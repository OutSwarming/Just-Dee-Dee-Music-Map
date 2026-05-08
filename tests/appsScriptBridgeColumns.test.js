const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function createFakeSheet(initialHeaders, initialRows = []) {
    const values = [initialHeaders.slice(), ...initialRows.map(row => row.slice())];
    const writes = [];
    const deletedColumns = [];
    const formatting = [];
    let name = 'Venues';

    function ensureSize(rowCount, columnCount) {
        while (values.length < rowCount) values.push([]);
        values.forEach(row => {
            while (row.length < columnCount) row.push('');
        });
    }

    function range(row, column, numRows = 1, numColumns = 1) {
        ensureSize(row + numRows - 1, column + numColumns - 1);
        return {
            getValues() {
                return values.slice(row - 1, row - 1 + numRows).map(sourceRow => (
                    sourceRow.slice(column - 1, column - 1 + numColumns)
                ));
            },
            setValue(value) {
                values[row - 1][column - 1] = value;
                writes.push({ row, column, value });
                return this;
            },
            setValues(nextValues) {
                nextValues.forEach((nextRow, rowOffset) => {
                    nextRow.forEach((value, columnOffset) => {
                        values[row - 1 + rowOffset][column - 1 + columnOffset] = value;
                    });
                });
                writes.push({ row, column, values: nextValues });
                return this;
            },
            setNumberFormat() {
                formatting.push({ type: 'numberFormat', row, column });
                return this;
            },
            setDataValidation() {
                formatting.push({ type: 'validation', row, column });
                return this;
            },
            setFontWeight() {
                formatting.push({ type: 'fontWeight', row, column });
                return this;
            },
            setBackground() {
                formatting.push({ type: 'background', row, column });
                return this;
            },
            setFontColor() {
                formatting.push({ type: 'fontColor', row, column });
                return this;
            },
            setBackgrounds(backgrounds) {
                formatting.push({ type: 'backgrounds', row, column, backgrounds });
                return this;
            },
            setFontColors(fontColors) {
                formatting.push({ type: 'fontColors', row, column, fontColors });
                return this;
            }
        };
    }

    return {
        values,
        writes,
        deletedColumns,
        formatting,
        getName() {
            return name;
        },
        setName(nextName) {
            name = nextName;
            return this;
        },
        getLastColumn() {
            return values[0].length;
        },
        getLastRow() {
            return values.length;
        },
        getMaxRows() {
            return Math.max(100, values.length);
        },
        getMaxColumns() {
            return values[0].length;
        },
        getRange: range,
        clear() {
            values.splice(0, values.length, ['']);
            return this;
        },
        deleteColumns(startColumn, count) {
            values.forEach(row => row.splice(startColumn - 1, count));
            deletedColumns.push({ startColumn, count });
            return this;
        },
        deleteRows(startRow, count) {
            values.splice(startRow - 1, count);
            return this;
        },
        appendRow(row) {
            values.push(row.slice());
            return this;
        },
        setFrozenRows() {
            return this;
        },
        setColumnWidth() {
            return this;
        }
    };
}

