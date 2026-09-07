'use strict';
const crypto = require('node:crypto');
const {keyFor, matchEvent, venueName, normalize} = require('./calendarVenueMatching');
const {verifyDiscordSignature} = require('./discordEmailInteractions');
const {indexRows, searchVenues} = require('./venueLinks');
const GUILD_ID = '1543777084265070623';
const ENDPOINT = 'https://us-central1-barkrangermap-auth.cloudfunctions.net/jddmCalendarVenueReview';
const quiet = {allowed_mentions: {parse: []}, flags: 4096};
const esc = s => String(s || '').replace(/[*_`~|\\]/g, '\\$&');
const dateKey = d => new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
function card(id, r) {
    const pending = r.status === 'pending' && r.active !== false;
    return {content: [`📅 **${pending ? 'Calendar venue needs a decision' : 'Calendar venue reviewed'}**`, `**${esc(r.name)}**`, r.location ? `Location: ${esc(r.location).slice(0,450)}` : 'No location supplied.', `Dates: ${(r.dates || []).slice(0,15).join(', ') || 'No upcoming date'}`, r.active === false ? 'No upcoming event remains in the latest calendar/website checks. New row is disabled.' : pending ? r.reason : r.status === 'ignored' ? 'Ignored — no spreadsheet row will be created for this calendar venue/location.' : `Linked to **${esc(r.venueName)}**. Gig dates update on the next calendar/website sync.`, pending ? 'New row creates a venue only after your confirmation. Link opens the existing-venue dropdown. Ignore keeps this out of the venue sheet.' : 'Link can change this decision. Ignore never deletes a calendar event.'].join('\n').slice(0,1900), ...quiet,
        components:[{type:1,components:[{type:2,style:2,label:'New row',custom_id:`jddmcal:new:${id}`,disabled:!pending},{type:2,style:1,label:'Link',custom_id:`jddmcal:link:${id}`},{type:2,style:2,label:'Ignore',custom_id:`jddmcal:ignore:${id}`,disabled:r.status === 'ignored'}]}]};
}
function createReviewService({db, discord, listRows, createVenue, now = () => Date.now()}) {
    const ref = id => db.doc('jddmCalendarReviews/' + id);
    async function config({required=true}={}) { const c = (await db.doc('jddmCalendarReview/config').get()).data(); if (!c?.channelId && required) throw Error('Calendar review channel is not configured'); return c || {}; }
    async function lock(id, fn) {
        const owner = crypto.randomUUID(), lease = db.doc('jddmCalendarReviewLocks/' + id);
        const acquired = await db.runTransaction(async tx => { const d = (await tx.get(lease)).data(); if (d?.until > now()) return false; tx.set(lease,{owner,until:now()+180000}); return true; });
        if (!acquired) throw Error('This calendar review is already being updated. Try again shortly');
        try { return await fn(); } finally { await db.runTransaction(async tx => { if ((await tx.get(lease)).data()?.owner === owner) tx.set(lease,{until:0},{merge:true}); }); }
    }
    async function publish(id, r) {
        const cfg = await config({required:false});
        if (!cfg.channelId) return; // Keep a durable pending review while channel provisioning is blocked.
        const body = card(id,r), digest = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
        if (r.messageHash === digest && r.messageId) return;
        let m;
        if (r.messageId) m = await discord('PATCH',`/channels/${cfg.channelId}/messages/${r.messageId}`,body);
        else m = await discord('POST',`/channels/${cfg.channelId}/messages`,{...body,nonce:id.slice(0,24),enforce_nonce:true});
        await ref(id).set({messageId:m.id,messageHash:digest},{merge:true});
    }
    async function resolveEvents(events, {enqueue=true, source='website'}={}) {
        if (!['website','calendar'].includes(source)) throw Error('Invalid calendar source');
        if (!Array.isArray(events) || events.length > 3000) throw Error('Invalid calendar event list');
        const rows = await listRows(), groups = new Map(), mappings = {}, reviews = [];
        for (const e of events) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '') || !(e.venueName || e.title)) continue;
            const id = keyFor(e); if (!groups.has(id)) groups.set(id,[]); groups.get(id).push(e);
        }
        const activeKeys = [];
        for (const [id, group] of groups) {
            const futureDates = [...new Set(group.filter(e=>e.date>=dateKey(new Date(now()))).map(e=>e.date))].sort();
            if (enqueue && futureDates.length) activeKeys.push(id);
            if (enqueue) await lock(id, async()=>{
                const old = (await ref(id).get()).data();
                if (!old) return;
                const sources = {...old.sources,[source]:futureDates};
                const dates = [...new Set(Object.values(sources).flat())].sort();
                await ref(id).set({sources,dates,active:dates.length>0},{merge:true});
            });
            const e = group[0], saved = (await ref(id).get()).data(), matching = matchEvent(rows,e);
            if (saved?.status === 'ignored') { mappings[id] = ''; if(enqueue)await publish(id,saved); continue; }
            if (saved?.status === 'linked' && saved.linkMode !== 'automatic' && rows.filter(r => r['Place ID'] === saved.venueId).length === 1) { mappings[id] = saved.venueId; if(enqueue)await publish(id,saved); continue; }
            if ((!saved || saved.linkMode === 'automatic' || saved.status === 'pending' && !saved.actor) && matching.venue) {
                mappings[id] = matching.venue['Place ID'];
                if(saved&&enqueue)await lock(id,async()=>{const current=(await ref(id).get()).data();if(current?.status!=='pending'&&current?.linkMode!=='automatic'||current.actor){mappings[id]=current?.status==='linked'?current.venueId:'';return;}const next={...current,status:'linked',linkMode:'automatic',venueId:matching.venue['Place ID'],venueName:matching.venue['Place Name'],revision:(current.revision||0)+(current.venueId!==matching.venue['Place ID']||current.status!=='linked'?1:0),reason:'Now uniquely matched to the existing spreadsheet venue.'};await ref(id).set(next);await publish(id,next);});
                continue;
            }
            mappings[id] = '';
            const future = group.filter(e => e.date >= dateKey(new Date(now())));
            if (!enqueue || !future.length) continue;
            await lock(id, async () => {
                const current = (await ref(id).get()).data();
                if (current?.status === 'ignored' || (current?.status === 'linked' && current.linkMode !== 'automatic' && rows.filter(r=>r['Place ID']===current.venueId).length===1)) { mappings[id] = current.venueId || ''; return; }
                const sources = {...current?.sources,[source]:futureDates};
                const r = {...current,sources,active:true,status:'pending',name:String(e.venueName || venueName(e.title)).slice(0,200),location:String(e.location || '').slice(0,1000),dates:[...new Set(Object.values(sources).flat())].sort(),reason:matching.reason,updatedAt:new Date(now()).toISOString(),createdAt:current?.createdAt || new Date(now()).toISOString()};
                await ref(id).set(r); await publish(id,r); reviews.push(id);
            });
        }
        if (enqueue) {
            const sourceRef=db.doc('jddmCalendarReviewSources/'+source), previous=(await sourceRef.get()).data()?.keys || [];
            for (const id of previous.filter(id=>!activeKeys.includes(id))) await lock(id,async()=>{
                const old=(await ref(id).get()).data(); if(!old)return;
                const sources={...old.sources,[source]:[]}, dates=[...new Set(Object.values(sources).flat())].sort();
                const next={...old,sources,dates,active:dates.length>0}; await ref(id).set(next); await publish(id,next);
            });
            await sourceRef.set({keys:activeKeys,checkedAt:new Date(now()).toISOString()});
        }
        return {mappings, reviews};
    }
    async function choose(id, action, venueId, actor, expectedRevision) {
        return lock('decision', () => lock(id, async () => {
            const r = (await ref(id).get()).data(); if (!r) throw Error('Calendar review no longer exists');
            if ((r.revision || 0) !== expectedRevision) throw Error('Someone already changed this review. Open Link again');
            const rows = await listRows(); let venue;
            if (action === 'new') {
                if (r.active === false || !r.dates?.some(d=>d>=dateKey(new Date(now())))) throw Error('This calendar venue has no upcoming event. Refresh the review');
                if (r.status !== 'pending') throw Error('This event has already been reviewed');
                const candidates = matchEvent(rows,{venueName:r.name,location:r.location}).candidates;
                const proposedId = 'calendar-approved-' + id;
                const recovered = rows.filter(v=>v['Place ID']===proposedId);
                if (recovered.length === 1) venue = recovered[0];
                else {
                    if (candidates.length) throw Error('An existing venue now matches this name. Use Link to avoid another duplicate');
                    const result = await createVenue({action:'createVenue',requestId:'calendar-review-'+id,rawFields:{'Place ID':proposedId,'Place Name':r.name,Address:r.location,Status:'Needs Review',Notes:'Created after explicit Discord calendar review. Verify venue address and contact details.'}});
                    if (!result.ok) throw Error(result.message || 'The venue could not be created');
                    venue = result.venue;
                }
            } else if (action === 'link') {
                const matches = rows.filter(v=>v['Place ID']===venueId); if (matches.length !== 1) throw Error('That venue is missing or its Place ID is duplicated. Choose another venue'); venue = matches[0];
            } else if (action !== 'ignore') throw Error('Unknown calendar decision');
            const next = {...r,linkMode:'manual',status:action==='ignore'?'ignored':'linked',venueId:venue?.['Place ID'] || '',venueName:venue?.['Place Name'] || '',actor,revision:(r.revision||0)+1,decidedAt:new Date(now()).toISOString()};
            await ref(id).set(next); await publish(id,next); return next;
        }));
    }
    async function picker(id, user, query) {
        const r = (await ref(id).get()).data(); if (!r) throw Error('Calendar review no longer exists');
        const index = indexRows(await listRows()), suggestions = searchVenues(index,query || r.name), priority = new Set([r.venueId,...suggestions.map(v=>v.id)]);
        const results = query ? suggestions : index.filter(v=>v.linkable).sort((a,b)=>Number(priority.has(b.id))-Number(priority.has(a.id))||a.name.localeCompare(b.name));
        const offered = results.slice(0,25), session = crypto.randomBytes(10).toString('hex');
        await db.doc('jddmCalendarSelections/'+session).set({id,user,revision:r.revision||0,offered:offered.map(v=>v.id),expiresAt:now()+600000});
        return {content:`**Choose the existing venue below.** ${query ? results.length+' results.' : 'Suggested matches appear first.'} Use Search venues to find any saved place; spelling mistakes are OK.`,components:[...(offered.length?[{type:1,components:[{type:3,custom_id:`jddmcal:select:${id}:${session}`,placeholder:'Select an existing venue',options:offered.map(v=>({label:v.name.slice(0,100),value:v.id,description:(v.city||'Location not recorded').slice(0,100)}))}]}]:[]),{type:1,components:[{type:2,style:1,label:'Search venues',custom_id:`jddmcal:query:${id}`}]}]};
    }
    async function select(id,session,user,chosen) {
        const s = (await db.doc('jddmCalendarSelections/'+session).get()).data();
        if (!s || s.id!==id || s.user!==user || s.expiresAt<=now() || !s.offered.includes(chosen)) throw Error('This dropdown expired. Click Link again');
        return choose(id,'link',chosen,user,s.revision);
    }
    return {resolve:(events,options={})=>options.enqueue===false?resolveEvents(events,options):lock('source-'+(options.source||'website'),()=>resolveEvents(events,options)),choose,picker,select,config,get:async id=>(await ref(id).get()).data()};
}
function searchModal(id) {
    return {type:9,data:{custom_id:`jddmcal:search:${id}`,title:'Find an existing venue',components:[{type:1,components:[{type:4,custom_id:'value',label:'Venue name or city (typos are OK)',style:1,required:true,min_length:2,max_length:100}]}]}};
}
function createInteractionHandler({publicKey,service,discord}) {
    return async(req,res) => {
        if (!verifyDiscordSignature({publicKey:publicKey(),signature:req.get('X-Signature-Ed25519'),timestamp:req.get('X-Signature-Timestamp'),rawBody:req.rawBody || JSON.stringify(req.body)})) return res.status(401).send('Invalid signature');
        const i=req.body, [,action,id,context]=String(i.data?.custom_id||'').split(':'), user=i.member?.user?.id;
        if (i.guild_id!==GUILD_ID || !user || !/^[a-f0-9]{32}$/.test(id||'')) return res.status(403).send('Invalid calendar control');
        if (action==='query') return res.json(searchModal(id));
        if (req.get('x-jddm-deferred')!=='1') await discord('POST',`/interactions/${i.id}/${i.token}/callback`,{type:5,data:{flags:64}});
        let result;
        try {
            const cfg=await service.config(); if(i.channel_id!==cfg.channelId) throw Error('Use this control in calendar-review');
            if(action==='link'||action==='search') { const q=i.data?.components?.flatMap(c=>c.components||[]).find(c=>c.custom_id==='value')?.value; if(action==='search'&&String(q||'').trim().length<2)throw Error('Enter at least two characters'); result=await service.picker(id,user,action==='search'?q.trim():null); }
            else if(action==='new'||action==='ignore') {const r=await service.get(id);if(!r)throw Error('Review no longer exists');result={content:action==='new'?`Create a new spreadsheet venue named **${esc(r.name)}**? Use Link if this place already exists.`:`Ignore **${esc(r.name)}** for this venue/location? Calendar events stay untouched.`,components:[{type:1,components:[{type:2,style:action==='new'?3:2,label:action==='new'?'Confirm new row':'Confirm ignore',custom_id:`jddmcal:${action}-confirm:${id}:${r.revision||0}`}]}]};}
            else {let r;if(action==='select')r=await service.select(id,context,user,i.data.values?.[0]);else if(['new-confirm','ignore-confirm'].includes(action)&&/^\d+$/.test(context||''))r=await service.choose(id,action.split('-')[0],'',user,Number(context));else throw Error('Unknown calendar control');result={content:r.status==='ignored'?'Ignored. No row will be created and no calendar event was deleted.':`Linked to **${esc(r.venueName)}**. Gig dates will update on the next sync.`,components:[]};}
        } catch(e) { result={content:'Could not complete this decision: '+e.message+'.',components:[]}; }
        await discord('PATCH',`/webhooks/${i.application_id}/${i.token}/messages/@original`,{...result,allowed_mentions:{parse:[]}});
        return res.status(202).send('handled');
    };
}
async function remoteResolve(events, secret, fetchImpl=fetch, source='calendar') {
    const body=JSON.stringify({events,source}), stamp=String(Date.now()), signature=crypto.createHmac('sha256',secret).update(stamp+'.'+body).digest('hex');
    const r=await fetchImpl(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','x-jddm-timestamp':stamp,'x-jddm-signature':signature},body,signal:AbortSignal.timeout(110000)});
    const d=await r.json();if(!r.ok||!d.ok)throw Error('Calendar venue review is unavailable; automatic row creation remains disabled');return d;
}
function createResolveHandler({secret,service}) {return async(req,res)=>{
    const body=req.rawBody?.toString()||JSON.stringify(req.body), stamp=req.get('x-jddm-timestamp')||'', signature=req.get('x-jddm-signature')||'';
    const expected=crypto.createHmac('sha256',secret()).update(stamp+'.'+body).digest('hex');
    if(req.method!=='POST'||!/^\d+$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>300000||!/^[a-f0-9]{64}$/.test(signature)||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return res.status(401).json({ok:false});
    try{return res.json({ok:true,...await service.resolve(req.body.events,{source:req.body.source||'calendar',enqueue:req.body.enqueue!==false})});}catch(e){console.error('[calendarVenueReview]',e.message);return res.status(503).json({ok:false});}
};}
module.exports={ENDPOINT,card,searchModal,createReviewService,createInteractionHandler,createResolveHandler,remoteResolve,dateKey};
