const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const b=require('../bookingTracker'),d=require('../bookingDrafts'),c=require('../contactRecords');
const DAY=86400000,T=Date.parse('2026-09-01T15:00Z');
const row=(extra={})=>Object.fromEntries(require('../jddmSpreadsheetBridge').CANONICAL_HEADERS.map(k=>[k,({'Place ID':'venue-1','Place Name':'Local Venue',Status:'Played in the Past','Email/Contact':'booking@example.com','Phone Number':'3305550123',...extra})[k]||'']));
const msg=(id,extra={})=>({id,threadId:'thread',at:T,body:'2027 music booking',subject:'2027 booking',from:['justdeedeemusic@gmail.com'],to:['booking@example.com'],sent:false,draft:false,deleted:false,rfcId:'<'+id+'@example.com>',...extra});
const derive=(mail,extra={},task={},today='2026-09-10',signals=[])=>b.derive(task,row(extra),mail,signals,today);
function setup(rows=[row()]){
 const store=new Map(),calls=[],threads=new Map();let sequence=0;
 store.set(b.PREFIX+'/config',{enabled:true,forumId:'forum',tags:Object.fromEntries(Object.keys(b.STATES).map(x=>[x,x])),mapTags:{}});
 const ref=path=>({path,get:async()=>({exists:store.has(path),data:()=>structuredClone(store.get(path))}),set:async(v,o)=>store.set(path,{...(o?.merge?store.get(path):{}),...structuredClone(v)})});
 const db={doc:ref,collection:name=>({get:async()=>({docs:[...store].filter(([k])=>k.startsWith(name+'/')).map(([k,v])=>({id:k.split('/').at(-1),data:()=>structuredClone(v)}))})}),runTransaction:fn=>fn({get:r=>r.get(),set:(r,v,o)=>r.set(v,o)})};
 const sheet={list:async()=>structuredClone(rows),get:async id=>structuredClone(rows.find(r=>r['Place ID']===id)),save:async(id,fields,expected)=>{const r=rows.find(r=>r['Place ID']===id);for(const[k,v]of Object.entries(expected))assert.equal(r[k]||'',v);Object.assign(r,fields);return{ok:true};}};
 const discord=async(method,path,body)=>{calls.push({method,path,body:structuredClone(body)});if(path.includes('/threads/active'))return{threads:[...threads.values()]};if(method==='POST'&&path.endsWith('/threads')){const id='forum-post-'+(++sequence);threads.set(id,{id,parent_id:'forum',name:body.name,thread_metadata:{archived:false}});return{id};}if(method==='GET')return threads.get(path.split('/')[2])||{};return{id:'message-'+(++sequence)};};
 const service=b.createService({db,discord,sheet,gmail:{},now:()=>new Date('2026-09-10T15:00Z')});
 return{store,db,sheet,discord,service,rows,calls};
}
test('unsent draft has no follow-up clock even after months; 2026 map booking is not 2027 booking',()=>{
 const v=derive([msg('draft',{draft:true})],{Status:'Booked'}, {},'2027-02-01');assert.equal(v.state,'draft');assert.equal(v.canAutoDraft,false);assert.equal(v.due,'');
});
test('only SENT label establishes a send; from-self draft is never sent',()=>{
 const raw={id:'m',internalDate:String(T),labelIds:['DRAFT'],payload:{headers:[{name:'From',value:b.MAILBOX}],body:{data:Buffer.from('2027').toString('base64url')}}};const m=b.normalizeMessage(raw);assert.equal(m.sent,false);assert.equal(m.draft,true);
});
test('sent → yellow, reply → blue, Dee Dee actual send → yellow with cold sequence paused',()=>{
 const sent=msg('s',{sent:true}),reply=msg('r',{at:T+DAY,from:['booking@example.com']}),again=msg('s2',{sent:true,at:T+2*DAY});
 assert.equal(derive([sent],{}, {},'2026-09-02').state,'venue');assert.equal(derive([sent,reply]).state,'deedee');const v=derive([sent,reply,again]);assert.equal(v.state,'venue');assert.equal(v.canAutoDraft,false);assert.match(v.reason,/active conversation/);
});
test('7/14/30 sequence waits from actual send, never floods late senders; three follow-ups stop',()=>{
 const first=msg('1',{sent:true});assert.equal(derive([first]).due,'2026-09-08');
 const late=msg('2',{sent:true,at:T+12*DAY});assert.equal(derive([first,late],{}, {},'2026-09-14').due,'2026-09-20');
 const third=msg('3',{sent:true,at:T+19*DAY});assert.equal(derive([first,late,third],{}, {},'2026-09-21').due,'2026-10-06');
 assert.match(derive([first,late,third,msg('4',{sent:true,at:T+35*DAY})],{}, {},'2026-12-01').reason,/Three follow-ups/);
});
test('official spreadsheet date overrides cadence; pending draft suppresses duplicate request',()=>{
 const m=msg('s',{sent:true});let v=derive([m],{'Next Follow Up':'11/01/2026'});assert.equal(v.due,'2026-11-01');assert.equal(v.canAutoDraft,false);
 v=derive([m],{'Next Follow Up':'09/03/2026'});assert.equal(v.canAutoDraft,true);assert.equal(derive([m],{}, {jobState:'pending'}).canAutoDraft,false);
});
test('delivery failures are red, temporary failures wait, legitimate discussion of an invalid email is not a bounce',()=>{
 const raw=(from,subject,body)=>b.normalizeMessage({id:'r',internalDate:String(T+DAY),labelIds:['INBOX'],payload:{headers:[{name:'From',value:from},{name:'Subject',value:subject}],body:{data:Buffer.from(body).toString('base64url')}}});
 const fail=raw('mailer-daemon@googlemail.com','Delivery Status Notification (Failure)','Final-Recipient: rfc822; booking@example.com\nAction: failed\nStatus: 5.1.1');assert.equal(fail.delivery,true);assert.deepEqual(fail.failedRecipients,['booking@example.com']);assert.equal(derive([msg('s',{sent:true}),fail]).state,'invalid');
 const delay=raw('mailer-daemon@googlemail.com','Delivery incomplete','Action: delayed\nStatus: 4.2.0\nwill retry');assert.equal(delay.temporaryDelivery,true);assert.equal(derive([msg('s',{sent:true}),delay]).canAutoDraft,false);
 assert.equal(raw('booking@example.com','Re: booking','Our old address was invalid but this one works.').delivery,false);
});
test('newer linked Voice/Messenger/Instagram activity pauses email sequence',()=>{
 const v=derive([msg('s',{sent:true})],{}, {},'2026-09-10',[{platform:'Google Voice',at:T+DAY}]);assert.equal(v.state,'deedee');assert.equal(v.canAutoDraft,false);assert.match(v.reason,/Google Voice/);
});
test('outcomes block auto drafts and unsent drafts never override a manually set no/booked/invalid',()=>{
 for(const outcome of ['no','booked','invalid','wrong','paused','yes']){const v=derive([msg('s',{sent:true}),msg('d',{draft:true})],{},{outcome});assert.equal(v.state,outcome);assert.equal(v.canAutoDraft,false);}
});
test('phone-only, email-only and other-only contacts are eligible and no email is invented',()=>{
 const data={version:2,contacts:[{...c.empty(),phones:[{value:'3305550123'}]},{...c.empty(),emails:[{value:'other@example.com'}]}]};const r=row({...c.summary(data),'Booking Contact':c.encode(data)}),v=derive([]);assert.equal(b.hasContact(r),true);const card=b.card({id:'x',venueId:'v'},r,v);assert.match(card.embeds[0].description,/\(330\) 555-0123/);assert.match(card.embeds[0].description,/other@example.com/);assert.equal(b.hasContact(row({'Email/Contact':'','Phone Number':''})),false);
});
test('cards stay within Discord limits, silent flags, no mention or send controls',()=>{
 const r=row({Notes:'x'.repeat(5000),'Contact Name':'Long name'.repeat(100)}),m=msg('d',{draft:true,body:'x'.repeat(20000)}),v=derive([m]);const card=b.card({id:'x',venueId:'v',recommendation:'why '.repeat(1000)},r,v);
 assert.ok(card.embeds.every(e=>!e.description||e.description.length<=4096));assert.ok(JSON.stringify(card.embeds).length<6000);assert.equal(card.flags,4096);assert.deepEqual(card.allowed_mentions.parse,[]);assert.ok(!JSON.stringify(card.components).includes('Send email'));assert.ok(card.components.length<=5);
});
test('publication is idempotent and excludes duplicate IDs, missing IDs and tests; no sheet writes',async()=>{
 const s=setup([row(),row({'Place ID':'dup'}),row({'Place ID':'dup'}),row({'Place ID':''}),row({'Place ID':'jddm-e2e-test'})]);await s.service.poll({mail:false});await s.service.poll({mail:false});assert.equal(s.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/threads')).length,1);assert.equal(s.rows.length,5);
});
test('date and map saves use canonical row and reject stale controls without adding columns',async()=>{
 const s=setup();await s.service.poll({mail:false});const id=b.hash('venue-1'),t=await s.service.get(id),before=Object.keys(s.rows[0]);await s.service.action(id,'date-submit','09/20/2026',t.threadId,'user','action',b.hash(''));assert.equal(s.rows[0]['Next Follow Up'],'2026-09-20');
 await assert.rejects(s.service.action(id,'date-submit','09/21/2026',t.threadId,'user','action2',b.hash('')),/changed/);assert.equal(s.rows[0]['Next Follow Up'],'2026-09-20');assert.equal(s.rows.length,1);assert.equal(Object.keys(s.rows[0]).length,before.length);assert.equal(before.length,28);
});
test('request draft is idempotent; wrong channel cannot mutate campaign; official status stays separate',async()=>{
 const s=setup();await s.service.poll({mail:false});const id=b.hash('venue-1'),t=await s.service.get(id);await s.service.action(id,'draft',null,t.threadId,'user','a');await s.service.action(id,'draft',null,t.threadId,'user','b');assert.equal((await s.service.readAll(b.PREFIX+'Jobs')).length,1);await assert.rejects(s.service.action(id,'outcome','no','elsewhere','user','c'),/original/);await s.service.action(id,'outcome','booked',t.threadId,'user','d');assert.equal(s.rows[0].Status,'Played in the Past');assert.equal((await s.service.get(id)).outcome,'booked');
});
test('writer refuses guesses, stale sends, replies, unsent duplicates and header injection',()=>{
 const proposal={recipient:'booking@example.com',subject:'2027 music',body:'Hi, should we look at 2027 dates?',recommendation:'Follow up by email based on past booking thread.',evidence:['Gmail prior booking']},job={anchor:'s',requestedBy:'automatic'},view=derive([msg('s',{sent:true})]);assert.equal(d.validate(proposal,row(),view,job),'booking@example.com');
 assert.throws(()=>d.validate({...proposal,recipient:'guessed@example.com'},row(),view,job),/verified/);assert.throws(()=>d.validate({...proposal,subject:'hello\nBcc: attacker@example.com'},row(),view,job),/subject/);assert.throws(()=>d.validate(proposal,row(),view,{...job,anchor:'older'}),/new email/);assert.throws(()=>d.validate(proposal,row(),derive([msg('s',{sent:true}),msg('d',{draft:true})]),job),/unsent/);assert.throws(()=>d.validate(proposal,row(),derive([msg('s',{sent:true}),msg('r',{from:['booking@example.com'],at:T+DAY})]),job),/no longer/);
});
test('follow-up MIME keeps same Gmail thread and references with Unicode body and stable message ID',()=>{
 const v=derive([msg('s',{sent:true,subject:'2027 — local music'})]),p={subject:'Changed',body:'Hi Dee Dee — thanks!'},j={id:'job',generation:1};const out=d.rawDraft(p,'booking@example.com',v,j),decoded=Buffer.from(out.raw,'base64url').toString();assert.equal(out.threadId,'thread');assert.match(decoded,/In-Reply-To: <s@example.com>/);assert.match(decoded,/Message-ID: <jddm-2027-job-1@justdeedeemusic.com>/);assert.equal(Buffer.from(decoded.split('\r\n\r\n')[1].replace(/\r\n/g,''),'base64').toString(),p.body);
});
test('date modal opens immediately from the post and invalid signatures are refused',async()=>{
 const s=setup();await s.service.poll({mail:false});const id=b.hash('venue-1'),t=await s.service.get(id),keys=crypto.generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');const handler=b.createInteractions({...s,publicKey:()=>publicKey});const body={id:'i',guild_id:b.GUILD,channel_id:t.threadId,member:{user:{id:'user'}},data:{custom_id:'jddmb:date:'+id+':'+b.hash('')+':0'}},rawBody=Buffer.from(JSON.stringify(body)),timestamp=String(Math.floor(Date.now()/1000)),signature=crypto.sign(null,Buffer.concat([Buffer.from(timestamp),rawBody]),keys.privateKey).toString('hex');const res={status(n){this.code=n;return this},send(v){this.body=v},json(v){this.body=v}};await handler({body,rawBody,get:n=>n==='X-Signature-Ed25519'?signature:timestamp},res);assert.equal(res.body.type,9);assert.match(res.body.data.custom_id,/date-submit/);await handler({body,rawBody,get:n=>n==='X-Signature-Ed25519'?'00'.repeat(64):timestamp},res);assert.equal(res.code,401);
});
test('an old sent message in a reused Gmail thread does not start a 2027 follow-up clock',()=>{
 const old=msg('old',{sent:true,at:T-300*DAY,subject:'2026 booking',body:'Our date in 2026'}),draft=msg('new',{draft:true,at:T});const view=derive([old,draft]);assert.equal(view.sent.length,0);assert.equal(view.state,'draft');assert.equal(view.canAutoDraft,false);
});
test('only an actual 2027 calendar date automatically establishes a 2027 booking',()=>{
 assert.equal(derive([],{Status:'Booked','Future Gigs':'2026-11-01'}).state,'ready');const v=derive([],{'Future Gigs':'2026-11-01; 2027-03-12'});assert.equal(v.state,'booked');assert.equal(v.canAutoDraft,false);assert.match(v.reason,/2027-03-12/);
});
test('real gateway-shaped Gmail draft, send, reply and removal events reconcile without sending or duplicate venue posts',async()=>{
 const s=setup(),messages=new Map();let phase=0;
 const raw=(id,labels,from,at,subject='2027 booking',body='2027 acoustic music')=>({id,threadId:'gmail-thread',internalDate:String(at),labelIds:labels,payload:{mimeType:'text/plain',headers:[{name:'From',value:from},{name:'To',value:from===b.MAILBOX?'booking@example.com':b.MAILBOX},{name:'Subject',value:subject},{name:'Message-ID',value:'<'+id+'@example.com>'}],body:{data:Buffer.from(body).toString('base64url')}}});
 messages.set('old',raw('old',['SENT'],b.MAILBOX,T-300*DAY,'2026 booking','2026 show'));messages.set('d',raw('d',['DRAFT'],b.MAILBOX,T));
 const gmail={users:{
  getProfile:async()=>({data:{emailAddress:b.MAILBOX,historyId:String(phase+1)}}),
  drafts:{list:async()=>({data:{drafts:[...messages.values()].filter(m=>m.labelIds.includes('DRAFT')).map(m=>({id:'draft-'+m.id,message:{id:m.id}}))}})},
  messages:{
   list:async()=>({data:{messages:[...messages.values()].filter(m=>m.labelIds.includes('SENT')).map(m=>({id:m.id}))}}),
   get:async({id})=>{if(!messages.has(id))throw Object.assign(Error('gone'),{code:404});return{data:messages.get(id)}}
  },
  threads:{get:async()=>({data:{messages:[...messages.values()]}})},
  history:{list:async()=>({data:{history:[{messagesAdded:[...messages.values()].filter(m=>m.id!=='old').map(message=>({message}))}]}})}
 }};
 const service=b.createService({...s,gmail,now:()=>new Date('2026-09-10T15:00Z')});
 await service.poll();let task=await service.get(b.hash('venue-1'));assert.equal(task.state,'draft');assert.equal(task.lastSentAt,0);
 const writes=[],originalSet=s.store.set.bind(s.store);s.store.set=(key,value)=>{writes.push(key);return originalSet(key,value);};await service.poll();assert.deepEqual(writes.filter(k=>k.startsWith(b.PREFIX+'Mail/')),[],'unchanged Gmail content must not rewrite stored mail');s.store.set=originalSet;
 messages.delete('d');messages.set('s',raw('s',['SENT'],b.MAILBOX,T+10*DAY));phase++;await service.poll();task=await service.get(task.id);assert.equal(task.state,'venue');assert.equal(task.lastSentAt,T+10*DAY);
 messages.set('r',raw('r',['INBOX'],'booking@example.com',T+11*DAY,'Re: 2027 booking','Yes, what dates do you have?'));phase++;await service.poll();task=await service.get(task.id);assert.equal(task.state,'deedee');assert.equal(s.calls.filter(x=>x.method==='POST'&&x.path.endsWith('/threads')).length,1);
 assert.equal(typeof gmail.users.messages.send,'undefined');
});
test('draft writer creates and verifies one draft, never sends, and repeat completion is idempotent',async()=>{
 const s=setup();await s.service.poll({mail:false});const task=await s.service.get(b.hash('venue-1')),job={id:'writer-job',taskId:task.id,venueId:task.venueId,anchor:'initial',requestedBy:'user',generation:1,state:'pending'};await s.db.doc(b.PREFIX+'Jobs/'+job.id).set(job);
 const proposals=[],drafts=new Map();let creates=0;
 const gmail={users:{
  getProfile:async()=>({data:{emailAddress:b.MAILBOX,historyId:'1'}}),
  drafts:{list:async()=>({data:{drafts:[...drafts.values()].map(d=>({id:d.id,message:{id:d.message.id}}))}}),
   create:async({requestBody})=>{creates++;const raw=Buffer.from(requestBody.message.raw,'base64url').toString(),[head,...body]=raw.split('\r\n\r\n');proposals.push(raw);const message={id:'new-message',threadId:'new-thread',labelIds:['DRAFT'],internalDate:String(Date.now()),payload:{mimeType:'text/plain',headers:head.split('\r\n').map(l=>({name:l.split(':')[0],value:l.slice(l.indexOf(':')+1).trim()})),body:{data:Buffer.from(Buffer.from(body.join('\r\n\r\n').replace(/\r\n/g,''),'base64').toString()).toString('base64url')}}};const draft={id:'new-draft',message};drafts.set(draft.id,draft);return{data:draft};},
   get:async({id})=>({data:drafts.get(id)})},
  messages:{list:async()=>({data:{messages:[]}}),get:async({id})=>({data:[...drafts.values()].find(d=>d.message.id===id).message})},
  threads:{get:async()=>({data:{messages:[]}})},history:{list:async()=>({data:{history:[]}})}
 }};
 const service=b.createService({...s,gmail}),writer=d.createWriter({...s,gmail,service}),context=await writer.fresh(job),proposal={contextFingerprint:context.fingerprint,action:'draft',recipient:'booking@example.com',subject:'2027 booking',body:'Hi, are you considering acoustic music for 2027?',recommendation:'Ask the verified booking contact about next year.',evidence:['Official venue spreadsheet']};
 await assert.rejects(writer.complete(job.id,{...proposal,contextFingerprint:'stale'}),/changed/);
 const result=await writer.complete(job.id,proposal);assert.equal(result.verified,true);assert.equal(result.sent,false);assert.equal(creates,1);assert.equal((await writer.complete(job.id,proposal)).alreadyComplete,true);assert.equal(creates,1);assert.equal(typeof gmail.users.messages.send,'undefined');assert.match(proposals[0],/To: booking@example.com/);
});
test('manual requests can revisit a completed recommendation but never overwrite an uncertain Gmail creation',async()=>{
 const s=setup();await s.service.poll({mail:false});const t=await s.service.get(b.hash('venue-1')),v=derive([]);await s.service.enqueue(t,s.rows[0],v,'user');let task=await s.service.get(t.id),jr=s.db.doc(b.PREFIX+'Jobs/'+task.jobId);await jr.set({state:'complete'},{merge:true});await s.service.enqueue(task,s.rows[0],v,'automatic');assert.equal((await jr.get()).data().state,'complete');await s.service.enqueue(task,s.rows[0],v,'user');assert.equal((await jr.get()).data().generation,2);await jr.set({state:'creating'},{merge:true});const message=await s.service.enqueue(task,s.rows[0],v,'user');assert.equal((await jr.get()).data().state,'creating');assert.match(message,/needs verification/);
});
test('correcting a bounced recipient requires a saved alternate and never retries the failed address',async()=>{
 const s=setup();await s.service.poll({mail:false});const t=await s.service.get(b.hash('venue-1'));await s.db.doc(b.PREFIX+'Mail/s').set({...msg('s',{sent:true}),venueId:t.venueId});await s.db.doc(b.PREFIX+'Mail/f').set({...msg('f',{delivery:true,at:T+DAY,from:['mailer-daemon@googlemail.com'],failedRecipients:['booking@example.com']}),venueId:t.venueId});
 await assert.rejects(s.service.action(t.id,'outcome','recipient-fixed',t.threadId,'user','fix1'),/alternate/);s.rows[0]['Email/Contact']='correct@example.com';await s.service.action(t.id,'outcome','recipient-fixed',t.threadId,'user','fix2');const task=await s.service.get(t.id),snapshot=await s.service.snapshot(),view=s.service.viewFor(task,s.rows[0],snapshot);assert.notEqual(view.state,'invalid');assert.deepEqual(view.invalidRecipients,['booking@example.com']);assert.throws(()=>d.validate({recipient:'booking@example.com'},s.rows[0],view,{}),/invalid/);
});
test('a rescheduled official date permits a fresh automatic review after a completed recommendation, without daily repeats',async()=>{
 const s=setup();await s.service.poll({mail:false});const t=await s.service.get(b.hash('venue-1')),m=msg('s',{sent:true});let v=b.derive(t,s.rows[0],[m],[],'2026-09-10');
 await s.service.enqueue(t,s.rows[0],v);let j=(await s.service.readAll(b.PREFIX+'Jobs'))[0];await s.db.doc(b.PREFIX+'Jobs/'+j.id).set({state:'complete'},{merge:true});
 await s.service.enqueue(t,s.rows[0],v);assert.equal((await s.service.readAll(b.PREFIX+'Jobs'))[0].state,'complete');
 s.rows[0]['Next Follow Up']='2026-10-01';v=b.derive({...t,jobState:'complete'},s.rows[0],[m],[],'2026-09-10');assert.equal(v.canAutoDraft,false);
 v=b.derive({...t,jobState:'complete'},s.rows[0],[m],[],'2026-10-01');assert.equal(v.canAutoDraft,true);await s.service.enqueue(t,s.rows[0],v);j=(await s.service.readAll(b.PREFIX+'Jobs'))[0];assert.equal(j.state,'pending');assert.equal(j.generation,2);assert.equal(j.officialDateAtRequest,'2026-10-01');
});
test('sending on or after the official follow-up cannot immediately trigger another draft against that used date',()=>{
 const first=msg('first',{sent:true}),followup=msg('followup',{sent:true,at:T+10*DAY});
 for(const date of ['2026-09-08','2026-09-11']){const v=derive([first,followup],{'Next Follow Up':date},{},'2026-09-11');assert.equal(v.canAutoDraft,false);assert.equal(v.official,date);assert.match(v.reason,/Choose the next official/);}
 const next=derive([first,followup],{'Next Follow Up':'2026-09-12'},{},'2026-09-12');assert.equal(next.canAutoDraft,true);assert.equal(next.due,'2026-09-12');
});

test('a due unanswered campaign is orange, not a yellow card with an orange tag',()=>{
 const view=derive([msg('s',{sent:true})]);assert.equal(view.state,'due');assert.ok(view.tags.includes('due'));assert.equal(b.card({id:'test',venueId:'test'},row(),view).embeds[0].color,0xe67e22);
});
test('automatic acknowledgments never count as human replies or restart the sent clock',()=>{
 const v=derive([msg('s',{sent:true}),msg('auto',{autoReply:true,from:['booking@example.com'],at:T+DAY})]);assert.equal(v.state,'due');assert.equal(v.due,'2026-09-08');assert.equal(v.lastReply,null);
});
test('Eastern midnight and DST use calendar days, not elapsed 24-hour blocks',()=>{
 const v=derive([msg('s',{sent:true,at:Date.parse('2026-11-01T03:30:00Z')})],{},{},'2026-11-07');assert.equal(v.due,'2026-11-07');assert.equal(v.state,'due');
});
test('morning digest includes suggested booking timers, recipient problems, and explicit dates for returning venues exactly once',()=>{
 const {buildDigest}=require('../followUpDigest');const result=buildDigest({today:'2026-09-10',rows:[row({'Place ID':'past','Next Follow Up':'2026-09-10'}),row({'Place ID':'bad','Place Name':'Failed Venue','Next Follow Up':'2026-09-10'})],booking:[{id:'past',name:'Local Venue',date:'2026-09-10',official:true},{id:'suggested',name:'Suggested Venue',date:'2026-09-10',url:'https://example.com/test'},{id:'later',name:'Later Venue',date:'2026-09-12'},{id:'bad',name:'Failed Venue',attention:'Invalid email'}]});assert.equal(result.body.match(/• Local Venue/g).length,1);assert.match(result.body,/Suggested Venue/);assert.match(result.body,/Later Venue/);assert.match(result.body,/Failed Venue — Invalid email/);assert.equal(result.body.match(/• Failed Venue/g).length,1);assert.equal(result.bookingFollowUps,1);
});

test('a draft promoted to SENT with the same message ID is not mistakenly marked deleted',async()=>{
 const f=require('./helpers/bookingFixture').fixture();f.put({id:'same',labels:['DRAFT']});await f.service.poll();f.put({id:'same',labels:['SENT']});await f.service.poll();assert.equal((await f.task()).state,'venue');assert.equal(f.store.get(b.PREFIX+'Mail/same').deleted,false);
});
test('a send and separate-thread bounce arriving in one poll immediately mark the venue red',async()=>{
 const f=require('./helpers/bookingFixture').fixture();f.put({id:'draft',labels:['DRAFT']});await f.service.poll();f.messages.delete('draft');f.put({id:'sent',labels:['SENT']});f.put({id:'bounce',threadId:'bounce-thread',from:'mailer-daemon@googlemail.com',to:b.MAILBOX,subject:'Delivery Status Notification (Failure)',body:'Final-Recipient: rfc822; booking@example.com\nAction: failed\nStatus: 5.1.1',at:Date.parse('2026-09-09T12:00:01Z')});await f.service.poll();assert.equal((await f.task()).state,'invalid');
});
test('a due follow-up draft stays in the shared morning digest, while an initial unsent draft has no reminder',async()=>{
 const f=require('./helpers/bookingFixture').fixture();f.put({id:'draft',labels:['DRAFT']});await f.service.poll();const fetchImpl=async()=>({ok:true,text:async()=> 'Place ID,Place Name,Next Follow Up,Status\npreflight-fake-venue,Fake Venue,,Played in the Past'});
 const load=()=>require('../followUpDigest').loadDigest({db:f.db,fetchImpl,today:'2026-09-16',cache:false});assert.equal((await load()).bookingFollowUps,0);
 f.messages.delete('draft');f.put({id:'sent',labels:['SENT']});await f.service.poll();f.clock('2026-09-16T12:00Z');f.put({id:'followdraft',labels:['DRAFT']});await f.service.poll();assert.equal((await f.task()).state,'draft');assert.equal((await load()).bookingFollowUps,1);
});

test('trash and permanent deletion preserve sent evidence, but discarded drafts stay discarded',async()=>{
 const s=msg('sent',{sent:true,deleted:true}),discarded=msg('discarded',{deleted:true});
 const v=derive([s,discarded]);assert.equal(v.due,'2026-09-08');assert.equal(v.sent.length,1);assert.equal(v.drafts.length,0);assert.equal(v.history.length,1);
 const f=require('./helpers/bookingFixture').fixture();f.put({id:'sent',labels:['SENT','TRASH']});let options;const list=f.gmail.users.messages.list;f.gmail.users.messages.list=async o=>{options=o;return list(o)};
 await f.service.poll();assert.equal(options.includeSpamTrash,true);assert.equal((await f.task()).lastSentAt,Date.parse('2026-09-09T12:00:00Z'));
 f.messages.delete('sent');await f.db.doc(b.PREFIX+'/gmail').set({pending:['sent']},{merge:true});await f.service.poll();assert.equal((await f.task()).state,'venue');assert.ok((await f.task()).lastSentAt);
});
test('trashed bounces and venue replies still stop automatic outreach',()=>{
 const s=msg('s',{sent:true,deleted:true}),bounce=msg('bounce',{delivery:true,deleted:true,from:['mailer-daemon@googlemail.com'],at:T+DAY,failedRecipients:['booking@example.com']});
 assert.equal(derive([s,bounce]).state,'invalid');
 const reply=msg('reply',{deleted:true,from:['booking@example.com'],at:T+DAY});assert.equal(derive([s,reply]).state,'deedee');
 assert.equal(derive([s,reply,msg('answer',{sent:true,at:T+2*DAY})]).canAutoDraft,false);
});
test('corrected contact without a replacement send does not start a normal follow-up clock',()=>{
 const s=msg('s',{sent:true,deleted:true}),bounce=msg('bounce',{delivery:true,deleted:true,from:['mailer-daemon@googlemail.com'],at:T+DAY,failedRecipients:['booking@example.com']}),task={dismissedDeliveryId:'bounce',blockedRecipients:['booking@example.com']};
 const v=derive([s,bounce],{},task);assert.equal(v.state,'ready');assert.equal(v.due,'');assert.equal(v.canAutoDraft,false);assert.equal(v.sent.length,1);assert.deepEqual(v.invalidRecipients,['booking@example.com']);assert.match(v.reason,/no replacement email/);
 const draft=msg('newdraft',{draft:true,at:T+2*DAY,to:['new@example.com']});assert.equal(derive([s,bounce,draft],{},task).state,'draft');
});
test('replacement after a bounced initial email does not consume a follow-up attempt',()=>{
 const s=msg('s',{sent:true}),bounce=msg('bounce',{delivery:true,from:['mailer-daemon@googlemail.com'],at:T+60001,failedRecipients:['booking@example.com']}),replacement=msg('replacement',{sent:true,at:T+120002,to:['new@example.com']});
 const v=derive([s,bounce,replacement]);assert.equal(v.followupSends,0);assert.equal(v.sent.length,2);
 const follow=msg('follow',{sent:true,at:T+7*DAY,to:['new@example.com']});assert.equal(derive([s,bounce,replacement,follow]).followupSends,1);
 const partial=msg('partial',{sent:true,to:['booking@example.com','other@example.com']});assert.equal(derive([partial,bounce,replacement]).followupSends,1);
});
test('a separate-thread reply can match a venue whose sent email is in Trash',async()=>{
 const f=require('./helpers/bookingFixture').fixture();f.put({id:'sent',labels:['SENT','TRASH']});await f.service.poll();f.put({id:'reply',threadId:'separate',from:'booking@example.com',to:b.MAILBOX,subject:'Music availability',body:'Can you play in January?',at:Date.parse('2026-09-09T12:01Z')});await f.service.poll();assert.equal((await f.task()).state,'deedee');assert.equal(f.store.get(b.PREFIX+'Mail/reply').venueId,f.rows[0]['Place ID']);
});
