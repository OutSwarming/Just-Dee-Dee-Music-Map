'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {matchEvent,keyFor,venueName}=require('../calendarVenueMatching');
const {createReviewService,createInteractionHandler,card}=require('../calendarVenueReview');
function fakeDb(){const data=new Map();let queue=Promise.resolve();const ref=path=>({path,get:async()=>({exists:data.has(path),data:()=>structuredClone(data.get(path))}),set:async(v,o)=>data.set(path,o?.merge?{...data.get(path),...structuredClone(v)}:structuredClone(v))});return {data,doc:ref,runTransaction:fn=>{const job=queue.then(()=>fn({get:r=>r.get(),set:(r,v,o)=>r.set(v,o)}));queue=job.catch(()=>{});return job;}};}
const row=(id,name,Address='')=>({'Place ID':id,'Place Name':name,Address,'Next Follow Up':'2026-09-20'});
const event=(name='Unknown Room',location='')=>({date:'2026-10-23',venueName:name,location});
function setup(rows=[]){const db=fakeDb(),calls=[],writes=[];db.data.set('jddmCalendarReview/config',{channelId:'review'});const discord=async(method,path,body)=>{calls.push({method,path,body});return {id:'message'};};const service=createReviewService({db,discord,listRows:async()=>rows,now:()=>Date.parse('2026-09-07T12:00Z'),createVenue:async p=>{writes.push(p);rows.push(p.rawFields);return {ok:true,venue:p.rawFields};}});return {db,calls,writes,rows,discord,service};}
test('calendar aliases match address suffixes; exact duplicate aliases, IDs, branches and vague titles require review',()=>{
assert.equal(matchEvent([row('a','Filia Cellars 3059 Greenwich Rd')],event('Filia Cellars')).venue['Place ID'],'a');
for(const rows of [[row('a','Filia Cellars 3059 Greenwich Rd'),row('b','Filia Cellars')],[row('a','Filia Cellars'),row('a','Other')],[row('a','Filia Cellars','10 Main St')]])assert.equal(matchEvent(rows,event('Filia Cellars','20 Main St')).venue,null);
assert.equal(matchEvent([row('a','Scheduled Public Event')],event('Scheduled Public Event')).venue,null);
assert.equal(matchEvent([row('a','Filia Cellars')],event('Filia Celars')).venue,null);
assert.equal(venueName('JustDeeDeeMusic Live @ Filia Cellars'),'Filia Cellars');
});
test('unmatched recurring checks queue once, never append, and use silent three-button cards',async()=>{const s=setup(),e=event();await s.service.resolve([e,{...e,date:'2026-11-20'}]);await s.service.resolve([e,{...e,date:'2026-11-20'}]);assert.equal(s.writes.length,0);assert.equal(s.calls.filter(c=>c.method==='POST').length,1);const c=s.calls[0].body;assert.deepEqual(c.components[0].components.map(c=>c.label),['New row','Link','Ignore']);assert.equal(c.flags,4096);assert.deepEqual(c.allowed_mentions,{parse:[]});});
test('unique known venues and unmatched historical events need no review or writes',async()=>{const s=setup([row('a','Known')]);const result=await s.service.resolve([event('Known'),{...event(),date:'2025-01-01'}]);assert.equal(result.mappings[keyFor(event('Known'))],'a');assert.equal(s.calls.length,0);});
test('Link remembers a venue and keeps spreadsheet follow-up and all cells untouched',async()=>{const s=setup([row('a','Ugly Bunny Winery')]),e=event();await s.service.resolve([e]);const id=keyFor(e);const result=await s.service.picker(id,'user','ugly buny');const select=result.components[0].components[0];assert.equal(select.options[0].value,'a');await s.service.select(id,select.custom_id.split(':')[3],'user','a');assert.equal((await s.service.resolve([e])).mappings[id],'a');assert.equal(s.writes.length,0);assert.equal(s.rows[0]['Next Follow Up'],'2026-09-20');});
test('Ignore persists across dates but a different location gets a separate review',async()=>{const s=setup(),e=event();await s.service.resolve([e]);await s.service.choose(keyFor(e),'ignore','','user',0);await s.service.resolve([{...e,date:'2026-11-21'}]);assert.equal(s.calls.filter(c=>c.method==='POST').length,1);await s.service.resolve([event('Unknown Room','Different branch')]);assert.equal(s.calls.filter(c=>c.method==='POST').length,2);assert.equal(s.writes.length,0);});
test('legacy New row controls cannot create rows now that Add in app is required',async()=>{const s=setup(),id=keyFor(event());await s.service.resolve([event()]);await assert.rejects(s.service.choose(id,'new','','user',0),/Add in app/);assert.equal(s.writes.length,0);});
test('a venue added meanwhile blocks New row; duplicate-ID targets cannot be linked',async()=>{const s=setup(),e=event(),id=keyFor(e);await s.service.resolve([e]);s.rows.push(row('a',e.venueName));await assert.rejects(s.service.choose(id,'new','','user',0),/Add in app/);s.rows.push(row('a','Other'));await assert.rejects(s.service.choose(id,'link','a','user',0),/duplicated/);assert.equal(s.writes.length,0);});
test('picker is immediate, includes search and rejects other users, foreign choices and stale decisions',async()=>{const s=setup([row('a','Filia Cellars')]),e=event(),id=keyFor(e);await s.service.resolve([e]);const p=await s.service.picker(id,'one'),session=p.components[0].components[0].custom_id.split(':')[3];assert.equal(p.components[0].components[0].type,3);assert.equal(p.components[1].components[0].label,'Search venues');await assert.rejects(s.service.select(id,session,'two','a'),/expired/);await assert.rejects(s.service.select(id,session,'one','invented'),/expired/);await s.service.choose(id,'ignore','','one',0);await assert.rejects(s.service.select(id,session,'one','a'),/already changed/);});
test('concurrent legacy creation clicks both refuse direct spreadsheet writes',async()=>{const s=setup(),id=keyFor(event());await s.service.resolve([event()]);const results=await Promise.allSettled([s.service.choose(id,'new','','a',0),s.service.choose(id,'new','','b',0)]);assert.ok(results.every(r=>r.status==='rejected'));assert.equal(s.writes.length,0);});
test('deleting a linked venue reopens review instead of creating a replacement',async()=>{const s=setup([row('a','Known')]),e=event(),id=keyFor(e);await s.service.resolve([e]);await s.service.choose(id,'link','a','u',0);s.rows.length=0;const r=await s.service.resolve([e]);assert.equal(r.mappings[id],'');assert.equal((await s.service.get(id)).status,'pending');assert.equal(s.writes.length,0);});
test('review interactions reject forged signatures and wrong channels; acknowledge before looking up venues',async()=>{const s=setup([row('a','Known')]),id=keyFor(event());await s.service.resolve([event()]);const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');const key=publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');const handler=createInteractionHandler({publicKey:()=>key,service:s.service,discord:s.discord});const invoke=async(channel,sign=true)=>{const body={id:crypto.randomUUID(),application_id:'app',token:'interaction-token',guild_id:'1543777084265070623',channel_id:channel,member:{user:{id:'user'}},data:{custom_id:`jddmcal:link:${id}`}},rawBody=Buffer.from(JSON.stringify(body)),stamp=String(Math.floor(Date.now()/1000)),signature=crypto.sign(null,Buffer.concat([Buffer.from(stamp),rawBody]),privateKey).toString('hex');const res={status(n){this.code=n;return this;},send(v){this.body=v;return this;},json(v){this.body=v;return this;}};await handler({body,rawBody,get:n=>n.toLowerCase()==='x-signature-timestamp'?stamp:sign?signature:'bad'},res);return res;};assert.equal((await invoke('review',false)).code,401);await invoke('elsewhere');assert.match(s.calls.at(-1).body.content,/calendar-review/);await invoke('review');assert.equal(s.calls.at(-2).body.type,5);assert.equal(s.calls.at(-1).body.components[0].components[0].type,3);});

