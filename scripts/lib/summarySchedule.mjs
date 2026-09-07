import {createHash} from 'node:crypto';
import dates from '../../functions/followUpDigest.js';
export const SUMMARY_RECIPIENTS=['+14403054062','+12168499292'];
export function easternMinutes(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const n=t=>Number(parts.find(p=>p.type===t).value);return n('hour')*60+n('minute');
}
export function fingerprint(input){
 return createHash('sha256').update(JSON.stringify({today:input.today,metrics:input.metrics,todayPlan:input.todayPlan,warnings:input.warnings,sources:input.sources.map(({label,text,url})=>({label,text,url})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})).digest('hex');
}
export async function advanceRecap({state,now=new Date(),clock=()=>now,loadSources,generate,render,sendDiscord,sendText,persist=async()=>{}}){
 const day=dates.dateKey(now),minutes=easternMinutes(now);
 if(minutes<360)return {waiting:'6 AM preparation'};
 const record=state[day]||={};record.deliveries||={discord:!!record.sent,texts:{}};record.deliveries.texts||={};
 if(record.deliveries.discord&&SUMMARY_RECIPIENTS.every(p=>record.deliveries.texts[p])){record.sent=true;return {complete:true};}
 const anyDelivered=record.deliveries.discord||Object.values(record.deliveries.texts).some(Boolean);
 const refresh=!record.body||(minutes>=465&&!record.refreshedAt)||(minutes>=485&&!record.deliveryCheckedAt);
 if(refresh&&!anyDelivered){
  const input=await loadSources();if(input.today!==day)throw Error('Source date does not match today');
  if(!input.metrics||!input.todayPlan?.calendarAvailable)throw Error('Waiting for current gig/calendar and spreadsheet records');
  const nextHash=fingerprint(input);
  if(!record.body||record.fingerprint!==nextHash){const summary=await generate(input);const output=render(summary,input);Object.assign(record,output,{fingerprint:nextHash,input,summary,gigKeys:input.metrics.gigKeys,generatedAt:clock().toISOString()});}
  if(minutes>=465)record.refreshedAt=clock().toISOString();if(minutes>=485)record.deliveryCheckedAt=clock().toISOString();await persist(state);
 }
 const deliveryNow=clock();if(dates.dateKey(deliveryNow)!==day)return {waiting:'next day'};
 if(easternMinutes(deliveryNow)<485)return {prepared:true,waiting:'8:05 AM delivery'};
 if(!record.body||!record.smsBody)throw Error('Prepared recap is missing');
 const failures=[];
 if(!record.deliveries.discord){try{await sendDiscord(record.body,day);record.deliveries.discord=true;await persist(state);}catch(e){failures.push('Discord: '+e.message);}}
 for(const recipient of SUMMARY_RECIPIENTS){if(record.deliveries.texts[recipient])continue;try{await sendText(recipient,record.smsBody);record.deliveries.texts[recipient]=true;await persist(state);}catch(e){failures.push('Messages: '+e.message);}}
 record.sent=record.deliveries.discord&&SUMMARY_RECIPIENTS.every(p=>record.deliveries.texts[p]);if(record.sent)record.sentAt=clock().toISOString();await persist(state);
 return {prepared:true,complete:record.sent,failures};
}
