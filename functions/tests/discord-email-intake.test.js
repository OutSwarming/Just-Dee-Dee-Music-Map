'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordEmailIntakeHandler, BOT_ID, CHANNEL_ID, USER_AGENT } = require('../discordEmailIntake');
const credential = 'Bot ' + Buffer.from(BOT_ID).toString('base64url') + '.test.signature';
const channelPath = '/channels/' + CHANNEL_ID;
function req(method = 'GET', path = channelPath, body, auth = credential) {
    return { method, path, body, get: name => name === 'x-jddm-bot-authorization' ? auth : undefined };
}
function res() {
    return { headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(s) { this.code = s; return this; },
        json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; } };
}
const response = (status, data) => ({ status, headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify(data) });

test('rejects absent/other-bot credentials and all routes outside the JDDM forum without network access', async () => {
    const handler = createDiscordEmailIntakeHandler({ fetchImpl: async () => { throw Error('must not call'); } });
    for (const [request, expected] of [
        [req('GET', channelPath, null, ''), 401],
        [req('GET', channelPath, null, 'Bot b3RoZXI.test.signature'), 401],
        [req('GET', '/channels/other'), 404],
        [req('DELETE', channelPath), 404],
        [req('GET', channelPath + '/../../users/@me'), 404],
        [req('POST', channelPath + '/threads', {}), 400]
    ]) { const output = res(); await handler(request, output); assert.equal(output.code, expected); }
});

test('reads forum metadata with documented bot headers and preserves upstream authentication failures', async () => {
    let count = 0;
    const handler = createDiscordEmailIntakeHandler({ fetchImpl: async (url, options) => {
        count++;
        assert.equal(url, 'https://discord.com/api/v10' + channelPath);
        assert.equal(options.headers['User-Agent'], USER_AGENT);
        assert.equal(options.headers.Authorization, credential);
        assert.equal(options.redirect, 'error');
        return response(401, { message: '401: Unauthorized' });
    } });
    const output = res(); await handler(req(), output);
    assert.equal(output.code, 401); assert.equal(count, 1);
});

test('creates a forum post with email buttons intact and mentions disabled', async () => {
    const buttons = [{ type: 1, components: [{ type: 2, custom_id: 'jddm:reply:m:t' }] }];
    const handler = createDiscordEmailIntakeHandler({ fetchImpl: async (_url, options) => {
        const payload = JSON.parse(options.body);
        assert.deepEqual(payload.message.components, buttons);
        assert.deepEqual(payload.message.allowed_mentions, { parse: [] });
        return response(201, { id: 'post' });
    } });
    const output = res();
    await handler(req('POST', channelPath + '/threads', { name: 'Email', message: { content: 'Hello @everyone', components: buttons, allowed_mentions: { parse: ['everyone'] } } }), output);
    assert.equal(output.code, 201);
});

test('waits for explicit rate limits and then retries, without retrying ambiguous POST failures', async () => {
    let calls = 0; const waits = [];
    const handler = createDiscordEmailIntakeHandler({ sleep: async ms => waits.push(ms), fetchImpl: async () => {
        calls++; return calls === 1 ? response(429, { retry_after: 1.5 }) : response(200, { id: 'post' });
    } });
    const output = res(); await handler(req(), output);
    assert.equal(calls, 2); assert.deepEqual(waits, [1600]); assert.equal(output.code, 200);
    calls = 0;
    const failed = createDiscordEmailIntakeHandler({ fetchImpl: async () => { calls++; throw Error('private transport detail'); } });
    const failure = res(); await failed(req('POST', channelPath + '/threads', { name: 'Email', message: { content: 'test' } }), failure);
    assert.equal(calls, 1); assert.equal(failure.code, 502);
    assert.doesNotMatch(JSON.stringify(failure.body), /private transport detail/);
});
