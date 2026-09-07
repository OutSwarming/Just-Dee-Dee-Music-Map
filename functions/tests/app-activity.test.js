const test = require('node:test');
const assert = require('node:assert/strict');
const {dayKey, previousDay, inactiveDays, nightlyText, savedAppEdit, createAppActivity} = require('../appActivity');

function fixture(start='2026-09-07') {
    const data = new Map([['jddmAppActivity/config',{enabled:true,startedDay:start,channelId:'activity'}]]);
    let clock = new Date(start+'T16:00:00Z'), chain = Promise.resolve(), failPost = false;
    const snapshot = path => ({exists:data.has(path),data:()=>structuredClone(data.get(path))});
    const db = {
        doc:path=>({path,get:async()=>snapshot(path),set:async(value,opts)=>{data.set(path,{...(opts?.merge?data.get(path):{}),...value});}}),
        runTransaction:fn=>{
            const run=chain.then(()=>fn({get:async ref=>snapshot(ref.path),set:(ref,value,opts)=>data.set(ref.path,{...(opts?.merge?data.get(ref.path):{}),...value})}));
            chain=run.catch(()=>{}); return run;
        }
    };
    const messages=[];
    const service=createAppActivity({db,now:()=>clock,discord:async(method,path,body)=>{
        if(method==='GET') return messages;
        if(failPost) throw Error('Discord unavailable');
        const message={id:String(messages.length+1),...body};messages.push(message);return message;
    }});
    const edit = (id, extras={})=>service.record({method:'POST',origin:'https://outswarming.github.io',payload:{action:'saveVenue',requestId:id,id:'venue'},result:{ok:true,changedHeaders:['Notes']},...extras});
    return {service,edit,data,messages,setTime:time=>{clock=new Date(time);},failPost:value=>{failPost=value;}};
}

test('Eastern dates remain calendar dates through midnight and both DST transitions',()=>{
    assert.equal(dayKey(new Date('2026-09-08T03:59:59Z')),'2026-09-07');
    assert.equal(dayKey(new Date('2026-09-08T04:00:00Z')),'2026-09-08');
    assert.equal(previousDay('2026-03-09'),'2026-03-08');
    assert.equal(previousDay('2026-11-02'),'2026-11-01');
    assert.equal(inactiveDays('2026-03-10','2026-03-01','2026-03-07'),3);
    assert.equal(inactiveDays('2026-11-03','2026-10-01','2026-10-31'),3);
});

test('strict praise thresholds and no invented activity before tracking starts',()=>{
    assert.match(nightlyText(0,1),/No changes for 1 day/);
    assert.match(nightlyText(0,3),/No changes for 3 days/);
    for(const count of [1,2]) assert.equal(nightlyText(count,0),null);
    for(const count of [3,10]) {assert.match(nightlyText(count,0),new RegExp(count+' edits today'));assert.match(nightlyText(count,0),/Congrats/);}
    assert.match(nightlyText(11,0),/rocking today!!/);
    assert.equal(inactiveDays('2026-09-07','2026-09-07'),1);
    assert.equal(inactiveDays('2026-09-06','2026-09-07'),0);
});

test('only real successful browser saves count; automatic, failed, no-op and replay requests do not',async()=>{
    const f=fixture();
    for(const extra of [
        {origin:''},{origin:'http://localhost:4173'},{method:'GET'},
        {result:{ok:false,changedHeaders:['Notes']}},{result:{ok:true,changedHeaders:[]}},
        {result:{ok:true,replayed:true,changedHeaders:['Notes']}},
        {payload:{action:'syncWebsiteGigEvents'}},{payload:{action:'queueReminder'}}
    ]) assert.equal((await f.edit('exclude',extra)).counted,false);
    assert.equal(f.data.has('jddmAppActivity/state'),false);
    assert.equal(savedAppEdit({method:'POST',origin:'https://outswarming.github.io',payload:{action:'createVenue'},result:{ok:true}}),true);
    assert.equal((await f.edit('multi-field',{result:{ok:true,changedHeaders:['Notes','Phone Number','Next Follow Up']}})).count,1);
});

test('concurrent saves count once each and repeated request IDs cannot inflate the total',async()=>{
    const f=fixture();
    await Promise.all(Array.from({length:12},(_,i)=>f.edit('save-'+i)));
    await f.edit('save-1');
    assert.equal(f.data.get('jddmAppActivityDays/2026-09-07').count,12);
    assert.equal(f.data.get('jddmAppActivity/state').lastEditDay,'2026-09-07');
    assert.equal((await f.service.report('nightly')).count,12);
    assert.match(f.messages[0].content,/rocking/);
});

test('1, 2, 3 inactive nights and next morning warning, reset by a contact edit',async()=>{
    const f=fixture();
    for(const [day,streak] of [['07',1],['08',2],['09',3]]) {
        f.setTime(`2026-09-${day}T22:00:00-04:00`);
        assert.equal((await f.service.report('nightly')).streak,streak);
    }
    f.setTime('2026-09-10T07:55:00-04:00');
    assert.equal((await f.service.report('morning')).status,'sent');
    assert.match(f.messages.at(-1).content,/No new edits, what is going on/);
    await f.edit('reset');
    assert.equal((await f.service.report('nightly')).status,'skipped');
    f.setTime('2026-09-11T22:00:00-04:00');
    assert.equal((await f.service.report('nightly')).streak,1);
});

test('late-night and early-morning saves both cancel the morning warning',async()=>{
    for(const editTime of ['2026-09-09T23:59:00-04:00','2026-09-10T07:54:00-04:00']) {
        const f=fixture();f.setTime('2026-09-09T22:00:00-04:00');
        await f.service.report('nightly');
        f.setTime(editTime);await f.edit('late');
        f.setTime('2026-09-10T07:55:00-04:00');
        assert.equal((await f.service.report('morning')).status,'skipped');
        assert.equal(f.messages.length,1);
    }
});

test('report delivery is quiet, deduplicated and recoverable after Discord failure or receipt loss',async()=>{
    const f=fixture();f.failPost(true);
    await assert.rejects(f.service.report('nightly'),/Discord unavailable/);
    f.failPost(false);await f.service.report('nightly');
    assert.equal((await f.service.report('nightly')).duplicate,true);
    f.data.delete('jddmAppActivityReports/nightly-2026-09-07');
    await f.service.report('nightly');
    assert.equal(f.messages.length,1);
    assert.equal(f.messages[0].flags,4096);
    assert.deepEqual(f.messages[0].allowed_mentions,{parse:[]});
});

test('an edit while delivery is retrying suppresses a stale inactivity message',async()=>{
    const f=fixture();f.failPost(true);
    await assert.rejects(f.service.report('nightly'));
    await f.edit('before-retry');f.failPost(false);
    assert.equal((await f.service.report('nightly')).status,'skipped');
    assert.equal(f.messages.length,0);
});

test('old scheduled events cannot produce reports for a different day',async()=>{
    const f=fixture();f.setTime('2026-09-08T22:00:00-04:00');
    assert.equal((await f.service.report('nightly',new Date('2026-09-07T22:00:00-04:00'))).status,'stale');
    assert.equal(f.messages.length,0);
});
