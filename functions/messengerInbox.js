'use strict';
const crypto=require('node:crypto');
const email=require('./discordConversations');
const PAGE_ID='104617019336673', PREFIX='jddmm';
const INSTAGRAM_ID='17841459797433647';
const PLATFORMS={messenger:{selfId:PAGE_ID,prefix:PREFIX,namespace:'jddmMessenger',label:'Messenger',source:'Facebook Page Messenger'},instagram:{selfId:INSTAGRAM_ID,prefix:'jddmi',namespace:'jddmInstagram',label:'Instagram',source:'Instagram Direct'}};
const hash=s=>crypto.createHash('sha256').update(String(s||'')).digest('hex');
const quiet={parse:[]};
function sourceUrl(c){if(c.platform==='instagram')return `https://business.facebook.com/latest/inbox/instagram_direct?asset_id=${PAGE_ID}`;return c.sourceLink?.startsWith('/'+PAGE_ID+'/inbox/')?'https://www.facebook.com'+c.sourceLink:`https://business.facebook.com/latest/inbox/messenger?asset_id=${PAGE_ID}`;}
function card(c){
 const platform=PLATFORMS[c.platform]||PLATFORMS.messenger;
 const state=email.STATES[c.status], rows=email.controls(c.id,c.topics||[],c);
 rows[0].components=rows[0].components.filter(x=>!x.custom_id.includes(':reply:'));
 rows[0].components.unshift({type:2,style:5,label:'Open '+platform.label+' / Reply',url:sourceUrl(c)});
 for(const row of rows)for(const x of row.components)if(x.custom_id)x.custom_id=x.custom_id.replace('jddm2:',platform.prefix+':');
 return {content:state?`${state.emoji} **${state.name}**`:'📚 **Imported conversation — review when needed**',embeds:[{title:c.name.slice(0,256),color:state?.color||0x5865f2,description:`${c.venueId?'📍 '+c.venueName:'📍 No venue linked — use Link venue'}\n📅 Official spreadsheet follow-up: **${c.followUpDate||'not scheduled'}**${c.venueLinkIssue?'\n⚠️ '+c.venueLinkIssue:''}\n\nMessages and replies stay together in this post. Use **Open ${platform.label} / Reply** to reply in ${platform.label}.`,footer:{text:'Just Dee Dee Music • '+platform.source+' • Eastern time'}}],components:rows,allowed_mentions:quiet};
}
function messageParts(m,platformName='messenger'){
 const platform=PLATFORMS[platformName]||PLATFORMS.messenger;
 const outgoing=m.from?.id===platform.selfId;
 const stamp=new Date(m.created_time).toLocaleString('en-US',{timeZone:'America/New_York'});
 const attachments=(m.attachments?.data||[]).map(a=>a.name||a.mime_type||'Attachment');
 const shares=(m.shares?.data||[]).map(a=>a.link||a.name||'Shared content');
 const body=`**${outgoing?'Sent by Just Dee Dee Music':'Received from '+(m.from?.name||m.from?.username||platform.label+' contact')}** · ${stamp} Eastern\n\n${m.message||'(No text in this message.)'}${attachments.length?'\n\n📎 '+attachments.join(', ')+' — open '+platform.label+' to view.':''}${shares.length?'\n\nShared: '+shares.join('\n'):''}`;
 return email.splitText(body,1850).map((content,i)=>({content,flags:4096,allowed_mentions:quiet,nonce:hash(platformName+':'+m.id+':'+i).slice(0,24),enforce_nonce:true}));
}
function createGraphClient(token){return async function graph(path){const r=await fetch('https://graph.facebook.com/v26.0/'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(45000)});const d=await r.json();if(!r.ok)throw Error(`Facebook ${d.error?.code||r.status}: ${d.error?.message||'request failed'}`);return d;};}
async function allPages(graph,path){let out=[],after='';do{const d=await graph(path+(after?'&after='+encodeURIComponent(after):''));out.push(...(d.data||[]));after=d.paging?.next?d.paging?.cursors?.after:'';if(d.paging?.next&&!after)throw Error('Facebook pagination is incomplete');}while(after);return out;}
function createService({db,discord,graph,venueDirectory,now=()=>new Date(),platform:platformName='messenger'}){
 const platform=PLATFORMS[platformName];if(!platform)throw Error('Unknown messaging platform');
 const collection=db.collection(platform.namespace+'Conversations');
 const get=async id=>(await collection.doc(id).get()).data();
 const config=async()=>(await db.doc(platform.namespace+'Config/main').get()).data()||{};
 async function locked(id,fn){const ref=db.doc(platform.namespace+'Locks/'+hash(id)),owner=crypto.randomUUID();await db.runTransaction(async tx=>{const d=(await tx.get(ref)).data();if(d?.until>Date.now())throw Object.assign(Error('Another '+platform.label+' update is running. Try again shortly'),{code:'SYNC_BUSY'});tx.set(ref,{owner,until:Date.now()+600000});});try{return await fn();}finally{await db.runTransaction(async tx=>{if((await tx.get(ref)).data()?.owner===owner)tx.set(ref,{until:0});});}}
 async function updateCard(c){const cfg=await config(),render=card(c),renderHash=hash(JSON.stringify(render));const tags=[cfg.tags?.[c.status],...(c.importedHistory?[cfg.historyTag]:[]),...(c.topics||[]).map(t=>cfg.topicTags?.[t])].filter(Boolean).slice(0,5);const t=await discord('GET','/channels/'+c.discordThreadId);if(c.cardHash!==renderHash||JSON.stringify(tags)!==JSON.stringify(t.applied_tags)||t.name!==c.name.slice(0,100)){await discord('PATCH','/channels/'+c.discordThreadId,{archived:false,name:c.name.slice(0,100),applied_tags:tags});await discord('PATCH',`/channels/${c.discordThreadId}/messages/${c.starterId}`,render);await collection.doc(c.id).set({cardHash:renderHash},{merge:true});}if(['resolved','rejected','spam'].includes(c.status))await discord('PATCH','/channels/'+c.discordThreadId,{archived:true});}
 async function syncConversation(thread,{historical=false}={}){thread={...thread,sourceId:thread.id,id:platformName==='instagram'?hash(thread.id).slice(0,32):thread.id};return locked(thread.id,async()=>{
  const cfg=await config();if(!cfg.forumId)throw Error(platform.label+' forum is not configured');
  const people=thread.participants?.data||[];if(!people.some(p=>p.id===platform.selfId))throw Error('Conversation does not belong to JDDM');
  const contacts=people.filter(p=>p.id!==platform.selfId);if(contacts.length!==1)throw Error('Expected one '+platform.label+' contact');
  let c=await get(thread.id);const messages=[...(thread.messages||[])].sort((a,b)=>Date.parse(a.created_time)-Date.parse(b.created_time));
  if(!messages.length)return {skipped:true};
  if(!c){c={id:thread.id,sourceId:thread.sourceId,platform:platformName,psid:contacts[0].id,name:contacts[0].name||contacts[0].username||platform.label+' contact',status:historical?'history':'deedee',topics:[],venueId:'',followUpDate:'',importedHistory:historical,createdAt:now().toISOString()};
   // The external thread ID in the starter footer lets retries recover creation safely.
   const active=await discord('GET',`/guilds/${email.GUILD_ID}/threads/active`);let post;
   for(const t of active.threads||[]){if(t.parent_id!==cfg.forumId||t.name!==c.name.slice(0,100))continue;const m=await discord('GET',`/channels/${t.id}/messages/${t.id}`);if(m.embeds?.[0]?.footer?.text?.includes(thread.id)){post=t;break;}}
   if(!post){const starter=card(c);starter.embeds[0].footer.text+=' • '+thread.id;post=await discord('POST',`/channels/${cfg.forumId}/threads`,{name:c.name.slice(0,100),message:{...starter,flags:4096},applied_tags:[historical?cfg.historyTag:cfg.tags?.deedee].filter(Boolean)});}
   c.discordThreadId=post.id;c.starterId=post.message?.id||post.id;await collection.doc(c.id).set(c);
  }
  let posted=0;
  for(const m of messages){if(!m.id||!Number.isFinite(Date.parse(m.created_time)))throw Error('Invalid source message');const ref=db.doc(platform.namespace+'Messages/'+hash(m.id));let receipt=(await ref.get()).data()||{};if(receipt.complete)continue;
   if(!posted){const t=await discord('GET','/channels/'+c.discordThreadId);if(t.thread_metadata?.archived)await discord('PATCH','/channels/'+c.discordThreadId,{archived:false});}
   const parts=messageParts(m,platformName);for(let i=receipt.nextPart||0;i<parts.length;i++){const p=await discord('POST',`/channels/${c.discordThreadId}/messages`,parts[i]);receipt={...receipt,nextPart:i+1,messageIds:[...(receipt.messageIds||[]),p.id]};await ref.set({...receipt,conversationId:c.id,sourceMessageId:m.id});}
   await ref.set({complete:true},{merge:true});posted++;
  }
  const latest=messages.at(-1),newer=Date.parse(latest.created_time)>Number(c.lastMessageAt||0);
  if(newer){c={...c,lastMessageAt:Date.parse(latest.created_time),preview:(latest.message||'Attachment').slice(0,160),...(!historical?{status:latest.from?.id===platform.selfId?'venue':'deedee'}:{})};}
  c.sourceLink=thread.link||c.sourceLink||'';c.updatedTime=thread.updated_time||'';await collection.doc(c.id).set(c);await updateCard(c);return {posted,id:c.id,discordThreadId:c.discordThreadId};
 });}
 async function linkVenue(id,venueId,actor,expected){return locked(id,async()=>{const c=await get(id);if(!c||(c.venueId||'')!==expected)throw Error('Venue link changed; search again');const v=venueId?await venueDirectory.get(venueId):null;const n={...c,venueId:v?.id||'',venueName:v?.name||'',venueCity:v?.city||'',followUpDate:v?.date||'',venueLinkMode:'manual',venueLinkIssue:'',lastActor:actor};await collection.doc(id).set(n);await updateCard(n);return n;});}
 async function setStatus(id,status,actor,date,expected={}){return locked(id,async()=>{let c=await get(id);if(!c||!email.STATES[status])throw Error('Unknown status');if(status==='followup'){if(!email.validDate(date)||date<email.dateKey(now()))throw Error('Choose today or a future date');if(!c.venueId)throw Error('Link an existing venue first');if(expected.hash!==hash(c.venueId).slice(0,8))throw Error('Venue link changed; reopen the date form');const v=await venueDirectory.setDate(c.venueId,date,expected.date);c={...c,followUpDate:v.date};}c={...c,status,lastActor:actor};await collection.doc(id).set(c);await updateCard(c);return c;});}
 async function setTopics(id,topics,actor){return locked(id,async()=>{const c=await get(id);if(!c||!Array.isArray(topics)||topics.some(t=>!email.TOPICS[t]))throw Error('Unknown label');const n={...c,topics:[...new Set(topics)],lastActor:actor};await collection.doc(id).set(n);await updateCard(n);return n;});}
 async function refreshLinked(){const docs=await collection.where('venueId','>','').get();if(!docs.size)return;const index=await venueDirectory.list({fresh:true});for(const doc of docs.docs)await locked(doc.id,async()=>{const c=await get(doc.id),v=index.find(v=>v.id===c.venueId&&v.linkable!==false),patch=v?{venueName:v.name,venueCity:v.city,followUpDate:v.date,venueLinkIssue:''}:{venueLinkIssue:'Linked venue unavailable; choose an existing venue'};if(Object.entries(patch).some(([k,v])=>c[k]!==v)){await collection.doc(c.id).set(patch,{merge:true});await updateCard({...c,...patch});}});}
 async function poll(){return locked('poll',async()=>{const cfg=await config();if(!cfg.enabled)return {paused:true};const profile=await graph('me?fields=id,name');if(profile.id!==PAGE_ID)throw Error('Wrong Facebook Page token');let processed=0,posted=0;if(platformName==='instagram'){const account=await graph(PAGE_ID+'?fields=instagram_business_account');if(account.instagram_business_account?.id!==platform.selfId)throw Error('Wrong linked Instagram account');}const threads=await allPages(graph,PAGE_ID+'/conversations?fields=id,updated_time,participants'+(platformName==='messenger'?',link':'')+'&limit=100'+(platformName==='instagram'?'&platform=instagram':''));for(const t of threads){const c=await get(platformName==='instagram'?hash(t.id).slice(0,32):t.id);if(c&&c.updatedTime&&c.updatedTime===t.updated_time){if(t.link!==c.sourceLink){await collection.doc(c.id).set({sourceLink:t.link||''},{merge:true});c.sourceLink=t.link||'';}await updateCard(c);continue;}t.messages=await allPages(graph,t.id+'/messages?fields=id,created_time,from,to,message,attachments,shares&limit=100');const result=await syncConversation(t,{historical:!cfg.importComplete});posted+=result.posted||0;processed++;}await refreshLinked();await db.doc(platform.namespace+'Config/main').set({lastSuccessAt:now().toISOString(),lastError:''},{merge:true});return {processed,posted,total:threads.length};});}
 return {get,config,updateCard,syncConversation,linkVenue,setStatus,setTopics,refreshLinked,poll,searchVenues:q=>venueDirectory.search(q),browseVenues:async c=>(await venueDirectory.list()).filter(v=>v.linkable!==false).sort((a,b)=>Number(b.id===c.venueId)-Number(a.id===c.venueId)||a.name.localeCompare(b.name))};
}
module.exports={PAGE_ID,INSTAGRAM_ID,PLATFORMS,PREFIX,card,messageParts,createService,createGraphClient,allPages};
