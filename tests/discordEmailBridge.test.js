const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../google-apps-script/jddm-discord-email-bridge/Code.gs'),
    'utf8'
);

function fakeLabel(name) {
    return { getName: () => name };
}

function loadBridge(options = {}) {
    const properties = new Map(Object.entries(options.properties || {}));
    const labels = new Map();
    const requests = [];
    const threads = options.threads || [];
    const responseCodes = [...(options.responseCodes || [200])];
    const scriptProperties = {
        getProperty(key) { return properties.get(key) || null; },
        setProperty(key, value) { properties.set(key, String(value)); return this; },
        deleteProperty(key) { properties.delete(key); return this; }
    };
    const context = {
        console,
        Date,
        Math,
        Number,
        String,
        Boolean,
        Object,
        Array,
        JSON,
        RegExp,
        isFinite,
        PropertiesService: { getScriptProperties: () => scriptProperties },
        Session: {
            getActiveUser: () => ({ getEmail: () => options.activeEmail || 'justdeedeemusic@gmail.com' })
        },
        GmailApp: {
            search: () => threads,
            getInboxThreads: () => [],
            getUserLabelByName: name => labels.get(name) || null,
            createLabel(name) {
                const label = fakeLabel(name);
                labels.set(name, label);
                return label;
            }
        },
        UrlFetchApp: {
            fetch(url, requestOptions) {
                requests.push({
                    url,
                    options: requestOptions,
                    payload: requestOptions.payload ? JSON.parse(requestOptions.payload) : null
                });
                const code = responseCodes.length ? responseCodes.shift() : 200;
                return {
                    getResponseCode: () => code,
                    getContentText: () => code >= 300 ? 'test failure' : (options.fetchBody || '{"ok":true}')
                };
            }
        },
        Utilities: {
            formatDate(date) {
                return date.toISOString().slice(0, 7).replace('-', '_');
            }
        },
        ScriptApp: {
            getProjectTriggers: () => [],
            deleteTrigger() {},
            newTrigger: () => ({
                timeBased() { return this; },
                everyMinutes() { return this; },
                create() { return this; }
            })
        }
    };
    vm.createContext(context);
    vm.runInContext(SOURCE, context, { filename: 'Code.gs' });
    return { context, properties, labels, requests };
}

function makeThread(messages, options = {}) {
    const addedLabels = [];
    const removedLabels = [];
    return {
        addedLabels,
        removedLabels,
        getId: () => options.id || 'thread-123',
        getMessages: () => messages,
        getLabels: () => (options.labels || []).map(fakeLabel),
        isImportant: () => Boolean(options.important),
        isInSpam: () => Boolean(options.spam),
        addLabel(label) { addedLabels.push(label.getName()); },
        removeLabel(label) { removedLabels.push(label.getName()); }
    };
}

function makeMessage(overrides = {}) {
    const date = overrides.date || new Date();
    return {
        getId: () => overrides.id || 'message-123',
        getDate: () => date,
        getFrom: () => overrides.from || 'Venue Booker <booker@example.com>',
        getTo: () => overrides.to || 'justdeedeemusic@gmail.com',
        getCc: () => overrides.cc || '',
        getSubject: () => overrides.subject || 'Are you available for a live music booking?',
        getPlainBody: () => overrides.body || 'Can you play our venue on September 15? Please let me know.',
        isStarred: () => Boolean(overrides.starred)
    };
}

const TAGS = {
    important: '111111111111111111',
    booking: '222222222222222222',
    'action-needed': '333333333333333333',
    receipt: '444444444444444444',
    newsletter: '555555555555555555',
    spam: '666666666666666666',
    'google-voice': '777777777777777777',
    general: '888888888888888888'
};

function configuredProperties() {
    return {
        DISCORD_EMAIL_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/token',
        DISCORD_EMAIL_TAGS_JSON: JSON.stringify(TAGS),
        DISCORD_EMAIL_GMAIL_QUERY: 'in:anywhere newer_than:30d -in:trash',
        DISCORD_EMAIL_MAX_THREADS: '50'
    };
}

test('classifies booking email as booking and action needed', () => {
    const { context } = loadBridge();
    const result = context.classifyMessage_({
        subject: 'September booking availability',
        from: 'venue@example.com',
        body: 'Can you play live music at our venue? Please confirm.',
        labelNames: [],
        important: false,
        starred: false,
        spam: false
    });
    assert.deepEqual([...result.tags], ['booking', 'action-needed']);
});

test('classifies Google Voice notifications into the shared action queue', () => {
    const { context } = loadBridge();
    const result = context.classifyMessage_({
        subject: 'New text message from +1 330-555-0100',
        from: 'Google Voice <voice-noreply@google.com>',
        body: 'Are you available to play our winery?',
        labelNames: [],
        important: false,
        starred: false,
        spam: false
    });
    assert.ok(result.tags.includes('google-voice'));
    assert.ok(result.tags.includes('booking'));
    assert.ok(result.tags.includes('action-needed'));
});

