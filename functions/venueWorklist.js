'use strict';
const crypto=require('node:crypto');
const contacts=require('./contactRecords');
const {parseCsv}=require('./jddmSpreadsheetBridge');
const {calendarDate}=require('./venueFields');
const {verifyDiscordSignature}=require('./discordEmailInteractions');
const {dayKey,previousDay}=require('./appActivity');
const GUILD='1543777084265070623', APP='https://outswarming.github.io/Just-Dee-Dee-Music-Map/';
const BRIDGE='https://us-central1-barkrangermap-auth.cloudfunctions.net/jddmSpreadsheetBridge';
const STATUSES=['Needs Review','Not Contacted Yet','Contacted - Waiting on Reply','Booked','Played in the Past','Told No / Closed / No Music','Open Microphone','Not Set'];
const CONTACT_HEADERS=['Booking Contact','Contact Name','Contact Type','Email/Contact','Phone Number'];
const quiet={allowed_mentions:{parse:[]},flags:4096};
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex').slice(0,32);
const esc=v=>String(v||'').replace(/([*_`~|\\])/g,'\\$1');
const link=id=>APP+'?editVenue='+encodeURIComponent(id);
const dateLabel=d=>calendarDate(d)?calendarDate(d).split('-').slice(1).concat(calendarDate(d).slice(0,4)).join('/'):'Not set';
const personData=row=>contacts.tidy(contacts.read(row));
function missingInfo(row){const people=personData(row).contacts;return [!people.some(p=>p.name)&&'Contact name',!people.some(p=>p.emails.some(e=>e.value))&&'Email',!people.some(p=>p.phones.some(e=>e.value))&&'Phone',row.Status==='Needs Review'&&'Venue review'].filter(Boolean);}
function eligible(rows){const ids=new Map();rows.forEach(r=>ids.set(r['Place ID'],(ids.get(r['Place ID'])||0)+1));return rows.filter(r=>r['Place ID']&&ids.get(r['Place ID'])===1&&r['Place Name']&&!/^jddm-e2e-/.test(r['Place ID'])&&!/Told No|Closed|No Music/i.test(r.Status)&&(()=>{try{return missingInfo(r).length;}catch{return false;}})());}
function choose(rows,tasks,today,random=Math.random){
 const open=tasks.filter(t=>t.state==='open'),capacity=Math.max(0,4-open.length),known=new Map(tasks.map(t=>[t.venueId,t]));
 const pool=eligible(rows).filter(r=>{const t=known.get(r['Place ID']);return !t || (t.state==='deferred'&&t.deferUntil<=today);});
 const due=rows.filter(r=>rows.filter(x=>x['Place ID']===r['Place ID']).length===1&&known.get(r['Place ID'])?.state==='deferred'&&known.get(r['Place ID']).deferUntil<=today&&!/Told No|Closed|No Music/i.test(r.Status)).sort((a,b)=>known.get(a['Place ID']).deferUntil.localeCompare(known.get(b['Place ID']).deferUntil));
 const fresh=pool.filter(r=>!known.has(r['Place ID']));for(let i=fresh.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[fresh[i],fresh[j]]=[fresh[j],fresh[i]];}
 // Revisit completed, still-incomplete records only after all unseen records and a 30-day rest.
 const repeat=!fresh.length?eligible(rows).filter(r=>{const t=known.get(r['Place ID']);return t?.state==='done'&&Date.parse(today+'T12:00Z')-Date.parse(t.completedDay+'T12:00Z')>=30*86400000;}).sort((a,b)=>known.get(a['Place ID']).completedDay.localeCompare(known.get(b['Place ID']).completedDay)):[];
 return [...due,...fresh,...repeat].slice(0,capacity);
}
function button(id,action,label,style=2,extra={}){return {type:2,style,label,custom_id:`jddmw:${action}:${id}`,...extra};}
function card(task,row){
 const done=task.state==='done',deferred=task.state==='deferred',badge=done?'🟢':deferred?'🟠':'🔵';
 const people=personData(row).contacts;
 let detail=people.map((p,n)=>[`**${n+1}. ${esc(p.name||'Contact name not known yet')}**`,...p.emails.map(e=>'Email: '+esc(e.value)),...p.phones.map(e=>'Phone: '+esc(contacts.formatPhone(e.value))),...p.others.map(e=>`${esc(e.type||'Other')}: ${esc(e.value)}`),p.preferredMethod&&'Preferred: '+esc(p.preferredMethod),p.notes&&'Contact notes: '+esc(p.notes)].filter(Boolean).join('\n')).join('\n\n')||'No contacts recorded yet. Use **Edit contacts**; a phone-only or email-only contact is fine.';
 const venueNotes=String(row.Notes||'');if(venueNotes)detail+='\n\n**Venue notes**\n'+esc(venueNotes);
 if(detail.length>3600)detail=detail.slice(0,3480)+'\n… More saved details are available in Edit contacts or Open venue.';
 const needs=missingInfo(row);
 return {content:`${badge} **${done?'Done — venue information reviewed':deferred?'Rescheduled':'Venue information to review'}**\n${done?'Completed '+task.completedDay:deferred?'Returns '+dateLabel(task.deferUntil):'Selected '+task.assignedDay+' · Finish this post when you have reviewed the information.'}`,...quiet,
  embeds:[{title:String(row['Place Name']).slice(0,256),url:link(task.venueId),color:done?0x2ecc71:deferred?0xe67e22:0x3498db,
   description:[`**Address:** ${esc([row.Address,row.City,row.State,row.Zip].filter(Boolean).join(', '))||'Not recorded'}`,`**Spreadsheet status:** ${esc(row.Status)||'Not set'}`,`**Last contacted:** ${dateLabel(row['Last Contacted'])}`,`**Official follow-up:** ${dateLabel(row['Next Follow Up'])}`,`**Still missing:** ${needs.join(', ')||'No basic contact gaps'}`,'',detail].join('\n').slice(0,4096),footer:{text:'Existing spreadsheet row • Missing information can stay blank • All dates Eastern'}}],
  components:[{type:1,components:[{type:2,style:5,label:'Open venue',url:link(task.venueId)},button(task.id,'contacts','Edit contacts',1),button(task.id,'contacted','Contacted'),button(task.id,'date','Reschedule'),button(task.id,done?'reopen':'done',done?'Reopen':'Done',done?2:3)]},
   {type:1,components:[{type:3,custom_id:`jddmw:status:${task.id}`,placeholder:'Change the official spreadsheet status',options:STATUSES.map(value=>({label:value,value,default:value===row.Status}))}]},
   {type:1,components:[button(task.id,'refresh','Refresh from spreadsheet'),button(task.id,'notes','Edit venue notes')]}]};
}
function createSheetGateway({fetchImpl=fetch,secret=()=>process.env.JDDM_WORKLIST_EDIT_KEY}={}){
 async function call(action,payload={}){
  if(!['csv','getVenue','saveVenue'].includes(action))throw Error('Worklist can only edit existing venues');
  const body=JSON.stringify({action,...payload}),stamp=String(Date.now()),headers={'Content-Type':'application/json'};
  if(action==='saveVenue'){if(!secret())throw Error('Worklist save authentication is unavailable');headers['x-jddm-worklist-timestamp']=stamp;headers['x-jddm-worklist-signature']=crypto.createHmac('sha256',secret()).update(stamp+'.'+body).digest('hex');}
  const r=await fetchImpl(BRIDGE,{method:'POST',headers,body,signal:AbortSignal.timeout(65000)});
  if(action==='csv'){if(!r.ok)throw Error('Spreadsheet unavailable');const csv=parseCsv(await r.text()),h=csv.shift();if(!h?.includes('Place ID'))throw Error('Invalid spreadsheet response');return csv.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]||''])));}
  const d=await r.json();if(!r.ok||!d.ok)throw Object.assign(Error(d.message||'Spreadsheet save failed'),{code:d.code});return d;
 }
 return {list:()=>call('csv'),get:async id=>(await call('getVenue',{id})).rawFields,save:async(id,rawFields,expectedRawFields,requestId)=>call('saveVenue',{id,rawFields,expectedRawFields,requestId})};
}
function createService({db,discord,sheet,now=()=>new Date(),prefix='jddmVenueWorklist',random=Math.random}){
 const taskRef=id=>db.doc(prefix+'Tasks/'+id), sessionRef=id=>db.doc(prefix+'Sessions/'+id);
 const get=async id=>{const t=(await taskRef(id).get()).data();if(!t)throw Error('This venue post is no longer available');return {...t,id};};
 const all=async()=>(await db.collection(prefix+'Tasks').get()).docs.map(d=>({...d.data(),id:d.id}));
 async function lock(id,fn){const ref=db.doc(prefix+'Locks/'+id),owner=crypto.randomUUID();await db.runTransaction(async tx=>{const s=(await tx.get(ref)).data();if(s?.until>Date.now())throw Error('This worklist is already saving. Try again shortly.');tx.set(ref,{owner,until:Date.now()+180000});});try{return await fn();}finally{await db.runTransaction(async tx=>{if((await tx.get(ref)).data()?.owner===owner)tx.set(ref,{until:0},{merge:true});});}}
 async function config(){const c=(await db.doc(prefix+'/config').get()).data();if(!c?.enabled||!c.forumId)throw Error('Venue worklist is not enabled');return c;}
 async function current(t){const rows=await sheet.list();if(rows.filter(r=>r['Place ID']===t.venueId).length!==1)throw Error('The spreadsheet venue was removed or its ID is ambiguous. No row will be created.');return sheet.get(t.venueId);}
 async function publish(t,row){
  const cfg=await config(),body=card(t,row),digest=hash(JSON.stringify(body));
  if(t.messageHash===digest&&t.threadId)return t;
  let threadId=t.threadId;
  if(!threadId){
   // Recover an already-created forum post after a lost Firestore receipt.
   const active=await discord('GET',`/guilds/${GUILD}/threads/active`);
   for(const thread of (active.threads||[]).filter(x=>x.parent_id===cfg.forumId)){
    const starter=await discord('GET',`/channels/${thread.id}/messages/${thread.id}`);
    if(starter.embeds?.[0]?.url===link(t.venueId)){threadId=thread.id;break;}
   }
   if(!threadId){const post=await discord('POST',`/channels/${cfg.forumId}/threads`,{name:String(row['Place Name']).slice(0,100),auto_archive_duration:10080,applied_tags:[cfg.tags[t.state]].filter(Boolean),message:body});threadId=post.id;}
  }
  const thread=await discord('GET',`/channels/${threadId}`);
  if(thread.thread_metadata?.archived)await discord('PATCH',`/channels/${threadId}`,{archived:false});
  await discord('PATCH',`/channels/${threadId}/messages/${threadId}`,body);
  const name=String(row['Place Name']).slice(0,100);
  const tags=[cfg.tags[t.state]].filter(Boolean);
  if(thread.name!==name||JSON.stringify(thread.applied_tags||[])!==JSON.stringify(tags)||t.state==='done')await discord('PATCH',`/channels/${threadId}`,{...(thread.name!==name?{name}:{}),applied_tags:tags,...(t.state==='done'?{archived:true}:{})});
  const update={threadId,messageHash:digest,name:row['Place Name'],missing:missingInfo(row),followUpDate:calendarDate(row['Next Follow Up']),updatedAt:now().toISOString()};await taskRef(t.id).set(update,{merge:true});return {...t,...update};
 }
 async function refresh(){const rows=await sheet.list(),tasks=await all();let updated=0;for(const t of tasks){if(updated>=24)break;const matches=rows.filter(r=>r['Place ID']===t.venueId);if(matches.length!==1)continue;let next=t;
   // Sheets dates are authoritative, including changes made in the map app.
   if(t.state==='deferred'&&calendarDate(matches[0]['Next Follow Up'])!==t.deferUntil){next={...t,deferUntil:calendarDate(matches[0]['Next Follow Up'])||dayKey(now())};await taskRef(t.id).set({deferUntil:next.deferUntil},{merge:true});}
   if(hash(JSON.stringify(card(next,matches[0])))!==t.messageHash||!t.threadId){await lock(t.id,async()=>publish(await get(t.id),matches[0]));updated++;}
  }return {updated};}
 async function fill(){return lock('daily',async()=>{
  const cfg=await config(),today=dayKey(now()),stateRef=db.doc(prefix+'/daily'),state=(await stateRef.get()).data();
  if(state?.day===today)return {alreadyFilled:true};
  const rows=await sheet.list(),tasks=await all();
  const picks=choose(rows,tasks,today,random),selected=[];
  for(const row of picks){const id=hash(row['Place ID']),old=tasks.find(t=>t.id===id),t={...old,id,venueId:row['Place ID'],name:row['Place Name'],state:'open',assignedDay:today,completedDay:old?.completedDay||'',deferUntil:'',updatedAt:now().toISOString()};await taskRef(id).set(t);selected.push(id);}
  // Reserve all slots before posting; refresh retries incomplete delivery without adding more venues.
  await stateRef.set({day:today,selected,at:now().toISOString()});
  for(const id of selected){const t=await get(id);await publish(t,rows.find(r=>r['Place ID']===t.venueId));}
  return {selected:selected.length,carried:tasks.filter(t=>t.state==='open').length,forumId:cfg.forumId};
 });}
 async function prepare(id,user,channel){const t=await get(id);if(channel!==t.threadId)throw Error('Use this control in its original venue post');const row=await current(t),sid=crypto.randomBytes(8).toString('hex');await sessionRef(sid).set({taskId:id,user,channel,row,expiresAt:Date.now()+30*60000});return {t,row,sid};}
 async function session(sid,id,user,channel){const s=(await sessionRef(sid).get()).data();if(!s||s.taskId!==id||s.user!==user||s.channel!==channel||s.expiresAt<Date.now())throw Error('This form expired. Open Edit contacts again.');return s;}
 async function mutate(id,kind,values,{user,actor,channel,requestId,sid,index}){return lock(id,async()=>{
  let t=await get(id);if(t.threadId!==channel)throw Error('Use the current venue post');
  const row=await current(t),s=sid?await session(sid,id,user,channel):null;
  const fields={},expected={};let state=t.state;
  if(['contact','other'].includes(kind)){
   const base=s.row,data=personData(base);const n=Number(index);if(!Number.isInteger(n)||n<0||n>data.contacts.length)throw Error('Contact not found. Reload the form.');
   const p=structuredClone(data.contacts[n]||contacts.empty());
   if(kind==='contact'){
    p.name=String(values.name||'').trim();p.preferredMethod=String(values.preferred||'').trim();p.notes=String(values.notes||'').trim();
    for(const [key,validator]of [['emails',v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)],['phones',v=>/^\(\d{3}\) \d{3}-\d{4}(?: ext\. \d+)?$/.test(contacts.formatPhone(v))]]){
     const raw=String(values[key]||'').trim();if(raw!==p[key].map(x=>x.value).join('\n')){const list=raw.split(/[\n;,]+/).map(x=>x.trim()).filter(Boolean);if(list.some(v=>!validator(v)))throw Error(key==='emails'?'Use complete email addresses, one per line. Missing emails may stay blank.':'Use a full 10-digit US phone number, one per line. Missing phones may stay blank.');p[key]=[...new Set(list)].map(value=>({value:key==='phones'?contacts.formatPhone(value):value,note:''}));}
    }
   }else{
    p.preferredMethod=String(values.preferred||'').trim();const raw=String(values.other||'').trim();
    if(raw!==p.others.map(x=>`${x.type||'Other'} | ${x.value}`).join('\n'))p.others=raw.split('\n').map(v=>v.trim()).filter(Boolean).map(v=>{const split=v.indexOf('|');return {type:split<0?'Other':v.slice(0,split).trim(),value:split<0?v:v.slice(split+1).trim(),note:''};});
   }
   if(!p.name&&!p.notes&&!p.preferredMethod&&!p.emails.length&&!p.phones.length&&!p.others.length)throw Error('Add at least one detail. To remove a contact, use the app’s confirmed Remove contact control.');
   data.contacts[n]=p;Object.assign(fields,contacts.summary(data),{'Booking Contact':contacts.encode(data)});for(const h of CONTACT_HEADERS)expected[h]=base[h]||'';
  }else if(kind==='date'){
   const date=calendarDate(String(values.date||'').trim());if(!date||date<dayKey(now()))throw Error('Choose today or a future date, such as 09/20/2026.');fields['Next Follow Up']=date;expected['Next Follow Up']=s.row['Next Follow Up']||'';state='deferred';
  }else if(kind==='notes'){fields.Notes=String(values.notes||'').trim();expected.Notes=s.row.Notes||'';
  }else if(kind==='status'){if(!STATUSES.includes(values.status))throw Error('Choose a listed spreadsheet status');fields.Status=values.status;expected.Status=s.row.Status||'';
  }else if(kind==='contacted'){fields['Last Contacted']=dayKey(now());expected['Last Contacted']=s.row['Last Contacted']||'';if(['Needs Review','Not Contacted Yet','Not Set','Contacted - Waiting on Reply',''].includes(row.Status)){fields.Status='Contacted - Waiting on Reply';expected.Status=s.row.Status||'';}
  }else if(kind==='done'){
   if(t.state==='done')return {task:t,message:'This venue review is already complete.'};
   const marker=`[Venue information reviewed ${dayKey(now())}]`;fields.Notes=String(row.Notes||'').includes(marker)?row.Notes:[row.Notes,marker+' Contact information reviewed in the daily venue worklist.'].filter(Boolean).join('\n');expected.Notes=row.Notes||'';state='done';
  }else if(kind==='reopen'){if((await all()).filter(x=>x.state==='open'&&x.id!==id).length>=4)throw Error('Four venues are already open. Complete or reschedule one before reopening this post.');state='open';}else throw Error('Unknown venue action');
  if(Object.keys(fields).length){const saved=await sheet.save(t.venueId,fields,expected,'worklist-'+requestId);if(!saved.ok)throw Error('The spreadsheet did not save this change');}
  const fresh=await sheet.get(t.venueId);
  for(const [k,v]of Object.entries(fields)){if(CONTACT_HEADERS.includes(k))continue;if(String(fresh[k]||'')!==String(v))throw Error('The saved value changed again. Refresh this post before continuing.');}
  if(fields['Booking Contact']&&JSON.stringify(personData(fresh).contacts)!==JSON.stringify(personData(fields).contacts))throw Error('Contact save verification failed. Refresh before retrying.');
  const changes={state,lastActor:actor,updatedAt:now().toISOString(),...(state==='done'?{completedDay:dayKey(now())}:{}),...(kind==='date'?{deferUntil:calendarDate(fresh['Next Follow Up'])}:{})};await taskRef(id).set(changes,{merge:true});t=await publish({...t,...changes},fresh);
  return {task:t,message:kind==='done'?'🟢 Done! The review was recorded in the spreadsheet. This post is green and archived; the next morning fills its open slot.':kind==='date'?`🟠 Official spreadsheet follow-up saved: ${dateLabel(fresh['Next Follow Up'])}. This venue returns to the worklist on or after that date.`:'Saved to the official spreadsheet. The venue post has been refreshed.'};
 });}
 return {get,all,config,fill,refresh,prepare,session,mutate,publish};
}
function input(key,label,value='',style=1,max=1000){return {type:18,label,component:{type:4,custom_id:key,style,required:false,max_length:max,...(value?{value:String(value)}:{})}};}
function modal(id,sid,kind,index,s){let fields,title;const p=personData(s.row).contacts[Number(index)]||contacts.empty();
 if(kind==='contact'){title='Contact details';fields=[input('name','Contact name (may be blank)',p.name,1,200),input('emails','Email addresses — one per line',p.emails.map(x=>x.value).join('\n'),2,1200),input('phones','US phone numbers — one per line',p.phones.map(x=>x.value).join('\n'),2,1200),input('preferred','Preferred contact method',p.preferredMethod,1,200),input('notes','Notes for this person or venue contact',p.notes,2,4000)];}
 else if(kind==='other'){title='Other ways to contact';fields=[input('preferred','Preferred contact method',p.preferredMethod,1,200),input('other','One per line: Website | https://example.com',p.others.map(x=>`${x.type||'Other'} | ${x.value}`).join('\n'),2,4000)];}
 else if(kind==='date'){title='Official venue follow-up';fields=[input('date','Follow-up date (MM/DD/YYYY, Eastern)',calendarDate(s.row['Next Follow Up'])?dateLabel(s.row['Next Follow Up']):'',1,10)];}
 else{title='Venue notes';fields=[input('notes','Shared venue notes',s.row.Notes||'',2,4000)];}
 if(fields.some(f=>(f.component.value||'').length>f.component.max_length))throw Error('These saved details exceed Discord’s form size. Open venue to edit them safely in the app.');
 return {type:9,data:{title,custom_id:`jddmw:${kind}-submit:${id}:${sid}:${index||0}`,components:fields}};
}
function valuesOf(data){const result={};function walk(c){if(c.custom_id&&'value'in c)result[c.custom_id]=c.value;if(c.component)walk(c.component);(c.components||[]).forEach(walk);}walk(data);return result;}
function createInteractions({db,discord,service,publicKey}){return async(req,res)=>{
 const raw=req.rawBody||JSON.stringify(req.body);if(!verifyDiscordSignature({publicKey:publicKey(),signature:req.get('X-Signature-Ed25519'),timestamp:req.get('X-Signature-Timestamp'),rawBody:raw}))return res.status(401).send('Invalid signature');
 const i=req.body,[prefix,action,id,sid,index]=String(i.data?.custom_id||'').split(':');
 const user=i.member?.user?.id,actor=i.member?.nick||i.member?.user?.global_name||i.member?.user?.username||'Dee Dee';
 if(prefix!=='jddmw'||i.guild_id!==GUILD||!user||!id||!/^[a-f0-9]{32}$/.test(id))return res.json({type:4,data:{content:'Open this control in the JDDM venue worklist.',flags:64}});
 // These buttons use a prepared private snapshot, so the modal opens within Discord's response window.
 if(['contact-form','other-form','date-form','notes-form'].includes(action)){
  try{const s=await service.session(sid,id,user,i.channel_id);const n=i.data.values?.[0]??index??0;return res.json(modal(id,sid,action.replace('-form',''),n,s));}catch(e){return res.json({type:4,data:{content:e.message,flags:64}});}
 }
 await discord('POST',`/interactions/${i.id}/${i.token}/callback`,{type:5,data:{flags:64}});
 const receipt=db.doc('jddmWorklistActions/'+i.id);
 const claimed=await db.runTransaction(async tx=>{const s=await tx.get(receipt);if(s.exists)return false;tx.set(receipt,{state:'started',at:new Date().toISOString()});return true;});if(!claimed)return res.status(202).send('Already handled');
 try{let content,components=[];
  if(['contacts','date','notes','contacted','status','done'].includes(action)){
   const prepared=await service.prepare(id,user,i.channel_id),{row,sid:newSid}=prepared;
   if(action==='contacts'){
    const people=personData(row).contacts;
    const options=people.slice(0,24).map((p,n)=>({label:(p.name||p.emails[0]?.value||p.phones[0]?.value||'Unnamed contact '+(n+1)).slice(0,100),value:String(n),description:'Edit this contact’s name, phone, email and notes'}));
    content='Choose a contact below, or add another contact. A name, phone number, or email can stay blank. Each contact has one set of notes.';
    if(people.length>24)content+=' More contacts are available through Open venue.';
    components=[{type:1,components:[{type:3,custom_id:`jddmw:contact-form:${id}:${newSid}`,placeholder:'Edit a contact or add another',options:[...options,{label:'＋ Add another contact',value:String(people.length)}]}]}];
    if(options.length)components.push({type:1,components:[{type:3,custom_id:`jddmw:other-form:${id}:${newSid}`,placeholder:'Edit websites / other ways to contact',options}]});
   }else if(action==='date'||action==='notes'){
    content=action==='date'?`Current official follow-up: **${dateLabel(row['Next Follow Up'])}**. Rescheduling saves the spreadsheet date and pauses this worklist post until then.`:'Edit the shared venue notes. Contact-specific notes are under Edit contacts.';
    components=[{type:1,components:[button(id,`${action}-form`,'Open '+(action==='date'?'date form':'notes'),1,{custom_id:`jddmw:${action}-form:${id}:${newSid}:0`})]}];
   }else if(action==='status'){
    const status=i.data.values?.[0];if(!STATUSES.includes(status))throw Error('Invalid status');content=`Change **${esc(row['Place Name'])}** from **${esc(row.Status)}** to **${esc(status)}**?`;
    components=[{type:1,components:[button(id,'status-confirm','Save status',1,{custom_id:`jddmw:status-confirm:${id}:${newSid}:${STATUSES.indexOf(status)}`})]}];
   }else{
    content=action==='contacted'?`Mark **${esc(row['Place Name'])}** contacted today? This records today as Last Contacted; it does not send an email or text.`:`Finish reviewing **${esc(row['Place Name'])}**? A dated review note will be saved in the spreadsheet and this post will turn green. Missing details may stay blank; booking status is kept.`;
    components=[{type:1,components:[button(id,action+'-confirm',action==='done'?'Yes, done':'Yes, contacted',3,{custom_id:`jddmw:${action}-confirm:${id}:${newSid}:0`})]}];
   }
  }else if(action==='refresh'){
   const p=await service.prepare(id,user,i.channel_id);await service.publish(p.t,p.row);content='Refreshed from the official spreadsheet.';
  }else{
   const kind=action.replace(/-(submit|confirm)$/,''),values=valuesOf(i.data);if(kind==='status')values.status=STATUSES[Number(index)];
   const result=await service.mutate(id,kind,values,{user,actor,channel:i.channel_id,requestId:i.id,sid,index});content=result.message;
  }
  await discord('PATCH',`/webhooks/${i.application_id}/${i.token}/messages/@original`,{content,components,allowed_mentions:{parse:[]}});await receipt.set({state:'complete'},{merge:true});
 }catch(e){
  const draft=valuesOf(i.data);if(sid&&Object.keys(draft).length)await db.doc('jddmVenueWorklistSessions/'+sid).set({draft,draftError:e.message},{merge:true});
  const draftText=Object.entries(draft).map(([k,v])=>`${k}: ${v}`).join('\n');
  await discord('PATCH',`/webhooks/${i.application_id}/${i.token}/messages/@original`,{content:('Could not finish: '+e.message+(draftText?'\n\nYour submitted draft was kept privately. Reopen Edit contacts to compare with the latest spreadsheet before saving again.\n'+draftText:'')).slice(0,1950),components:[],allowed_mentions:{parse:[]}});await receipt.set({state:'failed',error:e.message},{merge:true});
 }
 return res.status(200).send('Handled');
};}
module.exports={GUILD,APP,STATUSES,CONTACT_HEADERS,missingInfo,eligible,choose,card,link,createSheetGateway,createService,modal,valuesOf,createInteractions};
