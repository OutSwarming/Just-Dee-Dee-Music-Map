const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadBookingModules() {
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
        RegExp
    };
    context.window = context;
    context.global = context;

    vm.createContext(context);
    ['modules/bookingSchema.js', 'modules/bookingActions.js'].forEach((relativePath) => {
        vm.runInContext(
            fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
            context,
            { filename: relativePath }
        );
    });

    return context.window.BARK;
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

test('mark sent sets sent status and schedules a seven day follow-up', () => {
    const bark = loadBookingModules();
    const patch = bark.bookingActions.buildStatusPatch(
        bark.bookingActions.ACTION_TYPES.MARK_SENT,
        { today: new Date(2026, 4, 4) }
    );

    assert.deepEqual(plain(patch), {
        contactStatus: bark.bookingSchema.CONTACT_STATUS.SENT,
        draftStatus: bark.bookingSchema.DRAFT_STATUS.SENT,
        lastContactedDate: '2026-05-04',
        nextFollowUpDate: '2026-05-11',
        doNotContact: false
    });
});

test('mark interested, booked, and do-not-contact produce predictable next steps', () => {
    const bark = loadBookingModules();
    const actions = bark.bookingActions.ACTION_TYPES;
    const today = new Date(2026, 4, 4);

    assert.deepEqual(plain(bark.bookingActions.buildStatusPatch(actions.MARK_INTERESTED, { today })), {
        contactStatus: bark.bookingSchema.CONTACT_STATUS.INTERESTED,
        nextFollowUpDate: '2026-05-06',
        doNotContact: false
    });

    assert.deepEqual(plain(bark.bookingActions.buildStatusPatch(actions.MARK_BOOKED, { today })), {
        contactStatus: bark.bookingSchema.CONTACT_STATUS.BOOKED,
        nextFollowUpDate: '',
        doNotContact: false
    });

    assert.deepEqual(plain(bark.bookingActions.buildStatusPatch(actions.MARK_DO_NOT_CONTACT, { today })), {
        contactStatus: bark.bookingSchema.CONTACT_STATUS.DO_NOT_CONTACT,
        nextFollowUpDate: '',
        doNotContact: true
    });
});

test('draft ready and not-a-fit actions produce predictable planner states', () => {
    const bark = loadBookingModules();
    const actions = bark.bookingActions.ACTION_TYPES;

    assert.deepEqual(plain(bark.bookingActions.buildStatusPatch(actions.MARK_DRAFT_READY)), {
        contactStatus: bark.bookingSchema.CONTACT_STATUS.DRAFT_READY,
        draftStatus: bark.bookingSchema.DRAFT_STATUS.DRAFT_READY,
        doNotContact: false
    });

    assert.deepEqual(plain(bark.bookingActions.buildStatusPatch(actions.MARK_NOT_A_FIT)), {
        contactStatus: bark.bookingSchema.CONTACT_STATUS.NOT_A_FIT,
        nextFollowUpDate: '',
        doNotContact: false
    });
});

test('raw field patch writes both legacy sheet headers and normalized CRM headers', () => {
    const bark = loadBookingModules();
    const rawFields = bark.bookingActions.buildRawFieldsPatch({
        contactStatus: bark.bookingSchema.CONTACT_STATUS.SENT,
        draftStatus: bark.bookingSchema.DRAFT_STATUS.SENT,
        lastContactedDate: '2026-05-04',
        nextFollowUpDate: '2026-05-11',
        doNotContact: false
    });

    assert.equal(rawFields.Status, 'Sent');
    assert.equal(rawFields.contactStatus, 'Sent');
    assert.equal(rawFields.Contacted, '2026-05-04');
    assert.equal(rawFields.lastContactedDate, '2026-05-04');
    assert.equal(rawFields.nextFollowUpDate, '2026-05-11');
    assert.equal(rawFields.draftStatus, 'Sent');
    assert.equal(rawFields.doNotContact, '');
    assert.equal(rawFields.DNC, '');
});

test('manual follow-up date patch validates and writes only follow-up fields', () => {
    const bark = loadBookingModules();
    const patch = bark.bookingActions.buildFollowUpDatePatch('2026-06-01');
    const payload = bark.bookingActions.buildFollowUpDateSavePayload({ id: 'venue-1' }, '2026-06-01');

    assert.deepEqual(plain(patch), {
        nextFollowUpDate: '2026-06-01'
    });
    assert.equal(payload.id, 'venue-1');
    assert.equal(payload.actionType, bark.bookingActions.ACTION_TYPES.SET_FOLLOW_UP_DATE);
    assert.equal(payload.rawFields.nextFollowUpDate, '2026-06-01');
    assert.equal(payload.rawFields['next follow up date'], '2026-06-01');
    assert.equal(Object.prototype.hasOwnProperty.call(payload.rawFields, 'Status'), false);
    assert.throws(() => bark.bookingActions.buildFollowUpDatePatch(''), /required/);
    assert.throws(() => bark.bookingActions.buildFollowUpDatePatch('not a date'), /not valid/);
});

test('mergeBookingPatch updates dashboard flags without dropping venue details', () => {
    const bark = loadBookingModules();
    const updated = bark.bookingActions.mergeBookingPatch({
        id: 'venue-1',
        name: 'Test Venue',
        contactEmail: 'booking@example.com',
        booking: bark.bookingSchema.normalizeVenue({
            contactEmail: 'booking@example.com',
            contactStatus: 'Not Contacted'
        })
    }, {
        contactStatus: bark.bookingSchema.CONTACT_STATUS.SENT,
        nextFollowUpDate: '2000-01-01',
        doNotContact: false
    });

    assert.equal(updated.id, 'venue-1');
    assert.equal(updated.name, 'Test Venue');
    assert.equal(updated.booking.contactEmail, 'booking@example.com');
    assert.equal(updated.booking.contactStatus, bark.bookingSchema.CONTACT_STATUS.SENT);
    assert.equal(updated.booking.isFollowUpDue, true);
});
