'use strict';
const crypto = require('node:crypto');
const email = require('./discordConversations');
const identity=require('./venueIdentity');
const {getHeader} = require('./discordEmailInteractions');
const PREFIX = 'jddmv';
const KINDS = {text:{name:'Text',label:'Received text',path:'messages'},calls:{name:'Missed call',label:'Missed-call notice',path:'calls'},voicemail:{name:'Voicemail',label:'Voicemail transcript',path:'voicemail'}};
const QUIET = {parse: []};
const hash = value => crypto.createHash('sha256').update(value || '').digest('hex').slice(0,8);
function phone(raw) {
 const digits=String(raw||'').replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');
 return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits)?digits:'';
}
function displayPhone(number) { return number.replace(/^(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3'); }
// Only incoming Google Voice SMS notifications qualify. Neither subjects alone
// nor arbitrary phone numbers in the message body can establish identity.
function parseText(message) {
 if(message.labelIds?.some(l=>['DRAFT','TRASH','SENT'].includes(l)))return null;
 const headers=message.payload?.headers||[];
 const sender=email.address(getHeader(headers,'From'));
 if(!sender.endsWith('@txt.voice.google.com')||!/^New text message from\s/i.test(getHeader(headers,'Subject')))return null;
 const local=sender.split('@')[0].split('.');
 const number=phone(local[1]);
 const subjectNumber=phone(getHeader(headers,'Subject').replace(/^New text message from\s*/i,''));
 if(!number||!phone(local[0])||(subjectNumber&&subjectNumber!==number))return null;
 let body=email.plainBody(message.payload).replace(/^\s*<https:\/\/voice\.google\.com\/?[^>]*>\s*/,'');
 const footer=body.indexOf('\nYOUR ACCOUNT <https://voice.google.com');
 if(footer>=0)body=body.slice(0,footer);
 body=body.replace(/\s*To respond to this text message, reply to this email or visit Google Voice\.\s*$/,'').trim();
 const files=[];function walk(p){if(p?.filename)files.push(p.filename);(p?.parts||[]).forEach(walk);}walk(message.payload);
 if(files.length)body+='\n\nAttachments: '+files.join(', ')+' — open the source notification to view.';
 return {id:message.id,key:number,kind:'text',phone:number,mailboxPhone:phone(local[0]),gmailThreadId:message.threadId,time:Number(message.internalDate),body:body||'(Open the source notification to view this text.)'};
}
function parseRecord(message) {
 const text=parseText(message);if(text)return text;
 if(message.labelIds?.some(l=>['DRAFT','TRASH','SENT'].includes(l)))return null;
 const headers=message.payload?.headers||[];
 if(email.address(getHeader(headers,'From'))!=='voice-noreply@google.com')return null;
 const subject=getHeader(headers,'Subject');
 const match=subject.match(/^(New voicemail|(?:New )?Missed call) from (.+)$/i);if(!match)return null;
 const kind=/voicemail/i.test(match[1])?'voicemail':'calls',number=phone(match[2]);
 let body=email.plainBody(message.payload).replace(/^\s*<https:\/\/voice\.google\.com\/?[^>]*>\s*/,'');
 const footer=body.indexOf('\nYOUR ACCOUNT <https://voice.google.com');if(footer>=0)body=body.slice(0,footer);
 body=body.replace(/\ncall back\n<https:\/\/voice\.google\.com\/calls[^>]*>/i,'');
 body=body.replace(/\nplay message\n<https:\/\/accounts\.google\.com\/AccountChooser[^>]*>/i,'').trim();
 return {id:message.id,key:kind+'-'+(number||'unknown-'+message.id),kind,phone:number,caller:number?'':match[2],gmailThreadId:message.threadId,time:Number(message.internalDate),body:body||'(No transcript available. Open the source notification.)'};
}
function title(c){return `${c.phone?displayPhone(c.phone):c.caller||'Unknown caller'}${c.venueName?' · '+c.venueName:''}`.slice(0,100);}
function card(c){
 const state=email.STATES[c.status]||email.STATES.deedee;
 const rows=email.controls(c.key||c.phone,c.topics||[],c);
 rows[0].components=rows[0].components.filter(x=>!x.custom_id.includes(':reply:'));
 rows[0].components.push({type:2,style:5,label:'Open Google Voice',url:'https://voice.google.com/u/2/'+(KINDS[c.kind]?.path||'messages')});
 for(const row of rows)for(const component of row.components)if(component.custom_id)component.custom_id=component.custom_id.replace(/^jddm2:/,PREFIX+':');
 return {content:`${state.emoji} **${state.name}**`,embeds:[{title:title(c),color:state.color,description:`📱 **${c.phone?displayPhone(c.phone):c.caller||'Unknown caller'}**\n${c.venueId?'📍 **'+c.venueName+'**'+(c.venueCity?' — '+c.venueCity:''):'📍 No venue linked — use Link venue'}\n📅 Official spreadsheet follow-up: **${c.followUpDate||'not scheduled'}**${c.venueLinkIssue?'\n⚠️ '+c.venueLinkIssue:''}\n\nGoogle Voice ${KINDS[c.kind]?.name.toLowerCase()||'text'} records grouped by phone number. Status and labels here organize Discord only.`,footer:{text:'Incoming records only • Respond in Google Voice'}}],components:rows,allowed_mentions:QUIET};
}
function chunks(text){
 const stamp=new Date(text.time).toLocaleString('en-US',{timeZone:'America/New_York'});
 return email.splitText(`**${KINDS[text.kind]?.label||'Received text'}** · ${stamp} Eastern\n**From:** ${text.phone?displayPhone(text.phone):text.caller||'Unknown caller'}\n\n${text.body}\n\n[Source notification](${email.mailUrl(text.gmailThreadId)})`).map((content,i)=>({content,flags:4096,allowed_mentions:QUIET,nonce:crypto.createHash('sha256').update('voice:'+text.id+':'+i).digest('hex').slice(0,24),enforce_nonce:true}));
}
function createService({db,gmail,discord,venueDirectory,now=()=>new Date()}) {
 db = require('./operationStore').operationDb(db);
 const collection=db.collection('jddmVoiceConversations');
 async function config(){return (await db.doc('jddmVoiceConfig/main').get()).data()||{};}
 function channelConfig(cfg,kind='text'){return {...cfg,...(cfg.channels?.[kind]||{})};}
 async function get(id){return (await collection.doc(id).get()).data();}
 async function locked(key,fn){const ref=db.doc('jddmVoiceLocks/'+key),owner=crypto.randomBytes(12).toString('hex');
  await db.runTransaction(async tx=>{const d=(await tx.get(ref)).data();if(d?.until>Date.now())throw Error('Another Google Voice update is in progress. Try again shortly.');tx.set(ref,{owner,until:Date.now()+500000});});
  try{return await fn();}finally{await db.runTransaction(async tx=>{if((await tx.get(ref)).data()?.owner===owner)tx.set(ref,{until:0},{merge:true});});}
 }
 const linkMemory=identity.createMemory(db);
 async function tryAutoLink(c){if(!venueDirectory||c.venueLinkMode==='manual')return c;try{const e=identity.voiceEvidence(c),found=identity.resolve(await venueDirectory.list(),e,await linkMemory.lookup(e.identities)),v=found.venue;return {...c,linkVersion:identity.VERSION,linkEvidence:e,venueCandidates:found.candidates.slice(0,12).map(v=>v.id),venueLinkReason:found.reason,venueLinkIssue:v?'':found.reason,...(v?{venueId:v.id,venueName:v.name,venueCity:v.city,followUpDate:v.date,venueLinkMode:'automatic'}:c.venueLinkMode==='automatic'?{previousAutomaticVenueId:c.venueId||'',venueId:'',venueName:'',venueCity:'',followUpDate:'',venueLinkMode:'review'}:{})};}catch{return {...c,venueLinkIssue:'Venue matching is temporarily unavailable; messages continue to arrive.'};}}
 async function rematchUnlinked(){if(!venueDirectory)return;const docs=await collection.get();for(const doc of docs.docs){const saved=doc.data();if(saved.venueLinkMode==='manual')continue;const candidate=await tryAutoLink(saved);if(require('./operationStore').same(saved,candidate)){await updateCard(saved);continue;}await locked(doc.id,async()=>{const c=await get(doc.id);if(!c||c.venueLinkMode==='manual')return;const next=await tryAutoLink(c);if(!require('./operationStore').same(c,next))await collection.doc(doc.id).set(next);await updateCard(next);});}}
 async function updateCard(c){
  const cfg=channelConfig(await config(),c.kind),path='/channels/'+c.discordThreadId;
  const current=await discord('GET',path),tags=email.appliedTags(c,cfg),patch={};
  if(current.name!==title(c))patch.name=title(c);
  if(JSON.stringify(current.applied_tags||[])!==JSON.stringify(tags))patch.applied_tags=tags;
  const rendered=card(c),cardHash=crypto.createHash('sha256').update(JSON.stringify(rendered)).digest('hex');
  if(current.thread_metadata?.archived&&(c.cardHash!==cardHash||Object.keys(patch).length))patch.archived=false;
  if(Object.keys(patch).length)await discord('PATCH',path,patch);
  if(c.cardHash!==cardHash){await discord('PATCH',`${path}/messages/${c.starterId}`,rendered);await collection.doc(c.key||c.phone).set({cardHash},{merge:true});}
  const shouldArchive=['resolved','rejected','spam'].includes(c.status);
  if(shouldArchive&&(!current.thread_metadata?.archived||patch.archived===false))await discord('PATCH',path,{archived:true});
 }

 async function syncMessage(message){const text=parseRecord(message);if(!text)return {skipped:true};return locked(text.key,async()=>{
  const cfg=channelConfig(await config(),text.kind);if(!cfg.enabled||!cfg.forumId)return {paused:true};
  const receipt=db.doc('jddmVoiceMessages/'+text.id);let state=(await receipt.get()).data()||{};
  if(state.complete)return {duplicate:true};
  let c=await get(text.key);
  if(!c){c={key:text.key,kind:text.kind,caller:text.caller||'',phone:text.phone,source:'google-voice-'+text.kind,gmailThreadId:text.key,status:'deedee',topics:text.kind==='text'?['textmessage']:[],venueId:'',followUpDate:'',createdAt:now().toISOString()};
   c=await tryAutoLink(c);
   // Recover a thread if Discord accepted creation before the database write.
   const active=await discord('GET',`/guilds/${email.GUILD_ID}/threads/active`);
   let post=(active.threads||[]).find(t=>t.parent_id===cfg.forumId&&t.name===title(c));
   if(!post)post=await discord('POST',`/channels/${cfg.forumId}/threads`,{name:title(c),message:{...card(c),flags:4096},applied_tags:email.appliedTags(c,cfg)});
   c.discordThreadId=post.id;c.starterId=post.message?.id||post.id;await collection.doc(text.key).set(c);
  }
  const parts=chunks(text);const currentThread=await discord('GET','/channels/'+c.discordThreadId);if(currentThread.thread_metadata?.archived)await discord('PATCH','/channels/'+c.discordThreadId,{archived:false});
  for(let i=state.nextPart||0;i<parts.length;i++){
   const posted=await discord('POST',`/channels/${c.discordThreadId}/messages`,parts[i]);
   state={...state,phone:text.phone,nextPart:i+1,discordThreadId:c.discordThreadId,messageIds:[...(state.messageIds||[]),posted.id]};await receipt.set(state);
  }
  if(text.time>Number(c.lastMessageAt||0)){c={...c,status:message.labelIds?.includes('SPAM')?'spam':'deedee',lastMessageAt:text.time,preview:text.body.slice(0,160),latestSourceThreadId:text.gmailThreadId};await collection.doc(text.key).set(c);}
  c=await tryAutoLink(c);await collection.doc(text.key).set(c);await updateCard(c);await receipt.set({complete:true,completedAt:now().toISOString()},{merge:true});
  return {posted:parts.length,phone:text.phone,discordThreadId:c.discordThreadId};
 });}
 async function refreshLinked(){if(!venueDirectory)return;const index=await venueDirectory.list({fresh:true});const docs=await collection.where('venueId','>','').get();const patchFor=c=>{const v=index.find(v=>v.id===c.venueId&&v.linkable!==false);return v?{venueName:v.name,venueCity:v.city,followUpDate:v.date,venueLinkIssue:''}:{venueLinkIssue:'Linked venue is unavailable. Use Change linked venue.'};};for(const d of docs.docs){const saved=d.data();if(require('./operationStore').same(saved,{...saved,...patchFor(saved)}))continue;await locked(d.id,async()=>{const c=await get(d.id);if(!c)return;const patch=patchFor(c);if(!require('./operationStore').same(c,{...c,...patch})){await collection.doc(d.id).set(patch,{merge:true});await updateCard({...c,...patch});}});}}
 async function linkVenue(id,venueId,actor,expected){return locked(id,async()=>{const c=await get(id);if(!c)throw Error('Conversation is not ready');if((c.venueId||'')!==expected)throw Error('Venue link changed; search again');const v=venueId?await venueDirectory.get(venueId):null;const updated={...c,venueId:v?.id||'',venueName:v?.name||'',venueCity:v?.city||'',followUpDate:v?.date||'',venueLinkMode:'manual',venueLinkIssue:'',lastActor:actor};await collection.doc(id).set(updated);await linkMemory.remember(identity.voiceEvidence(c).identities,'voice:'+id,venueId);await updateCard(updated);return updated;});}
 async function setStatus(id,status,actor,date,expected={}){return locked(id,async()=>{let c=await get(id);if(!c||!email.STATES[status])throw Error('Unknown conversation or status');if(status==='followup'){
  if(!email.validDate(date)||date<email.dateKey(now()))throw Error('Choose today or a future date');if(!c.venueId)throw Error('Link an existing venue first. New places are added in the map app');if(expected.hash!==hash(c.venueId))throw Error('Venue link changed. Reopen the date form');
  const v=await locked('place-'+hash(c.venueId),()=>venueDirectory.setDate(c.venueId,date,expected.date));c={...c,followUpDate:v.date,lastActor:actor};
 }else c={...c,status,lastActor:actor};await collection.doc(id).set(c);await updateCard(c);return c;});}
 async function setTopics(id,topics,actor){return locked(id,async()=>{const c=await get(id);if(!c||!Array.isArray(topics)||topics.some(t=>!email.TOPICS[t]))throw Error('Unknown label');const updated={...c,topics:[...new Set([...(c.kind==='text'?['textmessage']:[]),...topics])],lastActor:actor};await collection.doc(id).set(updated);await updateCard(updated);return updated;});}
 async function poll({limit=50}={}){return locked('poll',async()=>{const cfg=await config();if(!cfg.enabled)return {paused:true};const profile=(await gmail.users.getProfile({userId:'me'})).data;if(profile.emailAddress.toLowerCase()!==email.MAILBOX)throw Error('Wrong Gmail mailbox');
  const ref=db.doc('jddmVoiceConfig/checkpoint');let state=(await ref.get()).data()||{};
  if(!state.scanStarted)state={...state,scanStarted:Math.floor(now().getTime()/1000),scanAfter:state.after||Math.floor(now().getTime()/1000)-30*86400};
  let pending=state.pending||[];
  if(!pending.length){const page=(await gmail.users.messages.list({userId:'me',q:`in:anywhere -in:trash after:${state.scanAfter} {from:txt.voice.google.com from:voice-noreply@google.com}`,maxResults:100,pageToken:state.pageToken||undefined})).data;pending=(page.messages||[]).map(m=>m.id).reverse();state={...state,pending,pageToken:page.nextPageToken||''};await ref.set(state);}
  let processed=0,posted=0;while(pending.length&&processed<limit){const id=pending[0];const receipt=(await db.doc('jddmVoiceMessages/'+id).get()).data();if(!receipt?.complete){let m;try{m=(await gmail.users.messages.get({userId:'me',id,format:'full'})).data;}catch(e){if(Number(e.code)!==404)throw e;}
   if(m){const result=await syncMessage(m);if(result.paused)break;posted+=result.posted||0;}}
   pending.shift();processed++;await ref.set({pending},{merge:true});}
  const more=!!(pending.length||state.pageToken);
  if(!more)await ref.set({after:state.scanStarted-300,scanStarted:0,scanAfter:0,pageToken:'',pending:[]});
  await rematchUnlinked();await refreshLinked();return {processed,posted,more,pending:pending.length};
 });}
 return {config,get,tryAutoLink,rematchUnlinked,syncMessage,poll,updateCard,refreshLinked,linkVenue,setStatus,setTopics,reply:async()=>{throw Error('Google Voice intake does not send texts');},searchVenues:q=>venueDirectory.search(q),browseVenues:async c=>(await venueDirectory.list()).filter(v=>v.linkable!==false).sort((a,b)=>Number([c.venueId,...(c.venueCandidates||[])].includes(b.id))-Number([c.venueId,...(c.venueCandidates||[])].includes(a.id))||a.name.localeCompare(b.name))};
}
module.exports={PREFIX,KINDS,phone,displayPhone,parseText,parseRecord,title,card,chunks,createService};
