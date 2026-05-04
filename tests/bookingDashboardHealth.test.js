const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadBookingDashboard() {
    const context = {
        console,
        Date,
        Intl,
        Map,
        Set,
        Promise,
        Math,
        Number,
        String,
        Boolean,
        Object,
        Array,
        JSON,
        RegExp,
        document: {
            getElementById() {
                return null;
            },
            querySelector() {
                return null;
            },
            addEventListener() {}
        },
        setTimeout() {},
        clearTimeout() {}
    };
    context.window = context;
    context.global = context;
    context.CSS = {
        escape(value) {
            return String(value);
        }
    };

    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(ROOT, 'modules/bookingDashboard.js'), 'utf8'),
        context,
        { filename: 'modules/bookingDashboard.js' }
    );

    return context.window.BARK.bookingDashboard;
}

function safeHealth(overrides = {}) {
    return {
        ok: true,
        sheetName: 'Venues',
        schemaVersion: '2026-05-04-safe-booking-columns',
        generatedColumns: [
            { header: 'Longitude' },
            { header: 'Latitude' },
            { header: 'Site ID' },
            { header: 'contactStatus' },
            { header: 'draftStatus' },
            { header: 'lastContactedDate' },
            { header: 'nextFollowUpDate' },
            { header: 'doNotContact' }
        ],
        ...overrides
    };
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

test('booking dashboard reports safe sheet bridge as ready', () => {
    const dashboard = loadBookingDashboard();
    const summary = dashboard.getBridgeHealthSummary(
        { configured: true },
        { checking: false, checkedAt: new Date(2026, 4, 4), result: safeHealth(), error: null }
    );

    assert.equal(summary.tone, 'success');
    assert.equal(summary.label, 'Sheet bridge ready');
    assert.match(summary.detail, /safe booking-column bridge/i);
});

test('booking dashboard warns when Apps Script is still on an old schema version', () => {
    const dashboard = loadBookingDashboard();
    const summary = dashboard.getBridgeHealthSummary(
        { configured: true },
        {
            checking: false,
            result: safeHealth({ schemaVersion: '2026-05-04-booking-status-fields' }),
            error: null
        }
    );

    assert.equal(summary.tone, 'warning');
    assert.equal(summary.label, 'Apps Script redeploy needed');
    assert.match(summary.detail, /Deploy the safe booking-column script/i);
});

test('booking dashboard identifies missing CRM headers from bridge health', () => {
    const dashboard = loadBookingDashboard();
    const missing = dashboard.getMissingBookingHeaders(safeHealth({
        generatedColumns: [
            { header: 'Longitude' },
            { header: 'Latitude' },
            { header: 'Site ID' },
            { header: 'contactStatus' }
        ]
    }));

    assert.deepEqual(plain(missing), [
        'draftStatus',
        'lastContactedDate',
        'nextFollowUpDate',
        'doNotContact'
    ]);
});
