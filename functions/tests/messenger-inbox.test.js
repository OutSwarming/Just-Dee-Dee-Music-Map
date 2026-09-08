const {test}=require('node:test'),assert=require('node:assert/strict');
const m=require('../messengerInbox');
test('history card has no false waiting status and cannot send email',()=>{const c=m.card({id:'t_123',psid:'456',name:'Venue contact',status:'history',topics:[]});assert.match(c.content,/Imported conversation/);assert.equal(c.allowed_mentions.parse.length,0);assert.ok(c.components.flatMap(r=>r.components).every(x=>!x.custom_id?.startsWith('jddm2:')));assert.ok(c.components[0].components.find(x=>x.style===5).url.startsWith('https://business.facebook.com/'));assert.ok(c.components.flatMap(r=>r.components).every(x=>!x.custom_id?.startsWith('jddm2:reply:')));});
test('long sent replies retain all text and use silent deduplicated messages',()=>{const body='Long booking conversation. '.repeat(500),parts=m.messageParts({id:'m_123',created_time:'2026-09-07T12:00:00Z',from:{id:m.PAGE_ID,name:'Just Dee Dee Music'},message:body});assert.ok(parts.length>1);assert.ok(parts.every(p=>p.flags===4096&&p.enforce_nonce&&p.allowed_mentions.parse.length===0&&p.content.length<2000));assert.match(parts[0].content,/Sent by Just Dee Dee Music/);assert.equal(new Set(parts.map(p=>p.nonce)).size,parts.length);assert.equal(parts.map(p=>p.content).join('').replace(/\s/g,'').includes(body.replace(/\s/g,'')),true);});
test('pagination follows all history pages without using a remote next URL',async()=>{const calls=[];const out=await m.allPages(async p=>{calls.push(p);return calls.length===1?{data:[1],paging:{next:'https://example.invalid/',cursors:{after:'next cursor'}}}:{data:[2]};},'104/conversations?limit=100');assert.deepEqual(out,[1,2]);assert.match(calls[1],/&after=next%20cursor$/);});