test('keeps spam out of important and action-needed tags', () => {
    const { context } = loadBridge();
    const result = context.classifyMessage_({
        subject: 'URGENT guaranteed loan',
        from: 'scammer@example.com',
        body: 'Wire funds for a crypto investment. Can you reply?',
        labelNames: ['SPAM'],
        important: true,
        starred: true,
        spam: true
    });
    assert.deepEqual([...result.tags], ['spam']);
});

test('creates one tagged forum post and does not duplicate it on the next run', () => {
    const message = makeMessage({ id: 'm-100', starred: true });
    const thread = makeThread([message], { id: 't-100', important: true });
    const bridge = loadBridge({ threads: [thread], properties: configuredProperties() });

    const first = bridge.context.syncJddmEmailToDiscord();
    const second = bridge.context.syncJddmEmailToDiscord();

    assert.equal(first.posted, 1);
    assert.equal(first.failed, 0);
    assert.equal(second.posted, 0);
    assert.equal(bridge.requests.length, 1);
    assert.equal(bridge.requests[0].payload.thread_name, 'Venue Booker — Are you available for a live music booking?');
    assert.deepEqual(
        [...bridge.requests[0].payload.applied_tags],
        [TAGS.important, TAGS.booking, TAGS['action-needed']]
    );
    assert.deepEqual(bridge.requests[0].payload.allowed_mentions, { parse: [] });
    assert.ok(thread.addedLabels.includes('JDDM/Discord Posted'));
});

test('retries a Discord failure because the message is not marked processed', () => {
    const message = makeMessage({ id: 'm-retry' });
    const thread = makeThread([message], { id: 't-retry' });
    const bridge = loadBridge({
        threads: [thread],
        properties: configuredProperties(),
        responseCodes: [500, 200]
    });

    const first = bridge.context.syncJddmEmailToDiscord();
    const second = bridge.context.syncJddmEmailToDiscord();

    assert.equal(first.failed, 1);
    assert.equal(second.posted, 1);
    assert.equal(bridge.requests.length, 2);
    assert.ok(thread.addedLabels.includes('JDDM/Discord Error'));
});

test('refuses to run from Carter personal Gmail', () => {
    const bridge = loadBridge({
        activeEmail: 'cswarm34@gmail.com',
        properties: configuredProperties()
    });
    assert.throws(
        () => bridge.context.syncJddmEmailToDiscord(),
        /Wrong Gmail account.*justdeedeemusic@gmail\.com.*cswarm34@gmail\.com/
    );
    assert.equal(bridge.requests.length, 0);
});

test('rejects malformed webhook and incomplete tag configuration', () => {
    const { context } = loadBridge();
    assert.throws(() => context.configureDiscordEmailBridge('https://example.com/hook', TAGS), /valid Discord webhook/);
    assert.throws(
        () => context.configureDiscordEmailBridge('https://discord.com/api/webhooks/123/token', { important: TAGS.important }),
        /Tag IDs are required/
    );
});

const BOT_TOKEN = 'a'.repeat(59);
const CHANNEL_ID = '999999999999999999';

function botConfiguredProperties() {
    return {
        DISCORD_EMAIL_BOT_TOKEN: BOT_TOKEN,
        DISCORD_EMAIL_CHANNEL_ID: CHANNEL_ID,
        DISCORD_EMAIL_TAGS_JSON: JSON.stringify(TAGS),
        DISCORD_EMAIL_GMAIL_QUERY: 'in:anywhere newer_than:30d -in:trash',
        DISCORD_EMAIL_MAX_THREADS: '50'
    };
}

test('configureDiscordEmailBotBridge validates the bot token, channel, and tags', () => {
    const { context } = loadBridge();
    assert.throws(() => context.configureDiscordEmailBotBridge('short', CHANNEL_ID, TAGS), /valid Discord bot token/);
    assert.throws(() => context.configureDiscordEmailBotBridge(BOT_TOKEN, 'nope', TAGS), /valid Discord forum channel/);
    assert.throws(() => context.configureDiscordEmailBotBridge(BOT_TOKEN, CHANNEL_ID, { important: TAGS.important }), /missing required tags/);
    const health = context.configureDiscordEmailBotBridge(BOT_TOKEN, CHANNEL_ID, TAGS);
    assert.equal(health.botConfigured, true);
    assert.equal(health.actionButtons, true);
    assert.equal(health.channelId, CHANNEL_ID);
});

