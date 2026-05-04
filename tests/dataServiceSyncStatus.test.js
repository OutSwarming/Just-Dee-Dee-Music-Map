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

function parseCsvRows(csv) {
    const lines = String(csv || '').trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map((header) => header.trim());
    return lines.slice(1).map((line) => {
        const values = line.split(',');
        return headers.reduce((row, header, index) => {
            row[header] = values[index] === undefined ? '' : values[index].trim();
            return row;
        }, {});
    });
}

function loadDataService({
    storageSeed = {},
    spreadsheetUrl = '',
    venueCsvUrl = '',
    fetchImpl,
    parseImpl
} = {}) {
    let publishedPoints = [];
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
        Promise,
        JSON,
        RegExp,
        AbortController,
        setTimeout() {},
        clearTimeout() {},
        setInterval() {},
        clearInterval() {},
        alert() {},
        fetch: fetchImpl || function () {},
        location: { origin: 'http://localhost:4173' },
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
            parse(csvString, options) {
                if (parseImpl) return parseImpl(csvString, options);
                if (options && typeof options.complete === 'function') {
                    options.complete({ data: parseCsvRows(csvString), errors: [] });
                }
                return undefined;
            }
        }
    };
    context.window = context;
    context.global = context;
    context.window.BARK = {
        services: {},
        config: {},
        normalizeText(value) {
            return String(value || '').toLowerCase();
        },
        getParkCategory(value) {
            return value || 'Other Venue';
        },
        incrementRequestCount() {},
        setAppVersion() {},
        repos: {
            ParkRepo: {
                replaceAll(points) {
                    publishedPoints = points;
                    return { accepted: true };
                }
            }
        }
    };
    context.window.syncState = function () {};
    context.window.JDDM_SPREADSHEET_API_URL = spreadsheetUrl;
    if (venueCsvUrl) context.window.BARK.config.VENUE_CSV_URL = venueCsvUrl;

    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(ROOT, 'modules/dataService.js'), 'utf8'),
        context,
        { filename: 'modules/dataService.js' }
    );

    context.window.BARK.__getPublishedPoints = () => publishedPoints;
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

test('cold start loads packaged venue CSV when spreadsheet polling times out', async () => {
    const calls = [];
    const packagedCsv = [
        'id,venue name,city,state,latitude,longitude,venue type,played',
        'venue-one-cleveland-oh,Venue One,Cleveland,OH,41.4993,-81.6944,Club,no'
    ].join('\n');
    const bark = loadDataService({
        spreadsheetUrl: 'https://script.google.com/macros/s/test/exec',
        venueCsvUrl: 'https://script.google.com/macros/s/test/exec?action=csv&autofill=0',
        fetchImpl: async (url) => {
            calls.push(String(url));
            if (String(url).startsWith('assets/data/jddm-venues.csv')) {
                return {
                    ok: true,
                    url,
                    text: async () => packagedCsv
                };
            }
            const error = new Error('Spreadsheet timed out');
            error.name = 'AbortError';
            throw error;
        }
    });

    const loaded = await bark.loadData();

    assert.equal(loaded, true);
    assert.ok(calls.some((url) => url.startsWith('assets/data/jddm-venues.csv')), 'packaged fallback was fetched');
    assert.ok(calls.some((url) => url.startsWith('https://script.google.com/macros/s/test/exec')), 'spreadsheet poll still ran');
    assert.equal(bark.__getPublishedPoints().length, 1);
    assert.equal(bark.__getPublishedPoints()[0].name, 'Venue One');
    assert.equal(bark.getVenueDataSyncStatus().source, 'Packaged CSV fallback');
});

test('cached venue data avoids packaged fallback while background sheet polling fails', async () => {
    const calls = [];
    const cachedCsv = [
        'id,venue name,city,state,latitude,longitude,venue type,played',
        'cached-venue-akron-oh,Cached Venue,Akron,OH,41.0814,-81.5190,Bar,yes'
    ].join('\n');
    const bark = loadDataService({
        storageSeed: {
            jddmVenueCSV: cachedCsv,
            jddmVenueCSV_time: '1777905600000'
        },
        spreadsheetUrl: 'https://script.google.com/macros/s/test/exec',
        venueCsvUrl: 'https://script.google.com/macros/s/test/exec?action=csv&autofill=0',
        fetchImpl: async (url) => {
            calls.push(String(url));
            const error = new Error('Spreadsheet timed out');
            error.name = 'AbortError';
            throw error;
        }
    });

    const loaded = await bark.loadData();

    assert.equal(loaded, false);
    assert.equal(bark.__getPublishedPoints().length, 1);
    assert.equal(bark.__getPublishedPoints()[0].name, 'Cached Venue');
    assert.equal(calls.some((url) => url.startsWith('assets/data/jddm-venues.csv')), false);
});

test('manual spreadsheet refresh uses autofill endpoint without packaged fallback', async () => {
    const calls = [];
    const refreshedCsv = [
        'id,venue name,city,state,latitude,longitude,venue type,played',
        'fresh-venue-lakewood-oh,Fresh Venue,Lakewood,OH,41.4819,-81.7982,Restaurant,no'
    ].join('\n');
    const bark = loadDataService({
        spreadsheetUrl: 'https://script.google.com/macros/s/test/exec',
        venueCsvUrl: 'https://script.google.com/macros/s/test/exec?action=csv&autofill=0',
        fetchImpl: async (url) => {
            calls.push(String(url));
            return {
                ok: true,
                url,
                text: async () => refreshedCsv
            };
        }
    });

    const loaded = await bark.loadData({ userInitiated: true, autofillLimit: 25 });

    assert.equal(loaded, true);
    assert.ok(calls.some((url) => url.includes('autofill=1')));
    assert.equal(calls.some((url) => url.startsWith('assets/data/jddm-venues.csv')), false);
    assert.equal(bark.__getPublishedPoints().length, 1);
    assert.equal(bark.__getPublishedPoints()[0].name, 'Fresh Venue');
    assert.equal(bark.getVenueDataSyncStatus().source, 'Manual Refresh');
});
