const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const w=require('../venueWorklist'),contacts=require('../contactRecords'),{CANONICAL_HEADERS}=require('../jddmSpreadsheetBridge');
function row(id,extra={}){return Object.fromEntries(CANONICAL_HEADERS.map(k=>[k,({'Place ID':id,'Place Name':'Venue '+id,Status:'Needs Review',Notes:'Keep original venue notes',...extra})[k]||'']));}
function setup(initial=[row('one')]){
 const data=new Map([['jddmVenueWorklist/config',{enabled:true,forumId:'forum',tags:{open:'blue',done:'green',deferred:'orange'}}]]),rows=structuredClone(initial),calls=[],threads=new Map(),messages=new Map();let time=new Date('2026-09-08T12:00:00Z'),counter=0;
 const ref=path=>({path,id:path.split('/').at(-1),get:async()=>({exists:data.has(path),data:()=>structuredClone(data.get(path))}),set:async(v,o)=>data.set(path,{...(o?.merge?data.get(path):{}),...structuredClone(v)})});
 const collection=name=>({doc:id=>ref(name+'/'+id),get:async()=>({docs:[...data].filter(([k])=>k.startsWith(name+'/')).map(([k])=>({id:k.split('/').at(-1),data:()=>structuredClone(data.get(k))}))})});
 const db={doc:ref,collection,runTransaction:fn=>fn({get:r=>r.get(),set:(r,v,o)=>r.set(v,o)})};
 const discord=async(method,path,body)=>{calls.push({method,path,body:structuredClone(body)});if(path.includes('/threads/active'))return {threads:[...threads.values()]};if(method==='POST'&&path.endsWith('/threads')){const id='thread'+(++counter);threads.set(id,{id,parent_id:'forum',name:body.name,applied_tags:body.applied_tags,thread_metadata:{archived:false}});messages.set(id,body.message);return {id};}const id=path.split('/')[2];if(path.includes('/messages/')){if(method==='PATCH')messages.set(id,body);return messages.get(id)||{};}if(method==='GET')return threads.get(id)||{};if(method==='PATCH'){const t=threads.get(id)||{};threads.set(id,{...t,...body,thread_metadata:{archived:body.archived??t.thread_metadata?.archived}});return threads.get(id);}return {id:'message'};};
 const sheet={list:async()=>structuredClone(rows),get:async id=>{const r=rows.find(r=>r['Place ID']===id);if(!r)throw Error('Missing venue');return structuredClone(r);},save:async(id,fields,expected,requestId)=>{const r=rows.find(r=>r['Place ID']===id);for(const [k,v]of Object.entries(expected))if(String(r[k]||'')!==String(v||'')&&fields[k]!==r[k])throw Error('This venue changed in another window');Object.assign(r,structuredClone(fields));return {ok:true,rawFields:structuredClone(r)};}};
 const service=w.createService({db,discord,sheet,now:()=>time,random:()=>0});
 const task=async()=>{await service.fill();return (await service.all())[0];};
 const context=async t=>{const p=await service.prepare(t.id,'user',t.threadId);return {user:'user',actor:'Tester',channel:t.threadId,requestId:'action'+(++counter),sid:p.sid};};
 return {db,data,rows,calls,threads,messages,sheet,discord,service,task,context,setDay:d=>{time=new Date(d+'T12:00Z');}};
}
test('four slots carry unfinished posts and select three replacements after three completions',()=>{
 const rows=Array.from({length:10},(_,n)=>row('v'+n));const tasks=rows.slice(0,4).map((r,n)=>({venueId:r['Place ID'],state:n===0?'open':'done',completedDay:'2026-09-08'}));const picks=w.choose(rows,tasks,'2026-09-09',()=>0);
 assert.equal(picks.length,3);assert.ok(picks.every(r=>!tasks.some(t=>t.venueId===r['Place ID'])));
 assert.equal(w.choose(rows,tasks.map(t=>({...t,state:'open'})),'2026-09-09').length,0);
});
test('missing IDs, duplicate IDs, marked tests and closed venues cannot be selected',()=>{
 const rows=[row(''),row('duplicate'),row('duplicate'),row('jddm-e2e-test'),row('closed',{Status:'Told No / Closed / No Music'}),row('valid')];assert.deepEqual(w.eligible(rows).map(r=>r['Place ID']),['valid']);
});
test('completed venues get a rest and unseen venues are offered before repeats',()=>{
 const rows=[row('old'),row('new')],tasks=[{venueId:'old',state:'done',completedDay:'2026-07-01'}];assert.deepEqual(w.choose(rows,tasks,'2026-09-08').map(r=>r['Place ID']),['new']);assert.deepEqual(w.choose([row('old')],tasks,'2026-07-15'),[]);assert.equal(w.choose([row('old')],tasks,'2026-09-08').length,1);
});
test('daily fill is idempotent and completed slots refill only on the next day',async()=>{
 const s=setup(Array.from({length:8},(_,n)=>row('v'+n)));await s.service.fill();assert.equal((await s.service.all()).length,4);const t=(await s.service.all())[0];await s.service.mutate(t.id,'done',{},await s.context(t));await s.service.fill();assert.equal((await s.service.all()).length,4);s.setDay('2026-09-09');await s.service.fill();assert.equal((await s.service.all()).filter(t=>t.state==='open').length,4);assert.equal(s.rows.length,8);
});
test('phone-only and email-only people save separately with one notes field per contact and 28 columns',async()=>{
 const s=setup(),t=await s.task();const c1=await s.context(t);
 await s.service.mutate(t.id,'contact',{name:'',phones:'13305550123',emails:'',notes:'Front desk phone',preferred:'Phone'},{...c1,index:0});
 const c2=await s.context(await s.service.get(t.id));await s.service.mutate(t.id,'contact',{name:'',phones:'',emails:'booking@example.com',notes:'Booking email',preferred:'Email'},{...c2,index:1});
 const p=contacts.read(s.rows[0]).contacts;assert.equal(p.length,2);assert.equal(p[0].phones[0].value,'(330) 555-0123');assert.equal(p[0].emails.length,0);assert.equal(p[1].phones.length,0);assert.equal(p[1].emails[0].value,'booking@example.com');assert.equal(p[1].notes,'Booking email');assert.equal(s.rows[0].Notes,'Keep original venue notes');assert.equal(Object.keys(s.rows[0]).length,28);
});
test('other contact methods preserve phone/email/person notes and malformed input never writes',async()=>{
 const d={version:2,contacts:[{...contacts.empty(),name:'Booking',notes:'Person notes',emails:[{value:'booking@example.com',note:''}]}]};const s=setup([row('one',{...contacts.summary(d),'Booking Contact':contacts.encode(d)})]),t=await s.task();
 await s.service.mutate(t.id,'other',{preferred:'Website form',other:'Website | https://venue.example/contact'}, {...await s.context(t),index:0});const p=contacts.read(s.rows[0]).contacts[0];assert.equal(p.emails[0].value,'booking@example.com');assert.equal(p.notes,'Person notes');assert.equal(p.others[0].type,'Website');
 const before=JSON.stringify(s.rows);await assert.rejects(s.service.mutate(t.id,'contact',{name:'X',emails:'not an email',phones:'',notes:'',preferred:''},{...await s.context(t),index:0}),/complete email/);assert.equal(JSON.stringify(s.rows),before);
});
test('a stale Discord contact draft cannot overwrite a newer app edit',async()=>{
 const s=setup(),t=await s.task(),ctx=await s.context(t);s.rows[0]['Contact Name']='Newer app name';
 await assert.rejects(s.service.mutate(t.id,'contact',{name:'Stale name',emails:'a@example.com',phones:'',notes:'',preferred:''},{...ctx,index:0}),/another window/);assert.equal(s.rows[0]['Contact Name'],'Newer app name');
});
test('Done writes a review note, preserves booking/date, turns green and archives without deleting',async()=>{
 const s=setup([row('one',{Status:'Booked','Next Follow Up':'2026-10-01'})]),t=await s.task();await s.service.mutate(t.id,'done',{},await s.context(t));const done=await s.service.get(t.id);
 assert.equal(done.state,'done');assert.match(s.rows[0].Notes,/Keep original venue notes/);assert.match(s.rows[0].Notes,/Venue information reviewed/);assert.equal(s.rows[0].Status,'Booked');assert.equal(s.rows[0]['Next Follow Up'],'2026-10-01');assert.equal(s.rows.length,1);assert.equal(s.threads.get(t.threadId).thread_metadata.archived,true);assert.equal(s.messages.get(t.threadId).embeds[0].color,0x2ecc71);
});
test('Contacted records Eastern date without sending communication or changing an existing booking',async()=>{
 const s=setup([row('one',{Status:'Booked'})]),t=await s.task();await s.service.mutate(t.id,'contacted',{},await s.context(t));assert.equal(s.rows[0]['Last Contacted'],'2026-09-08');assert.equal(s.rows[0].Status,'Booked');assert.ok(!s.calls.some(c=>c.path.includes('gmail')||c.path.includes('voice')));
});
test('reschedule writes the official date and follows later app date changes',async()=>{
 const s=setup(),t=await s.task();await s.service.mutate(t.id,'date',{date:'09/12/2026'},await s.context(t));assert.equal(s.rows[0]['Next Follow Up'],'2026-09-12');assert.equal((await s.service.get(t.id)).state,'deferred');s.rows[0]['Next Follow Up']='2026-09-15';await s.service.refresh();assert.equal((await s.service.get(t.id)).deferUntil,'2026-09-15');s.setDay('2026-09-12');await s.service.fill();assert.equal((await s.service.get(t.id)).state,'deferred');s.setDay('2026-09-15');await s.service.fill();assert.equal((await s.service.get(t.id)).state,'open');
});
test('removed venue and mismatched user/channel/session fail closed without creating rows',async()=>{
 const s=setup(),t=await s.task(),ctx=await s.context(t);await assert.rejects(s.service.session(ctx.sid,t.id,'other',t.threadId),/expired/);await assert.rejects(s.service.mutate(t.id,'done',{}, {...ctx,channel:'elsewhere'}),/current venue/);s.rows.length=0;await assert.rejects(s.service.mutate(t.id,'done',{},ctx),/removed/);assert.equal(s.rows.length,0);
});
test('forms use supported labeled inputs, preserve blanks and reject oversize stored notes without truncation',()=>{
 const s={row:row('x')};const m=w.modal('task','session','contact',0,s);assert.equal(m.type,9);assert.equal(m.data.components.length,5);assert.ok(m.data.components.every(c=>c.type===18&&c.component.required===false));assert.deepEqual(w.valuesOf({components:[{type:18,component:{custom_id:'name',value:'Venue contact'}}]}),{name:'Venue contact'});assert.throws(()=>w.modal('task','session','notes',0,{row:row('x',{Notes:'x'.repeat(4001)})}),/form size/);
});
test('only authenticated worklist saves can count as human activity',()=>{
 const {verifyWorklistEdit,savedAppEdit}=require('../appActivity'),secret='test-secret',stamp=String(Date.now()),body=JSON.stringify({action:'saveVenue'}),sig=crypto.createHmac('sha256',secret).update(stamp+'.'+body).digest('hex');
 const req={rawBody:Buffer.from(body),get:n=>n==='x-jddm-worklist-timestamp'?stamp:sig};assert.equal(verifyWorklistEdit(req,secret),true);assert.equal(verifyWorklistEdit({...req,rawBody:Buffer.from('{}')},secret),false);assert.equal(verifyWorklistEdit(req,secret,Date.now()+180000),false);
 const input={method:'POST',origin:'',payload:{action:'saveVenue'},result:{ok:true,changedHeaders:['Notes']}};assert.equal(savedAppEdit(input),false);assert.equal(savedAppEdit({...input,trustedWorklist:true}),true);
});
test('sheet gateway refuses create/delete actions and signs saves without exposing the key',async()=>{
 let request;const gateway=w.createSheetGateway({secret:()=> 'private-key',fetchImpl:async(url,options)=>{request=options;return {ok:true,json:async()=>({ok:true})};}});await gateway.save('existing',{Notes:'Update'},{Notes:'Previous'},'stable-id');const body=JSON.parse(request.body);assert.equal(body.action,'saveVenue');assert.equal(body.id,'existing');assert.equal(body.requestId,'stable-id');assert.equal(request.headers['x-jddm-worklist-signature'].length,64);assert.ok(!JSON.stringify(request).includes('private-key'));
});
test('production runtime constructs the sheet gateway without test-only options',()=>{
 const gateway=w.createSheetGateway();assert.equal(typeof gateway.list,'function');assert.equal(typeof gateway.get,'function');assert.equal(typeof gateway.save,'function');
});
test('signed Discord contact selection and modal submission update the existing row; bad signatures are refused',async()=>{
 const s=setup(),task=await s.task(),keys=crypto.generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');
 const handler=w.createInteractions({...s,publicKey:()=>publicKey});let n=0;
 async function send(data,type=3,bad=false){const body={id:'signed-'+(++n),type,guild_id:w.GUILD,channel_id:task.threadId,application_id:'app',token:'test-interaction',member:{user:{id:'user',username:'Tester'}},data};const rawBody=Buffer.from(JSON.stringify(body)),stamp=String(Math.floor(Date.now()/1000)),signature=crypto.sign(null,Buffer.concat([Buffer.from(stamp),rawBody]),keys.privateKey).toString('hex');const res={status(n){this.code=n;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;}};await handler({body,rawBody,get:key=>key==='X-Signature-Ed25519'?(bad?'00'.repeat(64):signature):stamp},res);return res;}
 const refused=await send({custom_id:'jddmw:contacts:'+task.id},3,true);assert.equal(refused.code,401);
 await send({custom_id:'jddmw:contacts:'+task.id});const selector=s.calls.at(-1).body.components[0].components[0];
 const opened=await send({custom_id:selector.custom_id,values:['0']});assert.equal(opened.body.type,9);
 const submitted=await send({custom_id:opened.body.data.custom_id,components:[{type:18,component:{type:4,custom_id:'emails',value:'partial@example.com'}}]},5);assert.equal(submitted.code,200);assert.equal(contacts.read(s.rows[0]).contacts[0].emails[0].value,'partial@example.com');assert.equal(s.rows.length,1);
});
test('distance sorting uses Hinckley center, not input order or random selection',()=>{
 const point=(id,milesNorth)=>row(id,{Latitude:String(w.HINCKLEY_ORIGIN.latitude+milesNorth/69.0934),Longitude:String(w.HINCKLEY_ORIGIN.longitude)});
 const rows=[point('far',50),point('close',1),point('middle',10),point('closest',0),point('fifth',100)];
 assert.deepEqual(w.choose(rows,[],'2026-09-08').map(r=>r['Place ID']),['closest','close','middle','far']);
 assert.ok(Math.abs(w.distanceMiles(point('one-degree',69.0934))-69.0934)<0.01);
 assert.equal(w.distanceMiles(point('center',0)),0);
 assert.deepEqual(w.rankedMissing(rows.reverse()).map(r=>r['Place ID']),['closest','close','middle','far','fifth']);
});
test('missing, invalid, zero and out-of-range coordinates sort last with an honest label',()=>{
 for(const [Latitude,Longitude] of [['',''],[' ','-81'],['oops','-81'],['91','-81'],['41','181'],['Infinity','-81'],['0','0']])assert.equal(w.distanceMiles({Latitude,Longitude}),null);
 const rows=[row('unknown'),row('valid',{Latitude:'41.3',Longitude:'-81.7'})];
 assert.equal(w.rankedMissing(rows)[1]['Place ID'],'unknown');assert.match(w.distanceLabel(rows[0]),/unavailable/);
 assert.match(w.card({id:'t',venueId:'valid',state:'open',assignedDay:'2026-09-08'},rows[1]).embeds[0].description,/straight-line/);
});
test('equal distances are stable, open work carries, queued work returns nearest first, explicit dates win',()=>{
 const rows=['far','close','due','later','carried'].map((id,n)=>row(id,{Latitude:String(42-n/10),Longitude:'-81.7'}));
 const tasks=[{venueId:'carried',state:'open'},{venueId:'close',state:'queued'},{venueId:'due',state:'deferred',deferUntil:'2026-09-08'},{venueId:'later',state:'deferred',deferUntil:'2026-09-09'}];
 assert.deepEqual(w.choose(rows,tasks,'2026-09-08').map(r=>r['Place ID']),['due','close','far']);
 const same=[row('b',{'Place Name':'B',Latitude:'41.3',Longitude:'-81.7'}),row('a',{'Place Name':'A',Latitude:'41.3',Longitude:'-81.7'})];assert.deepEqual(w.choose(same,[],'2026-09-08').map(r=>r['Place ID']),['a','b']);
});
test('queued posts preserve their thread and row, archive honestly, and reopen when selected',async()=>{
 const s=setup(),t=await s.task(),before=JSON.stringify(s.rows);
 await s.db.doc('jddmVenueWorklistTasks/'+t.id).set({state:'queued'},{merge:true});
 await s.service.publish(await s.service.get(t.id),s.rows[0]);
 assert.equal(s.threads.get(t.threadId).thread_metadata.archived,true);assert.match(s.messages.get(t.threadId).content,/Waiting in the nearest-first queue/);
 assert.equal(JSON.stringify(s.rows),before);assert.equal(s.messages.get(t.threadId).embeds[0].color,0x95a5a6);
 s.setDay('2026-09-09');await s.service.fill();const reopened=await s.service.get(t.id);
 assert.equal(reopened.state,'open');assert.equal(reopened.threadId,t.threadId);assert.equal(s.threads.size,1);assert.equal(s.threads.get(t.threadId).thread_metadata.archived,false);assert.equal(JSON.stringify(s.rows),before);
});
