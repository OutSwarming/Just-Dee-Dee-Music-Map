'use strict';
const {parseCsv}=require('./jddmSpreadsheetBridge');
const contacts=require('./contactRecords');
const {calendarDate}=require('./venueFields');
const BRIDGE='https://us-central1-barkrangermap-auth.cloudfunctions.net/jddmSpreadsheetBridge';
const MAILBOX='justdeedeemusic@gmail.com';
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const emails=s=>[...new Set((String(s||'').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).map(e=>e.toLowerCase()).filter(e=>e!==MAILBOX))];
function indexRows(rows){
 const counts=new Map();for(const r of rows){const id=String(r['Place ID']||'').trim();if(id)counts.set(id,(counts.get(id)||0)+1);}
 return rows.filter(r=>r['Place Name']&&String(r['Place ID']||'').trim()).map(r=>{
  let people=[];try{people=contacts.read(r).contacts||[];}catch{};
  const contactEmails=[...emails(r['Email/Contact']),...people.flatMap(p=>p.emails.flatMap(e=>emails(e.value)))];
  const text=[r['Place Name'],r.City,r.State,r['Contact Name'],r['Email/Contact'],r['Phone Number'],...people.flatMap(p=>[p.name,...p.emails.map(e=>e.value),...p.phones.map(e=>e.value)])].join(' ');
  return {linkable:counts.get(String(r['Place ID']).trim())===1,id:String(r['Place ID']).trim(),name:r['Place Name'],city:[r.City,r.State].filter(Boolean).join(', '),emails:[...new Set(contactEmails)],search:norm(text),date:calendarDate(r['Next Follow Up']),rawDate:r['Next Follow Up']||''};
 });
}
function searchVenues(index,query){const q=norm(query);if(q.length<2)return[];const terms=q.split(' ');return index.filter(v=>v.linkable!==false&&terms.every(t=>v.search.includes(t))).sort((a,b)=>(norm(b.name)===q)-(norm(a.name)===q)||Number(norm(b.name).startsWith(q))-Number(norm(a.name).startsWith(q))||a.name.localeCompare(b.name));}
function matchVenue(index,messages){
 const participants=new Set();for(const m of messages||[])for(const h of m.payload?.headers||[])if(['from','to','cc','reply-to'].includes(h.name.toLowerCase()))for(const e of emails(h.value))participants.add(e);
 const matches=index.filter(v=>v.emails.some(e=>participants.has(e)));
 return {venue:matches.length===1&&matches[0].linkable!==false?matches[0]:null,candidates:matches,reason:matches.length>1?'More than one venue matches these email participants.':matches.length===1?(matches[0].linkable===false?'Matching venue has a duplicate Place ID; correct it in the app.':'Unique exact email address match.'):'No unique saved email address match.'};
}
function createVenueDirectory({fetchImpl=fetch,now=()=>Date.now()}={}){
 let cached,until=0;
 async function list({fresh=false}={}){if(cached&&!fresh&&now()<until)return cached;const r=await fetchImpl(BRIDGE+'?action=csv',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Venue search is temporarily unavailable.');const data=parseCsv(await r.text()),headers=data.shift();if(!headers?.includes('Place ID')||!headers.includes('Next Follow Up'))throw Error('Venue spreadsheet headers are unavailable.');cached=indexRows(data.map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]||'']))));until=now()+60000;return cached;}
 async function get(id,{fresh=true}={}){const v=(await list({fresh})).find(v=>v.id===id&&v.linkable!==false);if(!v)throw Error('This venue is missing or has a duplicate Place ID. Correct it in the map app.');return v;}
 async function setDate(id,date,expected){const v=await get(id);if(v.date!==expected)throw Error('The venue follow-up changed. Reopen Set follow-up date to review the latest date.');const r=await fetchImpl(BRIDGE,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),body:JSON.stringify({action:'saveVenue',id,rawFields:{'Next Follow Up':date},expectedRawFields:{'Next Follow Up':v.rawDate}})});const result=await r.json();if(!r.ok||!result.ok)throw Error(result.message||'The spreadsheet could not save this date.');until=0;const saved=await get(id);if(saved.date!==date)throw Error('The saved date could not be verified. Reopen the venue before retrying.');return saved;}
 return {list,get,setDate,search:async q=>searchVenues(await list(),q)};
}
module.exports={BRIDGE,indexRows,searchVenues,matchVenue,createVenueDirectory};
