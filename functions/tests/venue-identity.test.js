'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const I=require('../venueIdentity'),{indexRows,emailEvidence,searchVenues}=require('../venueLinks');
const row=(id,name,person={})=>({'Place ID':id,'Place Name':name,'Booking Contact':'JDDM_CONTACTS_V2\n'+JSON.stringify({version:2,contacts:[{name:'',emails:[],phones:[],others:[],...person}]})});
const person={name:'Abbey Swanson',emails:[{value:'abbey@patina.example'}],phones:[{value:'(440) 555-1234'}],others:[{type:'Instagram',value:'@patina.porch'}]};
const rows=[row('a','Patina Porch',person),row('b','Other Venue',{name:'Another Person'})],index=indexRows(rows);
const social=(text,name='Abbey Swanson')=>I.socialEvidence({platform:'messenger',psid:'sender',name},[{from:{id:'sender'},message:text}]);
for(const [label,e,id] of [
 ['case insensitive saved email',{emails:I.emails('ABBEY@PATINA.EXAMPLE')},'a'],
 ['US phone punctuation',{phones:I.phones('+1 (440) 555-1234')},'a'],
 ['Instagram stored handle',{profiles:['instagram:patina.porch']},'a'],
 ['name alone',social('Hello'),null],
 ['name plus represented venue',social('At Patina Porch, we would love to book you.'),'a'],
 ['name plus explicit saved email',social('Email me at abbey@patina.example'),'a'],
 ['name plus explicit saved phone',social('Call me at (440) 555-1234'),'a'],
 ['stranger mentioning a venue',social('I saw you at Patina Porch','Random Person'),null],
 ['stranger pasting an email',social('Try abbey@patina.example','Random Person'),null],
 ['quoted venue mention',social('Hello\n> Patina Porch'),null],
 ['forwarded venue mention',social('Hello\n----- Forwarded message -----\nPatina Porch'),null],
 ['outgoing email body does not identify correspondent',I.socialEvidence({psid:'sender',name:'Abbey Swanson'},[{from:{id:'business'},message:'At Patina Porch'}]),null],
 ['single first name',social('At Patina Porch','Abbey'),null],
 ['subject only',{subjects:['booking at patina porch']},null],
 ['lookalike domain',{domains:['patina.example.attacker.test']},null],
 ['unrelated profile',{profiles:['instagram:patina.porch.official']},null],
 ['unknown number',{phones:['2165557777']},null],
 ['missing every field',{},null]
])test(label,()=>assert.equal(I.resolve(index,e).venue?.id||null,id));

