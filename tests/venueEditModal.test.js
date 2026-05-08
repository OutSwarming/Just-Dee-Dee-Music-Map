const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadVenueEditModal() {
    const context = {
        console,
        Date,
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
        alert() {},
        document: {
            body: {
                classList: {
                    add() {},
                    remove() {}
                }
            },
            getElementById() {
                return null;
            },
            addEventListener() {}
        }
    };
    context.window = context;
    context.global = context;

    vm.createContext(context);
    ['modules/bookingSchema.js', 'modules/venueEditModal.js'].forEach((relativePath) => {
        vm.runInContext(
            fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
            context,
            { filename: relativePath }
        );
    });

    return context.window.BARK.venueEditModal;
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

test('venue editor renders only focused pin CRM fields it receives', () => {
    const modal = loadVenueEditModal();
    const headers = modal.getRenderableHeaders({
        'Place Name': 'Brighten Brewing Company',
        Address: '123 Main St',
        Status: 'Contacted - Waiting on Reply',
        'Last Contacted': '2026-05-04',
        'Contact Name': 'Jamie',
        'Email/Contact': 'booking@example.com',
        'Phone Number': '440-555-1212',
        'Contact Type': 'Email',
        'Next Follow Up': '2026-05-11',
        'Past Gigs': '2025-01-01',
        Notes: 'Great fit for acoustic sets.'
    });

    assert.deepEqual(plain(headers), [
        'Status',
        'Last Contacted',
        'Contact Name',
        'Email/Contact',
        'Phone Number',
        'Contact Type',
        'Next Follow Up',
        'Notes'
    ]);
    assert.equal(headers.includes('Place Name'), false);
    assert.equal(headers.includes('Address'), false);
    assert.equal(headers.includes('Past Gigs'), false);
    assert.equal(headers.includes('contactStatus'), false);
    assert.equal(headers.includes('draftStatus'), false);
});

test('venue editor builds structured booking fields from raw sheet aliases', () => {
    const modal = loadVenueEditModal();
    const fields = modal.buildVenueFromRawFields({
        'Place Name': 'Brighten Brewing Company',
        Address: '123 Main St',
        City: 'Cuyahoga Falls',
        State: 'OH',
        Zip: '44221',
        'Place ID': 'brighten-brewing-company',
        Latitude: '41.123',
        Longitude: '-81.456',
        Status: 'Contacted - Waiting on Reply',
        'Last Contacted': '2026-05-04',
        'Contact Name': 'Jamie',
        'Email/Contact': 'booking@example.com',
        'Phone Number': '440-555-1212',
        'Contact Type': 'Email',
        'Next Follow Up': '2026-05-11',
        Priority: '8',
        'Past Gigs': '2025-05-06 | COMPLETED | Brighten Brewing',
        'Future Gigs': '2026-05-06 | BOOKED | Brighten Brewing',
        'Last Played': '2025-05-06',
        'Next Booked': '2026-05-06',
        'Past Gig Count': '3',
        'Future Gig Count': '1',
        'Total Gig Count': '4',
        'Last Synced': '2026-05-06T20:00:00.000Z',
        Played: '',
        'private event': ''
    }, {
        id: 'brighten-brewing-company',
        played: true,
        privateEvent: true,
        contactStatus: 'Responded - Needs Action'
    });

    assert.equal(fields.id, 'brighten-brewing-company');
    assert.equal(fields.name, 'Brighten Brewing Company');
    assert.equal(fields.address, '123 Main St');
    assert.equal(fields.city, 'Cuyahoga Falls');
    assert.equal(fields.state, 'OH');
    assert.equal(fields.zip, '44221');
    assert.equal(fields.contactStatus, 'Contacted - Waiting on Reply');
    assert.equal(fields.contactName, 'Jamie');
    assert.equal(fields.contactEmail, 'booking@example.com');
    assert.equal(fields.contactPhone, '440-555-1212');
    assert.equal(fields.contactType, 'Email');
    assert.equal(fields.lastContactedDate, '2026-05-04');
    assert.equal(fields.nextFollowUpDate, '2026-05-11');
    assert.equal(fields.priority, '8');
    assert.equal(fields.calendarPastGigEvents, '2025-05-06 | COMPLETED | Brighten Brewing');
    assert.equal(fields.calendarFutureGigEvents, '2026-05-06 | BOOKED | Brighten Brewing');
    assert.equal(fields.calendarLastGigDate, '2025-05-06');
    assert.equal(fields.calendarNextGigDate, '2026-05-06');
    assert.equal(fields.calendarPastGigCount, '3');
    assert.equal(fields.calendarFutureGigCount, '1');
    assert.equal(fields.calendarTotalGigsPlayed, '4');
    assert.equal(fields.calendarLastSyncedAt, '2026-05-06T20:00:00.000Z');
    assert.equal(fields.played, false);
    assert.equal(fields.privateEvent, false);
});

test('venue editor focused CRM fields fall back to active pin identity', () => {
    const modal = loadVenueEditModal();
    const fields = modal.buildVenueFromRawFields({
        Status: 'Needs Review',
        'Last Contacted': '2026-05-07',
        'Contact Name': '',
        'Email/Contact': '',
        'Phone Number': '330-555-0101',
        'Contact Type': 'Phone',
        'Next Follow Up': '2026-05-14',
        Notes: ''
    }, {
        id: 'map-pin-1',
        name: 'Map Pin Room',
        address: '100 Music Ave',
        city: 'Akron',
        state: 'OH',
        zip: '44308',
        lat: '41.08',
        lng: '-81.52',
        notes: 'old notes',
        contactName: 'Old Name',
        contactEmail: 'old@example.com'
    });

    assert.equal(fields.id, 'map-pin-1');
    assert.equal(fields.name, 'Map Pin Room');
    assert.equal(fields.lat, '41.08');
    assert.equal(fields.lng, '-81.52');
    assert.equal(fields.contactStatus, 'Needs Review');
    assert.equal(fields.contactName, '');
    assert.equal(fields.contactEmail, '');
    assert.equal(fields.contactPhone, '330-555-0101');
    assert.equal(fields.contactType, 'Phone');
    assert.equal(fields.nextFollowUpDate, '2026-05-14');
    assert.equal(fields.notes, '');
});

test('venue editor seeds focused CRM fields from the current pin before Sheets loads', () => {
    const modal = loadVenueEditModal();
    const rawFields = modal.buildInitialRawFields({
        contactStatus: 'Booked',
        lastContactedDate: '2026-05-01',
        contactName: 'Jamie',
        contactEmail: 'booking@example.com',
        contactPhone: '330-555-1212',
        contactType: 'Email',
        nextFollowUpDate: '2026-05-15',
        notes: 'Confirm outdoor power.'
    });

    assert.deepEqual(plain(rawFields), {
        Status: 'Booked',
        'Last Contacted': '2026-05-01',
        'Contact Name': 'Jamie',
        'Email/Contact': 'booking@example.com',
        'Phone Number': '330-555-1212',
        'Contact Type': 'Email',
        'Next Follow Up': '2026-05-15',
        Notes: 'Confirm outdoor power.'
    });
});

test('venue editor treats green statuses as played for the map', () => {
    const modal = loadVenueEditModal();

    assert.equal(modal.buildVenueFromRawFields({ Status: 'Booked' }).played, true);
    assert.equal(modal.buildVenueFromRawFields({ Status: 'Played in the Past' }).played, true);
    assert.equal(modal.buildVenueFromRawFields({ Status: 'Played in the Past - Awaiting Reply' }).played, true);
    assert.equal(modal.buildVenueFromRawFields({ Status: 'Open Microphone' }).played, false);
    assert.equal(modal.buildVenueFromRawFields({ Status: 'Told No / Closed / No Music' }).doNotContact, true);
    assert.equal(modal.buildVenueFromRawFields({ Status: 'No Live Music' }).doNotContact, true);
});

test('venue editor preserves explicit false values and formats common date input', () => {
    const modal = loadVenueEditModal();
    const fields = modal.buildVenueFromRawFields({
        Status: '',
        Played: ''
    }, {
        id: 'venue-1',
        name: 'Venue One',
        lat: '41',
        lng: '-81',
        contactStatus: 'Booked',
        doNotContact: true,
        played: true
    });

    assert.equal(fields.contactStatus, '');
    assert.equal(fields.doNotContact, false);
    assert.equal(fields.played, false);
    assert.equal(modal.toDateInputValue('5/4/26'), '2026-05-04');
    assert.equal(modal.toDateInputValue('2026-05-11'), '2026-05-11');
});
