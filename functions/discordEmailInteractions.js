'use strict';

/**
 * Just Dee Dee Music — Discord email action bot backend.
 *
 * The Apps Script intake posts one forum post per Gmail message with an action
 * row of buttons (Reply / Mark Spam / Archive / Done). Clicking a button sends
 * a Discord "interaction" to this HTTPS endpoint. This module:
 *   1. verifies Discord's Ed25519 request signature (dependency-free),
 *   2. routes the interaction to the correct immediate response, and
 *   3. performs the Gmail side effect (reply, spam, archive, done) and edits the
 *      original Discord post to show what happened.
 *
 * Everything here is written as small injectable pieces so the routing and the
 * Gmail/MIME logic can be unit-tested without any network access.
 */

const crypto = require('crypto');

// SPKI DER prefix for a raw 32-byte Ed25519 public key. Prepending this lets
// Node's built-in crypto verify Discord signatures without an external library.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const CUSTOM_ID_PREFIX = 'jddm';

const INTERACTION_TYPE = Object.freeze({
    PING: 1,
    APPLICATION_COMMAND: 2,
    MESSAGE_COMPONENT: 3,
    MODAL_SUBMIT: 5
});

const RESPONSE_TYPE = Object.freeze({
    PONG: 1,
    CHANNEL_MESSAGE_WITH_SOURCE: 4,
    DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
    DEFERRED_UPDATE_MESSAGE: 6,
    UPDATE_MESSAGE: 7,
    MODAL: 9
});

const EPHEMERAL_FLAG = 64;
const REPLY_INPUT_ID = 'jddm_reply_body';
const KNOWN_ACTIONS = Object.freeze(['reply', 'spam', 'archive', 'done']);

/**
 * Verify an incoming Discord interaction signature.
 * Returns true only when the Ed25519 signature covers (timestamp + rawBody).
 */
function verifyDiscordSignature({ publicKey, signature, timestamp, rawBody }) {
    try {
        if (!publicKey || !signature || !timestamp || rawBody == null) return false;
        if (!/^[0-9a-fA-F]{64}$/.test(String(publicKey))) return false;
        if (!/^[0-9a-fA-F]+$/.test(String(signature)) || String(signature).length % 2 !== 0) return false;

        const keyDer = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(String(publicKey), 'hex')]);
        const keyObject = crypto.createPublicKey({ key: keyDer, format: 'der', type: 'spki' });
        const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
        const message = Buffer.concat([Buffer.from(String(timestamp), 'utf8'), bodyBuffer]);
        return crypto.verify(null, message, keyObject, Buffer.from(String(signature), 'hex'));
    } catch (error) {
        return false;
    }
}

/** Encode a Gmail message + thread reference into a Discord custom_id (<=100 chars). */
function buildCustomId(action, messageId, threadId) {
    return [CUSTOM_ID_PREFIX, action, messageId || '', threadId || ''].join(':').slice(0, 100);
}

/** Parse a Discord custom_id back into { action, messageId, threadId }, or null. */
function parseCustomId(customId) {
    const parts = String(customId || '').split(':');
    if (parts[0] !== CUSTOM_ID_PREFIX || parts.length < 2) return null;
    return {
        action: String(parts[1] || '').toLowerCase(),
        messageId: parts[2] || '',
        threadId: parts[3] || ''
    };
}

/**
 * The action row of buttons attached to every email post. Shared shape so the
 * Apps Script intake and this backend always agree on custom_id encoding.
 */
function buildEmailActionRow(messageId, threadId) {
    return {
        type: 1,
        components: [
            { type: 2, style: 1, label: 'Reply', emoji: { name: '✉️' }, custom_id: buildCustomId('reply', messageId, threadId) },
            { type: 2, style: 4, label: 'Mark Spam', emoji: { name: '🚫' }, custom_id: buildCustomId('spam', messageId, threadId) },
            { type: 2, style: 2, label: 'Archive', emoji: { name: '🗂️' }, custom_id: buildCustomId('archive', messageId, threadId) },
            { type: 2, style: 3, label: 'Done', emoji: { name: '✅' }, custom_id: buildCustomId('done', messageId, threadId) }
        ]
    };
}

