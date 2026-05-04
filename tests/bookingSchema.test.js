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

test('normalizeVenue clamps priority and best-fit scores for planner sorting', () => {
    const schema = loadBookingSchema();
    const booking = schema.normalizeVenue({
        contactStatus: 'Sent',
        priority: '12',
        bestFitScore: '8.4'
    });

    assert.equal(booking.priority, 10);
    assert.equal(booking.bestFitScore, 8);
    assert.equal(booking.isPriorityLead, true);
    assert.equal(schema.normalizeScore('-2'), 0);
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
    const upcomingGig = schema.normalizeVenue({
        contactStatus: 'Booked',
        eventDate: '2099-06-01'
    });
    const postGig = schema.normalizeVenue({
        contactStatus: 'Booked',
        eventDate: '2000-06-01'
    });

    assert.equal(booked.contactStatus, schema.CONTACT_STATUS.BOOKED);
    assert.equal(booked.isBooked, true);
    assert.equal(booked.isFollowUpDue, false);
    assert.equal(upcomingGig.isUpcomingGig, true);
    assert.equal(postGig.isPostGigFollowUpDue, true);
    assert.equal(missingInfo.isMissingInfo, true);
    assert.equal(missingInfo.hasContactInfo, false);

    const notFit = schema.normalizeVenue({
        contactStatus: 'Not a Fit',
        nextFollowUpDate: '2000-01-01'
    });
    assert.equal(notFit.isNotAFit, true);
    assert.equal(notFit.isFollowUpDue, false);
    assert.equal(notFit.isMissingInfo, false);
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
            id: 'priority',
            name: 'High Priority Pub',
            contactStatus: 'Sent',
            contactEmail: 'priority@example.com',
            priority: 8,
            bestFitScore: 7
        },
        {
            id: 'booked',
            name: 'Booked Festival',
            contactStatus: 'Booked',
            eventDate: '2099-07-04'
        },
        {
            id: 'post-gig',
            name: 'Past Booked Room',
            contactStatus: 'Booked',
            eventDate: '2000-07-04',
            contactEmail: 'past@example.com'
        },
        {
            id: 'missing',
            name: 'Missing Info Pub',
            contactStatus: 'Not Contacted'
        },
        {
            id: 'not-fit',
            name: 'Not Fit Room',
            contactStatus: 'Not a Fit',
            nextFollowUpDate: '2000-01-01'
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
    assert.deepEqual(ids(groups.priorityLeads), ['priority']);
    assert.deepEqual(ids(groups.booked), ['booked', 'post-gig']);
    assert.deepEqual(ids(groups.upcomingGigs), ['booked']);
    assert.deepEqual(ids(groups.postGigFollowUps), ['post-gig']);
    assert.deepEqual(ids(groups.notAFit), ['not-fit']);
    assert.deepEqual(ids(groups.missingInfo), ['missing']);
    assert.deepEqual(ids(groups.doNotContact), ['dnc']);
    assert.deepEqual(ids(groups.today), ['post-gig', 'follow-up', 'interested', 'priority', 'prospect', 'missing']);
});

test('daily agenda includes post-gig follow-through before upcoming gigs and prospects', () => {
    const schema = loadBookingSchema();
    const agenda = schema.getDailyAgenda([
        {
            id: 'prospect',
            name: 'New Prospect Cafe',
            contactStatus: 'Not Contacted',
            contactEmail: 'hello@example.com'
        },
        {
            id: 'upcoming',
            name: 'Upcoming Festival',
            contactStatus: 'Booked',
            eventDate: '2099-07-04'
        },
        {
            id: 'post-gig',
            name: 'Past Gig Room',
            contactStatus: 'Booked',
            eventDate: '2000-07-04'
        }
    ], 3);

    assert.deepEqual(Array.from(agenda, item => item.venueId), ['post-gig', 'upcoming', 'prospect']);
    assert.equal(agenda[0].type, 'postGigFollowUp');
    assert.match(agenda[0].suggestedAction, /thank-you/i);
    assert.equal(agenda[1].type, 'upcomingGig');
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
    assert.equal(agenda[3].type, 'priorityLead');
    assert.match(agenda[3].reason, /priority 9/i);
    assert.equal(agenda[5].suggestedAction, 'Research contact info');
});

test('filterVenues searches venue, location, contact, and booking status terms', () => {
    const schema = loadBookingSchema();
    const venues = [
        {
            id: 'brewery',
            name: 'Brighten Brewing Company',
            city: 'Cuyahoga Falls',
            venueType: 'Brewery',
            contactStatus: 'Sent',
            contactEmail: 'booking@brighten.example'
        },
        {
            id: 'winery',
            name: 'Lakeside Winery',
            city: 'Madison',
            venueType: 'Winery',
            contactStatus: 'Interested',
            contactName: 'Taylor'
        },
        {
            id: 'pub',
            name: 'Corner Pub',
            city: 'Akron',
            venueType: 'Pub/Bar',
            contactStatus: 'Not Contacted'
        }
    ];

    assert.deepEqual(ids(schema.filterVenues(venues, 'brighten sent')), ['brewery']);
    assert.deepEqual(ids(schema.filterVenues(venues, 'madison taylor')), ['winery']);
    assert.deepEqual(ids(schema.filterVenues(venues, 'pub bar akron')), ['pub']);
    assert.deepEqual(ids(schema.filterVenues(venues, 'missing')), []);
    assert.equal(schema.filterVenues(venues, '').length, 3);
});
