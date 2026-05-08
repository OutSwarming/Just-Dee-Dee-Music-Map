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
        schemaVersion: '2026-05-08-simplified-crm-statuses',
        generatedColumns: [
            { header: 'Place Name' },
            { header: 'Address' },
            { header: 'City' },
            { header: 'Zip' },
            { header: 'State' },
            { header: 'Place ID' },
            { header: 'Longitude' },
            { header: 'Latitude' },
            { header: 'Status' },
            { header: 'Contact Name' },
            { header: 'Email/Contact' },
            { header: 'Phone Number' },
            { header: 'Past Gigs' },
            { header: 'Future Gigs' },
            { header: 'Past Gig Count' },
            { header: 'Future Gig Count' },
            { header: 'Total Gig Count' }
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
    assert.match(summary.detail, /clean storage bridge/i);
});

test('booking dashboard warns when Apps Script is still on an old schema version', () => {
    const dashboard = loadBookingDashboard();
    const summary = dashboard.getBridgeHealthSummary(
        { configured: true },
        {
            checking: false,
            result: safeHealth({ schemaVersion: '2026-05-04-safe-booking-columns' }),
            error: null
        }
    );

    assert.equal(summary.tone, 'warning');
    assert.equal(summary.label, 'Apps Script redeploy needed');
    assert.match(summary.detail, /Deploy the clean storage bridge/i);
});

test('booking dashboard identifies missing CRM headers from bridge health', () => {
    const dashboard = loadBookingDashboard();
    const missing = dashboard.getMissingBookingHeaders(safeHealth({
        generatedColumns: [
            { header: 'Longitude' },
            { header: 'Latitude' },
            { header: 'Place ID' },
            { header: 'Status' }
        ]
    }));

    assert.deepEqual(plain(missing), [
        'Place Name',
        'Address',
        'City',
        'Zip',
        'State',
        'Contact Name',
        'Email/Contact',
        'Phone Number',
        'Past Gigs',
        'Future Gigs',
        'Past Gig Count',
        'Future Gig Count',
        'Total Gig Count'
    ]);
});

test('booking dashboard summarizes venue data freshness states', () => {
    const dashboard = loadBookingDashboard();

    assert.equal(dashboard.getDataFreshnessSummary({
        hasCachedData: false,
        cacheTime: null,
        source: 'Local CSV'
    }).tone, 'warning');

    const ready = dashboard.getDataFreshnessSummary({
        hasCachedData: true,
        cacheTime: 1777905600000,
        source: 'Google Sheet'
    });
    assert.equal(ready.tone, 'success');
    assert.match(ready.label, /Venue data loaded/i);
    assert.match(ready.detail, /Google Sheet/i);

    const checking = dashboard.getDataFreshnessSummary({}, { checking: true });
    assert.equal(checking.actionDisabled, true);
    assert.equal(checking.label, 'Refreshing venue data');
});

test('booking dashboard orders CRM state summary by planning priority', () => {
    const dashboard = loadBookingDashboard();
    const summary = dashboard.getStateSummaryItems({
        statusGroups: {
            'Booked': [{ id: 'booked-1' }, { id: 'booked-2' }],
            'Needs Review': [{ id: 'review-1' }],
            'Told No / Closed / No Music': [{ id: 'closed-1' }]
        }
    });

    assert.equal(summary.length, 12);
    assert.deepEqual(Array.from(summary.slice(0, 4), item => item.label), [
        'Response!',
        'Follow Up',
        'Needs Review',
        'Booked'
    ]);
    assert.equal(summary.find(item => item.status === 'Booked').count, 2);
    assert.equal(summary.find(item => item.status === 'Told No / Closed / No Music').tone, 'closed');
    assert.equal(dashboard.getDefaultStatusState({ statusGroups: { 'Needs Review': [{ id: 'review-1' }] } }), 'Needs Review');
});
