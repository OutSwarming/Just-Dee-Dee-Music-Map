const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadBookingSchema() {
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
    vm.runInContext(
        fs.readFileSync(path.join(ROOT, 'modules/bookingSchema.js'), 'utf8'),
        context,
        { filename: 'modules/bookingSchema.js' }
    );

    return context.window.BARK.bookingSchema;
}

function ids(venues) {
    return Array.from(venues, venue => venue.id);
}

test('normalizeVenue extracts booking contact details and prospect flags', () => {
    const schema = loadBookingSchema();
    const booking = schema.normalizeVenue({
        name: 'Brighten Brewing Company',
        bookingContact: 'Jamie Booker | bookings@example.com | 440-555-1212'
    });

    assert.equal(booking.contactName, 'Jamie Booker');
    assert.equal(booking.contactEmail, 'bookings@example.com');
    assert.equal(booking.contactPhone, '440-555-1212');
    assert.equal(booking.contactStatus, schema.CONTACT_STATUS.NOT_CONTACTED);
    assert.equal(booking.isNewProspect, true);
    assert.equal(booking.hasContactInfo, true);
});

test('normalizeVenue treats do-not-contact as an outreach stop sign', () => {
    const schema = loadBookingSchema();
    const booking = schema.normalizeVenue({
        contactEmail: 'owner@example.com',
        contactStatus: 'Not Contacted',
        doNotContact: 'yes'
    });

    assert.equal(booking.doNotContact, true);
    assert.equal(booking.contactStatus, schema.CONTACT_STATUS.DO_NOT_CONTACT);
    assert.equal(booking.isNewProspect, false);
    assert.equal(booking.isFollowUpDue, false);
});

test('normalizeVenue identifies booked events and missing-info venues safely', () => {
    const schema = loadBookingSchema();
    const booked = schema.normalizeVenue({
        eventDate: '2099-06-01',
        nextFollowUpDate: '2000-01-01'
    });
    const missingInfo = schema.normalizeVenue({
        name: 'Mystery Listening Room',
        contactStatus: 'Not Contacted'
    });

    assert.equal(booked.contactStatus, schema.CONTACT_STATUS.BOOKED);
    assert.equal(booked.isBooked, true);
    assert.equal(booked.isFollowUpDue, false);
    assert.equal(missingInfo.isMissingInfo, true);
    assert.equal(missingInfo.hasContactInfo, false);
});

test('date helpers support common spreadsheet date formats', () => {
    const schema = loadBookingSchema();

    assert.equal(schema.parseLocalDate('2026-05-04').getFullYear(), 2026);
    assert.equal(schema.parseLocalDate('5/4/26').getFullYear(), 2026);
    assert.equal(schema.isDue('2000-01-01'), true);
    assert.equal(schema.isDue('2099-01-01'), false);
    assert.equal(schema.isDue(''), false);
});

test('getDashboardGroups separates today, follow-ups, prospects, booked, and do-not-contact', () => {
    const schema = loadBookingSchema();
    const groups = schema.getDashboardGroups([
        {
            id: 'follow-up',
            name: 'Follow Up Room',
            contactStatus: 'Sent',
            nextFollowUpDate: '2000-01-01',
            contactEmail: 'follow@example.com'
        },
        {
            id: 'prospect',
            name: 'New Prospect Cafe',
            contactStatus: 'Not Contacted',
            contactEmail: 'hello@example.com'
        },
        {
            id: 'interested',
            name: 'Interested Winery',
            contactStatus: 'Interested',
            contactEmail: 'wine@example.com'
        },
        {
            id: 'booked',
            name: 'Booked Festival',
            contactStatus: 'Booked',
            eventDate: '2099-07-04'
        },
        {
            id: 'missing',
            name: 'Missing Info Pub',
            contactStatus: 'Not Contacted'
        },
        {
            id: 'dnc',
            name: 'Do Not Contact Hall',
            doNotContact: 'true',
            contactEmail: 'stop@example.com'
        }
    ]);

    assert.deepEqual(ids(groups.followUps), ['follow-up']);
    assert.deepEqual(ids(groups.newProspects), ['prospect']);
    assert.deepEqual(ids(groups.interested), ['interested']);
    assert.deepEqual(ids(groups.booked), ['booked']);
    assert.deepEqual(ids(groups.missingInfo), ['missing']);
    assert.deepEqual(ids(groups.doNotContact), ['dnc']);
    assert.deepEqual(ids(groups.today), ['follow-up', 'interested', 'prospect', 'missing']);
});

test('daily agenda prioritizes interested follow-ups, due follow-ups, prospects, and missing info', () => {
    const schema = loadBookingSchema();
    const agenda = schema.getDailyAgenda([
        {
            id: 'prospect-low',
            name: 'Low Fit Cafe',
            contactStatus: 'Not Contacted',
            contactEmail: 'low@example.com',
            priority: 1
        },
        {
            id: 'missing',
            name: 'Mystery Pub',
            contactStatus: 'Not Contacted'
        },
        {
            id: 'follow-up',
            name: 'Sent Brewery',
            contactStatus: 'Sent',
            nextFollowUpDate: '2000-01-01',
            contactEmail: 'sent@example.com'
        },
        {
            id: 'interested-due',
            name: 'Interested Winery',
            contactStatus: 'Interested',
            nextFollowUpDate: '2000-01-02',
            contactEmail: 'wine@example.com'
        },
        {
            id: 'prospect-high',
            name: 'High Fit Room',
            contactStatus: 'Not Contacted',
            contactEmail: 'high@example.com',
            priority: 9
        },
        {
            id: 'interested',
            name: 'Interested Gallery',
            contactStatus: 'Interested',
            contactEmail: 'gallery@example.com'
        }
    ], 6);

    assert.deepEqual(Array.from(agenda, item => item.venueId), [
        'interested-due',
        'follow-up',
        'interested',
        'prospect-high',
        'prospect-low',
        'missing'
    ]);
    assert.equal(agenda[0].type, 'interestedDue');
    assert.match(agenda[0].suggestedAction, /mark booked/i);
    assert.equal(agenda[3].reason, 'New venue ready for first outreach');
    assert.equal(agenda[5].suggestedAction, 'Research contact info');
});
