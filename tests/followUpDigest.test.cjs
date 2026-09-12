const test=require('node:test'),assert=require('node:assert/strict');const {buildDigest,dateKey,plusDays}=require('../functions/followUpDigest');
test('today only, overdue hidden, exactly next two days on horizon',()=>{const rows=[['Overdue','2026-09-06'],['Today','2026-09-07'],['Tomorrow','2026-09-08'],['Day two','2026-09-09'],['Later','2026-09-10'],['Unknown','nonsense']].map(([n,d])=>({'Place Name':n,'Next Follow Up':d}));const d=buildDigest({today:'2026-09-07',rows});assert.equal(d.venues,1);assert.equal(d.horizonPlaces,2);assert.match(d.body,/Hi Dee Dee, here are the places you need to contact today:/);assert.match(d.body,/On the horizon/);assert.doesNotMatch(d.body,/Overdue|Later|Unknown/);});
test('an explicit follow-up date stays actionable for booked venues; email follow-ups included',()=>{const d=buildDigest({today:'2026-09-07',rows:[{'Place Name':'Done',Status:'Booked','Next Follow Up':'2026-09-07'}],emails:[{status:'followup',subject:'Venue reply',followUpDate:'2026-09-07',discordThreadId:'123'}]});assert.equal(d.venues,1);assert.equal(d.emails,1);assert.doesNotMatch(d.body,/On the horizon/);assert.match(d.body,/Done/);assert.match(d.body,/Venue reply/);});
test('Eastern day and calendar arithmetic cover DST and month/year rollover',()=>{assert.equal(dateKey(new Date('2026-09-08T02:00:00Z')),'2026-09-07');assert.equal(plusDays('2026-12-31',2),'2027-01-02');assert.equal(plusDays('2026-03-07',2),'2026-03-09');});

const {loadDigest,DIGEST_VERSION}=require('../functions/followUpDigest');
test('old venue, email and campaign timers never spill into today or the next two days',()=>{
 const rows=[{'Place ID':'old','Place Name':'Old venue','Next Follow Up':'2026-09-01'}];
 const d=buildDigest({today:'2026-09-12',rows,emails:[{subject:'Old mail',status:'followup',followUpDate:'2026-09-01'},{subject:'Current mail',status:'followup',followUpDate:'9/12/2026'},{subject:'Future mail',status:'followup',followUpDate:'2026-09-14T04:00:00Z'}],booking:[{id:'campaign',name:'Old campaign',date:'2025-08-13'},{id:'next',name:'Next campaign',date:'2026-09-14'}]});
 assert.equal(d.venues,0);assert.equal(d.emails,1);assert.equal(d.horizonEmails,1);assert.equal(d.bookingFollowUps,0);assert.doesNotMatch(d.body,/Old venue|Old mail|Old campaign|overdue/i);assert.match(d.body,/Current mail|Future mail|Next campaign/);assert.equal(rows[0]['Next Follow Up'],'2026-09-01');
});
test('same-day cache cannot override a rescheduled, cleared or newly due spreadsheet date',async()=>{
 const {db,store}=require('../functions/tests/helpers/bookingFixture').fixture();let date='2026-09-12',reads=0;
 store.set('jddmFollowUpDigests/2026-09-12',{body:'Stale venue — overdue since 2026-09-01'});
 const fetchImpl=async()=>{reads++;return {ok:true,text:async()=>`Place ID,Place Name,Next Follow Up,Status\np,Current venue,${date},Needs Review`};};
 const load=()=>loadDigest({db,fetchImpl,today:'2026-09-12',cache:true});
 assert.equal((await load()).venues,1);date='2026-10-01';assert.doesNotMatch((await load()).body,/Current venue/);date='';assert.doesNotMatch((await load()).body,/Current venue/);date='2026-09-14';assert.equal((await load()).horizonPlaces,1);
 assert.equal(reads,4);assert.equal(store.get('jddmFollowUpDigests/2026-09-12').version,DIGEST_VERSION);
 await assert.rejects(loadDigest({db,today:'2026-09-12',fetchImpl:async()=>({ok:false}),cache:true}),/unavailable/);
});
test('stale linked email and official campaign dates cannot resurrect cleared or postponed dates',()=>{
 for(const date of ['', '2027-01-01']){
  const d=buildDigest({today:'2026-09-12',rows:[{'Place ID':'p','Place Name':'Moved venue','Next Follow Up':date}],emails:[{venueId:'p',subject:'Moved email',status:'followup',followUpDate:'2026-09-12'}],booking:[{id:'p',name:'Moved campaign',date:'2026-09-12',official:true}]});
  assert.equal(d.venues+d.emails+d.bookingFollowUps,0);assert.doesNotMatch(d.body,/Moved/);
 }
});
