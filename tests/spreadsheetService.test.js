const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadSpreadsheetService({ apiUrl = '', editToken = '', fetchImpl = async () => ({ ok: true, text: async () => '{"ok":true}' }) } = {}) {
    const context = {
        console,
        JSON,
        RegExp,
        String,
        Boolean,
        Error,
        setTimeout,
        clearTimeout,
        AbortController,
        fetch: fetchImpl
    };
    context.window = context;
    context.global = context;
    context.JDDM_SPREADSHEET_API_URL = apiUrl;
    context.JDDM_SPREADSHEET_EDIT_TOKEN = editToken;

    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(ROOT, 'services/spreadsheetService.js'), 'utf8'),
        context,
        { filename: 'services/spreadsheetService.js' }
    );

    return context.window.BARK.services.spreadsheet;
}

test('spreadsheet service posts health checks without using schema migration', async () => {
    let requestUrl = '';
    let requestOptions = null;
    const service = loadSpreadsheetService({
        apiUrl: 'https://script.google.com/macros/s/test-deployment/exec',
        editToken: 'test-token',
        fetchImpl: async (url, options) => {
            requestUrl = url;
            requestOptions = options;
            return {
                ok: true,
                text: async () => JSON.stringify({
                    ok: true,
                    schemaVersion: '2026-05-04-safe-booking-columns'
                })
            };
        }
    });

    const result = await service.getHealth();
    const body = JSON.parse(requestOptions.body);

    assert.equal(requestUrl, 'https://script.google.com/macros/s/test-deployment/exec');
    assert.equal(requestOptions.method, 'POST');
    assert.equal(body.action, 'health');
    assert.equal(body.token, 'test-token');
    assert.equal(result.schemaVersion, '2026-05-04-safe-booking-columns');
});

test('spreadsheet service rejects health checks when bridge URL is missing', async () => {
    const service = loadSpreadsheetService();
    await assert.rejects(
        () => service.getHealth(),
        error => error.code === 'SPREADSHEET_BRIDGE_NOT_CONFIGURED'
    );
});

test('spreadsheet service exposes the create venue bridge action', async () => {
    let requestOptions = null;
    const service = loadSpreadsheetService({
        apiUrl: 'https://script.google.com/macros/s/test-deployment/exec',
        fetchImpl: async (_url, options) => {
            requestOptions = options;
            return { ok: true, text: async () => '{"ok":true,"action":"createVenue"}' };
        }
    });

    const result = await service.createVenue({
        rawFields: { 'Place Name': 'New Music Room', City: 'Akron' }
    });
    const body = JSON.parse(requestOptions.body);

    assert.equal(body.action, 'createVenue');
    assert.equal(body.rawFields['Place Name'], 'New Music Room');
    assert.match(body.requestId, /^createVenue-/);
    assert.equal(result.action, 'createVenue');
});

test('spreadsheet write aborts become a clear maybe-completed timeout error', async () => {
    const service = loadSpreadsheetService({
        apiUrl: 'https://script.google.com/macros/s/test-deployment/exec',
        fetchImpl: async () => {
            const error = new Error('This operation was aborted');
            error.name = 'AbortError';
            throw error;
        }
    });

    await assert.rejects(
        () => service.createVenue({ rawFields: { 'Place Name': 'Slow Room' } }),
        error => {
            assert.equal(error.code, 'SPREADSHEET_BRIDGE_TIMEOUT');
            assert.equal(error.action, 'createVenue');
            assert.equal(error.retryable, true);
            assert.match(error.message, /write may still be finishing/i);
            assert.match(error.message, /60 seconds/i);
            return true;
        }
    );
});

test('spreadsheet create preserves a caller request id across retries', async () => {
    const bodies = [];
    const service = loadSpreadsheetService({
        apiUrl: 'https://script.google.com/macros/s/test-deployment/exec',
        fetchImpl: async (_url, options) => {
            bodies.push(JSON.parse(options.body));
            return { ok: true, text: async () => '{"ok":true,"action":"createVenue"}' };
        }
    });

    await service.createVenue({
        requestId: 'stable-create-request',
        rawFields: { 'Place Name': 'Retry Safe Room' }
    });
    await service.createVenue({
        requestId: 'stable-create-request',
        rawFields: { 'Place Name': 'Retry Safe Room' }
    });

    assert.equal(bodies[0].requestId, 'stable-create-request');
    assert.equal(bodies[1].requestId, 'stable-create-request');
});

test('spreadsheet service queues reminder delivery through the shared bridge', async () => {
    let requestOptions = null;
    const service = loadSpreadsheetService({
        apiUrl: 'https://script.google.com/macros/s/test-deployment/exec',
        fetchImpl: async (_url, options) => {
            requestOptions = options;
            return { ok: true, text: async () => '{"ok":true,"action":"queueReminder","status":"pending"}' };
        }
    });

    const result = await service.queueReminder('follow-ups', 'web-request-1');
    const body = JSON.parse(requestOptions.body);

    assert.equal(body.action, 'queueReminder');
    assert.equal(body.reminderId, 'follow-ups');
    assert.equal(body.requestId, 'web-request-1');
    assert.equal(result.status, 'pending');
});
