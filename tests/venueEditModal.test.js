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

test('venue editor always exposes generated booking CRM fields', () => {
    const modal = loadVenueEditModal();
    const headers = modal.getRenderableHeaders({
        Place: 'Brighten Brewing Company, Cuyahoga Falls, OH 44221',
        Status: 'Sent',
        Notes: 'Great fit for acoustic sets.'
    });

    assert.deepEqual(plain(headers).filter(header => [
        'contactStatus',
        'draftStatus',
        'lastContactedDate',
        'nextFollowUpDate',
        'doNotContact',
        'priority',
        'bestFitScore'
    ].includes(header)), [
        'contactStatus',
        'draftStatus',
        'lastContactedDate',
        'nextFollowUpDate',
        'doNotContact',
        'priority',
        'bestFitScore'
    ]);
});

test('venue editor builds structured booking fields from raw sheet aliases', () => {
    const modal = loadVenueEditModal();
    const fields = modal.buildVenueFromRawFields({
        Place: 'Brighten Brewing Company, 123 Main St, Cuyahoga Falls, OH 44221',
        Latitude: '41.123',
        Longitude: '-81.456',
        Status: 'Sent',
        draftStatus: 'Draft Ready',
        lastContactedDate: '2026-05-04',
        nextFollowUpDate: '2026-05-11',
        priority: '8',
        bestFitScore: '9',
        doNotContact: 'Yes',
        Played: '',
        'private event': ''
    }, {
        id: 'brighten-brewing-company',
        played: true,
        privateEvent: true,
        contactStatus: 'Interested'
    });

    assert.equal(fields.id, 'brighten-brewing-company');
    assert.equal(fields.name, 'Brighten Brewing Company');
    assert.equal(fields.address, '123 Main St');
    assert.equal(fields.city, 'Cuyahoga Falls');
    assert.equal(fields.state, 'OH');
    assert.equal(fields.zip, '44221');
    assert.equal(fields.contactStatus, 'Sent');
    assert.equal(fields.draftStatus, 'Draft Ready');
    assert.equal(fields.lastContactedDate, '2026-05-04');
    assert.equal(fields.nextFollowUpDate, '2026-05-11');
    assert.equal(fields.priority, '8');
    assert.equal(fields.bestFitScore, '9');
    assert.equal(fields.doNotContact, true);
    assert.equal(fields.played, false);
    assert.equal(fields.privateEvent, false);
});

test('venue editor preserves explicit false values and formats common date input', () => {
    const modal = loadVenueEditModal();
    const fields = modal.buildVenueFromRawFields({
        contactStatus: '',
        doNotContact: '',
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
