'use strict';
const {parseCsv}=require('./jddmSpreadsheetBridge');
const contacts=require('./contactRecords');
const {calendarDate}=require('./venueFields');
const identity=require('./venueIdentity');
const BRIDGE='https://us-central1-barkrangermap-auth.cloudfunctions.net/jddmSpreadsheetBridge';
const MAILBOX='justdeedeemusic@gmail.com';
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const emails=identity.emails, phones=identity.phones;
function messageText(payload){const texts=[];function walk(p){if(!p)return;if(p.body?.data&&['text/plain','message/delivery-status','message/rfc822'].includes(p.mimeType))texts.push(Buffer.from(p.body.data,'base64url').toString('utf8'));(p.parts||[]).forEach(walk);}walk(payload);return texts.join('\n');}
function venueName(raw){return norm(String(raw||'').replace(/\s+\d+\s+.*$/,''));}
function indexRows(rows){
 const counts=new Map();for(const r of rows){const id=String(r['Place ID']||'').trim();if(id)counts.set(id,(counts.get(id)||0)+1);}
 return rows.filter(r=>r['Place Name']&&String(r['Place ID']||'').trim()).map(r=>{
  let people=[],autoLinkable=true;try{people=contacts.read(r).contacts||[];}catch{autoLinkable=false;}
  const contactEmails=[...emails(r['Email/Contact']),...people.flatMap(p=>p.emails.flatMap(e=>emails(e.value)))];
  const text=[r['Place Name'],r.Address,r.City,r.State,r.Zip,r['Contact Name'],r['Email/Contact'],r['Phone Number'],...people.flatMap(p=>[p.name,...p.emails.map(e=>e.value),...p.phones.map(e=>e.value),...p.others.map(e=>e.type+' '+e.value)])].join(' ');
  const contactNames=[...new Set([r['Contact Name'],...people.map(p=>p.name)].map(norm).filter(Boolean))];
  const socialProfiles=[...new Set([identity.socialProfile(r.Website),...people.flatMap(p=>p.others.map(o=>identity.socialProfile(o.value,/insta/i.test(o.type)?'instagram':undefined)))].filter(Boolean))];
  const domains=[...new Set([r.Website,...people.flatMap(p=>p.others.filter(x=>!/insta|facebook|messenger/i.test(x.type)).map(x=>x.value)),...contactEmails.map(e=>e.split('@')[1])].map(identity.domain).filter(Boolean))];
  return {calendarRow:{'Place ID':String(r['Place ID']).trim(),'Place Name':r['Place Name'],Address:r.Address||'',City:r.City||'',State:r.State||'',Zip:r.Zip||''},autoLinkable,contactNames,socialProfiles,address:r.Address||'',state:r.State||'',zip:r.Zip||'',names:[...new Set([norm(r['Place Name']),venueName(r['Place Name']),venueName(r['Place Name']).replace(/ (?:company|co|inc|llc)$/,'')])],domains,phones:[...new Set([r['Phone Number'],...people.flatMap(p=>p.phones.map(x=>x.value))].flatMap(phones))],linkable:counts.get(String(r['Place ID']).trim())===1,id:String(r['Place ID']).trim(),name:r['Place Name'],city:(/^[A-Z]{2}\s+\d{5}(?:-\d{4})?$/.test(String(r.City||'').trim())&&r.Address&&!/\d/.test(r.Address)?[r.Address,r.City]:[r.City,r.State]).filter(Boolean).join(', '),emails:[...new Set(contactEmails)],search:norm(text),date:calendarDate(r['Next Follow Up']),rawDate:r['Next Follow Up']||''};
 });
}
// Manual suggestions only: spelling similarity never establishes an automatic link.
function editDistance(a,b){
 const rows=Array.from({length:a.length+1},(_,i)=>[i]);for(let j=0;j<=b.length;j++)rows[0][j]=j;
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){
  rows[i][j]=Math.min(rows[i-1][j]+1,rows[i][j-1]+1,rows[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])rows[i][j]=Math.min(rows[i][j],rows[i-2][j-2]+1);
 }return rows[a.length][b.length];
}
function wordCost(term,word){
 if(word.includes(term))return 0;
 if(term.length<3||/^\d+$/.test(term))return Infinity;
 const limit=term.length>=9?3:term.length>=5?2:1;
 let distance=Math.abs(term.length-word.length)<=limit?editDistance(term,word):Infinity;
 if(term.length>=4&&word.length>term.length)distance=Math.min(distance,editDistance(term,word.slice(0,term.length)));
 return distance<=limit&&distance/term.length<=0.4?distance:Infinity;
}
function searchVenues(index,query){
 const q=norm(query).slice(0,100);if(q.length<2)return[];
 const allTerms=[...new Set(q.split(' '))],meaningful=allTerms.filter(t=>!['the','and','at'].includes(t)),terms=meaningful.length?meaningful:allTerms;
 const results=[];
 for(const v of index){if(v.linkable===false)continue;
  const name=norm(v.name),nameCompact=name.replace(/ /g,''),qCompact=q.replace(/ /g,''),tokens=[...new Set((v.search||name).split(' '))];
  let score=Infinity;
  if(name===q||nameCompact===qCompact)score=0;
  else if(name.startsWith(q)||nameCompact.startsWith(qCompact))score=5;
  else if(terms.every(t=>name.includes(t)))score=10;
  else if(terms.every(t=>(v.search||name).includes(t)))score=20;
  else {
   const costs=terms.map(t=>Math.min(...tokens.map(w=>wordCost(t,w))));
   if(costs.every(Number.isFinite))score=40+costs.reduce((a,b)=>a+b,0)*10;
   if(terms.length===1&&q.length>=5)score=Math.min(score,40+wordCost(qCompact,nameCompact)*10);
  }
  if(Number.isFinite(score))results.push({...v,searchScore:score,approximateMatch:score>=40});
 }
 return results.sort((a,b)=>a.searchScore-b.searchScore||a.name.localeCompare(b.name));
}
function emailEvidence(messages){
 const participants=new Set(),voicePhones=new Set(),subjects=[],calendarEvents=[];
 for(const m of messages||[]){if(m.labelIds?.some(l=>['DRAFT','TRASH'].includes(l)))continue;
  const headers=m.payload?.headers||[],get=name=>headers.find(h=>h.name.toLowerCase()===name.toLowerCase())?.value||'';
  for(const h of headers)if(['from','to','cc','reply-to'].includes(h.name.toLowerCase()))for(const e of emails(h.value))participants.add(e);
  subjects.push(norm(get('subject')));
  const forwarded=messageText(m.payload).match(/(?:Begin forwarded message:|-{2,}\s*Forwarded message\s*-{2,})([\s\S]{0,3000})/i);
  if(forwarded){const block=forwarded[1].replace(/^\s+/, '').split(/\r?\n\s*\r?\n/)[0];for(const h of block.matchAll(/^(?:From|To|Cc|Reply-To):[ \t]*(.+)$/gim))for(const e of emails(h[1]))participants.add(e);}

  const from=(get('from').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).map(e=>e.toLowerCase());
  // Use the event's structured body and Google's authentication result, never an arbitrary subject mention.
  if(from.includes('calendar-notification@google.com')&&/^mx\.google\.com;[\s\S]*\bdkim=pass\s+header\.i=@google\.com\b/i.test(get('Authentication-Results'))){
   const body=messageText(m.payload),title=body.trim().split(/\r?\n/)[0]||'',location=body.match(/(?:^|\n)Location\r?\n([^\r\n]+)/)?.[1]?.trim()||'';
   if(/^just\s*dee\s*dee\s*music\s+live\s*@\s*/i.test(title)&&location)calendarEvents.push({title,location});
  }

  if(from.some(e=>e.endsWith('@txt.voice.google.com'))&&/^(?:(?:re|fwd?):\s*)*new text message from\b/i.test(get('subject')))for(const p of phones(get('subject')))voicePhones.add(p);
  // Delivery notices carry their recipient outside normal From/To headers.
  if(from.some(e=>/^mailer-daemon@(?:googlemail|google)\.com$/.test(e))){
   const text=messageText(m.payload);
   for(const match of text.matchAll(/(?:Final-Recipient:\s*rfc822;\s*|problem delivering your message to\s+|Your message (?:wasn't delivered|couldn't be delivered) to\s+)([^\s<>]+)/gi))for(const e of emails(match[1]))participants.add(e);
  }
 }
 const identityEmails=[...participants].filter(e=>!/(?:^|[._-])(?:no-?reply|notification|mailer-daemon|calendar-notification)(?:[._@-]|$)/i.test(e)&&!e.endsWith('@google.com')&&!e.endsWith('@googlemail.com'));
 return {source:'email',calendarEvents,emails:[...participants],phones:[...voicePhones],domains:[...new Set([...participants].map(e=>identity.domain(e.split('@')[1])).filter(Boolean))],subjects,identities:identityEmails.length===1?identityEmails.map(e=>'email:'+e):[],names:[],profiles:[],text:''};
}
function matchVenue(index,messages,memory=[]){return identity.resolve(index,emailEvidence(messages),memory);}