test('canceled events disable New row and a second active source keeps its review open',async()=>{const s=setup(),e=event(),id=keyFor(e);await s.service.resolve([e],{source:'calendar'});await s.service.resolve([e],{source:'website'});await s.service.resolve([],{source:'calendar'});assert.equal((await s.service.get(id)).active,true);await s.service.resolve([],{source:'website'});assert.equal((await s.service.get(id)).active,false);await assert.rejects(s.service.choose(id,'new','','u',0),/Add in app/);assert.equal(s.writes.length,0);});

test('years are not mistaken for street suffixes and dated placeholders never auto-link to a private event',()=>{
 const rows=[row('a','JDDM 2026 Scheduled Private Event')];
 assert.equal(matchEvent(rows,event('JDDM 2027 Scheduled Public Event')).venue,null);
 assert.equal(matchEvent([row('b','Festival 2026')],event('Festival 2027')).venue,null);
 assert.equal(matchEvent([row('c','Dee Dee and KLOS Guitars')],event('Dee Dee and KLOS Guitars','Google Meet (instructions in description)')).venue,null);
});

test('calendar full street and geography conflicts are rejected, abbreviations and legacy addresses work',()=>{
 const a=row('a','Filia Cellars','10 North Main Street, Wadsworth, OH 44281');
 assert.equal(matchEvent([a],event('Filia Cellars','10 N Main St, Wadsworth, OH 44281')).venue['Place ID'],'a');
 for(const address of ['10 Oak Street, Wadsworth, OH 44281','10 South Main St, Wadsworth, OH 44281','10 N Main St, Somewhere, PA 44281','10 N Main St, Akron, OH 44301'])assert.equal(matchEvent([a],event('Filia Cellars',address)).venue,null,address);
 assert.equal(matchEvent([row('a','Filia Cellars 3059 Greenwich Rd','Wadsworth')],event('Filia Cellars','3060 Greenwich Road')).venue,null);
});
test('a fully known branch can be selected, while a duplicate without an address needs review',()=>{
 const a=row('a','Same Winery','10 Main St'),b=row('b','Same Winery','20 Main St');
 assert.equal(matchEvent([a,b],event('Same Winery','10 Main Street')).venue['Place ID'],'a');
 assert.equal(matchEvent([a,{...b,Address:''}],event('Same Winery','10 Main Street')).venue,null);
 assert.equal(matchEvent([a,b],event('Same Winery')).venue,null);
 assert.equal(matchEvent([a],event('Different Winery','10 Main St')).venue,null);
});
test('new directory evidence resolves a pending review, later conflict reopens it, manual choice remains authoritative',async()=>{
 const s=setup(),e=event('Same Winery','10 Main St'),id=keyFor(e);await s.service.resolve([e]);s.rows.push(row('a','Same Winery','10 Main St'));
 assert.equal((await s.service.resolve([e])).mappings[id],'a');assert.equal((await s.service.get(id)).linkMode,'automatic');
 s.rows.push(row('b','Same Winery','10 Main St'));assert.equal((await s.service.resolve([e])).mappings[id],'');assert.equal((await s.service.get(id)).status,'pending');
 const r=await s.service.get(id);await s.service.choose(id,'link','b','Dee Dee',r.revision);s.rows[1].Address='99 Other St';assert.equal((await s.service.resolve([e])).mappings[id],'b');assert.equal(s.writes.length,0);
});
