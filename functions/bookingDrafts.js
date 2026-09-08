'use strict';
// A restricted writer: drafts.create only. Never grant this worker a send action.
const { PREFIX, MAILBOX, emails, people, normalizeMessage, derive, hash } = require('./bookingTracker');
const { dayKey } = require('./appActivity');
function validate(proposal, row, view, job) {
  const recipient = String(proposal.recipient || '').trim().toLowerCase();
  if (view.invalidRecipients?.includes(recipient)) throw Error('This recipient was marked invalid or the wrong person; use a verified alternate contact');
  const verified = people(row).flatMap(p => p.emails.flatMap(e => emails(e.value)));
  if (!verified.includes(recipient) && !view.sent.some(m => m.to.includes(recipient))) throw Error('Recipient is not a verified saved or previously used venue email');
  if (emails(recipient).length !== 1 || /[\r\n,;]/.test(recipient)) throw Error('One verified recipient is required');
  if (!proposal.subject || /[\r\n]/.test(proposal.subject) || proposal.subject.length > 240) throw Error('Invalid draft subject');
  if (!proposal.body || proposal.body.length > 12000) throw Error('Draft body is missing or too long');
  if (!proposal.recommendation || proposal.recommendation.length > 4000) throw Error('A concise evidence-based next-step recommendation is required');
  if (!Array.isArray(proposal.evidence) || !proposal.evidence.length) throw Error('List the actual evidence used for this draft');
  if (view.drafts.length) throw Error('An unsent draft already exists; no duplicate created');
  if (['booked', 'no', 'invalid', 'wrong', 'paused'].includes(view.state)) throw Error('This campaign is paused or has a recipient problem');
  if (job.anchor !== (view.lastSent?.id || 'initial')) throw Error('A new email was sent since this job was requested; review again');
  if (job.requestedBy === 'automatic' && !view.canAutoDraft) throw Error('The follow-up is no longer due or there is new activity');
  return recipient;
}
function rawDraft(proposal, recipient, view, job) {
  const base = view.lastReply && (!view.lastSent || view.lastReply.at > view.lastSent.at) ? view.lastReply : view.lastSent, rfcId = `<jddm-2027-${job.id}-${job.generation || 1}@justdeedeemusic.com>`;
  const clean = v => String(v || '').replace(/[\r\n]/g, '');
  const subject = base ? base.subject : proposal.subject;
  const h = [`From: Dee Dee <${MAILBOX}>`, `To: ${recipient}`, `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`, `Message-ID: ${rfcId}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'];
  if (base?.rfcId) h.push('In-Reply-To: ' + clean(base.rfcId), 'References: ' + clean([base.references, base.rfcId].filter(Boolean).join(' ')));
  const raw = Buffer.from(h.join('\r\n') + '\r\n\r\n' + Buffer.from(proposal.body).toString('base64').match(/.{1,76}/g).join('\r\n')).toString('base64url');
  return { raw, rfcId, threadId: base?.threadId || '' };
}
function createWriter({ db, gmail, sheet, service }) {
  async function fresh(job) {
    const synced = await service.lock('poll', async () => service.syncMail(await sheet.list()));
    if (synced.pending) throw Error('Gmail changes are still syncing. Wait for the tracker to catch up before preparing a draft.');
    const s = await service.snapshot(), task = await service.get(job.taskId);
    const matches = s.rows.filter(r => r['Place ID'] === job.venueId);
    if (matches.length !== 1) throw Error('Canonical spreadsheet row missing or ambiguous');
    const row = await sheet.get(job.venueId);
    // Re-fetch every known campaign thread immediately before drafting to catch recent replies.
    const relevant = s.mail.filter(m => m.venueId === job.venueId), byId = new Map(relevant.map(m => [m.id, m]));
    const earliest = relevant.filter(m => !m.deleted).reduce((n, m) => Math.min(n, m.at), Infinity);
    for (const threadId of new Set(relevant.map(m => m.threadId))) {
      let result;
      try { result = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' }); }
      catch (e) { if (Number(e.code || e.response?.status) === 404) continue; throw e; }
      for (const raw of result.data.messages || []) { const m = normalizeMessage(raw); if (m.at >= earliest) byId.set(m.id, { ...m, venueId: job.venueId }); }
    }
    const view = derive({ ...task, jobState: '' }, row, [...byId.values()], s.signals.filter(x => x.venueId === job.venueId), dayKey(new Date()));
    const linkedSignals = s.signals.filter(x => x.venueId === job.venueId);
    const rowContext = Object.fromEntries(['Place ID','Place Name','Status','Next Follow Up','Last Contacted','Booking Contact','Contact Name','Contact Type','Email/Contact','Phone Number','Future Gigs','Next Booked','Notes','Website'].map(k => [k,row[k] || '']));
    const fingerprint = hash(JSON.stringify({ row: rowContext, outcome: task.outcome || 'auto', mail: [...byId.values()].sort((a,b) => a.id.localeCompare(b.id)).map(m => [m.id,m.sent,m.draft,m.deleted,hash(m.body)]), signals: linkedSignals }));
    return { task, row, view, signals: linkedSignals, fingerprint };
  }
  async function complete(id, proposal) { return service.lock('draft-' + id, async () => {
    const ref = db.doc(PREFIX + 'Jobs/' + id), job = (await ref.get()).data();
    if (!job) throw Error('Draft job not found');
    if (job.state === 'complete') return { alreadyComplete: true, draftId: job.draftId || '' };
    const profile = (await gmail.users.getProfile({ userId: 'me' })).data;
    if (profile.emailAddress.toLowerCase() !== MAILBOX) throw Error('Wrong Gmail account');
    const { task, row, view, fingerprint } = await fresh(job);
    if (proposal.contextFingerprint !== fingerprint) throw Error('Venue information or conversation activity changed. Read fresh evidence before completing this recommendation or draft.');
    if (proposal.action === 'recommendation') {
      if (!proposal.recommendation || !Array.isArray(proposal.evidence) || !proposal.evidence.length) throw Error('Recommendation and evidence required');
      await ref.set({ state: 'complete', recommendation: proposal.recommendation, evidence: proposal.evidence, completedAt: new Date().toISOString() }, { merge: true });
      await db.doc(PREFIX + 'Venues/' + task.id).set({ recommendation: proposal.recommendation, jobState: 'complete' }, { merge: true });
      return { recommendationOnly: true };
    }
    const recipient = validate(proposal, row, view, job), message = rawDraft(proposal, recipient, view, job);
    // Reserve before Gmail writes. An uncertain result is never retried blindly.
    if (job.state === 'creating') {
      const found = (await gmail.users.messages.list({ userId: 'me', q: 'in:anywhere rfc822msgid:' + message.rfcId })).data.messages || [];
      if (!found.length) throw Error('Previous draft creation is uncertain. Inspect Gmail before retrying.');
      throw Error('A previously created message exists. Reconcile its Gmail draft receipt before continuing.');
    }
    await ref.set({ state: 'creating', rfcId: message.rfcId, bodyHash: hash(proposal.body), proposal, creatingAt: new Date().toISOString() }, { merge: true });
    const result = (await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw: message.raw, ...(message.threadId ? { threadId: message.threadId } : {}) } } }, { retry: false })).data;
    await ref.set({ draftId: result.id, gmailMessageId: result.message.id }, { merge: true });
    const readback = (await gmail.users.drafts.get({ userId: 'me', id: result.id, format: 'full' })).data;
    const normalized = normalizeMessage(readback.message);
    if (!normalized.draft || !normalized.to.includes(recipient) || hash(normalized.body.trim()) !== hash(proposal.body.trim())) throw Error('Gmail draft verification failed; inspect the existing draft, do not create a duplicate');
    if (gmail.users.labels?.list) {
      try { const labels = (await gmail.users.labels.list({ userId: 'me' })).data.labels || []; const label = labels.find(l => l.name === 'JDDM/2027 Booking Drafts'); if (label) await gmail.users.messages.modify({ userId: 'me', id: result.message.id, requestBody: { addLabelIds: [label.id] } }); }
      catch (e) { await ref.set({ labelWarning: 'Draft verified, but its booking label needs another attempt.' }, { merge: true }); }
    }
    await db.doc(PREFIX + 'Mail/' + normalized.id).set({ ...normalized, venueId: job.venueId, draftId: result.id, seenAt: new Date().toISOString() });
    await ref.set({ state: 'complete', recommendation: proposal.recommendation, evidence: proposal.evidence, completedAt: new Date().toISOString() }, { merge: true });
    await db.doc(PREFIX + 'Venues/' + task.id).set({ recommendation: proposal.recommendation, jobState: 'complete' }, { merge: true });
    return { draftId: result.id, verified: true, sent: false };
  }); }
  return { fresh, complete };
}
module.exports = { validate, rawDraft, createWriter };
