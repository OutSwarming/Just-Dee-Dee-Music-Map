'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const bot = require('../discordEmailInteractions');

// Build a real Ed25519 keypair and expose the raw public key hex the way Discord
// publishes it (last 32 bytes of the SPKI DER export).
function makeKeypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const der = publicKey.export({ type: 'spki', format: 'der' });
    return { privateKey, publicKeyHex: Buffer.from(der.subarray(der.length - 32)).toString('hex') };
}

function sign(privateKey, timestamp, body) {
    const message = Buffer.concat([Buffer.from(String(timestamp)), Buffer.from(body)]);
    return crypto.sign(null, message, privateKey).toString('hex');
}

test('verifyDiscordSignature accepts a genuine signature and rejects tampering', () => {
    const { privateKey, publicKeyHex } = makeKeypair();
    const timestamp = '1700000000';
    const body = JSON.stringify({ type: 1 });
    const signature = sign(privateKey, timestamp, body);

    assert.equal(bot.verifyDiscordSignature({ publicKey: publicKeyHex, signature, timestamp, rawBody: body }), true);
    // Tampered body.
    assert.equal(bot.verifyDiscordSignature({ publicKey: publicKeyHex, signature, timestamp, rawBody: body + ' ' }), false);
    // Tampered timestamp.
    assert.equal(bot.verifyDiscordSignature({ publicKey: publicKeyHex, signature, timestamp: '1700000001', rawBody: body }), false);
    // Wrong key.
    const other = makeKeypair();
    assert.equal(bot.verifyDiscordSignature({ publicKey: other.publicKeyHex, signature, timestamp, rawBody: body }), false);
    // Garbage inputs never throw.
    assert.equal(bot.verifyDiscordSignature({ publicKey: 'nothex', signature, timestamp, rawBody: body }), false);
    assert.equal(bot.verifyDiscordSignature({}), false);
});

test('custom_id round-trips action + gmail references', () => {
    const id = bot.buildCustomId('spam', 'msg-abc', 'thr-xyz');
    assert.equal(id, 'jddm:spam:msg-abc:thr-xyz');
    assert.deepEqual(bot.parseCustomId(id), { action: 'spam', messageId: 'msg-abc', threadId: 'thr-xyz' });
    assert.equal(bot.parseCustomId('notours:spam:1:2'), null);
    assert.equal(bot.buildCustomId('reply', 'm', 't').length <= 100, true);
});

test('buildEmailActionRow yields four buttons with our custom_ids', () => {
    const row = bot.buildEmailActionRow('m1', 't1');
    assert.equal(row.type, 1);
    assert.deepEqual(row.components.map(c => c.custom_id), [
        'jddm:reply:m1:t1', 'jddm:spam:m1:t1', 'jddm:archive:m1:t1', 'jddm:done:m1:t1'
    ]);
});

test('planInteraction handles PING', () => {
    assert.deepEqual(bot.planInteraction({ type: bot.INTERACTION_TYPE.PING }).respond, { type: bot.RESPONSE_TYPE.PONG });
});

test('planInteraction opens a modal for Reply', () => {
    const plan = bot.planInteraction({
        type: bot.INTERACTION_TYPE.MESSAGE_COMPONENT,
        data: { custom_id: 'jddm:reply:m1:t1' }
    });
    assert.equal(plan.respond.type, bot.RESPONSE_TYPE.MODAL);
    assert.equal(plan.respond.data.custom_id, 'jddm:reply-submit:m1:t1');
    assert.equal(plan.respond.data.components[0].components[0].custom_id, bot.REPLY_INPUT_ID);
    assert.equal(plan.effect, undefined);
});

test('planInteraction returns a Gmail effect for Spam/Archive/Done', () => {
    for (const action of ['spam', 'archive', 'done']) {
        const plan = bot.planInteraction({
            type: bot.INTERACTION_TYPE.MESSAGE_COMPONENT,
            data: { custom_id: `jddm:${action}:m9:t9` },
            member: { user: { global_name: 'Carter' } }
        });
        assert.equal(plan.respond, undefined);
        assert.deepEqual(
            { kind: plan.effect.kind, messageId: plan.effect.messageId, actor: plan.effect.actor },
            { kind: action, messageId: 'm9', actor: 'Carter' }
        );
    }
});

test('planInteraction rejects unknown or reference-less buttons', () => {
    const unknown = bot.planInteraction({ type: bot.INTERACTION_TYPE.MESSAGE_COMPONENT, data: { custom_id: 'jddm:bogus:m:t' } });
    assert.equal(unknown.respond.type, bot.RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE);
    assert.equal(unknown.respond.data.flags, bot.EPHEMERAL_FLAG);
    assert.equal(unknown.effect, undefined);

    const noRef = bot.planInteraction({ type: bot.INTERACTION_TYPE.MESSAGE_COMPONENT, data: { custom_id: 'jddm:spam::' } });
    assert.equal(noRef.respond.type, bot.RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE);
    assert.equal(noRef.effect, undefined);
});