/** The reply modal shown when Reply is clicked. */
function buildReplyModal(target) {
    return {
        type: RESPONSE_TYPE.MODAL,
        data: {
            custom_id: buildCustomId('reply-submit', target.messageId, target.threadId),
            title: 'Reply from Just Dee Dee',
            components: [{
                type: 1,
                components: [{
                    type: 4,
                    custom_id: REPLY_INPUT_ID,
                    style: 2,
                    label: 'Your reply (sent from justdeedeemusic@gmail.com)',
                    placeholder: 'Type your reply. It is sent as a real email in the original thread.',
                    min_length: 1,
                    max_length: 3800,
                    required: true
                }]
            }]
        }
    };
}

function ephemeralMessage(content) {
    return {
        type: RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: String(content).slice(0, 1900), flags: EPHEMERAL_FLAG, allowed_mentions: { parse: [] } }
    };
}

/** Pull a header value out of a Gmail metadata payload, case-insensitively. */
function getHeader(headers, name) {
    const wanted = String(name).toLowerCase();
    const list = Array.isArray(headers) ? headers : [];
    for (let i = 0; i < list.length; i++) {
        if (String(list[i].name || '').toLowerCase() === wanted) return String(list[i].value || '');
    }
    return '';
}

function base64UrlEncode(value) {
    return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeMimeHeader(value) {
    const text = String(value || '');
    // Keep plain ASCII headers as-is; RFC 2047 encode anything else.
    if (/^[\x20-\x7E]*$/.test(text)) return text;
    return '=?UTF-8?B?' + Buffer.from(text, 'utf8').toString('base64') + '?=';
}

/** Build the raw RFC 5322 message for a threaded plain-text reply. */
function buildReplyRaw({ toAddress, subject, inReplyTo, references, body }) {
    const replySubject = /^re:/i.test(String(subject || '').trim()) ? subject : ('Re: ' + (subject || '(no subject)'));
    const referenceChain = [references, inReplyTo].map(part => String(part || '').trim()).filter(Boolean).join(' ').trim();
    const lines = [
        'To: ' + encodeMimeHeader(toAddress),
        'Subject: ' + encodeMimeHeader(replySubject),
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit'
    ];
    if (inReplyTo) lines.push('In-Reply-To: ' + inReplyTo);
    if (referenceChain) lines.push('References: ' + referenceChain);
    lines.push('');
    lines.push(String(body || ''));
    return base64UrlEncode(lines.join('\r\n'));
}

/**
 * Gmail gateway backed by an OAuth2 refresh token for the JDDM mailbox.
 * `google` is the googleapis module (already a functions dependency).
 */
function createGmailGateway({ google, clientId, clientSecret, refreshToken }) {
    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Gmail OAuth is not configured (client id, secret, and refresh token are required).');
    }
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    let doneLabelIdCache = null;

    async function resolveDoneLabelId() {
        if (doneLabelIdCache) return doneLabelIdCache;
        const list = await gmail.users.labels.list({ userId: 'me' });
        const labels = (list.data && list.data.labels) || [];
        const found = labels.find(label => String(label.name || '') === 'JDDM/Done');
        if (found) { doneLabelIdCache = found.id; return doneLabelIdCache; }
        const created = await gmail.users.labels.create({
            userId: 'me',
            requestBody: { name: 'JDDM/Done', labelListVisibility: 'labelShow', messageListVisibility: 'show' }
        });
        doneLabelIdCache = created.data.id;
        return doneLabelIdCache;
    }

    return {
        async markSpam(messageId) {
            await gmail.users.messages.modify({
                userId: 'me', id: messageId,
                requestBody: { addLabelIds: ['SPAM'], removeLabelIds: ['INBOX', 'UNREAD'] }
            });
        },
        async archive(messageId) {
            await gmail.users.messages.modify({
                userId: 'me', id: messageId,
                requestBody: { removeLabelIds: ['INBOX'] }
            });
        },
        async markDone(messageId) {
            const doneLabelId = await resolveDoneLabelId();
            await gmail.users.messages.modify({
                userId: 'me', id: messageId,
                requestBody: { addLabelIds: [doneLabelId], removeLabelIds: ['UNREAD', 'INBOX'] }
            });
        },
        async sendReply({ messageId, threadId, body }) {
            const meta = await gmail.users.messages.get({
                userId: 'me', id: messageId, format: 'metadata',
                metadataHeaders: ['From', 'Reply-To', 'Subject', 'Message-ID', 'References']
            });
            const headers = (meta.data && meta.data.payload && meta.data.payload.headers) || [];
            const replyTo = getHeader(headers, 'Reply-To') || getHeader(headers, 'From');
            const raw = buildReplyRaw({
                toAddress: replyTo,
                subject: getHeader(headers, 'Subject'),
                inReplyTo: getHeader(headers, 'Message-ID'),
                references: getHeader(headers, 'References'),
                body
            });
            const resolvedThreadId = threadId || (meta.data && meta.data.threadId) || undefined;
            await gmail.users.messages.send({
                userId: 'me',
                requestBody: resolvedThreadId ? { raw, threadId: resolvedThreadId } : { raw }
            });
            return { to: replyTo };
        }
    };
}

