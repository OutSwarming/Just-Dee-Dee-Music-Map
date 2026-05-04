const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function createStorage(seed = {}) {
    const store = new Map(Object.entries(seed));
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        }
    };
}

function loadDataService({ storageSeed = {}, spreadsheetUrl = '' } = {}) {
    const context = {
        console,
        Date,
        Map,
        Math,
        Number,
        String,
        Boolean,
        Object,
        Array,
        JSON,
        RegExp,
        setTimeout() {},
        clearTimeout() {},
        setInterval() {},
        clearInterval() {},
        alert() {},
        fetch() {},
        localStorage: createStorage(storageSeed),
        navigator: { onLine: true },
        document: {
            hidden: false,
            getElementById() {
                return null;
            },
            createElement() {
                return {
                    setAttribute() {},
                    style: {},
                    dataset: {}
                };
            },
            body: {
                appendChild() {}
            },
            addEventListener() {}
        },
        Papa: {
            parse() {}
        }
    };
    context.window = context;
    context.global = context;
    context.window.BARK = {
        services: {},
        repos: {},
        config: {},
        getParkCategory(value) {
            return value || 'Other Venue';
        },
        incrementRequestCount() {},
        setAppVersion() {}
    };
    context.window.JDDM_SPREADSHEET_API_URL = spreadsheetUrl;

    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(ROOT, 'modules/dataService.js'), 'utf8'),
        context,
        { filename: 'modules/dataService.js' }
    );

    return context.window.BARK;
}

test('data service exposes cached venue data sync status', () => {
    const bark = loadDataService({
        storageSeed: {
            jddmVenueCSV: 'id,name\nvenue-1,Venue One\n',
            jddmVenueCSV_time: '1777905600000'
        },
        spreadsheetUrl: 'https://script.google.com/macros/s/test/exec'
    });

    const status = bark.getVenueDataSyncStatus();

    assert.equal(bark.VENUE_DATA_SYNC_EVENT, 'jddm:venue-data-sync');
    assert.equal(status.hasCachedData, true);
    assert.equal(status.cacheTime, 1777905600000);
    assert.equal(status.source, 'Google Sheet');
});

test('data service reports missing cached venue data safely', () => {
    const bark = loadDataService();
    const status = bark.getVenueDataSyncStatus();

    assert.equal(status.hasCachedData, false);
    assert.equal(status.cacheTime, null);
    assert.equal(status.source, 'Local CSV');
});