test('planInteraction reads the reply modal body into an effect', () => {
    const plan = bot.planInteraction({
        type: bot.INTERACTION_TYPE.MODAL_SUBMIT,
        data: {
            custom_id: 'jddm:reply-submit:m1:t1',
            components: [{ components: [{ custom_id: bot.REPLY_INPUT_ID, value: '  Sounds great, we are in!  ' }] }]
        },
        member: { user: { username: 'deedee' } }
    });
    assert.equal(plan.respond, undefined);
    assert.deepEqual(plan.effect, { kind: 'reply', messageId: 'm1', threadId: 't1', body: 'Sounds great, we are in!', actor: 'deedee' });
});

test('empty reply modal submit is rejected without an effect', () => {
    const plan = bot.planInteraction({
        type: bot.INTERACTION_TYPE.MODAL_SUBMIT,
        data: { custom_id: 'jddm:reply-submit:m1:t1', components: [{ components: [{ custom_id: bot.REPLY_INPUT_ID, value: '   ' }] }] }
    });
    assert.equal(plan.respond.type, bot.RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE);
    assert.equal(plan.effect, undefined);
});

test('buildReplyRaw produces a threaded, Re:-prefixed plain-text reply', () => {
    const raw = bot.buildReplyRaw({
        toAddress: 'Booker <booker@venue.com>',
        subject: 'Booking availability',
        inReplyTo: '<abc@mail.gmail.com>',
        references: '<root@mail.gmail.com>',
        body: 'Yes, September 15 works for us.'
    });
    const mime = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    assert.match(mime, /^To: Booker <booker@venue\.com>/m);
    assert.match(mime, /^Subject: Re: Booking availability/m);
    assert.match(mime, /^In-Reply-To: <abc@mail\.gmail\.com>/m);
    assert.match(mime, /^References: <root@mail\.gmail\.com> <abc@mail\.gmail\.com>/m);
    assert.match(mime, /Yes, September 15 works for us\./);

    // Does not double-prefix an existing Re:.
    const raw2 = bot.buildReplyRaw({ toAddress: 'a@b.com', subject: 'Re: hi', body: 'x' });
    const mime2 = Buffer.from(raw2.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    assert.match(mime2, /^Subject: Re: hi$/m);
});

test('runEffect(spam) marks Gmail spam and buildEffectResponse removes the buttons', async () => {
    const calls = [];
    const gmail = { markSpam: async (id) => calls.push(['markSpam', id]) };
    const result = await bot.runEffect({ kind: 'spam', messageId: 'm5', threadId: 't5', actor: 'Carter' }, gmail);
    assert.deepEqual(calls[0], ['markSpam', 'm5']);
    const response = bot.buildEffectResponse({ kind: 'spam', messageId: 'm5', threadId: 't5', actor: 'Carter' }, result);
    assert.equal(response.type, bot.RESPONSE_TYPE.UPDATE_MESSAGE);
    assert.match(response.data.content, /Marked as spam.*Carter/);
    assert.deepEqual(response.data.components, []);
});

test('runEffect(reply) sends the email and buildEffectResponse keeps the buttons', async () => {
    const calls = [];
    const gmail = { sendReply: async (args) => { calls.push(args); return { to: 'booker@venue.com' }; } };
    const effect = { kind: 'reply', messageId: 'm6', threadId: 't6', body: 'On it!', actor: 'Dee Dee' };
    const result = await bot.runEffect(effect, gmail);
    assert.deepEqual(calls[0], { messageId: 'm6', threadId: 't6', body: 'On it!' });
    const response = bot.buildEffectResponse(effect, result);
    assert.match(response.data.content, /Replied by Dee Dee → booker@venue\.com/);
    assert.equal(response.data.components.length, 1);
    assert.equal(response.data.components[0].components.length, 4);
});

test('buildEffectErrorResponse describes the failed action ephemerally', () => {
    const response = bot.buildEffectErrorResponse({ kind: 'archive' }, new Error('gmail exploded'));
    assert.equal(response.type, bot.RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE);
    assert.equal(response.data.flags, bot.EPHEMERAL_FLAG);
    assert.match(response.data.content, /archive.*failed.*gmail exploded/);
});

// -- Full handler integration (signature verify -> plan -> Gmail -> response) --

function makeRes() {
    return {
        statusCode: null,
        body: null,
        sent: false,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; this.sent = true; return this; },
        send(payload) { this.body = payload; this.sent = true; return this; }
    };
}

