const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function createFakeSheet(initialHeaders) {
    const headers = initialHeaders.slice();
    const writes = [];

    function ensureLength(length) {
        while (headers.length < length) headers.push('');
    }

    const sheet = {
        headers,
        writes,
        getName() {
            return 'Venues';
        },
        getLastColumn() {
            return headers.length;
        },
        getMaxRows() {
            return 100;
        },
        getRange(row, column, numRows = 1, numColumns = 1) {
            return {
                getValues() {
                    ensureLength(column + numColumns - 1);
                    return [headers.slice(column - 1, column + numColumns - 1)];
                },
                setValue(value) {
                    ensureLength(column);
                    headers[column - 1] = value;
                    writes.push({ row, column, value });
                    return this;
                },
                setValues(values) {
                    const nextValues = values[0] || [];
                    ensureLength(column + nextValues.length - 1);
                    nextValues.forEach((value, index) => {
                        headers[column - 1 + index] = value;
                    });
                    writes.push({ row, column, values });
                    return this;
                },
                setNumberFormat() {
                    return this;
                }
            };
        }
    };

    return sheet;
}

function loadBridge(sheet) {
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
        Maps: {},
        ContentService: {
            MimeType: {
                JSON: 'application/json',
                CSV: 'text/csv'
            },
            createTextOutput() {
                return {
                    setMimeType() {
                        return this;
                    }
                };
            }
        },
        SpreadsheetApp: {
            getActiveSpreadsheet() {
                return {
                    getSheets() {
                        return [sheet];
                    },
                    getSheetByName() {
                        return sheet;
                    }
                };
            },
            getActive() {
                return {};
            }
        },
        ScriptApp: {
            getProjectTriggers() {
                return [];
            },
            newTrigger() {
                return {
                    forSpreadsheet() {
                        return this;
                    },
                    onEdit() {
                        return this;
                    },
                    create() {
                        return this;
                    }
                };
            },
            deleteTrigger() {}
        }
    };
    context.global = context;

    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(ROOT, 'google-apps-script/jddm-spreadsheet-bridge/Code.gs'), 'utf8'),
        context,
        { filename: 'google-apps-script/jddm-spreadsheet-bridge/Code.gs' }
    );

    return context;
}

function headerColumns(headers, header) {
    return headers
        .map((value, index) => String(value).trim().toLowerCase() === header.toLowerCase() ? index + 1 : 0)
        .filter(Boolean);
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

const BOOKING_HEADERS = [
    'contactStatus',
    'draftStatus',
    'lastContactedDate',
    'nextFollowUpDate',
    'doNotContact',
    'priority',
    'bestFitScore',
    'websiteBookingEvents',
    'calendarGigEvents',
    'calendarPastGigEvents',
    'calendarFutureGigEvents',
    'calendarLastGigDate',
    'calendarNextGigDate',
    'calendarPastGigCount',
    'calendarFutureGigCount',
    'calendarTotalGigsPlayed',
    'calendarLastSyncedAt'
];

test('booking CRM headers append after occupied spreadsheet columns', () => {
    const headers = Array.from({ length: 25 }, (_, index) => `Existing ${index + 1}`);
    headers[17] = 'Longitude';
    headers[18] = 'Latitude';
    headers[19] = 'Site ID';
    const sheet = createFakeSheet(headers);
    const bridge = loadBridge(sheet);

    const result = bridge.ensureGeneratedColumns_();

    assert.equal(sheet.headers[20], 'Existing 21');
    assert.equal(sheet.headers[21], 'Existing 22');
    assert.equal(sheet.headers[22], 'Existing 23');
    assert.equal(sheet.headers[23], 'Existing 24');
    assert.equal(sheet.headers[24], 'Existing 25');
    assert.deepEqual(sheet.writes.map(write => write.column), [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42]);
    assert.deepEqual(sheet.headers.slice(25, 42), BOOKING_HEADERS);
    assert.equal(result.columns.find(column => column.key === 'contactStatus').column, 26);
    assert.deepEqual(plain(result.changedHeaders), BOOKING_HEADERS);
});

test('existing booking CRM headers are reused instead of duplicated', () => {
    const headers = Array.from({ length: 28 }, (_, index) => `Existing ${index + 1}`);
    headers[17] = 'Longitude';
    headers[18] = 'Latitude';
    headers[19] = 'Site ID';
    headers[21] = 'contactStatus';
    headers[26] = 'nextFollowUpDate';
    const sheet = createFakeSheet(headers);
    const bridge = loadBridge(sheet);

    const result = bridge.ensureGeneratedColumns_();

    assert.deepEqual(headerColumns(sheet.headers, 'contactStatus'), [22]);
    assert.deepEqual(headerColumns(sheet.headers, 'nextFollowUpDate'), [27]);
    assert.deepEqual(sheet.writes.map(write => write.column), [29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43]);
    assert.deepEqual(sheet.writes.map(write => write.value), [
        'draftStatus',
        'lastContactedDate',
        'doNotContact',
        'priority',
        'bestFitScore',
        'websiteBookingEvents',
        'calendarGigEvents',
        'calendarPastGigEvents',
        'calendarFutureGigEvents',
        'calendarLastGigDate',
        'calendarNextGigDate',
        'calendarPastGigCount',
        'calendarFutureGigCount',
        'calendarTotalGigsPlayed',
        'calendarLastSyncedAt'
    ]);
    assert.equal(result.columns.find(column => column.key === 'contactStatus').column, 22);
    assert.equal(result.columns.find(column => column.key === 'nextFollowUpDate').column, 27);
});

test('preferred map columns append safely when their slots are occupied', () => {
    const headers = Array.from({ length: 20 }, (_, index) => `Client Field ${index + 1}`);
    const sheet = createFakeSheet(headers);
    const bridge = loadBridge(sheet);

    const result = bridge.ensureGeneratedColumns_();

    assert.equal(sheet.headers[17], 'Client Field 18');
    assert.equal(sheet.headers[18], 'Client Field 19');
    assert.equal(sheet.headers[19], 'Client Field 20');
    assert.deepEqual(sheet.writes.map(write => write.column), [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40]);
    assert.deepEqual(plain(result.preservedHeaders).map(item => item.header), ['Longitude', 'Latitude', 'Site ID']);
    assert.equal(result.columns.find(column => column.key === 'longitude').column, 21);
    assert.equal(result.columns.find(column => column.key === 'siteId').column, 23);
});
