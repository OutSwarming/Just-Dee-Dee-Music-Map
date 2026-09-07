const test=require('node:test');const assert=require('node:assert/strict');const codec=require('../functions/contactRecords');
test('people, method notes, preferred methods and legacy notes round trip in one original column',()=>{
 const data={version:2,legacyBookingContact:'Old instructions',contacts:[{...codec.empty(),name:'Jamie / manager',preferredMethod:'Text after 4 Eastern',notes:'Person notes',emails:[{value:'jamie@example.com',note:'Office'}],phones:[{value:'+1 330-555-0100 ext 3',note:'Mobile'}],others:[{type:'Messenger',value:'@jamie',note:'Weekends'}]},{...codec.empty(),name:'Venue office',emails:[{value:'office@example.com',note:'Gig materials'}]}]};
 const fields={...codec.summary(data),'Booking Contact':codec.encode(data)};const read=codec.read(fields);assert.deepEqual(read.contacts,data.contacts);assert.equal(read.legacyBookingContact,'Old instructions');
 fields['Phone Number']='330-555-0123';const changed=codec.read(fields);assert.equal(changed.contacts[0].phones[0].value,'330-555-0123');assert.equal(changed.contacts[0].phones[0].note,'Mobile');assert.deepEqual(changed.contacts[1],data.contacts[1]);
 assert(!codec.display(fields['Booking Contact']).includes('JDDM_CONTACTS'));
});
test('legacy free text becomes an Other method; email comments and AC notes are preserved',()=>{
 const a=codec.read({'Contact Name':'Sabrina /blond','Email/Contact':'Jennie owner','Contact Type':'stop, email'});assert.equal(a.contacts[0].name,'Sabrina /blond');assert.equal(a.contacts[0].others[0].value,'Jennie owner');assert.equal(a.contacts[0].emails.length,0);
 const b=codec.read({'Email/Contact':'one@example.com tues, wed 4pm'});assert.equal(b.contacts[0].emails[0].note,'tues, wed 4pm');
 const c=codec.read({'Email/Contact':'one@example.com','Phone Number':'123','Contact Details':JSON.stringify({version:1,emails:[{value:'one@example.com',note:'Main'}],phones:[{value:'123',note:'Office'},{value:'456',note:'Mobile'}]})});assert.equal(c.contacts[0].phones[1].note,'Mobile');assert.equal(c.contacts[0].emails[0].note,'Main');
});
test('empty contacts clear summaries; invalid or oversized records fail safely',()=>{
 assert.deepEqual(codec.summary(codec.normalize({version:2,contacts:[]})),{'Contact Name':'','Contact Type':'','Email/Contact':'','Phone Number':''});
 assert.throws(()=>codec.decode(codec.PREFIX+'broken'));assert.throws(()=>codec.encode({version:2,contacts:[{...codec.empty(),emails:[{value:'',note:'orphan'}]}]}));assert.throws(()=>codec.encode({version:2,contacts:[{...codec.empty(),notes:'x'.repeat(45000)}]}));
});