function signedReq(privateKey, interaction, { badSignature = false } = {}) {
    const rawBody = Buffer.from(JSON.stringify(interaction));
    const timestamp = '1700000000';
    const message = Buffer.concat([Buffer.from(timestamp), rawBody]);
    let signature = crypto.sign(null, message, privateKey).toString('hex');
    if (badSignature) signature = signature.replace(/^../, signature[0] === 'a' ? 'bb' : 'aa');
    return {
        rawBody,
        body: interaction,
        headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp },
        get(name) { return this.headers[String(name).toLowerCase()]; }
    };
}

test('handler rejects an invalid signature with 401 and no Gmail call', async () => {
    const { privateKey, publicKeyHex } = makeKeypair();
    let built = false;
    const handler = bot.createInteractionsHandler({
        getConfig: () => ({ publicKey: publicKeyHex }),
        buildGmailGateway: () => { built = true; return {}; }
    });
    const res = makeRes();
    await handler(signedReq(privateKey, { type: 1 }, { badSignature: true }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(built, false);
});

test('handler answers a signed PING with PONG', async () => {
    const { privateKey, publicKeyHex } = makeKeypair();
    const handler = bot.createInteractionsHandler({ getConfig: () => ({ publicKey: publicKeyHex }), buildGmailGateway: () => ({}) });
    const res = makeRes();
    await handler(signedReq(privateKey, { type: bot.INTERACTION_TYPE.PING }, {}), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { type: bot.RESPONSE_TYPE.PONG });
});

test('handler runs the Gmail action then edits the post', async () => {
    const { privateKey, publicKeyHex } = makeKeypair();
    const spammed = [];
    const handler = bot.createInteractionsHandler({
        getConfig: () => ({ publicKey: publicKeyHex }),
        buildGmailGateway: () => ({ markSpam: async (id) => spammed.push(id) })
    });
    const res = makeRes();
    const interaction = {
        type: bot.INTERACTION_TYPE.MESSAGE_COMPONENT,
        data: { custom_id: 'jddm:spam:mail-1:thr-1' },
        member: { user: { global_name: 'Carter' } }
    };
    await handler(signedReq(privateKey, interaction, {}), res);
    assert.deepEqual(spammed, ['mail-1']);
    assert.equal(res.body.type, bot.RESPONSE_TYPE.UPDATE_MESSAGE);
    assert.match(res.body.data.content, /Marked as spam/);
});

test('handler reports a Gmail failure ephemerally without throwing', async () => {
    const { privateKey, publicKeyHex } = makeKeypair();
    const errors = [];
    const handler = bot.createInteractionsHandler({
        getConfig: () => ({ publicKey: publicKeyHex }),
        buildGmailGateway: () => ({ archive: async () => { throw new Error('boom'); } }),
        onError: (e) => errors.push(e)
    });
    const res = makeRes();
    await handler(signedReq(privateKey, { type: bot.INTERACTION_TYPE.MESSAGE_COMPONENT, data: { custom_id: 'jddm:archive:m:t' } }, {}), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.flags, bot.EPHEMERAL_FLAG);
    assert.match(res.body.data.content, /archive.*failed.*boom/);
    assert.equal(errors.length, 1);
});

test('createGmailGateway.sendReply fetches headers and sends a threaded message', async () => {
    const sent = [];
    const fakeGoogle = {
        auth: { OAuth2: class { setCredentials() {} } },
        gmail: () => ({
            users: {
                messages: {
                    get: async () => ({
                        data: {
                            threadId: 'thread-77',
                            payload: { headers: [
                                { name: 'From', value: 'Booker <booker@venue.com>' },
                                { name: 'Subject', value: 'Play our winery?' },
                                { name: 'Message-ID', value: '<orig@mail>' }
                            ] }
                        }
                    }),
                    send: async (args) => { sent.push(args); return { data: { id: 'sent-1' } }; }
                }
            }
        })
    };
    const gateway = bot.createGmailGateway({ google: fakeGoogle, clientId: 'c', clientSecret: 's', refreshToken: 'r' });
    const result = await gateway.sendReply({ messageId: 'm', threadId: '', body: 'Yes!' });
    assert.equal(result.to, 'Booker <booker@venue.com>');
    assert.equal(sent[0].requestBody.threadId, 'thread-77');
    const mime = Buffer.from(sent[0].requestBody.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    assert.match(mime, /^To: Booker <booker@venue\.com>/m);
    assert.match(mime, /^Subject: Re: Play our winery\?$/m);
    assert.match(mime, /^In-Reply-To: <orig@mail>/m);
});

test('createGmailGateway requires full OAuth configuration', () => {
    assert.throws(() => bot.createGmailGateway({ google: {}, clientId: '', clientSecret: 's', refreshToken: 'r' }), /Gmail OAuth is not configured/);
});