function setup(){const data=new Map([['jddmMessengerConfig/main',{forumId:'forum',historyTag:'history',tags:{deedee:'blue',venue:'yellow',resolved:'green'},topicTags:{songs:'pink'}}]]);const ref=path=>({get:async()=>({exists:data.has(path),data:()=>structuredClone(data.get(path))}),set:async(v,o)=>data.set(path,o?.merge?{...data.get(path),...structuredClone(v)}:structuredClone(v))});const db={doc:ref,collection:n=>({doc:id=>ref(n+'/'+id),where:()=>({get:async()=>({size:0,docs:[]})})}),runTransaction:async fn=>fn({get:r=>r.get(),set:(r,v,o)=>r.set(v,o)})};const calls=[];let i=0;const discord=async(method,path,body)=>{calls.push({method,path,body});return path.endsWith('/threads/active')?{threads:[]}:{id:'post'+(++i)};};const venues=[{id:'venue',name:'Real venue',date:'2026-09-20'}];const venueDirectory={list:async()=>venues,get:async()=>venues[0],setDate:async(id,date,expected)=>{assert.equal(expected,venues[0].date);venues[0].date=date;return venues[0];}};return {db,data,calls,discord,venueDirectory,venues,service:m.createService({db,discord,venueDirectory,now:()=>new Date('2026-09-07T12:00:00Z')})};}
function conversation(id='t_1',messages=[{id:'m1',from:{id:'contact',name:'Customer'},created_time:'2026-09-06T12:00:00Z',message:'Hello'}]){return {id,participants:{data:[{id:m.PAGE_ID},{id:'contact',name:'Customer'}]},messages,updated_time:messages.at(-1)?.created_time};}
test('historical import is idempotent; later incoming and outgoing messages share one post',async()=>{const s=setup(),t=conversation();await s.service.syncConversation(t,{historical:true});await s.service.setStatus(t.id,'resolved','Dee Dee');await s.service.syncConversation(t,{historical:true});assert.equal((await s.service.get(t.id)).status,'resolved');t.messages.push({id:'m2',from:{id:'contact'},created_time:'2026-09-07T12:00:00Z',message:'New request'});await s.service.syncConversation(t);assert.equal((await s.service.get(t.id)).status,'deedee');t.messages.push({id:'m3',from:{id:m.PAGE_ID},created_time:'2026-09-07T13:00:00Z',message:'Our reply'});await s.service.syncConversation(t);assert.equal((await s.service.get(t.id)).status,'venue');assert.equal(s.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/threads')).length,1);assert.equal(s.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/messages')).length,3);});
test('source isolation and partial message retry preserve data',async()=>{const s=setup();await assert.rejects(()=>s.service.syncConversation({...conversation(),participants:{data:[{id:'other-page'}]}}),/does not belong/);let fail=true;const svc=m.createService({...s,discord:async(method,path,body)=>{if(method==='POST'&&path.endsWith('/messages')&&s.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/messages')).length===1&&fail){fail=false;throw Error('temporary');}return s.discord(method,path,body);}});const t=conversation();t.messages[0].message='long text '.repeat(1000);await assert.rejects(()=>svc.syncConversation(t,{historical:true}),/temporary/);await svc.syncConversation(t,{historical:true});const sent=s.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/messages'));assert.equal(sent.length,m.messageParts(t.messages[0]).length);assert.equal(new Set(sent.map(c=>c.body.nonce)).size,sent.length);});
test('official follow-up requires existing link and rejects stale venue context',async()=>{const s=setup();await s.service.syncConversation(conversation(),{historical:true});await assert.rejects(()=>s.service.setStatus('t_1','followup','Dee Dee','2026-09-25'),/Link an existing/);await s.service.linkVenue('t_1','venue','Dee Dee','');await assert.rejects(()=>s.service.setStatus('t_1','followup','Dee Dee','2026-09-25',{hash:'wrong'}),/link changed/);const hash=require('node:crypto').createHash('sha256').update('venue').digest('hex').slice(0,8);await s.service.setStatus('t_1','followup','Dee Dee','2026-09-25',{hash,date:'2026-09-20'});assert.equal((await s.service.get('t_1')).followUpDate,'2026-09-25');});
test('webhook rejects unsigned, changed, and unrelated Page payloads',async()=>{const w=require('../messengerWebhook'),crypto=require('crypto'),secret='test-secret',raw=Buffer.from(JSON.stringify({object:'page',entry:[{id:'other-page'}]})),signature='sha256='+crypto.createHmac('sha256',secret).update(raw).digest('hex');assert.equal(w.validSignature(raw,signature,secret),true);assert.equal(w.validSignature(Buffer.from('changed'),signature,secret),false);assert.equal(w.validSignature(raw,'sha256=bad',secret),false);let writes=0,code;const res={status:x=>{code=x;return res;},send:x=>x};await w.createHandler({db:{doc:()=>({set:async()=>writes++})},appSecret:secret})({method:'POST',rawBody:raw,body:JSON.parse(raw),get:()=>signature},res);assert.equal(code,200);assert.equal(writes,0);});

test('Instagram uses its own forum, receipts, short control IDs, and outgoing identity',async()=>{
 const s=setup();s.data.set('jddmInstagramConfig/main',{forumId:'insta',historyTag:'ig-history',tags:{deedee:'blue',venue:'yellow'}});
 const service=m.createService({...s,platform:'instagram'});
 const sourceId='instagram-conversation-'.repeat(12),thread={id:sourceId,participants:{data:[{id:m.INSTAGRAM_ID},{id:'ig-customer',username:'venue.customer'}]},messages:[{id:'m1',created_time:'2026-09-07T12:00:00Z',from:{id:'ig-customer',username:'venue.customer'},message:'Instagram inquiry'}]};
 const result=await service.syncConversation(thread,{historical:true});assert.equal(result.id.length,32);
 let c=await service.get(result.id);assert.equal(c.name,'venue.customer');assert.equal(c.sourceId,sourceId);assert.equal(c.platform,'instagram');
 const rendered=m.card(c);assert.ok(rendered.components.flatMap(r=>r.components).filter(x=>x.custom_id).every(x=>(x.custom_id.startsWith('jddmi:')||x.custom_id.startsWith('jddms:reply:instagram:'))&&x.custom_id.length<=100));assert.match(rendered.components[0].components.find(x=>x.style===5).url,/instagram_direct/);
 thread.messages.push({id:'m2',created_time:'2026-09-07T13:00:00Z',from:{id:m.INSTAGRAM_ID},message:'JDDM reply'});await service.syncConversation(thread);c=await service.get(result.id);assert.equal(c.status,'venue');
 const posts=s.calls.filter(x=>x.method==='POST'&&x.path.endsWith('/messages'));assert.match(posts.at(-1).body.content,/Sent by Just Dee Dee Music/);assert.ok(posts.every(x=>x.body.flags===4096));
 assert.equal([...s.data.keys()].filter(x=>x.startsWith('jddmMessengerMessages/')).length,0);assert.equal([...s.data.keys()].filter(x=>x.startsWith('jddmInstagramMessages/')).length,2);
 await assert.rejects(()=>service.syncConversation(conversation()),/does not belong/);
});

test('Instagram poll imports a new conversation even when updated_time is absent',async()=>{
 const s=setup();s.data.set('jddmInstagramConfig/main',{forumId:'insta',enabled:true,importComplete:true,tags:{deedee:'blue'}});
 const thread={id:'long-instagram-id'.repeat(8),participants:{data:[{id:m.INSTAGRAM_ID},{id:'customer',username:'customer'}]}};
 const graph=async path=>{if(path==='me?fields=id,name')return {id:m.PAGE_ID};if(path.includes('?fields=instagram_business_account'))return {instagram_business_account:{id:m.INSTAGRAM_ID}};if(path.includes('/conversations?')){assert.match(path,/platform=instagram/);return {data:[thread]};}if(path.includes('/messages?'))return {data:[{id:'ig-new',created_time:'2026-09-07T12:00:00Z',from:{id:'customer'},message:'Hello'}]};throw Error('Unexpected API route');};
 const service=m.createService({...s,platform:'instagram',graph});assert.equal((await service.poll()).posted,1);assert.equal((await service.poll()).posted,0);
 assert.equal(s.calls.filter(x=>x.method==='POST'&&x.path.endsWith('/threads')).length,1);
});

test('social link uses corroborated saved identity and rechecks after sheet updates without reposting history',async()=>{
 const s=setup(),t=conversation();t.participants.data[1].name='Abbey Swanson';t.messages[0].message='At Patina Porch, we want to book you';
 await s.service.syncConversation(t,{historical:true});assert.equal((await s.service.get(t.id)).venueId,'');
 s.venues[0]={...s.venues[0],name:'Patina Porch',names:['patina porch'],contactNames:['abbey swanson']};await s.service.syncConversation(t,{historical:true});
 let c=await s.service.get(t.id);assert.equal(c.venueId,'venue');assert.equal(c.status,'history');assert.equal(c.followUpDate,'2026-09-20');
 s.venues.push({...s.venues[0],id:'duplicate'});await s.service.syncConversation(t,{historical:true});c=await s.service.get(t.id);assert.equal(c.venueId,'');assert.match(c.venueLinkIssue,/confirmation/);
 assert.equal(s.calls.filter(x=>x.method==='POST'&&x.path.endsWith('/messages')).length,1);
 await s.service.linkVenue(t.id,'venue','Dee Dee','');await s.service.syncConversation(t);assert.equal((await s.service.get(t.id)).venueId,'venue');assert.equal((await s.service.get(t.id)).venueLinkMode,'manual');
});
test('a manual social identity is remembered across conversations, explicit unlink and test data never auto-link',async()=>{
 const s=setup(),t=conversation();await s.service.syncConversation(t);await s.service.linkVenue(t.id,'venue','Dee Dee','');
 const second=conversation('t_2',[{...t.messages[0],id:'different-message'}]);await s.service.syncConversation(second);assert.equal((await s.service.get(second.id)).venueId,'venue');
 await s.service.linkVenue(t.id,'','Dee Dee','venue');await s.service.syncConversation(second);assert.equal((await s.service.get(second.id)).venueId,'');
 const c={...await s.service.get(t.id),venueId:'',venueLinkMode:'',testConversation:true};assert.deepEqual(await s.service.tryAutoLink(c),c);
});
test('Instagram exact saved handle links without a display name or message-body guess',async()=>{
 const s=setup();s.data.set('jddmInstagramConfig/main',{forumId:'insta'});s.venues[0].socialProfiles=['instagram:venue.customer'];const service=m.createService({...s,platform:'instagram'});
 const t={id:'ig-thread',participants:{data:[{id:m.INSTAGRAM_ID},{id:'ig-customer',username:'venue.customer'}]},messages:[{id:'ig-message',from:{id:'ig-customer'},created_time:'2026-09-07T12:00:00Z',message:'Hello'}]};
 const result=await service.syncConversation(t);assert.equal((await service.get(result.id)).venueId,'venue');
 t.participants.data[1].username='different.handle';await service.syncConversation(t);assert.equal((await service.get(result.id)).venueId,'');
});


test('signed webhooks route only the matching JDDM platform identity',async()=>{
 const w=require('../messengerWebhook'),crypto=require('crypto');
 for(const [object,id,expected] of [['page',m.PAGE_ID,'jddmMessengerConfig/webhook'],['instagram',m.INSTAGRAM_ID,'jddmInstagramConfig/webhook'],['instagram',m.PAGE_ID,null],['page',m.INSTAGRAM_ID,null],['instagram','other-ig',null]]){
  const body={object,entry:[{id}]},raw=Buffer.from(JSON.stringify(body)),secret='test-secret',signature='sha256='+crypto.createHmac('sha256',secret).update(raw).digest('hex');let writes=[],code;
  const res={status:x=>{code=x;return res;},send:x=>x};
  await w.createHandler({db:{doc:p=>({set:async v=>writes.push({p,v})})},appSecret:secret})({method:'POST',rawBody:raw,body,get:()=>signature},res);
  assert.equal(code,200);assert.deepEqual(writes.map(x=>x.p),expected?[expected]:[]);if(expected)assert.equal(writes[0].v.pending,true);
 }
});


test('privacy restriction blocks initial import and reimport without touching the source inbox',async()=>{
 const s=setup(),p=require('../socialPrivacy'),t=conversation();await p.restrict(s.db,'messenger','contact');
 assert.deepEqual(await s.service.syncConversation(t),{skipped:true,restricted:true});assert.equal(s.calls.length,0);
 assert.equal(await s.service.get(t.id),undefined);assert.equal(await p.isRestricted(s.db,'instagram','contact'),false);
 const record=s.data.get(p.restrictionPath('messenger','contact'));assert.deepEqual(Object.keys(record).sort(),['restricted','updatedAt']);
});
test('privacy restriction prevents unchanged polling from reopening a removed conversation',async()=>{
 const s=setup(),p=require('../socialPrivacy'),t=conversation();await s.service.syncConversation(t);await p.restrict(s.db,'messenger','contact');
 s.data.set('jddmMessengerConfig/main',{...s.data.get('jddmMessengerConfig/main'),enabled:true,importComplete:true});const before=s.calls.length;
 const graph=async path=>path==='me?fields=id,name'?{id:m.PAGE_ID}:{data:[t]};
 assert.equal((await m.createService({...s,graph}).poll()).posted,0);assert.equal(s.calls.length,before);
});