/**
 * Decide what to do with an interaction. Returns either:
 *   { respond }  — an immediate Discord response (ping, modal, validation error)
 *   { effect }   — a Gmail side effect to run before we can build the response
 * Pure: no I/O happens here.
 */
function planInteraction(interaction) {
    const type = interaction && interaction.type;

    if (type === INTERACTION_TYPE.PING) {
        return { respond: { type: RESPONSE_TYPE.PONG } };
    }

    if (type === INTERACTION_TYPE.MESSAGE_COMPONENT) {
        const target = parseCustomId(interaction.data && interaction.data.custom_id);
        if (!target || KNOWN_ACTIONS.indexOf(target.action) < 0) {
            return { respond: ephemeralMessage('This button is no longer recognized.') };
        }
        if (!target.messageId) {
            return { respond: ephemeralMessage('This email post is missing its Gmail reference, so the action cannot run.') };
        }
        if (target.action === 'reply') {
            return { respond: buildReplyModal(target) };
        }
        return { effect: { kind: target.action, messageId: target.messageId, threadId: target.threadId, actor: actorName(interaction) } };
    }

    if (type === INTERACTION_TYPE.MODAL_SUBMIT) {
        const target = parseCustomId(interaction.data && interaction.data.custom_id);
        if (!target || target.action !== 'reply-submit' || !target.messageId) {
            return { respond: ephemeralMessage('This reply form has expired. Reopen the email and try again.') };
        }
        const body = readModalValue(interaction, REPLY_INPUT_ID);
        if (!body) {
            return { respond: ephemeralMessage('The reply was empty, so nothing was sent.') };
        }
        return { effect: { kind: 'reply', messageId: target.messageId, threadId: target.threadId, body, actor: actorName(interaction) } };
    }

    return { respond: ephemeralMessage('Unsupported interaction.') };
}

function actorName(interaction) {
    const member = interaction && interaction.member;
    const user = (member && member.user) || (interaction && interaction.user) || {};
    return String(user.global_name || user.username || 'a teammate');
}

function readModalValue(interaction, inputId) {
    const rows = (interaction && interaction.data && interaction.data.components) || [];
    for (let i = 0; i < rows.length; i++) {
        const fields = (rows[i] && rows[i].components) || [];
        for (let j = 0; j < fields.length; j++) {
            if (fields[j] && fields[j].custom_id === inputId) return String(fields[j].value || '').trim();
        }
    }
    return '';
}

/** Human-readable status line appended to the original post after an action. */
function actionStatusLine(kind, actor, extra) {
    const who = actor || 'a teammate';
    if (kind === 'spam') return `🚫 Marked as spam in Gmail by ${who}.`;
    if (kind === 'archive') return `🗂️ Archived in Gmail by ${who}.`;
    if (kind === 'done') return `✅ Marked done by ${who}.`;
    if (kind === 'reply') return `✉️ Replied by ${who}${extra && extra.to ? ` → ${extra.to}` : ''}.`;
    return `Updated by ${who}.`;
}

