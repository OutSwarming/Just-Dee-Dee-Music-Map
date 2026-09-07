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
 assert.throws(()=>codec.decode(codec.PREFIX+'broken'));assert.equal(codec.decode(codec.encode({version:2,contacts:[{...codec.empty(),emails:[{value:'',note:'Ask for address'}]}]})).contacts[0].emails[0].note,'Ask for address');assert.throws(()=>codec.encode({version:2,contacts:[{...codec.empty(),notes:'x'.repeat(45000)}]}));
});

test('US phones format consistently without changing partial or ambiguous legacy values',()=>{
 for(const input of ['3305550123','330-555-0123','(330)555.0123','1 330 555 0123','+1 (330) 555-0123']) assert.equal(codec.formatPhone(input),'(330) 555-0123');
 for(const suffix of ['x2',' ext 2',' ext. 2',' extension 2',' #2']) assert.equal(codec.formatPhone('3305550123'+suffix),'(330) 555-0123 ext. 2');
 for(const input of ['','330','216216216','Call front desk','330-555-0123 / 440-555-0199'])assert.equal(codec.formatPhone(input),input);
 assert.equal(codec.formatPhone(codec.formatPhone('13305550123')),'(330) 555-0123');
});
test('email-only, phone-only, unnamed and notes-only contacts keep their own methods',()=>{
 const data={version:2,contacts:[{...codec.empty(),emails:[{value:'unknown@example.com',note:'No name known'}]},{...codec.empty(),name:'Pat',phones:[{value:'(330) 555-0123',note:'Mobile'}]},{...codec.empty(),notes:'Ask for booking contact'},{...codec.empty()}]};
 const stored=codec.decode(codec.encode(data));assert.equal(stored.contacts.length,3);assert.equal(stored.contacts[0].phones.length,0);assert.equal(stored.contacts[1].emails.length,0);assert.equal(stored.contacts[2].notes,'Ask for booking contact');assert.equal(codec.summary(stored)['Phone Number'],'(330) 555-0123');assert.equal(codec.summary(stored)['Email/Contact'],'unknown@example.com');
});

test('missing-method notes survive and primary values come from the contact who has them',()=>{
 const data={version:2,contacts:[{...codec.empty(),name:'Phone only',emails:[{value:'',note:'Need email later'}],phones:[{value:'(330) 555-0123',note:''}]},{...codec.empty(),name:'Email only',emails:[{value:'known@example.com',note:'Booking'}]}]};
 const fields={...codec.summary(data),'Booking Contact':codec.encode(data)};assert.equal(fields['Email/Contact'],'known@example.com');fields['Email/Contact']='changed@example.com';const read=codec.read(fields);assert.equal(read.contacts[0].emails[0].value,'');assert.equal(read.contacts[0].emails[0].note,'Need email later');assert.equal(read.contacts[1].emails[0].value,'changed@example.com');
});

test('tidying consolidates notes once and splits recognized contact lists without guessing',()=>{
 const input={version:2,contacts:[{...codec.empty(),name:'Sandy, Nicole',notes:'Existing person note',emails:[],phones:[{value:'330-555-0123 / 4405550199',note:'Office and mobile'}],others:[{type:'Previous email/contact',value:'nicole@example.com sandy@example.com',note:'Booking contacts'},{type:'Previous email/contact',value:'http://www.750mlwines.com',note:'Website note'}]}]};
 const tidy=codec.tidy(input),p=tidy.contacts[0];assert.deepEqual(p.phones.map(i=>i.value),['(330) 555-0123','(440) 555-0199']);assert.deepEqual(p.emails.map(i=>i.value),['nicole@example.com','sandy@example.com']);assert.equal(p.others[0].type,'Website');assert(p.notes.includes('Existing person note'));assert(p.notes.includes('Office and mobile'));assert(p.notes.includes('Booking contacts'));assert(p.notes.includes('Website note'));assert([...p.emails,...p.phones,...p.others].every(i=>!i.note));assert.deepEqual(codec.tidy(tidy),tidy);
 assert.deepEqual(codec.phoneList('Ask Bob: 3305550123 or front desk'),['Ask Bob: 3305550123 or front desk']);assert.equal(codec.emailList('email a@example.com next week'),null);
});

test('cleanup preserves explicit contact types on Facebook and booking links',()=>{
 const data={version:2,contacts:[{...codec.empty(),others:[{type:'Facebook Messenger',value:'https://m.me/venue',note:'Ask for Pat'},{type:'Booking form',value:'https://example.com/book',note:''}]}]};const p=codec.tidy(data).contacts[0];assert.equal(p.others[0].type,'Facebook Messenger');assert.equal(p.others[1].type,'Booking form');assert(p.notes.includes('Ask for Pat'));
});
