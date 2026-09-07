'use strict';
const crypto = require('node:crypto');
const venueLinks = require('./venueLinks');
const linkHash = id => crypto.createHash('sha256').update(id||'').digest('hex').slice(0,8);
const { verifyDiscordSignature, buildReplyRaw, getHeader } = require('./discordEmailInteractions');
const GUILD_ID = '1543777084265070623';
const FORUM_ID = '1543777722042679436';
const MAILBOX = 'justdeedeemusic@gmail.com';
const STATES = {
  venue: { name: 'Waiting on venue', emoji: '🟡', color: 0xf1c40f },
  deedee: { name: 'Waiting on DEE DEE', emoji: '🔵', color: 0x3498db },
  resolved: { name: 'Resolved', emoji: '🟢', color: 0x2ecc71 },
  rejected: { name: 'Rejected', emoji: '🔴', color: 0xe74c3c },
  spam: { name: 'Spam', emoji: '🟣', color: 0x9b59b6 },
  followup: { name: 'Follow up', emoji: '🟠', color: 0xe67e22 }
};
const TOPICS = {
  gigprep: { name: 'Gig prep', emoji: '🩵', color: 0x1abc9c },
  songs: { name: 'Song requests', emoji: '🩷', color: 0xe91e63 },
  textmessage: { name: 'Text message', emoji: '🟤', color: 0xa8794f },
  newevent: { name: 'New Event', emoji: '⚪', color: 0xecf0f1 }
};
const ALLOWED_MENTIONS = { parse: [] };
function dateKey(date = new Date()) { return new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit'}).format(date); }
function followUpDate(raw){const value=String(raw||'').trim();if(/^\d{4}-\d{2}-\d{2}$/.test(value))return validDate(value)?value:'';const date=new Date(value);return Number.isNaN(date.getTime())?'':dateKey(date);}
function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s+'T12:00:00Z')) && new Date(s+'T12:00:00Z').toISOString().slice(0,10) === s; }
function cleanHeader(s) { return String(s || '').replace(/[\r\n]/g,' ').trim(); }
function address(s) { const m=String(s||'').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i); return m ? m[0].toLowerCase() : ''; }
function ownMessage(message) { return message.labelIds?.includes('SENT') || address(getHeader(message.payload?.headers,'From')) === MAILBOX; }
function contactName(value){const clean=cleanHeader(value);const before=clean.split('<')[0].trim().replace(/^"|"$/g,'').trim();return (before&&before!==clean?before:address(clean)||clean)||'Email';}
function threadTitle(c){const subject=cleanHeader(c.displaySubject||c.subject).replace(/^(?:(?:re|fwd?):\s*)+/i,'')||'(No subject)';return `${contactName(c.correspondent).slice(0,32)} · ${subject.replace(/^New event: JustDeeDeeMusic Live @ /i,'Gig: ')}`.slice(0,100);}
function automaticTopics(messages) {
 const topics=new Set();
 for(const message of messages||[]){
  const subject=cleanHeader(getHeader(message.payload?.headers,'Subject')).replace(/^(?:(?:re|fwd?):\s*)+/i,'');
  if(/^New text message\b/i.test(subject))topics.add('textmessage');
  if(/^New event\b/i.test(subject))topics.add('newevent');
 }
 return [...topics];
}
function appliedTags(c,cfg){return [cfg.tags?.[c.status],...(c.topics||[]).map(t=>cfg.topicTags?.[t])].filter(Boolean);}
function splitText(text, limit=1850) {
  const parts=[]; let rest=String(text||'');
  while(rest.length>limit){let n=rest.lastIndexOf('\n',limit);if(n<limit/2)n=limit;if(/[\uD800-\uDBFF]/.test(rest[n-1]))n--;parts.push(rest.slice(0,n));rest=rest.slice(n).replace(/^\n/,'');}
  if(rest)parts.push(rest);return parts;
}
function plainBody(payload) {
  const nodes=[];function visit(p){if(!p)return;if(p.body?.data)nodes.push(p);(p.parts||[]).forEach(visit);}visit(payload);
  const node=nodes.find(p=>p.mimeType==='text/plain')||nodes.find(p=>p.mimeType==='text/html')||nodes[0];
  if(!node)return '(No plain-text body. Open the original email for attachments.)';
  let text=Buffer.from(node.body.data,'base64url').toString('utf8');
  if(node.mimeType==='text/html')text=text.replace(/<(script|style)[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?>|<\/p>|<\/div>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"');
  // Remove only recognizable quoted history; the actual original messages are
  // posted separately in chronological order, without truncating their bodies.
  text=text.replace(/\r\n/g,'\n');const cut=text.search(/\n(?:On [^\n]{3,220}(?:\n[^\n]{0,220}){0,3}wrote:|[- ]{2,}Original Message[- ]*)\s*\n/i);
  const forwardedAt=text.search(/Begin forwarded message:|[- ]+Forwarded message[- ]+/i);
  if(cut>0&&(forwardedAt<0||cut<forwardedAt))text=text.slice(0,cut);
  return text.trim()||'(See original email.)';
}
function attachments(payload){const names=[];function visit(p){if(p?.filename)names.push(p.filename);(p?.parts||[]).forEach(visit);}visit(payload);return names;}
function mailUrl(id){return `https://mail.google.com/mail/?authuser=${MAILBOX}#all/${id}`;}
function conversationUrl(id){return `https://discord.com/channels/${GUILD_ID}/${id}`;}
function controls(id,topics=[],c={}){const dateContext=`${c.followUpDate||"none"}:${linkHash(c.venueId)}`;return [
 {type:1,components:[{type:2,style:1,label:'Reply by email',emoji:{name:'✉️'},custom_id:`jddm2:reply:${id}`},{type:2,style:2,label:'Set follow-up date',emoji:{name:'📅'},custom_id:`jddm2:date:${id}:${dateContext}`},{type:2,style:2,label:c.venueId?'Change linked venue':'Link venue',custom_id:`jddm2:venue-search:${id}`} ]},
 {type:1,components:[{type:3,custom_id:`jddm2:status:${id}:${dateContext}`,placeholder:'Change conversation status',options:Object.entries(STATES).map(([value,s])=>({label:s.name,value,emoji:{name:s.emoji}}))}]},
 {type:1,components:[{type:3,custom_id:`jddm2:topics:${id}`,placeholder:'Conversation labels',min_values:0,max_values:Object.keys(TOPICS).length,options:Object.entries(TOPICS).map(([value,s])=>({label:s.name,value,emoji:{name:s.emoji},default:topics.includes(value)}))}]}
];}
function summaryMessage(c){const s=STATES[c.status]||STATES.deedee;return {content:`${s.emoji} **${s.name}**${c.preview?' — '+c.preview:''}`,embeds:[{title:(c.displaySubject||c.subject).slice(0,256),description:`${s.emoji} **${s.name}**${c.venueId?'\n📍 **'+c.venueName+'**'+(c.venueCity?' — '+c.venueCity:''):'\n📍 No venue linked — use Link venue'}${c.followUpDate?'\n📅 '+(c.venueId?'Official venue follow-up':'Legacy email follow-up')+': **'+c.followUpDate+'**':c.venueId?'\n📅 No venue follow-up scheduled':''}${c.venueLinkIssue?'\n⚠️ '+c.venueLinkIssue:''}${c.legacyFollowUpDate?'\nPrevious email date kept for review: '+c.legacyFollowUpDate:''}\n\n${c.correspondent||'Email conversation'}\n[Open original Gmail conversation](${mailUrl(c.gmailThreadId)})`,color:s.color,footer:{text:'Replies from Gmail and Discord stay together'}} ,...(c.topics||[]).filter(t=>TOPICS[t]).map(t=>({title:`${TOPICS[t].emoji} ${TOPICS[t].name}`,color:TOPICS[t].color}))],components:controls(c.gmailThreadId,c.topics,c),allowed_mentions:ALLOWED_MENTIONS};}
function messageChunks(message){const h=message.payload?.headers||[];const from=cleanHeader(getHeader(h,'From'));const to=cleanHeader(getHeader(h,'To'));const when=new Date(Number(message.internalDate)).toLocaleString('en-US',{timeZone:'America/New_York'});const files=attachments(message.payload);const body=plainBody(message.payload)+(files.length?'\n\nAttachments: '+files.join(', ')+' (open Gmail to download)':'');const heading=`**${ownMessage(message)?'Sent by Dee Dee':'Received'}** · ${when} Eastern\n**From:** ${from}\n**To:** ${to}\n\n`;
 const parts=splitText(heading+body);return parts.map((part,i)=>({content:part+(parts.length>1?`\n-# Part ${i+1} of ${parts.length}`:''),allowed_mentions:ALLOWED_MENTIONS,nonce:crypto.createHash('sha256').update(message.id+':'+i).digest('hex').slice(0,24),enforce_nonce:true}));}
function createDiscordClient(token, fetchImpl=fetch){return async(method,path,body)=>{
 for(let i=0;i<3;i++){const r=await fetchImpl('https://discord.com/api/v10'+path,{method,headers:{Authorization:'Bot '+token,'User-Agent':'DiscordBot (https://outswarming.github.io/Just-Dee-Dee-Music-Map/, 2.0)','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const d=await r.json().catch(()=>({}));if(r.ok)return d;if(r.status===429&&d.retry_after<=5&&i<2){await new Promise(resolve=>setTimeout(resolve,d.retry_after*1000+100));continue;}const e=new Error('Discord request failed ('+r.status+'): '+String(d.message||''));e.status=r.status;e.retryAfter=d.retry_after;throw e;}
};}
function createConversationService({db,gmail,discord,now=()=>new Date(),fetchImpl=fetch,venueDirectory=null}){
 const collection=db.collection('jddmEmailConversations');
 // Serialize manual relinking and date writes across function instances so a
 // date submission cannot write a venue that was relinked during the request.
 async function withVenueLock(id,fn){
  const ref=db.doc('jddmVenueActionLocks/'+id),owner=crypto.randomBytes(12).toString('hex');
  await db.runTransaction(async tx=>{const current=(await tx.get(ref)).data();if(current?.until>Date.now())throw Error('Another venue update is still saving. Try again shortly.');tx.set(ref,{owner,until:Date.now()+180000});});
  try{return await fn();}finally{await db.runTransaction(async tx=>{if((await tx.get(ref)).data()?.owner===owner)tx.set(ref,{until:0},{merge:true});});}
 }

 async function config(){return (await db.doc('jddmEmailConfig/main').get()).data()||{};}
 async function get(id){const d=await collection.doc(id).get();return d.exists?d.data():null;}
 async function updateCard(c){if(venueDirectory&&c.venueId){try{const v=await venueDirectory.get(c.venueId,{fresh:false});c={...c,venueName:v.name,venueCity:v.city,followUpDate:v.date,venueLinkIssue:''};}catch{c={...c,venueLinkIssue:'Venue information is unavailable; check the app before acting.'};}}const cfg=await config();await discord('PATCH',`/channels/${c.discordThreadId}`,{archived:false,name:threadTitle(c),applied_tags:appliedTags(c,cfg)});await discord('PATCH',`/channels/${c.discordThreadId}/messages/${c.starterId||c.discordThreadId}`,summaryMessage(c));if(['resolved','rejected','spam'].includes(c.status))await discord('PATCH',`/channels/${c.discordThreadId}`,{archived:true});}
 async function tryAutoLink(c,messages){
  if(!venueDirectory||c.venueId||c.venueLinkMode==='manual')return c;
  try{const found=venueLinks.matchVenue(await venueDirectory.list(),messages);const v=found.venue;
   if(!v)return {...c,venueLinkIssue:found.reason};
   const patch={venueId:v.id,venueName:v.name,venueCity:v.city,venueLinkMode:'automatic',venueLinkReason:found.reason,venueLinkIssue:'',followUpDate:v.date,legacyFollowUpDate:'',supersededEmailFollowUpDate:c.legacyFollowUpDate||(!c.venueId&&c.followUpDate!==v.date?c.followUpDate:'')||c.supersededEmailFollowUpDate||'',venueLinkedAt:now().toISOString()};
   return await db.runTransaction(async tx=>{const ref=collection.doc(c.gmailThreadId),fresh=(await tx.get(ref)).data()||c;if(fresh.venueId||fresh.venueLinkMode==='manual')return {...c,...fresh};tx.set(ref,patch,{merge:true});return {...c,...patch};});
  }catch(e){return {...c,venueLinkIssue:'Venue matching is temporarily unavailable; use Link venue later.'};}
 }
 async function linkVenue(id,venueId,actor,expectedVenueId){
  if(!venueDirectory)throw Error('Venue linking is unavailable.');const v=venueId?await venueDirectory.get(venueId):null;
  const updated=await db.runTransaction(async tx=>{const ref=collection.doc(id),c=(await tx.get(ref)).data();if(!c)throw Error('Conversation is not ready.');if((c.venueId||'')!==expectedVenueId)throw Error('The linked venue changed. Search again to review it.');
   const legacy=!c.venueId&&c.followUpDate&&c.followUpDate!==v?.date?c.followUpDate:c.legacyFollowUpDate||'';
   const patch={venueId:v?.id||'',venueName:v?.name||'',venueCity:v?.city||'',venueLinkMode:'manual',venueLinkedAt:now().toISOString(),venueLinkActor:actor,venueLinkIssue:'',followUpDate:v?v.date:(!c.venueId?c.followUpDate:'')||'',legacyFollowUpDate:v?'':legacy,supersededEmailFollowUpDate:v?(legacy||c.supersededEmailFollowUpDate||''):c.supersededEmailFollowUpDate||''};tx.set(ref,patch,{merge:true});return {...c,...patch};});
  await updateCard(updated);return updated;
 }
 async function refreshLinked(){if(!venueDirectory)return;const index=await venueDirectory.list({fresh:true});const snapshot=await collection.where('venueId','>','').get();for(const doc of snapshot.docs){const c=doc.data(),v=index.find(v=>v.id===c.venueId&&v.linkable!==false);const patch=v?{venueName:v.name,venueCity:v.city,followUpDate:v.date,venueLinkIssue:'',legacyFollowUpDate:'',supersededEmailFollowUpDate:c.legacyFollowUpDate||c.supersededEmailFollowUpDate||''}:{venueLinkIssue:'Linked venue missing or duplicated. Choose an existing venue in the app.'};if(Object.entries(patch).some(([k,v])=>c[k]!==v)){const updated=await db.runTransaction(async tx=>{const ref=collection.doc(c.gmailThreadId),fresh=(await tx.get(ref)).data();if(fresh?.venueId!==c.venueId)return null;tx.set(ref,patch,{merge:true});return {...fresh,...patch};});if(updated)await updateCard(updated);}}}
 async function syncThread(thread,options={}){
  const lock=db.doc('jddmEmailSyncLocks/'+thread.id);const acquired=await db.runTransaction(async tx=>{const current=await tx.get(lock);if((current.data()?.until||0)>Date.now())return false;tx.set(lock,{until:Date.now()+500000});return true;});
  if(!acquired)return {posted:0,deferred:true};try{return await syncUnlocked(thread,options);}finally{await lock.set({until:0});}
 }
 async function syncUnlocked(thread,{budget=100}={}){
  const id=thread.id;const messages=(thread.messages||[]).filter(m=>!m.labelIds?.includes('DRAFT')&&!m.labelIds?.includes('TRASH')).sort((a,b)=>Number(a.internalDate)-Number(b.internalDate));if(!messages.length)return {posted:0};
  const detectedTopics=automaticTopics(messages);let c=await get(id);const latest=messages[messages.length-1];const headers=latest.payload?.headers||[];
  if(!c){const cfg=await config();const subject=cleanHeader(getHeader(headers,'Subject')).replace(/^(?:(?:re|fwd?):\s*)+/i,'')||'(No subject)';c={gmailThreadId:id,subject,correspondent:cleanHeader(getHeader(headers,ownMessage(latest)?'To':'From')),status:latest.labelIds?.includes('SPAM')?'spam':ownMessage(latest)?'venue':'deedee',followUpDate:'',topics:detectedTopics,preview:plainBody(latest.payload).replace(/\s+/g,' ').slice(0,160),processed:[],chunks:{},latestMessageId:latest.id,createdAt:now().toISOString()};
   const post=await discord('POST',`/channels/${FORUM_ID}/threads`,{name:threadTitle(c),message:summaryMessage(c),applied_tags:appliedTags(c,cfg)});c.discordThreadId=post.id;c.starterId=post.message?.id||post.id;await collection.doc(id).set(c);
  }
  if(venueDirectory){const before=c;c=await tryAutoLink(c,messages);if(c.venueId!==before.venueId||c.venueLinkIssue!==before.venueLinkIssue){await collection.doc(id).set({venueLinkIssue:c.venueLinkIssue||''},{merge:true});await updateCard(c);}}
  const combinedTopics=[...new Set([...(c.topics||[]),...detectedTopics])];
  const topicsChanged=combinedTopics.length!==(c.topics||[]).length;
  if(topicsChanged){c.topics=combinedTopics;await collection.doc(id).set({topics:c.topics},{merge:true});await updateCard(c);}
  let posted=0;const newMessages=messages.filter(m=>!c.processed.includes(m.id));
  for(const message of newMessages){const chunks=messageChunks(message);let part=c.chunks?.[message.id]||0;for(;part<chunks.length;part++){
    if(posted>=budget)return {posted,deferred:true};
    // Reopen after Discord's inactivity archive. A status change is independent.
    if(posted===0)await discord('PATCH',`/channels/${c.discordThreadId}`,{archived:false});
    const delivered=await discord('POST',`/channels/${c.discordThreadId}/messages`,chunks[part]);c.messagePosts={...c.messagePosts,[message.id]:[...(c.messagePosts?.[message.id]||[]),delivered.id]};posted++;c.chunks={...c.chunks,[message.id]:part+1};await collection.doc(id).set({chunks:c.chunks,messagePosts:c.messagePosts},{merge:true});
   }
   c.processed.push(message.id);c.latestMessageId=message.id;c.updatedAt=now().toISOString();await collection.doc(id).set({processed:c.processed,latestMessageId:c.latestMessageId,updatedAt:c.updatedAt},{merge:true});
  }
  if(newMessages.length){const fresh=await get(id);c={...c,...fresh,topics:fresh.topics||[]};const last=newMessages[newMessages.length-1];if(Number(last.internalDate)>Number(c.lastStatusMessageAt||0)){
    c.status=last.labelIds?.includes('SPAM')?'spam':ownMessage(last)?'venue':'deedee';if(!c.venueId)c.followUpDate='';c.lastStatusMessageAt=Number(last.internalDate);c.preview=plainBody(last.payload).replace(/\s+/g,' ').slice(0,160);
    await collection.doc(id).set({status:c.status,...(!c.venueId?{followUpDate:c.followUpDate}:{}),lastStatusMessageAt:c.lastStatusMessageAt,preview:c.preview},{merge:true});
  }await updateCard(c);}
  return {posted,discordThreadId:c.discordThreadId};
 }
 async function poll(){const cfg=await config();if(!cfg.enabled)return {paused:true};const lock=db.doc('jddmEmailConfig/pollLock');const acquired=await db.runTransaction(async tx=>{const s=await tx.get(lock);if((s.data()?.until||0)>Date.now())return false;tx.set(lock,{until:Date.now()+500000});return true;});if(!acquired)return {busy:true};const result={conversations:0,posted:0};try{
  const profile=(await gmail.users.getProfile({userId:'me'})).data;if(profile.emailAddress.toLowerCase()!==MAILBOX)throw Error('Wrong Gmail mailbox');
  const checkpoint=db.doc('jddmEmailConfig/checkpoint');const saved=(await checkpoint.get()).data()||{};
  let ids=[...(saved.pending||[])],cursor=saved.historyId,pageToken;
  if(cursor){try{do{const page=(await gmail.users.history.list({userId:'me',startHistoryId:cursor,maxResults:500,pageToken})).data;for(const h of page.history||[]){for(const added of h.messagesAdded||[])if(!added.message.labelIds?.includes('TRASH')&&!added.message.labelIds?.includes('DRAFT'))ids.push(added.message.threadId);for(const sent of h.labelsAdded||[])if(sent.labelIds?.includes('SENT'))ids.push(sent.message.threadId);}pageToken=page.nextPageToken;}while(pageToken);}catch(e){if(Number(e.code)!==404)throw e;cursor=null;}}
  if(!cursor){pageToken=undefined;const after=saved.checkedAt?Math.floor(Date.parse(saved.checkedAt)/1000)-300:null;do{const page=(await gmail.users.threads.list({userId:'me',q:'in:anywhere '+(after?'after:'+after:'newer_than:1d')+' -in:trash',maxResults:500,pageToken})).data;ids.push(...(page.threads||[]).map(t=>t.id));pageToken=page.nextPageToken;}while(pageToken);}
  ids=[...new Set(ids)];await checkpoint.set({historyId:profile.historyId,pending:ids,checkedAt:now().toISOString()});
  // Read only changed conversations, with a persisted queue for bursts and long bodies.
  while(ids.length&&result.posted<100&&result.conversations<25){const id=ids[0];let thread;try{thread=(await gmail.users.threads.get({userId:'me',id,format:'full'})).data;}catch(e){if(Number(e.code)!==404)throw e;ids.shift();await checkpoint.set({pending:ids},{merge:true});continue;}const r=await syncThread(thread,{budget:100-result.posted});result.posted+=r.posted;result.conversations++;if(r.deferred)break;ids.shift();await checkpoint.set({pending:ids},{merge:true});}
  result.queued=ids.length;
  if(venueDirectory){try{await refreshLinked();}catch(e){result.venueRefreshError=e.message;}}
  await db.doc('jddmEmailConfig/health').set({...result,lastSuccess:now().toISOString()});return result;
 }catch(e){await db.doc('jddmEmailConfig/health').set({lastError:e.message,errorAt:now().toISOString()},{merge:true});throw e;}finally{await lock.set({until:0});}}
 async function setStatus(id,status,actor,date='',expected={}){if(!STATES[status])throw Error('Unknown status');if(status==='followup'&&(!validDate(date)||date<dateKey(now())))throw Error('Choose today or a future date in YYYY-MM-DD format.');let c=await get(id);if(!c)throw Error('Conversation is not ready yet.');const previous=c.followUpDate;
  if(venueDirectory&&status==='followup'){if(!c.venueId)throw Error('Link this conversation to an existing venue first. New venues can only be added in the map app.');if(expected.hash&&expected.hash!==linkHash(c.venueId))throw Error('The linked venue changed. Reopen the follow-up form.');const v=await withVenueLock('place-'+crypto.createHash('sha256').update(c.venueId).digest('hex'),()=>venueDirectory.setDate(c.venueId,date,expected.date===undefined?c.followUpDate:expected.date));await collection.doc(id).set({followUpDate:v.date,legacyFollowUpDate:'',updatedAt:now().toISOString(),lastActor:actor},{merge:true});await refreshLinked();const updated={...c,followUpDate:v.date,legacyFollowUpDate:''};await updateCard(updated);return updated;}
  if(status==='spam')await gmail.users.threads.modify({userId:'me',id,requestBody:{addLabelIds:['SPAM'],removeLabelIds:['INBOX','UNREAD']}});
  if(status==='resolved')await gmail.users.threads.modify({userId:'me',id,requestBody:{removeLabelIds:['INBOX','UNREAD']}});
  c={...c,status,followUpDate:c.venueId?c.followUpDate:status==='followup'?date:'',updatedAt:now().toISOString(),lastActor:actor};await collection.doc(id).set({status:c.status,...(!c.venueId?{followUpDate:c.followUpDate}:{}),updatedAt:c.updatedAt,lastActor:actor},{merge:true});await updateCard(c);
  if(status==='followup'&&date!==previous){const cfg=await config();await discord('POST',`/channels/${cfg.confirmationChannelId}/messages`,{content:`🟠 **Email follow-up ${previous?'changed':'added'}**\n**${c.subject}**\n${c.correspondent}\n${previous?'Previous: '+previous+'\n':''}Due: **${date}**\n[Open conversation](${conversationUrl(c.discordThreadId)})\nUpdated by ${actor}`,allowed_mentions:ALLOWED_MENTIONS});}
  return c;
 }
 async function setTopics(id,topics,actor){if(!Array.isArray(topics)||topics.some(t=>!TOPICS[t]))throw Error('Unknown conversation label');const c=await get(id);if(!c)throw Error('Conversation is not ready yet');c.topics=[...new Set(topics)];await collection.doc(id).set({topics:c.topics,lastActor:actor},{merge:true});await updateCard(c);return c;}
 async function reply(id,body,actor){const c=await get(id);if(!c)throw Error('Conversation is not ready.');const thread=(await gmail.users.threads.get({userId:'me',id,format:'metadata',metadataHeaders:['From','To','Reply-To','Subject','Message-ID','References']})).data;const list=(thread.messages||[]).filter(m=>!m.labelIds?.includes('DRAFT')&&!m.labelIds?.includes('TRASH')).sort((a,b)=>Number(a.internalDate)-Number(b.internalDate));const latest=list[list.length-1];const h=latest.payload.headers;const to=cleanHeader(ownMessage(latest)?getHeader(h,'To'):getHeader(h,'Reply-To')||getHeader(h,'From'));if(!address(to))throw Error('No valid recipient was found.');const raw=buildReplyRaw({toAddress:to,subject:cleanHeader(getHeader(h,'Subject')),inReplyTo:cleanHeader(getHeader(h,'Message-ID')),references:cleanHeader(getHeader(h,'References')),body});const sent=(await gmail.users.messages.send({userId:'me',requestBody:{raw,threadId:id}})).data;await setStatus(id,'venue',actor);const full=(await gmail.users.threads.get({userId:'me',id,format:'full'})).data;await syncThread(full);return {to,messageId:sent.id};}
 async function daily({force=false,test=false,today=dateKey(now())}={}){const cfg=await config();if(!cfg.enabled)return {paused:true};const ref=db.doc('jddmEmailDaily/'+(test?'test-':'')+today);const claim=await db.runTransaction(async tx=>{const s=await tx.get(ref);if(!force&&(s.data()?.sent||s.data()?.sendingUntil>Date.now()))return false;tx.set(ref,{sendingUntil:Date.now()+300000},{merge:true});return true;});if(!claim)return {duplicate:true};
  try{const digest=await require('./followUpDigest').loadDigest({db,fetchImpl,today,cache:!test});const lines=[test?'TEST — '+digest.body:digest.body];
  const saved=(await ref.get()).data()||{};const parts=saved.parts||splitText(lines.join('\n'),1900);await ref.set({parts},{merge:true});for(let part=saved.nextPart||0;part<parts.length;part++){await discord('POST',`/channels/${cfg.dailyChannelId}/messages`,{...require('./discordNotifications').notificationBody(parts[part],{alert:cfg.dailyPingEveryone===true&&!test,part}),nonce:crypto.createHash('sha256').update(ref.path+':'+part).digest('hex').slice(0,24),enforce_nonce:true});await ref.set({nextPart:part+1},{merge:true});}await ref.set({sent:true,sentAt:now().toISOString(),emails:digest.emails,venues:digest.venues});return {emails:digest.emails,venues:digest.venues};
 }catch(e){await ref.set({sendingUntil:0,error:e.message},{merge:true});throw e;}}
 return {config,get,syncThread,poll,setStatus:(...args)=>venueDirectory&&args[1]==='followup'?withVenueLock(args[0],()=>setStatus(...args)):setStatus(...args),setTopics,reply,daily,updateCard,tryAutoLink,linkVenue:(...args)=>withVenueLock(args[0],()=>linkVenue(...args)),refreshLinked,searchVenues:q=>venueDirectory.search(q)};
}
function modal(id,kind,context=[]){
 const search=kind==='venue-search',reply=kind==='reply';
 return {type:9,data:{custom_id:`jddm2:${kind}-submit:${id}${context.length?':'+context.join(':'):''}`,title:search?'Find an existing venue':reply?'Reply as Just Dee Dee':'Official venue follow-up',components:[{type:1,components:[{type:4,custom_id:'value',label:search?'Venue, city, contact name or email':reply?'Your email reply':'Follow-up date (YYYY-MM-DD)',style:reply?2:1,required:true,max_length:reply?3800:search?100:10,placeholder:search?'Search existing places; add new ones in the app':reply?'This sends an email in the same conversation.':'2026-09-20',...(!search&&!reply&&validDate(context[0])?{value:context[0]}:{})}]}]}};
}
function createConversationInteractions({getConfig,service,discord,db,legacy}){return async(req,res)=>{
 const raw=req.rawBody||JSON.stringify(req.body);if(!verifyDiscordSignature({publicKey:getConfig().publicKey,signature:req.get('X-Signature-Ed25519'),timestamp:req.get('X-Signature-Timestamp'),rawBody:raw}))return res.status(401).send('invalid request signature');
 const i=req.body;if(i.type===1)return res.json({type:1});const custom=i.data?.custom_id||'';if(!custom.startsWith('jddm2:'))return legacy(req,res);const [,action,id,...context]=custom.split(':');if(i.guild_id!==GUILD_ID)return res.json({type:4,data:{content:'This control belongs to the JDDM server.',flags:64}});
 if(['reply','date','venue-search'].includes(action))return res.json(modal(id,action,action==='date'?context:[]));if(action==='status'&&i.data.values?.[0]==='followup')return res.json(modal(id,'date',context));
 const actor=i.member?.nick||i.member?.user?.global_name||i.member?.user?.username||'Dee Dee';
 await discord('POST',`/interactions/${i.id}/${i.token}/callback`,{type:5,data:{flags:64}});
 const key=db.doc('jddmEmailActions/'+i.id);const claim=await db.runTransaction(async tx=>{const d=await tx.get(key);if(d.exists)return false;tx.set(key,{state:'started',at:new Date().toISOString()});return true;});
 if(!claim)return res.status(202).send('already handled');
 try{const c=await service.get(id);if(!c||i.channel_id!==c.discordThreadId)throw Error('Open the current conversation post to use this control');const value=i.data?.components?.flatMap(r=>r.components||[]).find(v=>v.custom_id==='value')?.value?.trim()||'';let content,components=[];
 if(action==='venue-search-submit'){
  if(value.length<2)throw Error('Enter at least two characters to search');
  const user=i.member?.user?.id;if(!user)throw Error('Your Discord account could not be verified');
  const results=await service.searchVenues(value),offered=results.slice(0,24),sessionId=crypto.randomBytes(10).toString('hex');
  await db.doc('jddmVenueSelections/'+sessionId).set({conversationId:id,user,venueId:c.venueId||'',offered:offered.map(v=>v.id),expiresAt:Date.now()+10*60*1000});
  content=`${results.length} matching venue${results.length===1?'':'s'}${results.length>24?' — showing the first 24; search more specifically to narrow it down':''}. Current link: ${c.venueName||'none'}.\nChoose an existing place. Its spreadsheet follow-up date becomes the official date. New places can only be added in the map app.`;
  components=[{type:1,components:[{type:3,custom_id:`jddm2:venue-select:${id}:${sessionId}`,placeholder:'Choose the correct existing venue',options:[...offered.map(v=>({label:v.name.slice(0,100),value:v.id,description:((v.city||'Location not recorded')+' · Follow-up: '+(v.date||'not scheduled')).slice(0,100)})),{label:'Leave unlinked',value:'__unlink__',description:'Keep this conversation unlinked until you choose a venue'}]}]}];
 }
 else if(action==='venue-select'){
  const selection=(await db.doc('jddmVenueSelections/'+context[0]).get()).data(),chosen=i.data.values?.[0];
  if(!selection||selection.conversationId!==id||selection.user!==i.member?.user?.id||selection.expiresAt<Date.now())throw Error('This search has expired or belongs to another person. Search again');
  if(chosen!=='__unlink__'&&!selection.offered.includes(chosen))throw Error('Select a venue from these search results');
  const updated=await service.linkVenue(id,chosen==='__unlink__'?'':chosen,actor,selection.venueId);
  await db.doc('jddmVenueSelections/'+context[0]).set({expiresAt:0},{merge:true});
  content=updated.venueId?`📍 Linked to **${updated.venueName}**. Official spreadsheet follow-up: **${updated.followUpDate||'not scheduled'}**.`:'Venue link removed. Automatic matching will leave this conversation unlinked until you choose a venue.';
  if(updated.legacyFollowUpDate)content+=`\nPrevious email date **${updated.legacyFollowUpDate}** is kept for review. Set the official venue date if that reminder is still needed.`;
 }
 else if(action==='reply-submit'){if(!value)throw Error('Reply was empty.');const r=await service.reply(id,value,actor);content=`✉️ Email sent as ${MAILBOX} to ${r.to}. Conversation is waiting on the venue.`;}
 else if(action==='topics'){const updated=await service.setTopics(id,i.data.values||[],actor);content=updated.topics.length?'Labels: '+updated.topics.map(t=>TOPICS[t].emoji+' '+TOPICS[t].name).join(', '):'Conversation labels cleared';}
 else if(action==='date-submit'||action==='status'){
  const status=action==='date-submit'?'followup':i.data.values?.[0];
  if(action==='date-submit'&&context.length!==2)throw Error('This follow-up control is outdated. Reopen the current conversation card');
  const updated=await service.setStatus(id,status,actor,value,{date:context[0]==='none'?'':context[0],hash:context[1]});
  content=action==='date-submit'&&updated.venueId?`📅 **${updated.venueName}** — official spreadsheet follow-up saved: **${updated.followUpDate}**. The daily reminders use this same date.`:`${STATES[updated.status].emoji} ${STATES[updated.status].name}${updated.followUpDate?' — '+updated.followUpDate:''}`;
 }else throw Error('Unknown conversation control');
 await key.set({state:'complete'},{merge:true});await discord('PATCH',`/webhooks/${i.application_id}/${i.token}/messages/@original`,{content,components,allowed_mentions:ALLOWED_MENTIONS});
 }catch(e){await key.set({state:'failed',error:e.message},{merge:true});await discord('PATCH',`/webhooks/${i.application_id}/${i.token}/messages/@original`,{content:'Could not complete this action: '+e.message+'. If an email send was interrupted, check the conversation before retrying.',components:[],allowed_mentions:ALLOWED_MENTIONS});}
 return res.status(202).send('handled');
};}
module.exports={GUILD_ID,FORUM_ID,MAILBOX,STATES,TOPICS,automaticTopics,threadTitle,appliedTags,dateKey,validDate,followUpDate,address,ownMessage,splitText,plainBody,messageChunks,controls,summaryMessage,mailUrl,conversationUrl,createDiscordClient,createConversationService,createConversationInteractions};
