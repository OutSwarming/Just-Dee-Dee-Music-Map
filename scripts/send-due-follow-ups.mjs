#!/usr/bin/env node
/** Only the shared 8 AM daily follow-up digest is sent through Messages. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dailyDigest,SUPPORT} from './lib/notificationClient.mjs';
const exec=promisify(execFile),ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const RECIPIENTS=['+14403054062','+12168499292'];
const STATE=path.join(SUPPORT,'daily-follow-up-delivery-v2.json'),LOCK=path.join(SUPPORT,'daily-follow-up-delivery.lock');
export function allowedRecipients(onlyMe=false,override=''){
 const requested=override?override.split(/[,\s;]+/).filter(Boolean):onlyMe?[RECIPIENTS[0]]:RECIPIENTS;
 if(requested.some(p=>!RECIPIENTS.includes(p)))throw Error('Follow-up texts are restricted to Dee Dee and Carter.');return [...new Set(requested)];
}
export async function deliverDigest({digest,state={},recipients=RECIPIENTS,send,persist=async()=>{}}){
 allowedRecipients(false,recipients.join(','));const day=digest.today;state[day] ||= {};
 const failures=[];for(const recipient of recipients){if(state[day][recipient]?.sent)continue;try{await send(recipient,digest.body);state[day][recipient]={sent:true,sentAt:new Date().toISOString()};await persist(state);}catch(e){failures.push({recipient,error:e.message});}}
 return {state,failures};
}
async function main(){
 const dry=process.argv.includes('--dry-run'),force=process.argv.includes('--force');
 if(process.argv.includes('--discord-only'))throw Error('The cloud service owns the daily Discord post; use --dry-run to preview.');
 // This worker polls for retry/catch-up, but it never sends the morning message early.
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'}).format(new Date()));
 if(!dry&&!force&&hour<8){console.log('Daily texts wait until 8 AM Eastern.');return;}
 const targets=allowedRecipients(process.argv.includes('--only-me'),process.env.JDDM_FOLLOWUP_RECIPIENTS||'');
 const digest=await dailyDigest();if(dry){console.log(JSON.stringify({recipients:targets,...digest},null,2));return;}
 await mkdir(SUPPORT,{recursive:true});try{if(Date.now()-(await stat(LOCK)).mtimeMs>10*60*1000)await rm(LOCK,{recursive:true,force:true});}catch(e){if(e.code!=='ENOENT')throw e;}try{await mkdir(LOCK);}catch(e){if(e.code==='EEXIST'){console.log('Daily delivery already running; will retry.');return;}throw e;}
 try{
  let state={};try{state=JSON.parse(await readFile(STATE,'utf8'));}catch{}if(force)delete state[digest.today];
  const persist=async s=>{await writeFile(STATE+'.tmp',JSON.stringify(s,null,2),{mode:0o600});await rename(STATE+'.tmp',STATE);};
  const result=await deliverDigest({digest,state,recipients:targets,persist,send:async(recipient,body)=>{
   const file=path.join(tmpdir(),'jddm-daily-followup-'+process.pid+'.txt');await writeFile(file,body,{mode:0o600});
   try{await exec(process.execPath,[path.join(ROOT,'scripts/send-local-message.mjs'),'--phone',recipient,'--message-file',file,'--daily-follow-up'],{timeout:120000});}finally{await rm(file,{force:true});}
  }});
  console.log(JSON.stringify({date:digest.today,recipients:targets.length,failures:result.failures.length}));if(result.failures.length)throw Error('Some follow-up texts failed; successful recipients are saved and failures will retry.');
 }finally{await rm(LOCK,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
