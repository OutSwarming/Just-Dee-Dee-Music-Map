'use strict';
// The campaign ledger is separate from the venue's lifetime spreadsheet status.
// This module deliberately has no Gmail send capability.
const crypto = require('node:crypto');
const contacts = require('./contactRecords');
const { calendarDate } = require('./venueFields');
const { dayKey } = require('./appActivity');
const { STATUSES, link, valuesOf } = require('./venueWorklist');
const { plainBody, createDiscordClient } = require('./discordConversations');
const { verifyDiscordSignature } = require('./discordEmailInteractions');
const GUILD = '1543777084265070623', CATEGORY = '1546368345190826054';
const MAILBOX = 'justdeedeemusic@gmail.com', YEAR = 2027, PREFIX = 'jddmBooking2027';
const quiet = { allowed_mentions: { parse: [] }, flags: 4096 };
const hash = v => crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 32);
const clip = (v, n) => String(v || '').slice(0, n);
const STATES = {
  ready: ['Needs outreach', '⚪', 0x95a5a6], draft: ['Draft ready', '📝', 0x3498db],
  venue: ['Waiting on venue', '🟡', 0xf1c40f], deedee: ['Waiting on Dee Dee', '🔵', 0x3498db],
  yes: ['2027 — told yes', '🟩', 0x27ae60], booked: ['2027 — booked', '🟢', 0x2ecc71],
  no: ['2027 — told no', '🔴', 0xe74c3c], invalid: ['Invalid email', '⛔', 0xe74c3c],
  wrong: ['Wrong person', '👤', 0xe67e22], paused: ['Paused / do not contact', '⏸️', 0x95a5a6],
  due: ['Follow-up due', '🟠', 0xe67e22], queued: ['AI draft requested', '✍️', 0x9b59b6]
};
const OUTCOMES = ['auto', 'yes', 'booked', 'no', 'invalid', 'wrong', 'paused', 'recipient-fixed'];
const headers = m => Object.fromEntries((m.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
const emails = value => [...new Set((String(value || '').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []))];
const people = row => contacts.tidy(contacts.read(row)).contacts;
const hasContact = row => /^https?:\/\//i.test(row.Website || '') || people(row).some(p => p.emails.some(x => x.value) || p.phones.some(x => x.value) || p.others.some(x => x.value));
const gmailLink = thread => `https://mail.google.com/mail/?authuser=${MAILBOX}#${thread ? 'all/' + thread : 'drafts'}`;
function normalizeMessage(m) {
  const h = headers(m), body = plainBody(m.payload), labels = m.labelIds || [];
  const statusParts = []; function walk(p) { if (!p) return; if (p.mimeType === 'message/delivery-status' && p.body?.data) statusParts.push(Buffer.from(p.body.data, 'base64url').toString('utf8')); (p.parts || []).forEach(walk); } walk(m.payload);
  const deliveryText = body + '\n' + statusParts.join('\n');
  const deliverySender = /^(?:mailer-daemon|postmaster)@/i.test(emails(h.from)[0] || '');
  const delivery = deliverySender && (/delivery.status.notification|undeliver|address not found|delivery.+(?:fail|incomplete|delay)/i.test(h.subject || '') || /Final-Recipient:|Diagnostic-Code:/i.test(body));
  const temporary = delivery && /(?:Action:\s*delayed|Status:\s*4\.|delivery incomplete|temporar|will retry)/i.test(deliveryText + ' ' + h.subject) && !/(?:Action:\s*failed|Status:\s*5\.|address not found)/i.test(deliveryText + ' ' + h.subject);
  return { id: m.id, threadId: m.threadId, at: Number(m.internalDate || 0), subject: h.subject || '',
    from: emails(h.from), to: emails(h.to), cc: emails(h.cc), body: clip(body, 20000),
    rfcId: h['message-id'] || '', references: h.references || '', draft: labels.includes('DRAFT') && !labels.includes('TRASH'),
    sent: labels.includes('SENT') && !labels.includes('DRAFT'), deleted: labels.includes('TRASH'),
    delivery, temporaryDelivery: temporary, autoReply: Boolean(h['auto-submitted'] && h['auto-submitted'].toLowerCase() !== 'no'),
    failedRecipients: delivery ? emails(deliveryText.match(/(?:Final-Recipient:[^\n]+|Original-Recipient:[^\n]+|(?:address|recipient) [^\n]{0,200}|(?:problem delivering your message to|Your message (?:wasn't delivered|couldn't be delivered) to)\s+[^\s<>]+)/gi)?.join('\n') || '') : [] };
}
function datePlus(day, n) { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function derive(task, row, messages, signals = [], today = dayKey(new Date())) {
  const campaignStart = Math.min(...messages.filter(m => (m.sent || m.draft) && /\b2027\b/.test(m.subject + ' ' + m.body)).map(m => m.at));
  const live = messages.filter(m => !m.deleted && (!Number.isFinite(campaignStart) || m.at >= campaignStart)).sort((a, b) => a.at - b.at);
  const drafts = live.filter(m => m.draft), sent = live.filter(m => m.sent);
  const firstSent = sent[0], lastSent = sent.at(-1);
  // Unrelated messages, delivery notices and automatic acknowledgments are not human replies.
  const replies = live.filter(m => !m.sent && !m.draft && !m.delivery && !m.autoReply && !m.from.includes(MAILBOX));
  const lastReply = replies.at(-1);
  const failed = live.filter(m => m.delivery && !m.temporaryDelivery).at(-1);
  const deliveryDelay = live.filter(m => m.temporaryDelivery).at(-1);
  const cross = signals.filter(s => s.at >= (firstSent?.at || Date.now() + 1) && (s.platform !== 'Gmail' || s.status === 'deedee')).sort((a, b) => a.at - b.at).at(-1);
  const hasReply = lastReply && lastReply.at >= (lastSent?.at || 0);
  const failedNow = failed && failed.id !== task.dismissedDeliveryId && failed.at >= (lastSent?.at || 0);
  const changedChannel = cross && cross.at > (lastSent?.at || 0);
  const bookedDates = [...new Set([String(row['Next Booked'] || ''), ...String(row['Future Gigs'] || '').split(/[;,\n]/)].map(calendarDate).filter(d => d?.startsWith('2027-')))];
  const stopNote = /\b(?:do not contact|do not email|don.t (?:contact|email)|unsubscribed|no longer (?:offer(?:ing)?|host(?:ing)?|do(?:ing)?) (?:any )?(?:live )?music|aren.t doing live music)[\s\S]*/i.test([row.Notes, ...people(row).map(p => p.notes)].join('\n'));
  const autoPaused = stopNote || /Told No|Closed|No Music/i.test(row.Status || '');
  let state = task.outcome && task.outcome !== 'auto' ? task.outcome === 'yes' && bookedDates.length ? 'booked' : task.outcome : bookedDates.length ? 'booked' : failedNow ? 'invalid' : hasReply || changedChannel ? 'deedee' : autoPaused ? 'paused' : drafts.length ? 'draft' : lastSent ? 'venue' : 'ready';
  let reason = '', due = '', canAutoDraft = false;
  const official = calendarDate(row['Next Follow Up']);
  const followupSends = Math.max(0, sent.filter((m, i, a) => i === 0 || m.at - a[i - 1].at > 60000).length - 1);
  const priorReply = replies.some(m => firstSent && m.at > firstSent.at);
  if (task.outcome && task.outcome !== 'auto') reason = 'Campaign outcome set by a person. Automatic outreach is paused.';
  else if (bookedDates.length) reason = 'The official spreadsheet calendar has 2027 gigs: ' + bookedDates.join(', ') + '. Automatic booking outreach is paused.';
  else if (failedNow) reason = 'Delivery failed. Save a corrected or alternate contact in Open venue, choose Recipient fixed in the outcome menu, then request another draft.';
  else if (hasReply) reason = 'A message arrived from the venue. Review it before deciding the next step.';
  else if (changedChannel) reason = `There is newer ${cross.platform} activity. Review it before following up by email.`;
  else if (autoPaused) reason = 'The saved venue status or contact notes say no music, declined, or do not contact. Outreach is paused; review the source details in Open venue.';
  else if (drafts.length) reason = 'A Gmail draft is waiting for Dee Dee. No follow-up clock runs until she sends it.';
  else if (!lastSent) reason = 'No sent 2027 booking email has been verified. Request a draft or use a saved contact method.';
  else if (deliveryDelay && deliveryDelay.at >= lastSent.at) reason = 'Gmail reported a delivery delay. Wait for the delivery result before trying again.';
  else if (/Told No|Closed|No Music/i.test(row.Status || '')) reason = 'The spreadsheet says no / closed / no music. Review the venue before more outreach.';
  else if (priorReply) reason = 'This is an active conversation. Use the official follow-up date or request a tailored draft; the cold-email sequence is paused.';
  else if (followupSends >= 3) reason = 'Three follow-ups have been sent. Pause outreach until Dee Dee chooses a next step.';
  else if (official && official <= dayKey(new Date(lastSent.at))) reason = `The official follow-up (${official}) is on or before the latest sent email. Choose the next official follow-up date; another draft will not be prepared immediately after this send.`;
  else {
    due = official || datePlus(dayKey(new Date(lastSent.at)), [7, 7, 16][followupSends]);
    canAutoDraft = due <= today;
    reason = `${official ? 'Official spreadsheet follow-up' : 'Suggested follow-up'}: ${due}. ` + (canAutoDraft ? 'Review history and prepare one draft; Dee Dee decides whether to send.' : 'Wait until this date unless the venue replies.');
  }
  if (canAutoDraft && state === 'venue') state = 'due';
  const pending = task.jobState === 'pending' || task.jobState === 'working';
  return { state, drafts, sent, history: live.filter(m => !m.draft), lastSent: lastSent || null, lastReply: lastReply || null,
    reason, due, official, canAutoDraft: canAutoDraft && !pending, pending,
    tags: [...new Set([state, ...(lastSent && state === 'draft' ? ['venue'] : []), ...(canAutoDraft ? ['due'] : []), ...(pending ? ['queued'] : [])])],
    followupSends, cross: changedChannel ? cross : null, deliveryFailure: failed || null,
    invalidRecipients: [...new Set([...(task.blockedRecipients || []), ...(failedNow ? failed.failedRecipients?.length ? failed.failedRecipients : lastSent?.to || [] : [])])] };
}
function button(id, action, label, style = 2) { return { type: 2, style, label, custom_id: `jddmb:${action}:${id}` }; }
function card(t, row, view) {
  const [name, emoji, color] = STATES[view.state] || STATES.ready;
  const details = [people(row).map(p => [p.name || 'Contact name not known', ...p.emails.map(e => 'Email: ' + e.value), ...p.phones.map(e => 'Phone: ' + contacts.formatPhone(e.value)), ...p.others.map(e => (e.type || 'Other') + ': ' + e.value), p.preferredMethod && 'Preferred: ' + p.preferredMethod, p.notes && 'Notes: ' + p.notes].filter(Boolean).join('\n')).join('\n\n'), row.Website && 'Website / contact page: ' + row.Website].filter(Boolean).join('\n\n');
  const primary = view.drafts.at(-1), latest = view.lastReply && (!view.lastSent || view.lastReply.at > view.lastSent.at) ? view.lastReply : view.lastSent;
  const desc = [`**2027 campaign:** ${emoji} ${name}`, `**Map / spreadsheet status:** ${row.Status || 'Not set'}`, `**Official follow-up (Eastern):** ${view.official || 'Not set'}`, view.lastSent && `**Last verified sent:** ${dayKey(new Date(view.lastSent.at))}`, `**Next step:** ${view.reason}`, '', '**Contacts**', clip(details || 'No usable contact saved. Open venue to add information.', 1700), t.recommendation && '\n**AI recommendation**\n' + clip(t.recommendation, 650)].filter(Boolean).join('\n');
  const embeds = [{ title: clip('2027 • ' + row['Place Name'], 256), url: link(t.venueId), color, description: clip(desc, 3900), footer: { text: '2027 booking only • One official spreadsheet date • Only Dee Dee sends • Dates Eastern' } }];
  if (primary) embeds.push({ title: 'Gmail draft — ' + clip(primary.subject, 220), description: clip(primary.body, 1800) + (primary.body.length > 1800 ? '\n… Full draft in Gmail and this post’s draft history.' : ''), fields: [{ name: 'To', value: clip(primary.to.join(', ') || 'Recipient missing — correct in Gmail', 1000) }], color: 0x3498db });
  else if (latest) embeds.push({ title: latest.sent ? 'Most recent sent email' : 'Most recent venue message', description: clip(latest.body, 1800), color: latest.sent ? 0xf1c40f : 0x3498db });
  // Discord enforces 6,000 characters across all embeds, including titles and fields.
  while (JSON.stringify(embeds).length > 5800 && embeds[0].description.length > 1000) embeds[0].description = embeds[0].description.slice(0, -200);
  return { ...quiet, content: `**${clip(row['Place Name'], 150)} — 2027 booking**`, embeds,
    components: [
      { type: 1, components: [{ type: 2, style: 5, label: 'Open venue / contacts', url: link(t.venueId) }, { type: 2, style: 5, label: primary ? 'Open Gmail drafts' : 'Open Gmail', url: gmailLink(primary ? '' : latest?.threadId) }, { ...button(t.id, 'date', 'Follow-up date', 1), custom_id: `jddmb:date:${t.id}:${hash(row['Next Follow Up'] || '')}:${view.official || '0'}` }, button(t.id, 'draft', 'Request AI draft', 1), button(t.id, 'refresh', 'Refresh')] },
      { type: 1, components: [{ type: 3, custom_id: `jddmb:outcome:${t.id}`, placeholder: 'Set 2027 outcome / recipient problem', options: OUTCOMES.map(v => ({ label: v === 'auto' ? 'Track from Gmail automatically' : v === 'recipient-fixed' ? 'Recipient fixed — review again' : STATES[v][0], value: v, default: (t.outcome || 'auto') === v })) }] },
      { type: 1, components: [{ type: 3, custom_id: `jddmb:map:${t.id}:${hash(row.Status || '')}`, placeholder: 'Change official map / spreadsheet status', options: STATUSES.map((v, n) => ({ label: v, value: String(n), default: row.Status === v })) }] }
    ] };
}
function createService({ db, gmail, discord, sheet, now = () => new Date() }) {
 db = require('./operationStore').operationDb(db);
  // Back off during concurrent mailbox research; never turn a throttle into a missing-message assumption.
  async function read(fn) { for (let attempt = 0; ; attempt++) { try { return await fn(); } catch (e) { if (attempt >= 2 || !/quota|rate.limit/i.test(e.message)) throw e; await new Promise(resolve => setTimeout(resolve, [12000, 25000][attempt])); } } }
  if (gmail?.users?.getProfile) {
    const original = gmail; const u = { getProfile: args => read(() => original.users.getProfile(args)) };
    for (const [group, methods] of Object.entries({ drafts: ['list'], messages: ['get', 'list'], threads: ['get'], history: ['list'] })) u[group] = Object.fromEntries(methods.map(method => [method, args => read(() => original.users[group][method](args))]));
    gmail = { users: u };
  }
  const ref = id => db.doc(PREFIX + 'Venues/' + id);
  const readAll = async col => (await db.collection(col).get()).docs.map(d => ({ ...d.data(), id: d.id }));
  const get = async id => { const s = (await ref(id).get()).data(); if (!s) throw Error('Venue tracker not found'); return { ...s, id }; };
  const config = async () => { const c = (await db.doc(PREFIX + '/config').get()).data(); if (!c?.enabled || !c.forumId) throw Error('2027 tracker is not enabled'); return c; };
  async function lock(id, fn, ttl = 500000) {
    const r = db.doc(PREFIX + 'Locks/' + id), owner = crypto.randomUUID();
    await db.runTransaction(async tx => { const s = (await tx.get(r)).data(); if (s?.until > Date.now()) throw Error('Tracker update already running; try again shortly'); tx.set(r, { owner, until: Date.now() + ttl }); });
    try { return await fn(); } finally { await db.runTransaction(async tx => { if ((await tx.get(r)).data()?.owner === owner) tx.set(r, { until: 0 }, { merge: true }); }); }
  }
  async function signals() {
    const all = await Promise.all(['jddmMessengerConversations', 'jddmInstagramConversations', 'jddmVoiceConversations', 'jddmEmailConversations'].map(async c => (await readAll(c)).filter(x => x.venueId && !x.testConversation).map(x => ({ venueId: x.venueId, platform: c.includes('Messenger') ? 'Messenger' : c.includes('Instagram') ? 'Instagram' : c.includes('Email') ? 'Gmail' : 'Google Voice', at: Number(x.lastMessageAt || x.lastStatusMessageAt || 0), status: x.status || '', preview: clip(x.preview, 2500), url: x.discordThreadId ? `https://discord.com/channels/${GUILD}/${x.discordThreadId}` : '' }))));
    return all.flat();
  }
  async function snapshot() { return { rows: await sheet.list(), tasks: await readAll(PREFIX + 'Venues'), mail: await readAll(PREFIX + 'Mail'), signals: await signals() }; }
  function viewFor(t, row, s) { return derive(t, row, s.mail.filter(m => m.venueId === t.venueId), s.signals.filter(x => x.venueId === t.venueId), dayKey(now())); }
  async function syncMail(rows) {
    const profile = (await gmail.users.getProfile({ userId: 'me' })).data;
    if (profile.emailAddress.toLowerCase() !== MAILBOX) throw Error('Wrong Gmail account; no campaign changes made');
    const checkpoint = db.doc(PREFIX + '/gmail'), old = (await checkpoint.get()).data() || {};
    const ledger = await readAll('jddmBookingDrafts'), saved = await readAll(PREFIX + 'Mail');
    const observed = new Map(saved.map(m => [m.id, m]));
    async function saveMail(id, record) { if (!require('./operationStore').same(observed.get(id), record, ['seenAt'])) await db.doc(PREFIX + 'Mail/' + id).set(record); observed.set(id, record); }
    const uniqueRows = rows.filter(r => r['Place ID'] && rows.filter(x => x['Place ID'] === r['Place ID']).length === 1);
    const byEmail = new Map(), byThread = new Map(), byMessage = new Map();
    function add(map, k, v) { if (!k) return; if (!map.has(k)) map.set(k, new Set()); map.get(k).add(v); }
    for (const row of uniqueRows) for (const p of people(row)) for (const e of p.emails) for (const address of emails(e.value)) add(byEmail, address, row['Place ID']);
    for (const l of ledger) { add(byMessage, l.gmailMessageId, l.venueId); for (const e of emails(l.recipient)) add(byEmail, e, l.venueId); }
    for (const m of saved) if (m.venueId) add(byThread, m.threadId, m.venueId);
    const allDrafts = []; let pageToken;
    do { const r = (await gmail.users.drafts.list({ userId: 'me', maxResults: 50, ...(pageToken ? { pageToken } : {}) })).data; allDrafts.push(...(r.drafts || [])); pageToken = r.nextPageToken; } while (pageToken);
    const currentDraftIds = new Set(allDrafts.map(d => d.message.id));
    const ids = new Set(old.pending || []);
    // New drafts are prioritized; rotate existing drafts so edits are reflected without rescanning every body each minute.
    const known = new Set(saved.map(x => x.id)), newDrafts = allDrafts.filter(d => !known.has(d.message.id));
    newDrafts.forEach(d => ids.add(d.message.id));
    const sorted = allDrafts.filter(d => known.has(d.message.id)).sort((a, b) => a.id.localeCompare(b.id));
    const offset = old.draftOffset || 0;
    for (let n = 0; n < Math.min(35, sorted.length); n++) ids.add(sorted[(offset + n) % sorted.length].message.id);
    let cursor = profile.historyId;
    if (old.historyId) {
      try { let token; do { const d = (await gmail.users.history.list({ userId: 'me', startHistoryId: old.historyId, maxResults: 50, ...(token ? { pageToken: token } : {}) })).data; for (const h of d.history || []) for (const entry of [...(h.messagesAdded || []), ...(h.labelsAdded || []), ...(h.labelsRemoved || [])]) ids.add(entry.message.id); token = d.nextPageToken; } while (token); }
      catch (e) { if (Number(e.code || e.response?.status) !== 404) throw e; cursor = ''; }
    }
    if (!old.historyId || !cursor) {
      // Enumerating the SENT label avoids competing with the research worker's full-text search quota.
      let token; do { const d = (await gmail.users.messages.list({ userId: 'me', labelIds: ['SENT'], maxResults: 50, ...(token ? { pageToken: token } : {}) })).data; (d.messages || []).forEach(m => ids.add(m.id)); token = d.nextPageToken; } while (token);
    }
    // Persist the entire backlog before advancing the Gmail history cursor.
    await checkpoint.set({ historyId: profile.historyId, pending: [...ids], draftOffset: sorted.length ? (offset + 35) % sorted.length : 0, checkedAt: now().toISOString() });
    const draftMap = new Map(allDrafts.map(d => [d.message.id, d.id]));
    let processed = 0, matched = 0;
    for (const id of ids) {
      if (processed >= 100) break;
      let m;
      try { m = normalizeMessage((await gmail.users.messages.get({ userId: 'me', id, format: 'full' })).data); }
      catch (e) { if (Number(e.code || e.response?.status) !== 404) throw e; const existing = saved.find(x => x.id === id); if (existing && (!existing.deleted || existing.draft)) await db.doc(PREFIX + 'Mail/' + id).set({ deleted: true, draft: false }, { merge: true }); ids.delete(id); processed++; continue; }
      const candidates = new Set(byMessage.get(id) || byThread.get(m.threadId) || []);
      if (!candidates.size && ((m.draft || m.sent) && /\b2027\b/.test(m.subject + ' ' + m.body))) for (const e of [...m.to, ...m.cc]) for (const v of byEmail.get(e) || []) candidates.add(v);
      if (!candidates.size && m.delivery) for (const e of m.failedRecipients) for (const v of byEmail.get(e) || []) if ([...observed.values()].some(x => x.venueId === v && x.sent && !x.deleted && x.at <= m.at)) candidates.add(v);
      if (!candidates.size && !m.sent && !m.draft && !m.delivery && !m.from.includes(MAILBOX)) for (const e of m.from) for (const v of byEmail.get(e) || []) if ([...observed.values()].some(x => x.venueId === v && x.sent && !x.deleted && x.at <= m.at)) candidates.add(v);
      if (candidates.size === 1) {
        m.venueId = [...candidates][0]; m.draftId = draftMap.get(id) || ''; m.seenAt = now().toISOString();
        await saveMail(id,m); add(byThread, m.threadId, m.venueId); matched++;
        // Fetch the conversation once when discovering a new campaign; this captures replies already present before setup.
        if (!saved.some(x => x.threadId === m.threadId)) {
          const thread = (await gmail.users.threads.get({ userId: 'me', id: m.threadId, format: 'full' })).data;
          const history = (thread.messages || []).map(normalizeMessage);
          const campaignStart = Math.min(...history.filter(x => (x.sent || x.draft) && /\b2027\b/.test(x.subject + ' ' + x.body)).map(x => x.at), m.at);
          for (const other of history.filter(x => x.at >= campaignStart)) { const record={ ...other, venueId: m.venueId, draftId: draftMap.get(other.id) || '', seenAt: now().toISOString() }; await saveMail(other.id,record); }
        }
      } else if (m.draft && /\b2027\b/.test(m.subject + ' ' + m.body)) {
        await db.doc(PREFIX + 'Unmatched/' + id).set({ draftId: draftMap.get(id) || '', subject: m.subject, to: m.to, candidates: [...candidates], at: now().toISOString() });
      }
      if (candidates.size !== 1) await saveMail(id, { id, threadId: m.threadId, at: m.at, draft: m.draft, deleted: m.deleted, ignored: true, venueId: '', draftId: draftMap.get(id) || '', seenAt: now().toISOString() });
      ids.delete(id); processed++;
    }
    for (const m of observed.values()) if (m.draft && !m.deleted && !currentDraftIds.has(m.id)) {
      // A missing draft can mean sent or deleted; only Gmail's SENT label establishes a send.
      if (!ids.has(m.id)) ids.add(m.id);
      await db.doc(PREFIX + 'Mail/' + m.id).set({ draft: false, deleted: true }, { merge: true });
    }
    await checkpoint.set({ pending: [...ids] }, { merge: true });
    return { processed, matched, pending: ids.size, gmailDrafts: allDrafts.length };
  }
  async function publish(t, row, view, cfg) {
    const body = card(t, row, view), digest = hash(JSON.stringify(body) + JSON.stringify([...view.drafts, ...view.history].map(d => [d.id, d.body]))), tags = [...view.tags.map(x => cfg.tags[x]), cfg.mapTags?.[row.Status]].filter(Boolean).slice(0, 5);
    if (t.cardHash === digest && t.tagsHash === hash(JSON.stringify(tags)) && t.threadId) return false;
    let threadId = t.threadId;
    if (!threadId) {
      // A lost Discord create response must be reconciled, never blindly duplicated.
      if (t.creatingAt) {
        const active = await discord('GET', `/guilds/${GUILD}/threads/active`);
        for (const th of (active.threads || []).filter(x => x.parent_id === cfg.forumId && x.name === clip(row['Place Name'] + ' • 2027', 100))) {
          const starter = await discord('GET', `/channels/${th.id}/messages/${th.id}`);
          if (starter.embeds?.[0]?.url === link(t.venueId)) { threadId = th.id; break; }
        }
        if (!threadId) throw Error('A forum creation needs review before retrying: ' + row['Place Name']);
      } else {
        await ref(t.id).set({ creatingAt: now().toISOString() }, { merge: true });
        try { const post = await discord('POST', `/channels/${cfg.forumId}/threads`, { name: clip(row['Place Name'] + ' • 2027', 100), auto_archive_duration: 10080, applied_tags: tags, message: body }); threadId = post.id; }
        catch (e) { if ([400, 401, 403, 404, 429].includes(e.status)) await ref(t.id).set({ creatingAt: '' }, { merge: true }); throw e; }
      }
      await ref(t.id).set({ threadId }, { merge: true });
    } else {
      const channel = await discord('GET', `/channels/${threadId}`);
      if (channel.thread_metadata?.archived) await discord('PATCH', `/channels/${threadId}`, { archived: false });
      await discord('PATCH', `/channels/${threadId}/messages/${threadId}`, body);
      const name = clip(row['Place Name'] + ' • 2027', 100);
      await discord('PATCH', `/channels/${threadId}`, { applied_tags: tags, ...(channel.name !== name ? {name} : {}) });
    }
    // Keep a full, editable preview of every active draft under the same venue conversation.
    const receipts = t.draftPosts || {}, activeChunks = new Set();
    for (const draft of view.drafts) {
      const text = `**Gmail draft — not sent**\n**To:** ${draft.to.join(', ')}\n**Subject:** ${draft.subject}\n\n${draft.body}`;
      const chunks = text.match(/[\s\S]{1,1850}/g) || ['Empty draft'];
      for (let n = 0; n < chunks.length; n++) {
        const key = draft.id + '_' + n, payload = { ...quiet, content: chunks[n] }, digest = hash(chunks[n]);
        activeChunks.add(key);
        if (receipts[key]?.hash === digest) continue;
        if (receipts[key]?.id) await discord('PATCH', `/channels/${threadId}/messages/${receipts[key].id}`, payload);
        else { const msg = await discord('POST', `/channels/${threadId}/messages`, payload); receipts[key] = { id: msg.id }; }
        receipts[key].hash = digest;
        await ref(t.id).set({ draftPosts: receipts }, { merge: true });
      }
    }
    for (const [key, receipt] of Object.entries(receipts)) if (!activeChunks.has(key) && receipt.hash !== 'retired') {
      await discord('PATCH', `/channels/${threadId}/messages/${receipt.id}`, { ...quiet, content: 'This draft is no longer in Gmail Drafts. The current sent/reply status is shown at the top of this venue post.' }); receipt.hash = 'retired';
    }
    const events = t.eventPosts || {};
    for (const m of view.history) {
      const label = m.delivery ? 'Delivery notice' : m.autoReply ? 'Automatic acknowledgment' : m.sent ? 'Sent by Dee Dee in Gmail' : 'Venue message received';
      const text = `**${label} • ${dayKey(new Date(m.at))}**\n**From:** ${m.from.join(', ')}\n**To:** ${m.to.join(', ')}\n**Subject:** ${m.subject}\n\n${m.body}`;
      const chunks = text.match(/[\s\S]{1,1850}/g) || ['Empty message'];
      for (let n = 0; n < chunks.length; n++) { const key = m.id + '_' + n; if (events[key]) continue; const message = await discord('POST', `/channels/${threadId}/messages`, { ...quiet, content: chunks[n] }); events[key] = message.id; await ref(t.id).set({ eventPosts: events }, { merge: true }); }
    }
    await ref(t.id).set({ threadId, cardHash: digest, tagsHash: hash(JSON.stringify(tags)), draftPosts: receipts, eventPosts: events, state: view.state, officialFollowUp: view.official, officialFollowUpRaw: row['Next Follow Up'] || '', suggestedFollowUp: view.due, lastSentAt: view.lastSent?.at || 0, updatedAt: now().toISOString() }, { merge: true });
    return true;
  }
  async function enqueue(t, row, view, requestedBy = 'automatic') {
    if (view.drafts.length) return 'A Gmail draft already exists. Open Gmail drafts to review it; a duplicate was not created.';
    if (['no', 'booked', 'paused', 'invalid', 'wrong'].includes(view.state)) return 'Resolve the campaign outcome or recipient problem first. No draft was queued.';
    const anchor = view.lastSent?.id || 'initial';
    const id = hash(t.venueId + '|' + anchor + '|' + view.followupSends);
    const r = db.doc(PREFIX + 'Jobs/' + id);
    await db.runTransaction(async tx => { const existing = (await tx.get(r)).data(); if (existing && (['pending', 'working', 'creating'].includes(existing.state) || existing.state === 'complete' && requestedBy === 'automatic' && (existing.officialDateAtRequest || '') === (row['Next Follow Up'] || ''))) return; tx.set(r, { id, venueId: t.venueId, taskId: t.id, state: 'pending', requestedBy, anchor, officialDateAtRequest: row['Next Follow Up'] || '', requestedAt: now().toISOString(), generation: (existing?.generation || 0) + 1 }); });
    const job = (await r.get()).data();
    await ref(t.id).set({ jobId: id, jobState: job.state }, { merge: true });
    return job.state === 'creating' ? 'An earlier draft creation needs verification in Gmail before trying again. Another draft was not queued.' : job.state === 'complete' ? 'The AI review for this step is complete. See the recommendation above.' : 'Queued for an AI review of this venue’s history and a Gmail draft or recommended next action. Dee Dee sends it herself. The AI worker checks about every 15 minutes while this Mac and Codex are available.';
  }
  async function poll({ mail = true, limit = 35 } = {}) { return lock('poll', async () => {
    const cfg = await config(); const rows = await sheet.list();
    let mailResult = {};
    if (mail) { try { mailResult = await syncMail(rows); } catch (e) { mailResult = { pending: 1, error: e.message }; } }
    const s = await snapshot(), ids = new Map(); s.rows.forEach(r => ids.set(r['Place ID'], (ids.get(r['Place ID']) || 0) + 1));
    const eligible = s.rows.filter(r => r['Place ID'] && ids.get(r['Place ID']) === 1 && r['Place Name'] && !/^jddm-e2e-/.test(r['Place ID']) && hasContact(r));
    // Show existing drafts first, then contacted campaigns, then the remaining contactable venues.
    eligible.sort((a, b) => Number(s.mail.some(m => m.venueId === b['Place ID'] && !m.deleted)) - Number(s.mail.some(m => m.venueId === a['Place ID'] && !m.deleted)) || a['Place Name'].localeCompare(b['Place Name']));
    let updated = 0, queued = 0; const errors = [];
    for (const row of eligible) {
      const id = hash(row['Place ID']); let t = s.tasks.find(x => x.id === id);
      if (!t) { t = { id, venueId: row['Place ID'], name: row['Place Name'], outcome: 'auto', createdAt: now().toISOString() }; await ref(id).set(t); }
      let view = viewFor(t, row, s);
      if (view.canAutoDraft && mail && !mailResult.pending) { await enqueue(t, row, view); t = await get(id); view = viewFor(t, row, s); queued++; }
      if (updated < limit && (!cfg.discordRetryAt || cfg.discordRetryAt <= Date.now())) { try { if (await publish(t, row, view, cfg)) updated++; } catch (e) {
        errors.push({ venue: row['Place Name'], error: e.message, retryAfter: e.retryAfter || 0 });
        if (e.status === 429) { await db.doc(PREFIX + '/config').set({ discordRetryAt: Date.now() + Math.max(5, Number(e.retryAfter) || 60) * 1000 + 1000 }, { merge: true }); break; }
      } }
    }
    await db.doc(PREFIX + '/health').set({ checkedAt: now().toISOString(), venues: eligible.length, updated, queued, mail: mailResult, errors: errors.slice(0, 10) });
    return { venues: eligible.length, updated, queued, mail: mailResult, errors: errors.slice(0, 5) };
  }); }
  async function action(id, action, value, channel, user, requestId, expectedHash) { return lock(id, async () => {
    let t = await get(id); if (t.threadId !== channel) throw Error('Use this control in the original venue post');
    const rows = await sheet.list(); if (rows.filter(r => r['Place ID'] === t.venueId).length !== 1) throw Error('The spreadsheet row is missing or ambiguous. No row will be added.');
    let row = await sheet.get(t.venueId), message = 'Tracker refreshed.';
    if (action === 'outcome') {
      if (!OUTCOMES.includes(value)) throw Error('Choose a listed outcome');
      const current = await snapshot(), prior = viewFor(t,row,current);
      const blocked = [...new Set([...(t.blockedRecipients || []), ...prior.invalidRecipients, ...(['invalid','wrong'].includes(value) ? (prior.lastSent?.to || prior.drafts.at(-1)?.to || []) : [])])];
      if (value === 'recipient-fixed') {
        const available = people(row).flatMap(p=>p.emails.flatMap(e=>emails(e.value))).filter(e=>!blocked.includes(e));
        if (!available.length) throw Error('Add a corrected or alternate booking email in Open venue first. The failed/wrong recipient will not be reused.');
        await ref(id).set({ outcome:'auto', blockedRecipients:blocked, dismissedDeliveryId:prior.deliveryFailure?.id || '', outcomeBy:user, outcomeAt:now().toISOString(), recommendation:'' },{merge:true});
        message='Recipient problem acknowledged. Request AI draft to review the corrected contact; the failed address will not be reused.';
      } else { await ref(id).set({ outcome: value, blockedRecipients:blocked, outcomeBy: user, outcomeAt: now().toISOString(), recommendation: '' }, { merge: true }); message = '2027 campaign outcome saved. The map’s general status is shown separately.'; }
    }
    else if (action === 'date-submit' || action === 'map') {
      const field = action === 'map' ? 'Status' : 'Next Follow Up';
      if (hash(row[field] || '') !== expectedHash) throw Error('The spreadsheet changed since this control was opened. Refresh the post and try again.');
      let next = value;
      if (action === 'map') { next = STATUSES[Number(value)]; if (!next) throw Error('Choose a listed map status'); }
      else { next = value.trim() ? calendarDate(value.trim()) : ''; if (value.trim() && (!next || next < dayKey(now()))) throw Error('Use today or a future date, MM/DD/YYYY. Leave blank to clear.'); }
      await sheet.save(t.venueId, { [field]: next }, { [field]: row[field] || '' }, 'booking-' + requestId);
      row = await sheet.get(t.venueId); if ((action === 'map' ? row[field] : calendarDate(row[field])) !== next) throw Error('Save verification failed. Refresh before retrying.');
      message = 'Saved to the official spreadsheet. No columns or rows were added.';
    }
    const s = await snapshot(); t = await get(id); let view = viewFor(t, row, s);
    if (action === 'draft') { message = await enqueue(t, row, view, user); t = await get(id); view = viewFor(t, row, s); }
    await publish(t, row, view, await config()); return message;
  }); }
  return { get, config, poll, syncMail, snapshot, viewFor, publish, action, enqueue, lock, readAll };
}
function createInteractions({ service, discord, publicKey }) { return async (req, res) => {
  if (!verifyDiscordSignature({ publicKey: publicKey(), signature: req.get('X-Signature-Ed25519'), timestamp: req.get('X-Signature-Timestamp'), rawBody: req.rawBody || JSON.stringify(req.body) })) return res.status(401).send('Invalid signature');
  const i = req.body, [prefix, action, id, expected, displayedDate] = String(i.data?.custom_id || '').split(':'), user = i.member?.user?.id;
  if (prefix !== 'jddmb' || i.guild_id !== GUILD || !user || !/^[a-f0-9]{32}$/.test(id || '')) return res.json({ type: 4, data: { flags: 64, content: 'Use the JDDM 2027 booking tracker.' } });
  if (action === 'date') {
    try {
      if (!/^[a-f0-9]{32}$/.test(expected || '')) throw Error('Refresh this post once to load the new date control.');
      const date = calendarDate(displayedDate);
      return res.json({ type: 9, data: { title: 'Official follow-up date — Eastern', custom_id: `jddmb:date-submit:${id}:${expected}`, components: [{ type: 18, label: 'MM/DD/YYYY — leave blank to clear', component: { type: 4, custom_id: 'date', style: 1, required: false, max_length: 10, ...(date ? { value: date.split('-').slice(1).concat(date.slice(0, 4)).join('/') } : {}) } }] } });
    } catch (e) { return res.json({ type: 4, data: { flags: 64, content: e.message } }); }
  }
  await discord('POST', `/interactions/${i.id}/${i.token}/callback`, { type: 5, data: { flags: 64 } });
  try {
    const value = action === 'date-submit' ? valuesOf(i.data).date || '' : i.data.values?.[0];
    const content = await service.action(id, action, value, i.channel_id, user, i.id, expected);
    await discord('PATCH', `/webhooks/${i.application_id}/${i.token}/messages/@original`, { content, components: [], allowed_mentions: { parse: [] } });
  } catch (e) { await discord('PATCH', `/webhooks/${i.application_id}/${i.token}/messages/@original`, { content: clip('Could not finish: ' + e.message, 1900), components: [], allowed_mentions: { parse: [] } }); }
  return res.status(200).send('Handled');
}; }
module.exports = { GUILD, CATEGORY, MAILBOX, YEAR, PREFIX, STATES, OUTCOMES, quiet, hash, emails, people, hasContact, normalizeMessage, derive, card, gmailLink, createService, createInteractions, createDiscordClient };
