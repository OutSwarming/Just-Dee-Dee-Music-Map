const assert = require('node:assert/strict');
const test = require('node:test');

const {
    ARTIST_TRACKER_SHEETS,
    CANONICAL_HEADERS,
    REMINDER_HEADERS,
    SCHEMA_VERSION,
    WEBSITE_GIG_HEADERS,
    createJddmSpreadsheetBridgeHandler,
    createJddmSpreadsheetBridgeService,
    parseCsv,
    valuesToCsv
} = require('../jddmSpreadsheetBridge');

function columnIndex(name) {
    return String(name).split('').reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function createFakeGateway(initial = {}) {
    const sheets = {};
    Object.entries(initial).forEach(([name, values]) => {
        sheets[name] = values.map(row => row.slice());
    });
    const calls = [];

    function getSheetRange(range) {
        const match = String(range).match(/^([^!]+)!([A-Z]+)(\d*)?(?::([A-Z]+)?(\d*)?)?$/);
        if (!match) throw new Error(`Unsupported test range: ${range}`);
        return {
            sheetName: match[1],
            startColumn: columnIndex(match[2]),
            startRow: match[3] ? Number(match[3]) - 1 : 0,
            endColumn: match[4] ? columnIndex(match[4]) : null,
            endRow: match[5] ? Number(match[5]) - 1 : null
        };
    }

    async function metadata() {
        return {
            properties: { title: 'JustDeeDeeMusic Master Venue Spreadsheet', timeZone: 'America/New_York' },
            sheets: Object.keys(sheets).map((title, index) => ({ properties: { title, sheetId: index + 100, index } }))
        };
    }

    async function getValues(range) {
        calls.push({ action: 'getValues', range });
        const parsed = getSheetRange(range);
        const values = sheets[parsed.sheetName] || [];
        const endRow = parsed.endRow === null ? values.length - 1 : parsed.endRow;
        return values.slice(parsed.startRow, endRow + 1).map(row => {
            const endColumn = parsed.endColumn === null ? row.length - 1 : parsed.endColumn;
            return row.slice(parsed.startColumn, endColumn + 1);
        });
    }

    async function updateValues(range, values) {
        calls.push({ action: 'updateValues', range, values });
        const parsed = getSheetRange(range);
        if (!sheets[parsed.sheetName]) sheets[parsed.sheetName] = [];
        values.forEach((sourceRow, rowOffset) => {
            const rowIndex = parsed.startRow + rowOffset;
            while (sheets[parsed.sheetName].length <= rowIndex) sheets[parsed.sheetName].push([]);
            sourceRow.forEach((value, columnOffset) => {
                sheets[parsed.sheetName][rowIndex][parsed.startColumn + columnOffset] = value;
            });
        });
        return { updatedRange: range };
    }

    async function appendValues(range, values) {
        calls.push({ action: 'appendValues', range, values });
        const parsed = getSheetRange(range);
        if (!sheets[parsed.sheetName]) sheets[parsed.sheetName] = [];
        const start = sheets[parsed.sheetName].length + 1;
        values.forEach(row => sheets[parsed.sheetName].push(row.slice()));
        return { updates: { updatedRange: `${parsed.sheetName}!A${start}:AB${start + values.length - 1}` } };
    }

    return {
        calls,
        sheets,
        metadata,
        getValues,
        async getSheetValues(name) {
            calls.push({ action: 'getSheetValues', name });
            if (!sheets[name]) throw new Error(`Sheet not found: ${name}`);
            return sheets[name].map(row => row.slice());
        },
        updateValues,
        appendValues,
        async ensureSheet(name, headers) {
            calls.push({ action: 'ensureSheet', name, headers });
            if (!sheets[name]) sheets[name] = headers ? [headers.slice()] : [];
        },
        async replaceSheetValues(name, values) {
            calls.push({ action: 'replaceSheetValues', name, values });
            sheets[name] = values.map(row => row.slice());
        },
        async formatVenueRow(rowNumber, status, width) {
            calls.push({ action: 'formatVenueRow', rowNumber, status, width });
        },
        async deleteRow(name, rowNumber) {
            calls.push({ action: 'deleteRow', name, rowNumber });
            sheets[name].splice(rowNumber - 1, 1);
        }
    };
}

function makeVenueRow(overrides = {}) {
    return CANONICAL_HEADERS.map(header => Object.prototype.hasOwnProperty.call(overrides, header) ? overrides[header] : '');
}

function createMemoryIdempotency() {
    const results = new Map();
    return {
        async acquire(id) {
            return results.has(id) ? { state: 'complete', result: results.get(id) } : { state: 'acquired' };
        },
        async complete(id, result) {
            results.set(id, result);
        },
        async fail() {}
    };
}

test('bridge reports the Firebase schema and live workbook capability', async () => {
    const gateway = createFakeGateway({ Sheet1: [CANONICAL_HEADERS] });
    const service = createJddmSpreadsheetBridgeService({ gateway });

    const result = await service.route({ action: 'health' });

    assert.equal(result.ok, true);
    assert.equal(result.schemaVersion, SCHEMA_VERSION);
    assert.equal(result.sheetName, 'Sheet1');
    assert.equal(result.capabilities.firebaseHosted, true);
    assert.equal(result.capabilities.reminderQueue, true);
});

test('bridge reads and updates a venue by stable Place ID', async () => {
    const gateway = createFakeGateway({
        Sheet1: [
            CANONICAL_HEADERS,
            makeVenueRow({ 'Place Name': 'Test Room', 'Place ID': 'test-room', Status: 'Needs Review', Notes: 'before' })
        ]
    });
    const service = createJddmSpreadsheetBridgeService({ gateway });

    const before = await service.route({ action: 'getVenue', id: 'test-room' });
    const saved = await service.route({
        action: 'saveVenue',
        id: 'test-room',
        requestId: 'save-1',
        rawFields: { Status: 'Booked', Notes: 'after' }
    });
    const after = await service.route({ action: 'getVenue', id: 'test-room' });

    assert.equal(before.rawFields.Notes, 'before');
    assert.deepEqual(saved.changedHeaders, ['Status', 'Notes']);
    assert.equal(after.rawFields.Status, 'Booked');
    assert.equal(after.rawFields.Notes, 'after');
    assert.ok(gateway.calls.some(call => call.action === 'formatVenueRow' && call.status === 'Booked'));
});

test('create venue geocodes, generates an id, and safely replays a request', async () => {
    const gateway = createFakeGateway({ Sheet1: [CANONICAL_HEADERS] });
    const service = createJddmSpreadsheetBridgeService({
        gateway,
        idempotency: createMemoryIdempotency(),
        geocode: async () => ({ lat: 41.5, lng: -81.7 }),
        now: () => new Date('2026-08-31T01:00:00.000Z')
    });
    const payload = {
        action: 'createVenue',
        requestId: 'create-stable-1',
        rawFields: {
            'Place Name': 'New Test Stage',
            Address: '1 Music Way',
            City: 'Cleveland',
            State: 'OH',
            Notes: '[JDDM E2E TEST] temporary'
        }
    };

    const created = await service.route(payload);
    const replayed = await service.route(payload);

    assert.equal(created.ok, true);
    assert.equal(created.venue['Place ID'], 'new-test-stage-cleveland-oh');
    assert.equal(created.venue.Latitude, 41.5);
    assert.equal(created.venue.Longitude, -81.7);
    assert.equal(created.hasCoordinates, true);
    assert.equal(replayed.replayed, true);
    assert.equal(gateway.sheets.Sheet1.length, 2);
});

test('create venue rejects a duplicate name and address', async () => {
    const gateway = createFakeGateway({
        Sheet1: [
            CANONICAL_HEADERS,
            makeVenueRow({ 'Place Name': 'Same Stage', Address: '1 Main St', City: 'Akron', State: 'OH', 'Place ID': 'same-stage' })
        ]
    });
    const service = createJddmSpreadsheetBridgeService({ gateway });

    const result = await service.route({
        action: 'createVenue',
        requestId: 'duplicate-1',
        rawFields: { 'Place Name': 'Same Stage', Address: '1 Main St', City: 'Akron', State: 'OH' }
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'DUPLICATE_VENUE');
    assert.equal(gateway.sheets.Sheet1.length, 2);
});

function createRecordingNotifier() {
    const events = [];
    return {
        events,
        async newPlace(venue) { events.push({ type: 'newPlace', venue }); },
        async followUp(payload) { events.push(Object.assign({ type: 'followUp' }, payload)); }
    };
}

test('createVenue notifies Discord about the new place', async () => {
    const gateway = createFakeGateway({ Sheet1: [CANONICAL_HEADERS] });
    const notifier = createRecordingNotifier();
    const service = createJddmSpreadsheetBridgeService({ gateway, notifier });

    await service.route({
        action: 'createVenue',
        requestId: 'notify-new-1',
        rawFields: { 'Place Name': 'The Barn', City: 'Kent', State: 'OH' }
    });

    const event = notifier.events.find(e => e.type === 'newPlace');
    assert.ok(event, 'expected a newPlace notification');
    assert.equal(event.venue['Place Name'], 'The Barn');
    assert.equal(event.venue['City'], 'Kent');
});

test('saveVenue notifies Discord when a follow-up date is newly set', async () => {
    const gateway = createFakeGateway({
        Sheet1: [CANONICAL_HEADERS, makeVenueRow({ 'Place Name': 'Cafe X', 'Place ID': 'cafe-x', Status: 'Needs Review' })]
    });
    const notifier = createRecordingNotifier();
    const service = createJddmSpreadsheetBridgeService({ gateway, notifier, now: () => new Date('2026-09-06T15:00:00.000Z') });

    await service.route({
        action: 'saveVenue',
        id: 'cafe-x',
        requestId: 'notify-follow-1',
        venue: { nextFollowUpDate: '2026-09-20' }
    });

    const event = notifier.events.find(e => e.type === 'followUp');
    assert.ok(event, 'expected a followUp notification');
    assert.equal(event.date, '2026-09-20');
    assert.equal(event.venue['Place Name'], 'Cafe X');
    assert.ok(event.addedAt instanceof Date);
});

test('saveVenue does not notify when the follow-up date is unchanged', async () => {
    const gateway = createFakeGateway({
        Sheet1: [CANONICAL_HEADERS, makeVenueRow({ 'Place Name': 'Cafe Y', 'Place ID': 'cafe-y', 'Next Follow Up': '2026-09-20' })]
    });
    const notifier = createRecordingNotifier();
    const service = createJddmSpreadsheetBridgeService({ gateway, notifier });

    await service.route({ action: 'saveVenue', id: 'cafe-y', requestId: 'notify-follow-2', rawFields: { Notes: 'touched' } });

    assert.equal(notifier.events.filter(e => e.type === 'followUp').length, 0);
});

test('a failing notifier never breaks the sheet write', async () => {
    const gateway = createFakeGateway({ Sheet1: [CANONICAL_HEADERS] });
    const notifier = { newPlace: async () => { throw new Error('discord down'); }, followUp: async () => {} };
    const service = createJddmSpreadsheetBridgeService({ gateway, notifier });

    const created = await service.route({
        action: 'createVenue',
        requestId: 'notify-fail-1',
        rawFields: { 'Place Name': 'Resilient Room', City: 'Akron', State: 'OH' }
    });

    assert.equal(created.ok, true);
    assert.equal(gateway.sheets.Sheet1.length, 2);
});

test('reminder queue deduplicates pending work and records completion', async () => {
    const gateway = createFakeGateway({ Sheet1: [CANONICAL_HEADERS] });
    const service = createJddmSpreadsheetBridgeService({
        gateway,
        now: () => new Date('2026-08-31T01:15:00.000Z')
    });

    const queued = await service.route({ action: 'queueReminder', reminderId: 'follow-ups', requestId: 'reminder-1' });
    const duplicate = await service.route({ action: 'queueReminder', reminderId: 'follow-ups', requestId: 'reminder-2' });
    const pending = await service.route({ action: 'getPendingReminders' });
    const completed = await service.route({ action: 'completeReminder', requestId: 'reminder-1', status: 'sent', result: 'SM-test' });

    assert.equal(queued.queued, true);
    assert.equal(duplicate.duplicate, true);
    assert.equal(pending.reminders.length, 1);
    assert.equal(pending.reminders[0].requestId, 'reminder-1');
    assert.equal(completed.status, 'sent');
    assert.deepEqual(gateway.sheets.ReminderQueue[0], REMINDER_HEADERS);
    assert.equal(gateway.sheets.ReminderQueue[1][3], 'sent');
});

test('official website gig sync preserves calendar dates and replaces only its own snapshot', async () => {
    const gateway = createFakeGateway({
        Sheet1: [
            CANONICAL_HEADERS,
            makeVenueRow({
                'Place Name': 'Shared Source Room',
                'Place ID': 'shared-source-room',
                'Future Gigs': '2099-08-09; 2099-09-10',
                'Future Gig Count': 2,
                'Total Gig Count': 2
            })
        ],
        WebsiteGigs: [
            WEBSITE_GIG_HEADERS,
            ['website-old', '2099-08-09', 'Old gig', 'Shared Source Room', '1 Main St, Akron, OH 44308', 'https://www.justdeedeemusic.com/calendar/', '2099-01-01']
        ]
    });
    const service = createJddmSpreadsheetBridgeService({ gateway, now: () => new Date('2099-01-02T00:00:00.000Z') });

    const refused = await service.route({ action: 'syncWebsiteGigEvents', sourceChecked: false, events: [] });
    const synced = await service.route({
        action: 'syncWebsiteGigEvents',
        sourceChecked: true,
        events: [
            { id: 'website-new', date: '2099-08-10', venueName: 'Shared Source Room', title: 'New gig' },
            { id: 'website-added', date: '2099-10-01', venueName: 'Brand New Room', location: '2 Main St, Cleveland, OH 44101', sourceUrl: 'https://www.justdeedeemusic.com/calendar/' }
        ]
    });

    assert.equal(refused.code, 'UNCONFIRMED_WEBSITE_GIG_SOURCE');
    assert.equal(synced.ok, true);
    assert.equal(synced.websiteEventCount, 2);
    assert.equal(synced.mapSync.addedRows.length, 0);
    assert.deepEqual(synced.mapSync.pendingVenues, ['Brand New Room']);
    assert.equal(gateway.sheets.Sheet1[1][CANONICAL_HEADERS.indexOf('Future Gigs')], '2099-08-10; 2099-09-10');
    assert.equal(gateway.sheets.Sheet1.length, 2);
    assert.equal(gateway.sheets.WebsiteGigs.length, 3);
});

test('artist tracker tables read and write through the same gateway', async () => {
    const initial = { Sheet1: [CANONICAL_HEADERS] };
    ARTIST_TRACKER_SHEETS.forEach(name => {
        initial[name] = [['id', 'name'], [`${name}-1`, `${name} One`]];
    });
    const gateway = createFakeGateway(initial);
    const service = createJddmSpreadsheetBridgeService({ gateway });

    const before = await service.route({ action: 'getArtistTrackerTable', sheetName: 'Artists' });
    const written = await service.route({
        action: 'syncArtistTrackerTable',
        sheetName: 'Artists',
        csv: 'artist_id,canonical_name\nartist-2,"Two, Artist"'
    });
    const after = await service.route({ action: 'getArtistTrackerTable', sheetName: 'Artists' });

    assert.match(before.csv, /Artists One/);
    assert.equal(written.rowCount, 1);
    assert.match(after.csv, /"Two, Artist"/);
});

test('CSV helpers preserve quotes, commas, and line breaks', () => {
    const values = [['id', 'notes'], ['one', 'comma, quote " and\nline']];
    const csv = valuesToCsv(values);
    assert.deepEqual(parseCsv(csv), values);
});

test('HTTP handler serves CSV and blocks an unexpected browser origin', async () => {
    const gateway = createFakeGateway({
        Sheet1: [CANONICAL_HEADERS, makeVenueRow({ 'Place Name': 'CSV Room', 'Place ID': 'csv-room' })]
    });
    const service = createJddmSpreadsheetBridgeService({ gateway });
    const handler = createJddmSpreadsheetBridgeHandler({ service, allowedOrigins: ['https://outswarming.github.io'] });

    function responseRecorder() {
        return {
            headers: {},
            statusCode: 0,
            body: null,
            set(name, value) { this.headers[name] = value; return this; },
            type(value) { this.headers['Content-Type'] = value; return this; },
            status(value) { this.statusCode = value; return this; },
            send(value) { this.body = value; return this; },
            json(value) { this.body = value; return this; }
        };
    }

    const csvResponse = responseRecorder();
    await handler({ method: 'GET', query: { action: 'csv' }, headers: {}, get: () => '' }, csvResponse);
    assert.equal(csvResponse.statusCode, 200);
    assert.match(csvResponse.body, /CSV Room/);

    const blocked = responseRecorder();
    await handler({ method: 'POST', body: { action: 'health' }, headers: { origin: 'https://evil.example' }, get: () => 'https://evil.example' }, blocked);
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.body.code, 'ORIGIN_NOT_ALLOWED');
});

test('guarded cleanup only deletes marked end-to-end test rows', async () => {
    const gateway = createFakeGateway({
        Sheet1: [
            CANONICAL_HEADERS,
            makeVenueRow({ 'Place Name': 'Protected', 'Place ID': 'normal-row', Notes: 'real data' }),
            makeVenueRow({ 'Place Name': 'Temporary', 'Place ID': 'jddm-e2e-temp', Notes: '[JDDM E2E TEST] delete me' })
        ]
    });
    const service = createJddmSpreadsheetBridgeService({ gateway });

    const refused = await service.route({ action: 'deleteTestVenue', id: 'normal-row' });
    const deleted = await service.route({ action: 'deleteTestVenue', id: 'jddm-e2e-temp' });

    assert.equal(refused.code, 'TEST_VENUE_REQUIRED');
    assert.equal(deleted.ok, true);
    assert.equal(gateway.sheets.Sheet1.length, 2);
});

test('HTTP app activity sees successful contact saves and played changes, not empty saves or failures', async () => {
    const {savedAppEdit}=require('../appActivity');
    const gateway=createFakeGateway({Sheet1:[CANONICAL_HEADERS,makeVenueRow({'Place ID':'activity-test','Place Name':'Activity test',Status:'Needs Review'})]});
    const service=createJddmSpreadsheetBridgeService({gateway});
    const edits=[];
    const handler=createJddmSpreadsheetBridgeHandler({service,allowedOrigins:['https://outswarming.github.io'],activity:{record:async input=>{if(savedAppEdit(input))edits.push(input);}}});
    const res=()=>({set(){return this;},status(){return this;},json(body){this.body=body;return this;}});
    async function call(payload,origin='https://outswarming.github.io') {
        const response=res();await handler({method:'POST',body:payload,get:()=>origin},response);return response.body;
    }
    const payload={action:'saveVenue',id:'activity-test',rawFields:{Notes:'Office hours updated'}};
    await call(payload);await call(payload);
    await call({action:'saveVenue',id:'missing',rawFields:{Notes:'Not saved'}});
    await call({action:'setPlayed',id:'activity-test',played:true});
    await call({action:'setPlayed',id:'activity-test',played:true});
    await call({...payload,rawFields:{Notes:'Automated update'}},'');
    assert.equal(edits.length,2);
    assert.deepEqual(edits.map(e=>e.result.changedHeaders),[['Notes'],['Status']]);
});

test('an unavailable activity counter never turns a saved venue into a failed save',async()=>{
    const handler=createJddmSpreadsheetBridgeHandler({service:{route:async()=>({ok:true,action:'saveVenue',changedHeaders:['Notes']})},activity:{record:async()=>{throw Error('Temporary activity outage');}}});
    const res={set(){return this;},status(code){this.code=code;return this;},json(body){this.body=body;}};
    await handler({method:'POST',body:{action:'saveVenue'},get:()=>''},res);
    assert.equal(res.code,200);assert.equal(res.body.ok,true);
    assert.match(res.body.activityWarning,/change was saved/);
});

test('original 28 columns support people, legacy clients, edits and follow-up confirmations', async () => {
    const codec=require('../contactRecords');
    const gateway=createFakeGateway({Sheet1:[CANONICAL_HEADERS.slice()]});
    const notifier=createRecordingNotifier();const service=createJddmSpreadsheetBridgeService({gateway,notifier});
    const old={version:1,emails:[{value:'a@example.com',note:'Booking'}, {value:'b@example.com',note:'Gig prep'}],phones:[{value:'330-555-0100',note:'Office'}]};
    const made=await service.route({action:'createVenue',rawFields:{'Place Name':'Contact test','Place ID':'contact-test','Next Follow Up':'2026-09-20','Contact Details':JSON.stringify(old)}});
    assert.equal(made.ok,true);assert.equal(CANONICAL_HEADERS.length,28);assert.equal(gateway.sheets.Sheet1[0].length,28);
    assert.equal(made.rawFields['Email/Contact'],'a@example.com');
    const people=codec.read(made.rawFields);people.contacts[0].name='Jamie';people.contacts.push({...codec.empty(),name:'Venue office',preferredMethod:'Messenger',others:[{type:'Facebook',value:'@office',note:'After 4pm'}]});
    await service.route({action:'saveVenue',id:'contact-test',rawFields:{'Booking Contact':codec.encode(people),'Next Follow Up':'Sun Sep 20 2026 00:00:00 GMT-0400 (Eastern Daylight Time)'}});
    const read=await service.route({action:'getVenue',id:'contact-test'});assert.deepEqual(codec.read(read.rawFields).contacts,codec.tidy(people).contacts);
    assert.equal(notifier.events.filter(e=>e.type==='followUp').length,1,'same Eastern date does not notify');
    await assert.rejects(service.route({action:'saveVenue',id:'contact-test',rawFields:{'Contact Details':JSON.stringify(old)}}),/Refresh the map/);
    await service.route({action:'saveVenue',id:'contact-test',rawFields:{'Next Follow Up':'2026-09-22'}});assert.equal(notifier.events.at(-1).previousDate,'2026-09-20');
    const csv=await service.route({action:'csv'});assert.deepEqual(codec.decode(parseCsv(csv.csv)[1][13]).contacts,codec.tidy(people).contacts);
    assert.equal(gateway.sheets.Sheet1[1].length,28);
    await assert.rejects(service.route({action:'saveVenue',id:'contact-test',rawFields:{'Next Follow Up':'2026-02-30'}}),/valid calendar date/);
});

test('follow-up confirmations identify added, changed and removed dates with the place', () => {
    const {followUpMessage}=require('../venueFields');
    assert.match(followUpMessage({venue:{'Place Name':'Music Hall'},date:'2026-09-20'}),/Follow-up added — Music Hall/);
    const changed=followUpMessage({venue:{'Place Name':'Music Hall'},date:'2026-09-22',previousDate:'2026-09-20'});
    assert.match(changed,/Follow-up changed — Music Hall/);
    assert.match(changed,/Follow-up date: 2026-09-22 \(Eastern\)/);
    assert.match(changed,/Previous date: 2026-09-20/);
    assert.match(followUpMessage({venue:{'Place Name':'Music Hall'},date:'',previousDate:'2026-09-20'}),/Follow-up removed/);
});

test('gateway expands the current tab after a warm instance cached a replaced Sheet1', async () => {
    const {createGoogleSheetsGateway}=require('../jddmSpreadsheetBridge');
    let properties={sheetId:101,title:'Sheet1',gridProperties:{columnCount:29,rowCount:1000}};
    const updates=[];
    const google={auth:{GoogleAuth:class{}},sheets:()=>({spreadsheets:{
        get:async()=>({data:{sheets:[{properties:JSON.parse(JSON.stringify(properties))}]}}),
        batchUpdate:async request=>{updates.push(request.requestBody.requests[0]);properties.gridProperties.columnCount=29;return{data:{}};}
    }})};
    const gateway=createGoogleSheetsGateway({google});
    await gateway.ensureColumns('Sheet1',29);
    properties={sheetId:202,title:'Sheet1',gridProperties:{columnCount:28,rowCount:1000}};
    await gateway.ensureColumns('Sheet1',29);
    assert.equal(updates.length,1);
    assert.equal(updates[0].updateSheetProperties.properties.sheetId,202);
    assert.equal(updates[0].updateSheetProperties.properties.gridProperties.columnCount,29);
    await gateway.ensureColumns('Sheet1',29);
    assert.equal(updates.length,1,'already expanded tab is not rewritten');
});

test('fragmented people and missing-method notes save and clear within 28 columns',async()=>{
 const codec=require('../contactRecords');const gateway=createFakeGateway({Sheet1:[CANONICAL_HEADERS.slice()]});const service=createJddmSpreadsheetBridgeService({gateway});
 const data={version:2,contacts:[{...codec.empty(),phones:[{value:'(330) 555-0123',note:'Only phone known'}],emails:[{value:'',note:'Ask for email'}]},{...codec.empty(),emails:[{value:'venue@example.com',note:'Only email known'}],phones:[{value:'',note:'Ask for phone'}]}]};
 let result=await service.route({action:'createVenue',rawFields:{'Place ID':'fragmented','Place Name':'Fragmented','Booking Contact':codec.encode(data)}});assert.equal(result.ok,true);assert.equal(result.rawFields['Contact Name'],'');assert.equal(result.rawFields['Email/Contact'],'venue@example.com');assert.equal(result.rawFields['Phone Number'],'(330) 555-0123');assert.deepEqual(codec.read(result.rawFields).contacts,codec.tidy(data).contacts);
 data.contacts.shift();result=await service.route({action:'saveVenue',id:'fragmented',rawFields:{'Booking Contact':codec.encode(data)}});assert.equal(result.rawFields['Phone Number'],'');assert.equal(result.rawFields['Email/Contact'],'venue@example.com');assert(codec.read(result.rawFields).contacts[0].notes.includes('Ask for phone'));assert.equal(gateway.sheets.Sheet1[0].length,28);assert.equal(gateway.sheets.Sheet1[1].length,28);
});

test('stale editor cannot overwrite newer notes and retrying the same successful write is safe',async()=>{
 const gateway=createFakeGateway({Sheet1:[CANONICAL_HEADERS.slice()]});const service=createJddmSpreadsheetBridgeService({gateway});
 const made=await service.route({action:'createVenue',rawFields:{'Place ID':'conflict-test','Place Name':'Conflict test',Notes:'Original'}});
 await service.route({action:'saveVenue',id:'conflict-test',rawFields:{Notes:'Other window'}});
 const blocked=await service.route({action:'saveVenue',id:'conflict-test',rawFields:{Notes:'Stale overwrite'},expectedRawFields:made.rawFields});assert.equal(blocked.code,'VENUE_CONFLICT');assert.equal((await service.route({action:'getVenue',id:'conflict-test'})).rawFields.Notes,'Other window');
 const repeat=await service.route({action:'saveVenue',id:'conflict-test',rawFields:{Notes:'Other window'},expectedRawFields:made.rawFields});assert.equal(repeat.ok,true);assert.deepEqual(repeat.changedHeaders,[]);
});


test('ambiguous calendar names cannot update both rows or append another row', async () => {
    const gateway=createFakeGateway({Sheet1:[CANONICAL_HEADERS,makeVenueRow({'Place ID':'old','Place Name':'Filia Cellars 3059 Greenwich Rd','Future Gigs':'2026-10-23'}),makeVenueRow({'Place ID':'new','Place Name':'Filia Cellars'})]});
    const service=createJddmSpreadsheetBridgeService({gateway});
    const result=await service.route({action:'syncWebsiteGigEvents',sourceChecked:true,events:[{date:'2026-10-23',venueName:'Filia Cellars'}]});
    assert.deepEqual(result.mapSync.addedRows,[]);
    assert.deepEqual(result.mapSync.updatedRows,[]);
    assert.equal(gateway.sheets.Sheet1.length,3);
});

test('manual calendar decisions target IDs, keep contact fields intact and replace only owned dates on relink', async () => {
    const gateway=createFakeGateway({Sheet1:[CANONICAL_HEADERS,makeVenueRow({'Place ID':'old','Place Name':'Filia Cellars 3059 Greenwich Rd','Future Gigs':'2026-10-23; 2026-12-01','Notes':'Keep me'}),makeVenueRow({'Place ID':'new','Place Name':'Filia Cellars'})]});
    const event={date:'2026-10-23',venueName:'Filia Cellars'};
    let ownership={old:['2026-10-23']};
    const service=createJddmSpreadsheetBridgeService({gateway,calendarReview:{resolve:async()=>({mappings:{[require('../calendarVenueMatching').keyFor(event)]:'new'}})},websiteState:{load:async()=>ownership,save:async v=>{ownership=v;}}});
    const result=await service.route({action:'syncWebsiteGigEvents',sourceChecked:true,events:[event]});
    assert.equal(gateway.sheets.Sheet1[1][CANONICAL_HEADERS.indexOf('Future Gigs')],'2026-12-01');
    assert.equal(gateway.sheets.Sheet1[2][CANONICAL_HEADERS.indexOf('Future Gigs')],'2026-10-23');
    assert.equal(gateway.sheets.Sheet1[1][CANONICAL_HEADERS.indexOf('Notes')],'Keep me');
    assert.deepEqual(ownership,{new:['2026-10-23']});
});

test('review outage fails closed before changing website snapshot or master rows', async()=>{
    const gateway=createFakeGateway({Sheet1:[CANONICAL_HEADERS]});
    const service=createJddmSpreadsheetBridgeService({gateway,calendarReview:{resolve:async()=>{throw Error('offline');}}});
    await assert.rejects(service.route({action:'syncWebsiteGigEvents',sourceChecked:true,events:[{date:'2026-10-23',venueName:'Unknown'}]}),/offline/);
    assert.equal(gateway.sheets.Sheet1.length,1);
    assert.ok(!gateway.calls.some(c=>c.action==='appendValues'));
});