test('saved social handles remain searchable and URLs normalize without treating posts as profiles',()=>{
 assert.equal(searchVenues(index,'patina.porch')[0].id,'a');
 for(const [raw,p,want] of [['https://www.instagram.com/Patina.Porch/?igsh=x',null,'instagram:patina.porch'],['patina.porch','instagram','instagram:patina.porch'],['https://m.facebook.com/profile.php?id=123&ref=foo',null,'facebook:id:123'],['https://facebook.com/people/A-Name/123/',null,'facebook:id:123'],['https://m.me/PatinaPorch',null,'facebook:patinaporch'],['https://instagram.com/p/abc',null,''],['https://facebook.com/groups/123',null,''],['https://facebook.com.evil.test/Patina',null,''],['Messenger',null,'']])assert.equal(I.socialProfile(raw,p),want,raw);
});
test('no self mailbox, pseudo-social email, broad email provider or tracking domain can establish identity',()=>{
 assert.deepEqual(I.emails('justdeedeemusic@gmail.com 123@facebook.com 123@txt.voice.google.com'),[]);
 for(const d of ['gmail.com','sub.mailchimp.com','facebook.com','linktr.ee','sites.google.com'])assert.equal(I.domain(d),'');
 assert.deepEqual(I.phones('123-123-1234 144055512345 440-123-1234'),[]);
});
test('duplicate full names and shared methods remain ambiguous',()=>{
 const duplicate=indexRows([...rows,row('c','Third Venue',person)]);
 for(const evidence of [social('Patina Porch'),{emails:['abbey@patina.example']},{phones:['4405551234']},{profiles:['instagram:patina.porch']}])assert.equal(I.resolve(duplicate,evidence).venue,null);
});
test('conflicting exact methods do not use scoring to choose a winner',()=>{
 const two=indexRows([rows[0],row('b','Other Venue',{phones:[{value:'(216) 555-4444'}]})]);
 const result=I.resolve(two,{emails:['abbey@patina.example'],phones:['2165554444']});assert.equal(result.venue,null);assert.equal(result.candidates.length,2);
});
test('exact sender identity outranks incidental subject mentions',()=>{
 const result=I.resolve(index,{emails:['abbey@patina.example'],subjects:['other venue booking']});assert.equal(result.venue.id,'a');
});
test('same scoped social ID is distinct across accounts and platforms',()=>{
 const evidence=platform=>I.socialEvidence({platform,psid:'123',accountId:'account'}).identities[0];assert.notEqual(evidence('messenger'),evidence('instagram'));
 assert.notEqual(evidence('messenger'),I.socialEvidence({platform:'messenger',psid:'123',accountId:'different'}).identities[0]);
 assert.deepEqual(I.socialEvidence({platform:'messenger',psid:'123',name:'Patina Porch'}).profiles,[]);
});
test('manual identity conflicts, missing target and explicit unlink prevent guessing',()=>{
 for(const m of [[{venueIds:['a','b']}],[{venueIds:['gone']}],[{venueIds:[],blocked:true}]])assert.equal(I.resolve(index,{emails:['abbey@patina.example']},m).venue,null);
 assert.equal(I.resolve(index,{},[{venueIds:['a']}]).venue.id,'a');
 const dupe=indexRows([rows[0],{...rows[1],'Place ID':'a'}]);assert.equal(I.resolve(dupe,{},[{venueIds:['a']}]).venue,null);
});
test('manual correction replaces its contribution; conflicting conversations require review; unlink is sticky',async()=>{
 const data=new Map();
 const db={doc:path=>({path,get:async()=>({data:()=>data.get(path)})}),runTransaction:fn=>fn({get:r=>r.get(),set:(r,v)=>data.set(r.path,v)})};const m=I.createMemory(db);
 await m.remember(['sender'],'thread1','a');assert.deepEqual((await m.lookup(['sender']))[0].venueIds,['a']);
 await m.remember(['sender'],'thread1','b');assert.deepEqual((await m.lookup(['sender']))[0].venueIds,['b']);
 await m.remember(['sender'],'thread2','a');assert.equal(I.resolve(index,{},await m.lookup(['sender'])).venue,null);
 await m.remember(['sender'],'thread1','');assert.equal((await m.lookup(['sender']))[0].blocked,true);
});
test('body addresses outside the explicit contact statement are not corroboration',()=>{
 const e=social('My email is elsewhere@unrelated.test\nTry abbey@patina.example');assert.deepEqual(e.claimedEmails,['elsewhere@unrelated.test']);assert.equal(I.resolve(index,e).venue,null);
});
test('outbound mail, forwarded recipients and mixed recipients retain separate evidence',()=>{
 const message=(from,to)=>({payload:{headers:[{name:'From',value:from},{name:'To',value:to}]}});
 assert.deepEqual(emailEvidence([message('justdeedeemusic@gmail.com','abbey@patina.example')]).identities,['email:abbey@patina.example']);
 assert.deepEqual(emailEvidence([message('a@test.example','b@test.example')]).identities,[]);
 assert.deepEqual(emailEvidence([{...message('a@test.example',''),labelIds:['DRAFT']}]).emails,[]);
});

test('malformed saved contact data cannot silently become an automatic match',()=>{
 const index=indexRows([{'Place ID':'a','Place Name':'Patina Porch','Email/Contact':'abbey@patina.example','Booking Contact':'JDDM_CONTACTS_V2\n{bad json'}]);const result=I.resolve(index,{emails:['abbey@patina.example']});assert.equal(result.venue,null);assert.match(result.reason,/could not be read/);assert.equal(searchVenues(index,'Patina')[0].id,'a');
});

test('authenticated calendar event details use branch checks; subject text or forged notifications cannot',()=>{
 const rows=[{'Place ID':'a','Place Name':'Patina Porch',Address:'10 Main St'}],index=indexRows(rows);
 const m={payload:{mimeType:'text/plain',headers:[{name:'From',value:'calendar-notification@google.com'},{name:'Subject',value:'New event: JustDeeDeeMusic Live @ Patina Porch'},{name:'Authentication-Results',value:'mx.google.com; dkim=pass header.i=@google.com header.s=test; dmarc=pass header.from=google.com'}],body:{data:Buffer.from('JustDeeDeeMusic Live @ Patina Porch\nFriday September 11\n\nLocation\n10 Main Street\n').toString('base64url')}}};
 const evidence=emailEvidence([m]);assert.equal(I.resolve(index,evidence).venue.id,'a');assert.deepEqual(evidence.identities,[]);
 m.payload.body.data=Buffer.from('JustDeeDeeMusic Live @ Patina Porch\nLocation\n10 Oak St').toString('base64url');assert.equal(I.resolve(index,emailEvidence([m])).venue,null);
 m.payload.headers.pop();assert.deepEqual(emailEvidence([m]).calendarEvents,[]);assert.equal(I.resolve(index,emailEvidence([m])).venue,null);
});