function loadBridge(sheet, options = {}) {
    const sheets = [sheet];
    const calendars = options.calendars || {};
    const spreadsheet = {
        getSheets() {
            return sheets.slice();
        },
        getSheetByName(name) {
            return sheets.find(nextSheet => nextSheet.getName() === name) || null;
        },
        setActiveSheet() {},
        moveActiveSheet() {},
        insertSheet(name, index = sheets.length) {
            const nextSheet = createFakeSheet(['']);
            nextSheet.setName(name);
            sheets.splice(index, 0, nextSheet);
            return nextSheet;
        },
        deleteSheet(targetSheet) {
            const index = sheets.indexOf(targetSheet);
            if (index >= 0) sheets.splice(index, 1);
        }
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
        ContentService: {
            MimeType: {
                JSON: 'application/json',
                CSV: 'text/csv'
            },
            createTextOutput(text) {
                return {
                    text,
                    mimeType: '',
                    setMimeType(mimeType) {
                        this.mimeType = mimeType;
                        return this;
                    }
                };
            }
        },
        SpreadsheetApp: {
            getActiveSpreadsheet() {
                return spreadsheet;
            },
            newDataValidation() {
                return {
                    requireValueInList() {
                        return this;
                    },
                    setAllowInvalid() {
                        return this;
                    },
                    build() {
                        return {};
                    }
                };
            },
            getUi() {
                return {
                    createMenu() {
                        return {
                            addItem() { return this; },
                            addToUi() { return this; }
                        };
                    },
                    alert() {}
                };
            }
        },
        ScriptApp: {
            getProjectTriggers() {
                return [];
            },
            newTrigger() {
                return {
                    timeBased() { return this; },
                    everyMinutes() { return this; },
                    create() { return this; }
                };
            },
            deleteTrigger() {}
        },
        CalendarApp: {
            getCalendarById(calendarId) {
                const events = calendars[calendarId];
                if (!events) return null;
                return {
                    getEvents() {
                        return events.map((event, index) => ({
                            getTitle() {
                                return event.title || '';
                            },
                            getLocation() {
                                return event.location || '';
                            },
                            getStartTime() {
                                return event.startTime;
                            },
                            getId() {
                                return event.id || `event-${index}`;
                            },
                            isAllDayEvent() {
                                return Boolean(event.isAllDay);
                            }
                        }));
                    }
                };
            }
        },
        Utilities: {
            formatDate(date, _timezone, format) {
                if (format === 'yyyyMMdd-HHmmss') return '20260508-000000';
                return date.toISOString().slice(0, 10);
            },
            parseCsv(csv) {
                const rows = [];
                let row = [];
                let field = '';
                let quoted = false;
                for (let index = 0; index < String(csv).length; index += 1) {
                    const char = String(csv)[index];
                    if (quoted) {
                        if (char === '"') {
                            if (String(csv)[index + 1] === '"') {
                                field += '"';
                                index += 1;
                            } else {
                                quoted = false;
                            }
                        } else {
                            field += char;
                        }
                    } else if (char === '"') {
                        quoted = true;
                    } else if (char === ',') {
                        row.push(field);
                        field = '';
                    } else if (char === '\n') {
                        row.push(field);
                        rows.push(row);
                        row = [];
                        field = '';
                    } else if (char !== '\r') {
                        field += char;
                    }
                }
                if (field || row.length) {
                    row.push(field);
                    rows.push(row);
                }
                return rows;
            }
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

function headerIndex(headers, header) {
    return headers.findIndex(value => String(value).trim().toLowerCase() === header.toLowerCase());
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

test('purge keeps accurate scattered contact and gig data in canonical columns', () => {
    const sheet = createFakeSheet(
        [
            'Place',
            'Status',
            'contactStatus',
            'Email/Contact',
            'Phone Number',
            'calendarPastGigEvents',
            'calendarFutureGigEvents',
            'calendarLastGigDate',
            'calendarNextGigDate',
            'Longitude',
            'Latitude',
            'Site ID',
            'Random Duplicate Noise'
        ],
        [[
            'Bait House Brewery, 223 Meigs St, Sandusky, OH 44870',
            'Ignored because contactStatus wins',
            'Booked',
            'booking@bait.example',
            '440-555-1212',
            '2025-01-02; 2025-03-04',
            '2026-06-01',
            '2025-03-04',
            '2026-06-01',
            '-82.707',
            '41.448',
            'bait-house-brewery',
            'duplicate junk'
        ]]
    );
    const bridge = loadBridge(sheet);

    const result = bridge.purgeAndSetup_({ applyFormatting: false });
    const cleanSheet = bridge.getSheet_();
    const headers = cleanSheet.values[0];
    const row = cleanSheet.values[1];

    assert.equal(result.archivedSheetName, null);
    assert.equal(result.replacedSheet, true);
    assert.equal(result.schemaVersion, '2026-05-08-simplified-crm-statuses');
    assert.deepEqual(plain(headers), plain(bridge.JDDM_CANONICAL_HEADERS));
    assert.equal(row[headerIndex(headers, 'Place Name')], 'Bait House Brewery');
    assert.equal(row[headerIndex(headers, 'Address')], '223 Meigs St');
    assert.equal(row[headerIndex(headers, 'City')], 'Sandusky');
    assert.equal(row[headerIndex(headers, 'State')], 'OH');
    assert.equal(row[headerIndex(headers, 'Zip')], '44870');
    assert.equal(row[headerIndex(headers, 'Status')], 'Booked');
    assert.equal(row[headerIndex(headers, 'Email/Contact')], 'booking@bait.example');
    assert.equal(row[headerIndex(headers, 'Phone Number')], '440-555-1212');
    assert.equal(row[headerIndex(headers, 'Past Gigs')], '2025-01-02; 2025-03-04');
    assert.equal(row[headerIndex(headers, 'Future Gigs')], '2026-06-01');
    assert.equal(row[headerIndex(headers, 'Past Gig Count')], 2);
    assert.equal(row[headerIndex(headers, 'Future Gig Count')], 1);
    assert.equal(row[headerIndex(headers, 'Total Gig Count')], 3);
    assert.equal(row[headerIndex(headers, 'Random Duplicate Noise')], undefined);
    assert.equal(headers.length, bridge.JDDM_CANONICAL_HEADERS.length);
    assert.equal(headers.filter(header => header === 'Status').length, 1);
    assert.equal(headerIndex(headers, 'contactStatus'), -1);
    assert.equal(headerIndex(headers, 'CRM Status'), -1);
});

test('purge recalculates gig counts from unique dates inside rich calendar text', () => {
    const sheet = createFakeSheet(
        [
            'Place Name',
            'Status',
            'Past Gigs',
            'Future Gigs',
            'Past Gig Count',
            'Future Gig Count',
            'Total Gig Count'
        ],
        [[
            'Bummin Beaver Brewery',
            'Booked',
            [
                '2025-06-14',
                '2025-06-14 2:00pm ET | COMPLETED | Bummin Beaver Brewery | 11610 E Washington St',
                'Sat May 02 2026 00:00:00 GMT-0400 (Eastern Daylight Time)'
            ].join('; '),
            [
                '2099-07-31',
                'Fri Jul 31 2099 00:00:00 GMT-0400 (Eastern Daylight Time)',
                '2099-08-14 6:00pm ET | BOOKED | Bummin Beaver Brewery | 11610 E Washington St'
            ].join('; '),
            '68',
            '14',
            '82'
        ]]
    );
    const bridge = loadBridge(sheet);

    bridge.purgeAndSetup_({ applyFormatting: false });
    const cleanSheet = bridge.getSheet_();
    const headers = cleanSheet.values[0];
    const row = cleanSheet.values[1];

    assert.equal(row[headerIndex(headers, 'Past Gigs')], '2025-06-14; 2026-05-02');
    assert.equal(row[headerIndex(headers, 'Future Gigs')], '2099-07-31; 2099-08-14');
    assert.equal(row[headerIndex(headers, 'Past Gig Count')], 2);
    assert.equal(row[headerIndex(headers, 'Future Gig Count')], 2);
    assert.equal(row[headerIndex(headers, 'Total Gig Count')], 4);
});

test('purge ignores ZIP codes and historical ids when recalculating gig counts', () => {
    const sheet = createFakeSheet(
        ['Place Name', 'Status', 'Past Gigs', 'Past Gig Count', 'Total Gig Count'],
        [[
            'Lost Trail Winery',
            'Played in the Past',
            [
                '2024-03-28 | COMPLETED | Lost Trail Winery | 5228 State St NE',
                'OH 44721 | historical-2024-03-28-lost-trail-winery-live',
                'last played=2024-03-28.'
            ].join('; '),
            '3',
            '3'
        ]]
    );
    const bridge = loadBridge(sheet);

    bridge.purgeAndSetup_({ applyFormatting: false });
    const cleanSheet = bridge.getSheet_();
    const headers = cleanSheet.values[0];
    const row = cleanSheet.values[1];

    assert.equal(row[headerIndex(headers, 'Past Gigs')], '2024-03-28');
    assert.equal(row[headerIndex(headers, 'Past Gig Count')], 1);
    assert.equal(row[headerIndex(headers, 'Total Gig Count')], 1);
});

test('setup canonicalizes without adding duplicate generated columns', () => {
    const sheet = createFakeSheet(
        ['Venue Name', 'CRM Status', 'Email', 'Email/Contact', 'Phone', 'Phone Number', 'Gig Past Dates', 'extra'],
        [['Brighten Brewing', 'Played in the Past', 'old@example.com', 'booking@brighten.example', '111', '222', '2024-01-01', 'noise']]
    );
    const bridge = loadBridge(sheet);

    const result = bridge.setupComputerSection_({ applyFormatting: false });
    const cleanSheet = bridge.getSheet_();
    const headers = cleanSheet.values[0];
    const row = cleanSheet.values[1];

    assert.equal(result.ok, true);
    assert.equal(result.replacedSheet, true);
    assert.deepEqual(plain(headers), plain(bridge.JDDM_CANONICAL_HEADERS));
    assert.equal(row[headerIndex(headers, 'Email/Contact')], 'booking@brighten.example');
    assert.equal(row[headerIndex(headers, 'Phone Number')], '222');
    assert.equal(row[headerIndex(headers, 'Status')], 'Played in the Past');
    assert.equal(headerIndex(headers, 'extra'), -1);
});

test('venue row highlight is driven only by Status', () => {
    const sheet = createFakeSheet([
        'Venue Name',
        'Status',
        'Gig Future Count',
        'Gig Last Played',
        'Gig Past Dates'
    ]);
    const bridge = loadBridge(sheet);
    const headerMap = bridge.makeHeaderMap_(sheet.values[0]);
    const noisyRow = ['Venue', '', '4', '2024-01-01', '2024-01-01'];

    assert.equal(bridge.classifyVenueRowHighlight_(noisyRow, headerMap), 'NONE');
    assert.equal(bridge.classifyVenueRowHighlight_(['Venue', 'Booked', '', '', ''], headerMap), 'BOOKED');
    assert.equal(bridge.classifyVenueRowHighlight_(['Venue', 'Played in the Past', '', '', ''], headerMap), 'PLAYED');
    assert.equal(bridge.classifyVenueRowHighlight_(['Venue', 'Played in the Past - Awaiting Reply', '', '', ''], headerMap), 'PLAYED');
    assert.equal(bridge.classifyVenueRowHighlight_(['Venue', 'Open Microphone', '', '', ''], headerMap), 'OPEN_MIC');
    assert.equal(bridge.classifyVenueRowHighlight_(['Venue', 'Told No / Closed / No Music', '', '', ''], headerMap), 'CLOSED');
    assert.equal(bridge.classifyVenueRowHighlight_(['Venue', 'Closed and Not Booking', '', '', ''], headerMap), 'CLOSED');
    assert.equal(bridge.classifyVenueRowHighlight_(['Venue', 'No Live Music', '', '', ''], headerMap), 'CLOSED');
    assert.equal(bridge.classifyVenueRowHighlight_(['Venue', 'Venue Said No to JDDM', '', '', ''], headerMap), 'CLOSED');
    assert.equal(bridge.classifyVenueRowHighlight_(['Venue', 'Not Interested / Do Not Contact', '', '', ''], headerMap), 'CLOSED');
    assert.equal(bridge.classifyVenueRowHighlight_(['Venue', 'Bad Fit / Too Far', '', '', ''], headerMap), 'CLOSED');
    assert.equal(bridge.classifyVenueRowHighlight_(['Venue', 'Closed / No Longer Operating', '', '', ''], headerMap), 'CLOSED');
});

test('setup preserves Status instead of deriving app state from sheet facts', () => {
    const sheet = createFakeSheet(
        ['Place Name', 'City', 'Place ID', 'Status', 'Past Gigs', 'Future Gigs', 'Longitude', 'Latitude', 'Notes'],
        [
            ['Past Only Room', 'Akron', 'past-only-room', 'Booked', '2025-01-01', '', '-81.1', '41.1', ''],
            ['Waiting Past Room', 'Akron', 'waiting-past-room', 'Contacted - Waiting on Reply', '2025-02-01', '', '-81.2', '41.2', ''],
            ['Future Room', 'Akron', 'future-room', 'Needs Review', '2025-03-01', '2026-07-01', '-81.3', '41.3', ''],
            ['Open Mic Room', 'Akron', 'open-mic-room', 'Needs Review', '2025-04-01', '', '-81.4', '41.4', 'Open microphone'],
            ['Closed Room', 'Akron', 'closed-room', 'Needs Review', '', '', '-81.5', '41.5', 'No live music'],
            ['Dnc Room', 'Akron', 'dnc-room', 'Needs Review', '', '', '-81.6', '41.6', 'Not interested, do not contact'],
            ['Harvest Saloon 15147 Pearl Rd', 'OH 44136. CLoSED', 'harvest-saloon-15147-pearl-rd-strongsville-oh-44136', 'Not Contacted Yet', '', '', '-81.7', '41.7', '']
        ]
    );
    const bridge = loadBridge(sheet);

    bridge.setupComputerSection_({ applyFormatting: false });
    const cleanSheet = bridge.getSheet_();
    const headers = cleanSheet.values[0];
    const statuses = cleanSheet.values.slice(1, 8).map(row => row[headerIndex(headers, 'Status')]);

    assert.deepEqual(statuses, [
        'Booked',
        'Contacted - Waiting on Reply',
        'Needs Review',
        'Needs Review',
        'Needs Review',
        'Needs Review',
        'Not Contacted Yet'
    ]);
});

test('calendar sync preserves Status while rebuilding future gig dates from current calendar', () => {
    const sheet = createFakeSheet(
        ['Place Name', 'Place ID', 'Status', 'Past Gigs', 'Future Gigs', 'Longitude', 'Latitude'],
        [['Dragonfly Winery', 'dragonfly-winery-canal-fulton-oh-44614', 'Open Microphone', '1999-01-01', '2000-01-01; 2099-01-01', '-81.6', '40.8']]
    );
    const bridge = loadBridge(sheet, {
        calendars: {
            'justdeedeemusic@gmail.com': [{
                title: 'Dragonfly Winery',
                location: '215 Market St W, Canal Fulton, OH',
                startTime: new Date('2099-02-01T12:00:00Z'),
                id: 'future-dragonfly'
            }]
        }
    });

    bridge.syncCalendarGigEvents_({ addMissing: false });
    const cleanSheet = bridge.getSheet_();
    const headers = cleanSheet.values[0];
    const row = cleanSheet.values[1];

    assert.equal(row[headerIndex(headers, 'Status')], 'Open Microphone');
    assert.equal(row[headerIndex(headers, 'Past Gigs')], '1999-01-01; 2000-01-01');
    assert.equal(row[headerIndex(headers, 'Future Gigs')], '2099-02-01');
    assert.equal(row[headerIndex(headers, 'Past Gig Count')], 2);
    assert.equal(row[headerIndex(headers, 'Future Gig Count')], 1);
});

test('calendar sync fuzzy-matches venue names and adds missing future real gigs', () => {
    const sheet = createFakeSheet(
        ['Place Name', 'Address', 'City', 'Place ID', 'Status', 'Past Gigs', 'Future Gigs', 'Notes'],
        [['Brighten Brewing Company', '1375 S Main St', 'Cuyahoga Falls', 'brighten-brewing-company-cuyahoga-falls', 'Not Contacted Yet', '', '2099-01-01', '']]
    );
    const bridge = loadBridge(sheet, {
        calendars: {
            'justdeedeemusic@gmail.com': [
                {
                    title: 'Brighton Brewing',
                    location: '',
                    startTime: new Date('2099-02-02T12:00:00Z'),
                    id: 'future-brighton'
                },
                {
                    title: 'Pipe Creek Wharf',
                    location: '49 Madison St, Sandusky, OH 44870',
                    startTime: new Date('2099-03-03T12:00:00Z'),
                    id: 'future-pipe-creek'
                },
                {
                    title: 'Baci Winery - Proposed',
                    location: '',
                    startTime: new Date('2099-04-04T12:00:00Z'),
                    id: 'proposed-baci'
                },
                {
                    title: 'JDDM Summer Tour',
                    location: '',
                    startTime: new Date('2099-06-01T12:00:00Z'),
                    id: 'tour-placeholder',
                    isAllDay: true
                }
            ]
        }
    });

    const result = bridge.syncCalendarGigEvents_({});
    const cleanSheet = bridge.getSheet_();
    const headers = cleanSheet.values[0];
    const brighten = cleanSheet.values[1];
    const added = cleanSheet.values.find(row => row[headerIndex(headers, 'Place Name')] === 'Pipe Creek Wharf');

    assert.equal(result.eventCount, 2);
    assert.equal(result.addedRows.length, 1);
    assert.equal(brighten[headerIndex(headers, 'Status')], 'Not Contacted Yet');
    assert.equal(brighten[headerIndex(headers, 'Future Gigs')], '2099-02-02');
    assert.ok(added);
    assert.equal(added[headerIndex(headers, 'Place Name')], 'Pipe Creek Wharf');
    assert.equal(added[headerIndex(headers, 'Address')], '49 Madison St');
    assert.equal(added[headerIndex(headers, 'City')], 'Sandusky');
    assert.equal(added[headerIndex(headers, 'Zip')], '44870');
    assert.equal(added[headerIndex(headers, 'Status')], 'Needs Review');
    assert.equal(added[headerIndex(headers, 'Future Gigs')], '2099-03-03');
    assert.match(added[headerIndex(headers, 'Notes')], /Google Calendar future gig/i);
});

test('setPlayed writes Status instead of legacy Played columns', () => {
    const sheet = createFakeSheet(
        ['Place Name', 'Place ID', 'Status'],
        [['The Venue', 'the-venue', 'Not Contacted Yet']]
    );
    const bridge = loadBridge(sheet);

    const result = bridge.setPlayed_({ id: 'the-venue', played: true });

    assert.equal(result.ok, true);
    assert.equal(sheet.values[1][2], 'Played in the Past');
});

test('health advertises the lean storage schema', () => {
    const sheet = createFakeSheet(['Venue Name', 'CRM Status']);
    const bridge = loadBridge(sheet);
    const health = bridge.getHealth_();

    assert.equal(health.schemaVersion, '2026-05-08-simplified-crm-statuses');
    assert.ok(health.storageColumns.includes('Place Name'));
    assert.ok(health.sections.status.includes('Status'));
    assert.ok(health.statusOptions.includes('Played in the Past - Awaiting Reply'));
    assert.ok(health.statusOptions.includes('Told No / Closed / No Music'));
    assert.equal(health.statusOptions.includes('Closed and Not Booking'), false);
    assert.ok(health.generatedColumns.some(column => column.header === 'Future Gigs'));
});

test('status migration collapses legacy states while preserving highlight meanings', () => {
    const sheet = createFakeSheet(
        ['Place Name', 'Place ID', 'Status', 'Notes'],
        [
            ['Closed Room', 'closed-room', 'Closed and Not Booking', 'Original note'],
            ['Sent Room', 'sent-room', 'Sent', ''],
            ['Interested Room', 'interested-room', 'Interested', ''],
            ['Review Room', 'review-room', 'Need Contact Info', ''],
            ['Booked Room', 'booked-room', 'Booked', '']
        ]
    );
    const bridge = loadBridge(sheet);

    const result = bridge.migrateCrmStatuses_({ limit: 5000 });

    assert.equal(result.ok, true);
    assert.equal(result.changedRows, 4);
    assert.equal(sheet.values[1][2], 'Told No / Closed / No Music');
    assert.match(sheet.values[1][3], /Previous CRM status: Closed and Not Booking/);
    assert.equal(sheet.values[2][2], 'Contacted - Waiting on Reply');
    assert.equal(sheet.values[3][2], 'Responded - Needs Action');
    assert.equal(sheet.values[4][2], 'Needs Review');
    assert.equal(sheet.values[5][2], 'Booked');
});

test('restoreFromCsv rewrites the clean storage sheet from a CSV payload', () => {
    const sheet = createFakeSheet(
        ['Place Name', 'Place ID', 'Status', 'Notes'],
        [['Partial Row', 'partial-row', 'Not Set', '']]
    );
    const bridge = loadBridge(sheet);
    const csv = [
        'Place Name,Place ID,Status,Email/Contact,Notes',
        'Closed Room,closed-room,Closed and Not Booking,booking@example.com,"legacy note"',
        'Booked Room,booked-room,Booked,,'
    ].join('\n');

    const result = bridge.restoreFromCsv_({ csv, applyFormatting: false });

    assert.equal(result.ok, true);
    assert.equal(result.rowCount, 2);
    assert.deepEqual(plain(sheet.values[0]), plain(bridge.JDDM_CANONICAL_HEADERS));
    assert.equal(sheet.values[1][headerIndex(sheet.values[0], 'Status')], 'Told No / Closed / No Music');
    assert.equal(sheet.values[1][headerIndex(sheet.values[0], 'Email/Contact')], 'booking@example.com');
    assert.equal(sheet.values[2][headerIndex(sheet.values[0], 'Status')], 'Booked');
});

test('calendar cleanup removes no-coordinate calendar-only rows', () => {
    const sheet = createFakeSheet(
        ['Place Name', 'Address', 'City', 'Place ID', 'Longitude', 'Latitude', 'Status', 'Past Gigs', 'Future Gigs', 'Email/Contact'],
        [
            ['Real Venue', '123 Main', 'Akron', 'real-venue', '-81.1', '41.1', 'Booked', '', '2026-06-01', ''],
            ['Return from Vegas', '', '', 'return-from-vegas', '', '', 'Played in the Past', '2025-08-29', '', ''],
            ['Missing Coordinates But Real Contact', '', '', 'missing-real-contact', '', '', 'Booked', '', '2026-06-01', 'booking@example.com']
        ]
    );
    const bridge = loadBridge(sheet);

    const result = bridge.cleanupCalendarOnlyRows_({ applyFormatting: false });

    assert.equal(result.removedRows, 1);
    assert.deepEqual(sheet.values.map(row => row[0]), [
        'Place Name',
        'Real Venue',
        'Missing Coordinates But Real Contact'
    ]);
});
