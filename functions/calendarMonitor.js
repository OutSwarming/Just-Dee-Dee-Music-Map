'use strict';
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const CALENDARS = ['justdeedeemusic@gmail.com', '051b2fd8ffc9844eed9867801c9a348f546e282a484f7a33f47543273162a7ba@group.calendar.google.com'];
const CHANNEL_ID = '1546426968784769074';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pack = value => zlib.gzipSync(JSON.stringify(value)).toString('base64');
const unpack = value => JSON.parse(zlib.gunzipSync(Buffer.from(value, 'base64')).toString());
function validate(input) {
    if (!input || input.version !== 1 || !Number.isFinite(Date.parse(input.capturedAt)) || !Number.isFinite(Date.parse(input.end)) || !Array.isArray(input.calendars) || input.calendars.length !== CALENDARS.length) throw Error('Invalid calendar snapshot');
    const calendars = CALENDARS.map(id => {
        const cal = input.calendars.find(c => c.id === id);
        if (!cal || !Array.isArray(cal.events) || cal.events.length > 20000) throw Error('Incomplete calendar coverage');
        const events = cal.events.map(e => {
            if (!e.id || !Number.isFinite(Date.parse(e.start)) || !Number.isFinite(Date.parse(e.end))) throw Error('Invalid event');
            return {id:String(e.id), title:String(e.title||''), location:String(e.location||''), start:e.start, end:e.end, allDay:!!e.allDay, details:String(e.details||''), color:String(e.color||'')};
        }).sort((a,b) => a.id.localeCompare(b.id) || a.start.localeCompare(b.start));
        return {id, name:String(cal.name||id), events};
    });
    return {version:1,capturedAt:input.capturedAt,end:input.end,calendars};
}
function groups(snapshot, end) {
    const out = new Map();
    for (const c of snapshot.calendars) for (const e of c.events) {
        // The sync window rolls forward; newly visible distant events aren't edits.
        if (Date.parse(e.start) >= end) continue;
        const key = c.id+'|'+e.id;
        if (!out.has(key)) out.set(key,{calendar:c.name,events:[]});
        out.get(key).events.push(e);
    }
    return out;
}
function changes(before, after) {
    if (!before) return [];
    const end = Math.min(Date.parse(before.end),Date.parse(after.end));
    const old = groups(before,end), next = groups(after,end), result=[];
    for(const key of [...new Set([...old.keys(),...next.keys()])].sort()) {
        const a=old.get(key), b=next.get(key);
        if(JSON.stringify(a?.events)===JSON.stringify(b?.events)) continue;
        result.push({key,kind:!a?'added':!b?'removed':'changed',before:a||null,after:b||null});
    }
    return result;
}
function when(e) {
    const date = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'short',day:'numeric'});
    const time = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
    if(e.allDay) return date.format(new Date(e.start))+' (all day)';
    return date.format(new Date(e.start))+' · '+time.format(new Date(e.start))+' – '+date.format(new Date(e.end))+' · '+time.format(new Date(e.end));
}
const clean = text => String(text||'').replace(/[*_`~|\\]/g,'\\$&');
function message(change) {
    const old=change.before?.events||[], next=change.after?.events||[];
    const a=old.find(e=>!next.some(n=>JSON.stringify(n)===JSON.stringify(e)))||old[0];
    const b=next.find(e=>!old.some(n=>JSON.stringify(n)===JSON.stringify(e)))||next[0];
    const event=b||a;
    const lines=[({added:'📅 **Calendar event added**',changed:'✏️ **Calendar event changed**',removed:'❌ **Calendar event removed from sync / canceled**'})[change.kind], '**'+clean(event.title||'Untitled event')+'**', 'Calendar: '+clean((change.after||change.before).calendar)];
    if(a&&b) {
        if(a.title!==b.title) lines.push('Previous name: '+clean(a.title));
        if(old.length!==next.length && (old.length>1||next.length>1)) {
            const removed=old.filter(e=>!next.some(n=>n.start===e.start));
            const added=next.filter(e=>!old.some(n=>n.start===e.start));
            removed.slice(0,3).forEach(e=>lines.push('Occurrence removed: '+when(e)));
            added.slice(0,3).forEach(e=>lines.push('Occurrence added: '+when(e)));
        } else if(a.start!==b.start||a.end!==b.end||a.allDay!==b.allDay) lines.push('Before: '+when(a),'Now: '+when(b));
        else lines.push(when(b));
        if(a.location!==b.location) lines.push('Location: '+clean(a.location||'(none)')+' → '+clean(b.location||'(none)'));
        else if(b.location) lines.push('Location: '+clean(b.location));
        if(a.details!==b.details) lines.push('Event description updated.');
        if(a.color!==b.color) lines.push('Event color updated.');
    } else {lines.push(when(event));if(event.location)lines.push('Location: '+clean(event.location));}
    if(old.length>1||next.length>1) lines.push('Recurring series updated ('+old.length+' → '+next.length+' occurrences in the sync window).');
    lines.push('[Open JDDM calendar](https://calendar.google.com/calendar/u/2/r)');
    return lines.join('\n').slice(0,1900);
}
function createCalendarMonitor({db,discord,now=()=>new Date()}) {
    const ref=db.doc('jddmCalendarMonitor/state');
    return async input => {
        const snapshot=validate(input), owner=crypto.randomUUID();
        const acquired=await db.runTransaction(async tx=>{const s=(await tx.get(ref)).data()||{};if(s.lockUntil>Date.now())return false;tx.set(ref,{lockUntil:Date.now()+300000,owner},{merge:true});return true;});
        if(!acquired)throw Error('Calendar check already running');
        try {
            let state=(await ref.get()).data()||{};
            // Finish a durable notification queue before advancing the calendar baseline.
            async function drain() {
                if(!state.pending)return;
                const pending=unpack(state.pending);
                for(let i=state.next||0;i<pending.changes.length;i++) {
                    const change=pending.changes[i];
                    await discord('POST','/channels/'+CHANNEL_ID+'/messages',{content:message(change),allowed_mentions:{parse:[]},nonce:hash([pending.snapshot.capturedAt,change]).slice(0,24),enforce_nonce:true});
                    await ref.set({next:i+1},{merge:true});
                }
                state={...state,baseline:pack(pending.snapshot),pending:null,next:0};
                await ref.set({baseline:state.baseline,pending:null,next:0},{merge:true});
            }
            await drain();
            const before=state.baseline?unpack(state.baseline):null;
            if(before&&Date.parse(snapshot.capturedAt)<=Date.parse(before.capturedAt))return {stale:true,posted:0};
            const edits=changes(before,snapshot);
            if(edits.length) {
                const pending=pack({snapshot,changes:edits});
                if(pending.length+(state.baseline||'').length>800000)throw Error('Calendar checkpoint exceeds safe size');
                await ref.set({pending,next:0},{merge:true});state.pending=pending;state.next=0;await drain();
            } else {const baseline=pack(snapshot);if(baseline.length>800000)throw Error('Calendar snapshot exceeds safe size');await ref.set({baseline},{merge:true});}
            const result={posted:edits.length,initialized:!before,events:snapshot.calendars.reduce((n,c)=>n+c.events.length,0),lastSuccess:now().toISOString(),lastError:null};
            await ref.set(result,{merge:true});return result;
        } catch(e) {await ref.set({lastError:e.message,errorAt:now().toISOString()},{merge:true});throw e;}
        finally {await db.runTransaction(async tx=>{const s=(await tx.get(ref)).data();if(s?.owner===owner)tx.set(ref,{lockUntil:0},{merge:true});});}
    };
}
function createHandler({secret,run,now=()=>Date.now()}) {
    return async(req,res)=>{
        if(req.method!=='POST')return res.status(405).json({ok:false});
        const body=req.rawBody?.toString()||(typeof req.body==='string'?req.body:JSON.stringify(req.body));
        const stamp=req.get('x-jddm-timestamp')||'', signature=req.get('x-jddm-signature')||'';
        const expected=crypto.createHmac('sha256',secret()).update(stamp+'.'+body).digest('hex');
        if(!/^\d+$/.test(stamp)||Math.abs(now()-Number(stamp))>300000||!/^[a-f0-9]{64}$/.test(signature)||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return res.status(401).json({ok:false});
        if(Buffer.byteLength(body)>3000000)return res.status(413).json({ok:false});
        let input;try{input=validate(JSON.parse(body));}catch(e){return res.status(400).json({ok:false,error:e.message});}
        try{return res.json({ok:true,...await run(input)});}catch(e){console.error('[calendarMonitor]',e.message);return res.status(503).json({ok:false,error:'Calendar check could not complete; it will retry.'});}
    };
}
module.exports={CALENDARS,CHANNEL_ID,validate,changes,when,message,pack,unpack,createCalendarMonitor,createHandler};