test('configureDiscordEmailBotBridge auto-discovers tag IDs from the forum', () => {
    const availableTags = [
        { id: '111111111111111111', name: 'Important' },
        { id: '222222222222222222', name: 'Booking' },
        { id: '333333333333333333', name: 'Action Needed' },
        { id: '666666666666666666', name: 'Spam' },
        { id: '777777777777777777', name: 'Google Voice' },
        { id: '444444444444444444', name: 'Receipt' }
    ];
    const bridge = loadBridge({ fetchBody: JSON.stringify({ available_tags: availableTags }) });
    const health = bridge.context.configureDiscordEmailBotBridge(BOT_TOKEN, CHANNEL_ID);

    assert.equal(health.botConfigured, true);
    assert.match(bridge.requests[0].url, /\/channels\/999999999999999999$/);
    assert.equal(bridge.requests[0].options.method, 'get');
    assert.equal(bridge.requests[0].options.headers['X-JDDM-Bot-Authorization'], 'Bot ' + BOT_TOKEN);
    const stored = JSON.parse(bridge.properties.get('DISCORD_EMAIL_TAGS_JSON'));
    assert.equal(stored.important, '111111111111111111');
    assert.equal(stored['action-needed'], '333333333333333333');
    assert.equal(stored['google-voice'], '777777777777777777');
});

test('configureDiscordEmailBotBridge fails clearly when the forum lacks required tags', () => {
    const bridge = loadBridge({ fetchBody: JSON.stringify({ available_tags: [{ id: '111111111111111111', name: 'Important' }] }) });
    assert.throws(
        () => bridge.context.configureDiscordEmailBotBridge(BOT_TOKEN, CHANNEL_ID),
        /missing required tags/
    );
});

test('bot mode posts a forum thread with the four action buttons', () => {
    const message = makeMessage({ id: 'm-bot', starred: true });
    const thread = makeThread([message], { id: 't-bot', important: true });
    const bridge = loadBridge({ threads: [thread], properties: botConfiguredProperties() });

    const result = bridge.context.syncJddmEmailToDiscord();

    assert.equal(result.posted, 1);
    assert.equal(bridge.requests.length, 1);
    const request = bridge.requests[0];
    assert.match(request.url, /\/channels\/999999999999999999\/threads$/);
    assert.equal(request.options.method, 'post');
    assert.equal(request.options.headers['X-JDDM-Bot-Authorization'], 'Bot ' + BOT_TOKEN);
    assert.equal(request.options.headers.Authorization, undefined);
    assert.equal(request.payload.name, 'Venue Booker — Are you available for a live music booking?');
    assert.deepEqual(request.payload.applied_tags, [TAGS.important, TAGS.booking, TAGS['action-needed']]);
    const row = request.payload.message.components[0];
    assert.equal(row.type, 1);
    assert.deepEqual(row.components.map(c => c.custom_id), [
        'jddm:reply:m-bot:t-bot', 'jddm:spam:m-bot:t-bot', 'jddm:archive:m-bot:t-bot', 'jddm:done:m-bot:t-bot'
    ]);
    assert.deepEqual(request.payload.message.allowed_mentions, { parse: [] });
    assert.ok(thread.addedLabels.includes('JDDM/Discord Posted'));
});

test('bot mode takes priority when both bot and webhook are configured', () => {
    const message = makeMessage({ id: 'm-both' });
    const thread = makeThread([message], { id: 't-both' });
    const properties = Object.assign(botConfiguredProperties(), { DISCORD_EMAIL_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/t' });
    const bridge = loadBridge({ threads: [thread], properties });

    bridge.context.syncJddmEmailToDiscord();

    assert.match(bridge.requests[0].url, /\/channels\/.*\/threads$/);
    assert.ok(bridge.requests[0].payload.message.components);
});

 test('only recent messages in a matching conversation are forwarded once', () => {
 const old = makeMessage({ id: 'old', date: new Date(Date.now() - 90 * 86400000) });
 const recent = makeMessage({ id: 'recent' });
 const bridge = loadBridge({ threads: [makeThread([old, recent])], properties: botConfiguredProperties() });
 assert.equal(bridge.context.syncJddmEmailToDiscord().posted, 1);
 assert.equal(bridge.context.syncJddmEmailToDiscord().posted, 0);
 assert.equal(bridge.requests.length, 1);
 });

test('a large backlog is batched and drains without duplicate posts', () => {
 const messages = Array.from({length: 25}, (_, i) => makeMessage({id: 'batch-'+i}));
 const bridge = loadBridge({threads: [makeThread(messages)], properties: botConfiguredProperties()});
 const first = bridge.context.syncJddmEmailToDiscord();
 assert.equal(first.posted,20); assert.equal(first.deferred,5);
 assert.equal(bridge.context.syncJddmEmailToDiscord().posted,5);
 assert.equal(bridge.context.syncJddmEmailToDiscord().posted,0);
});

test('Discord rate limiting leaves the queue for the next poll and stops requests', () => {
 const bridge = loadBridge({threads:[makeThread([makeMessage({id:'a'}),makeMessage({id:'b'})])],properties:botConfiguredProperties(),responseCodes:[429]});
 const result=bridge.context.syncJddmEmailToDiscord();
 assert.equal(result.rateLimited,true);assert.equal(result.failed,0);assert.equal(result.deferred,2);assert.equal(bridge.requests.length,1);
 assert.equal(bridge.context.syncJddmEmailToDiscord().posted,2);
});
