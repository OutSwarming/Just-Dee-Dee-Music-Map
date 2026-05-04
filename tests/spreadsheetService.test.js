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