function createVenueDirectory({fetchImpl=fetch,now=()=>Date.now()}={}){
 let cached,until=0;
 async function list({fresh=false}={}){if(cached&&!fresh&&now()<until)return cached;const r=await fetchImpl(BRIDGE+'?action=csv',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Venue search is temporarily unavailable.');const data=parseCsv(await r.text()),headers=data.shift();if(!headers?.includes('Place ID')||!headers.includes('Next Follow Up'))throw Error('Venue spreadsheet headers are unavailable.');cached=indexRows(data.map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]||'']))));until=now()+60000;return cached;}
 async function get(id,{fresh=true}={}){const v=(await list({fresh})).find(v=>v.id===id&&v.linkable!==false);if(!v)throw Error('This venue is missing or has a duplicate Place ID. Correct it in the map app.');return v;}
 async function setDate(id,date,expected){const v=await get(id);if(v.date!==expected)throw Error('The venue follow-up changed. Reopen Set follow-up date to review the latest date.');const r=await fetchImpl(BRIDGE,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),body:JSON.stringify({action:'saveVenue',id,rawFields:{'Next Follow Up':date},expectedRawFields:{'Next Follow Up':v.rawDate}})});const result=await r.json();if(!r.ok||!result.ok)throw Error(result.message||'The spreadsheet could not save this date.');until=0;const saved=await get(id);if(saved.date!==date)throw Error('The saved date could not be verified. Reopen the venue before retrying.');return saved;}
 return {list,get,setDate,search:async q=>searchVenues(await list(),q)};
}
module.exports={BRIDGE,indexRows,searchVenues,matchVenue,emailEvidence,createVenueDirectory};
