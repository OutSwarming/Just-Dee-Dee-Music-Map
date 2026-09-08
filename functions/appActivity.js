'use strict';

const {createHash, createHmac, timingSafeEqual, randomUUID} = require('node:crypto');
function verifyWorklistEdit(req, secret, now = Date.now()) {
    if (!secret) return false;
    const stamp = req.get?.('x-jddm-worklist-timestamp') || '';
    const signature = req.get?.('x-jddm-worklist-signature') || '';
    if (!/^\d+$/.test(stamp) || Math.abs(now - Number(stamp)) > 120000 || !/^[a-f0-9]{64}$/.test(signature)) return false;
    const raw = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    const expected = createHmac('sha256',secret).update(stamp+'.').update(raw).digest();
    return timingSafeEqual(expected,Buffer.from(signature,'hex'));
}
const TIME_ZONE = 'America/New_York';
const APP_ORIGINS = new Set([
    'https://outswarming.github.io',
    'https://just-dee-dee-music-map.web.app',
    'https://just-dee-dee-music-map.firebaseapp.com'
]);
function dayKey(date) {
    return new Intl.DateTimeFormat('en-CA', {timeZone: TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit'}).format(date);
}
// Calendar-day arithmetic, not elapsed 24-hour periods (Eastern has DST).
function dayNumber(day) { return Date.parse(day + 'T12:00:00Z') / 86400000; }
function previousDay(day) { return new Date(Date.parse(day + 'T12:00:00Z') - 86400000).toISOString().slice(0,10); }
function inactiveDays(day, startedDay, lastEditDay) {
    if (day < startedDay || lastEditDay >= day) return 0;
    return Math.max(0, Math.round(dayNumber(day) - dayNumber(lastEditDay && lastEditDay >= startedDay ? lastEditDay : previousDay(startedDay))));
}
function savedAppEdit({method, origin, trustedWorklist, payload, result}) {
    if (method !== 'POST' || (!APP_ORIGINS.has(origin) && !trustedWorklist) || !result?.ok || result.replayed) return false;
    if (payload.action === 'createVenue') return true;
    return ['saveVenue', 'setPlayed'].includes(payload.action) && result.changedHeaders?.length > 0;
}
function nightlyText(count, streak) {
    if (count > 10) return `🌟 **Dee Dee, you are rocking today!!** You did **${count} edits today**!`;
    if (count > 2) return `🎉 **Congrats, Dee Dee!** You did **${count} edits today**!`;
    if (count > 0) return null;
    return `📝 **No changes for ${streak} ${streak === 1 ? 'day' : 'days'}.**\nNo saved app edits today. Adding a place or saving contact details, a follow-up date, status, or notes resets the counter.`;
}

function createAppActivity({db, discord, now = () => new Date(), prefix = 'jddmAppActivity'}) {
 db = require('./operationStore').operationDb(db);
    const configRef = db.doc(`${prefix}/config`);
    const stateRef = db.doc(`${prefix}/state`);
    const dayRef = day => db.doc(`${prefix}Days/${day}`);
    const reportRef = id => db.doc(`${prefix}Reports/${id}`);

    async function record(input) {
        if (!savedAppEdit(input)) return {counted:false};
        const at = now(), day = dayKey(at);
        const id = createHash('sha256').update(input.payload.action + ':' + (input.payload.requestId || randomUUID())).digest('hex');
        const eventRef = db.doc(`${prefix}Events/${id}`);
        return db.runTransaction(async tx => {
            const [configSnap,eventSnap,daySnap,stateSnap] = await Promise.all([configRef,eventRef,dayRef(day),stateRef].map(ref=>tx.get(ref)));
            const config = configSnap.data();
            if (!config?.enabled || day < config.startedDay || eventSnap.exists) return {counted:false};
            const count = (daySnap.data()?.count || 0) + 1;
            tx.set(eventRef, {day,at:at.toISOString(),action:input.payload.action,venueId:input.payload.id || input.result.venue?.['Place ID'] || '',changedHeaders:input.result.changedHeaders || [],source:input.trustedWorklist?'discord-worklist':'shared-app'});
            tx.set(dayRef(day), {count, lastEditAt:at.toISOString()}, {merge:true});
            if (!stateSnap.data()?.lastEditAt || at.toISOString() > stateSnap.data().lastEditAt) {
                tx.set(stateRef, {lastEditDay:day,lastEditAt:at.toISOString()}, {merge:true});
            }
            return {counted:true,count,day};
        });
    }

    async function report(kind, scheduledAt = now()) {
        if (!['nightly','morning'].includes(kind)) throw Error('Unknown activity report');
        const day = dayKey(scheduledAt), id = `${kind}-${day}`, ref = reportRef(id);
        // Do not send stale alarms after a long outage or replay an old event on a new day.
        if (day !== dayKey(now())) return {status:'stale'};
        const owner = randomUUID();
        const prepared = await db.runTransaction(async tx => {
            const [configSnap, stateSnap, dailySnap, receiptSnap] = await Promise.all([configRef,stateRef,dayRef(day),ref].map(r=>tx.get(r)));
            const config = configSnap.data(), state = stateSnap.data() || {}, receipt = receiptSnap.data();
            if (!config?.enabled || !config.channelId || day < config.startedDay) return {status:'disabled'};
            if (['sent','skipped'].includes(receipt?.status)) return {status:receipt.status,duplicate:true};
            if (receipt?.leaseUntil > now().getTime()) throw Error('Activity report is already running');
            let count = dailySnap.data()?.count || 0, streak, content;
            if (kind === 'nightly') {
                streak = count ? 0 : inactiveDays(day, config.startedDay, state.lastEditDay);
                content = nightlyText(count, streak);
            } else {
                const yesterday = previousDay(day);
                streak = inactiveDays(yesterday, config.startedDay, state.lastEditDay);
                // Edits after last night's report (including after midnight) cancel this alert.
                content = streak >= 3 && !count ? `👀 **No new edits, what is going on?**\nDee Dee, there have been **${streak} days without a saved app edit**. A contact update, follow-up date, or any other saved venue change resets the counter.` : null;
            }
            const data = {kind,day,count,streak,status:content?'sending':'skipped',owner,leaseUntil:now().getTime()+120000,content:content||'',channelId:config.channelId,updatedAt:now().toISOString()};
            tx.set(ref,data);
            return data;
        });
        if (prepared.status !== 'sending') return prepared;
        const marker = `JDDM app activity • ${id}`;
        try {
            // Recover a Discord success if the function stopped before saving its receipt.
            const recent = await discord('GET', `/channels/${prepared.channelId}/messages?limit=100`);
            let sent = recent.find(m=>m.embeds?.some(e=>e.footer?.text === marker));
            if (!sent) {
                // Recheck activity immediately before sending an inactivity message.
                if (prepared.count === 0) {
                    const state = (await stateRef.get()).data() || {};
                    const targetDay = kind === 'morning' ? previousDay(day) : day;
                    if (state.lastEditDay >= targetDay) {
                        await ref.set({status:'skipped',reason:'edited-before-delivery',leaseUntil:0},{merge:true});
                        return {status:'skipped'};
                    }
                }
                sent = await discord('POST', `/channels/${prepared.channelId}/messages`, {
                    content:prepared.content,
                    embeds:[{description:`${day} · ${kind === 'nightly' ? '10 PM' : '7:55 AM'} Eastern · Shared app activity`,footer:{text:marker},color:prepared.count>2?0x57f287:0xfee75c}],
                    flags:4096,allowed_mentions:{parse:[]},
                    nonce:createHash('sha256').update(prefix+':'+id).digest('hex').slice(0,24),enforce_nonce:true
                });
            }
            await ref.set({status:'sent',messageId:sent.id,leaseUntil:0,sentAt:now().toISOString()},{merge:true});
            return {status:'sent',count:prepared.count,streak:prepared.streak,messageId:sent.id};
        } catch (error) {
            await ref.set({status:'retry',leaseUntil:0,lastError:String(error.message).slice(0,300)},{merge:true});
            throw error;
        }
    }
    return {record,report};
}
module.exports = {TIME_ZONE,dayKey,previousDay,inactiveDays,savedAppEdit,nightlyText,createAppActivity,verifyWorklistEdit};