/** Run the Gmail side effect for a planned interaction. Returns a result object. */
async function runEffect(effect, gmail) {
    if (effect.kind === 'spam') { await gmail.markSpam(effect.messageId); return {}; }
    if (effect.kind === 'archive') { await gmail.archive(effect.messageId); return {}; }
    if (effect.kind === 'done') { await gmail.markDone(effect.messageId); return {}; }
    if (effect.kind === 'reply') {
        return await gmail.sendReply({ messageId: effect.messageId, threadId: effect.threadId, body: effect.body });
    }
    throw new Error('Unknown action: ' + effect.kind);
}

/**
 * Success response: edit the originating post in place. Spam/Done are terminal
 * (buttons removed); Archive/Reply keep the buttons for further action.
 */
function buildEffectResponse(effect, result) {
    const terminal = effect.kind === 'spam' || effect.kind === 'done';
    return {
        type: RESPONSE_TYPE.UPDATE_MESSAGE,
        data: {
            content: actionStatusLine(effect.kind, effect.actor, result),
            components: terminal ? [] : [buildEmailActionRow(effect.messageId, effect.threadId)],
            allowed_mentions: { parse: [] }
        }
    };
}

/** Failure response: an ephemeral note to the clicker; the post is left as-is. */
function buildEffectErrorResponse(effect, error) {
    const detail = String(error && error.message ? error.message : error).slice(0, 500);
    return ephemeralMessage(`⚠️ The ${effect.kind} action failed: ${detail}`);
}

/**
 * Build the Express-style HTTPS handler. `deps`:
 *   - getConfig(): { publicKey }
 *   - buildGmailGateway(): gmail gateway (created lazily, only when an effect runs)
 *   - onError(err): optional logger
 *
 * The Gmail action runs BEFORE the HTTP response, and the response itself edits
 * the originating post (UPDATE_MESSAGE). This avoids Cloud Functions' post-response
 * CPU throttling, so a click never silently no-ops: the action either completes
 * and the post updates, or (on a rare cold-start >3s) the action still completed
 * and only Discord's visual ack is missed.
 */
function createInteractionsHandler(deps) {
    return async function handleDiscordInteraction(req, res) {
        const publicKey = deps.getConfig().publicKey;
        const signature = req.get ? req.get('X-Signature-Ed25519') : (req.headers && req.headers['x-signature-ed25519']);
        const timestamp = req.get ? req.get('X-Signature-Timestamp') : (req.headers && req.headers['x-signature-timestamp']);
        const rawBody = req.rawBody != null ? req.rawBody : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));

        if (!verifyDiscordSignature({ publicKey, signature, timestamp, rawBody })) {
            return res.status(401).send('invalid request signature');
        }

        let interaction;
        try {
            interaction = typeof req.body === 'object' && req.body ? req.body : JSON.parse(String(rawBody));
        } catch (error) {
            return res.status(400).send('invalid interaction payload');
        }

        const plan = planInteraction(interaction);
        if (plan.respond) {
            return res.status(200).json(plan.respond);
        }

        let gmail;
        try {
            gmail = deps.buildGmailGateway();
        } catch (error) {
            if (deps.onError) deps.onError(error);
            return res.status(200).json(buildEffectErrorResponse(plan.effect, error));
        }

        try {
            const result = await runEffect(plan.effect, gmail);
            return res.status(200).json(buildEffectResponse(plan.effect, result));
        } catch (error) {
            if (deps.onError) deps.onError(error);
            return res.status(200).json(buildEffectErrorResponse(plan.effect, error));
        }
    };
}

module.exports = {
    ED25519_SPKI_PREFIX,
    INTERACTION_TYPE,
    RESPONSE_TYPE,
    EPHEMERAL_FLAG,
    REPLY_INPUT_ID,
    KNOWN_ACTIONS,
    verifyDiscordSignature,
    buildCustomId,
    parseCustomId,
    buildEmailActionRow,
    buildReplyModal,
    buildReplyRaw,
    getHeader,
    createGmailGateway,
    planInteraction,
    runEffect,
    buildEffectResponse,
    buildEffectErrorResponse,
    actionStatusLine,
    createInteractionsHandler
};
