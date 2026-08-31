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
                requests.push({ url, options: requestOptions, payload: JSON.parse(requestOptions.payload) });
                const code = responseCodes.length ? responseCodes.shift() : 200;
                return {
                    getResponseCode: () => code,
                    getContentText: () => code >= 300 ? 'test failure' : '{"ok":true}'
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
    const date = overrides.date || new Date('2026-08-30T12:00:00.000Z');
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
