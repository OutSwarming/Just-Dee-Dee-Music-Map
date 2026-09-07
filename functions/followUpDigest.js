'use strict';
const {calendarDate}=require('./venueFields');
const {parseCsv}=require('./jddmSpreadsheetBridge');
const APP='https://outswarming.github.io/Just-Dee-Dee-Music-Map/';
function dateKey(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
function plusDays(day,n){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function buildDigest({rows=[],emails=[],today=dateKey()}){
 const horizonEnd=plusDays(today,2);
 const venues=rows.map(v=>({id:v['Place ID']||'',name:String(v['Place Name']||'Unknown place'),date:calendarDate(v['Next Follow Up']),status:String(v.Status||'')})).filter(v=>v.date&&!/^(Booked|Played in the Past|Open Microphone|Told No)/i.test(v.status));
 const mail=emails.filter(e=>!e.venueId&&e.status==='followup'&&e.followUpDate).map(e=>({name:e.subject||e.correspondent||'Email conversation',date:e.followUpDate,url:`https://discord.com/channels/1543777084265070623/${e.discordThreadId}`}));
 const linkedUrls=id=>[...new Set(emails.filter(e=>id&&e.venueId===id&&e.discordThreadId).map(e=>`https://discord.com/channels/1543777084265070623/${e.discordThreadId}`))];
 const links=v=>linkedUrls(v.id).map(url=>'\n'+url).join('');
 const sort=(a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name);
 const due=venues.filter(v=>v.date<=today).sort(sort),upcoming=venues.filter(v=>v.date>today&&v.date<=horizonEnd).sort(sort);
 const dueMail=mail.filter(v=>v.date<=today).sort(sort),upcomingMail=mail.filter(v=>v.date>today&&v.date<=horizonEnd).sort(sort);
 const lines=['Hi Dee Dee, here are the places you need to contact today:',`Daily follow-ups — ${today} (Eastern)`,...due.map(v=>`• ${v.name}${v.date<today?' — overdue since '+v.date:''}${links(v)}`)];
 if(!due.length)lines.push('No places are due today.');
 if(dueMail.length)lines.push('','Email conversations needing follow-up:',...dueMail.map(v=>`• ${v.name} — ${v.date}\n${v.url}`));
 if(upcoming.length||upcomingMail.length)lines.push('','On the horizon — the next 2 days:',...upcoming.map(v=>`• ${v.name} — ${v.date}${links(v)}`),...upcomingMail.map(v=>`• Email: ${v.name} — ${v.date}\n${v.url}`));
 lines.push('',APP);
 return {today,body:lines.join('\n'),venues:due.length,emails:dueMail.length,horizonPlaces:upcoming.length,horizonEmails:upcomingMail.length};
}
async function loadDigest({db,fetchImpl=fetch,today=dateKey(),cache=true}){
 const ref=db.doc('jddmFollowUpDigests/'+today);
 const saved=(await ref.get()).data();if(cache&&saved?.body)return saved;
 const r=await fetchImpl('https://us-central1-barkrangermap-auth.cloudfunctions.net/jddmSpreadsheetBridge?action=csv',{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Live spreadsheet unavailable');
 const csv=parseCsv(await r.text()),headers=csv.shift();if(!headers?.includes('Next Follow Up')||!headers.includes('Place Name'))throw Error('Invalid spreadsheet response');
 const rows=csv.map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]||''])));
 const records=await db.collection('jddmEmailConversations').get();
 const emails=records.docs.map(d=>d.data());
 const digest=buildDigest({rows,emails,today});
 // The cloud Discord sender and local Messages sender use one frozen morning list.
 if(cache)return db.runTransaction(async tx=>{const s=(await tx.get(ref)).data();if(s?.body)return s;tx.set(ref,{...digest,createdAt:new Date().toISOString()});return digest;});
 return digest;
}
module.exports={buildDigest,loadDigest,dateKey,plusDays};
