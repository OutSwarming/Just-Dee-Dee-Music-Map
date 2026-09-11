const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadBookingSchema(now) {
    const Clock = now ? class extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
    } : Date;
    const context = {
        console,
        Date: Clock,
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
    assert.equal(booking.contactStatus, schema.CONTACT_STATUS.NOT_SET);
    assert.equal(booking.isNewProspect, false);
    assert.equal(booking.isNeedsReview, true);
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
    assert.equal(booking.contactStatus, schema.CONTACT_STATUS.TOLD_NO_CLOSED_NO_MUSIC);
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
    const awaitingReply = schema.normalizeVenue({
        contactStatus: 'Played in the Past - Awaiting Reply'
    });
    const openMic = schema.normalizeVenue({
        contactStatus: 'Open Microphone'
    });

    assert.equal(booked.contactStatus, schema.CONTACT_STATUS.BOOKED);
    assert.equal(booked.isBooked, true);
    assert.equal(booked.isFollowUpDue, false);
    assert.equal(upcomingGig.isUpcomingGig, true);
    assert.equal(postGig.isPostGigFollowUpDue, true);
    assert.equal(awaitingReply.isPlayedPast, true);
    assert.equal(awaitingReply.isPlayedPastAwaitingReply, true);
    assert.equal(openMic.isOpenMicrophone, true);
    assert.equal(openMic.isPlayedForMap, true);
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

test('getVenueMapState maps only CRM Status into pin color states', () => {
    const schema = loadBookingSchema();

    assert.equal(schema.getVenueMapState({ contactStatus: 'Booked' }), 'booked');
    assert.equal(schema.getVenueMapState({ contactStatus: 'Played in the Past' }), 'played');
    assert.equal(schema.getVenueMapState({ contactStatus: 'Played in the Past - Awaiting Reply' }), 'played');
    assert.equal(schema.getVenueMapState({ contactStatus: 'Open Microphone' }), 'played');
    assert.equal(schema.getVenueMapState({ contactStatus: 'Told No / Closed / No Music' }), 'closed');
    assert.equal(schema.getVenueMapState({ contactStatus: 'Not Interested / Do Not Contact' }), 'closed');
    assert.equal(schema.getVenueMapState({ contactStatus: 'Not Contacted Yet', played: true }), 'default');
});

test('date helpers support common spreadsheet date formats', () => {
    const schema = loadBookingSchema();

    assert.equal(schema.parseLocalDate('2026-05-04').getFullYear(), 2026);
    assert.equal(schema.parseLocalDate('5/4/26').getFullYear(), 2026);
    assert.equal(schema.isDue('2000-01-01'), true);
    assert.equal(schema.isDue('2099-01-01'), false);
    assert.equal(schema.isDue(''), false);
});

test('gig stats dedupe rich calendar history and ignore inflated total counts', () => {
    const schema = loadBookingSchema();
    const stats = schema.getVenueGigStats({
        calendarPastGigEvents: [
            '2025-06-14',
            '2025-06-14 2:00pm ET | COMPLETED | Castaway Craigs | 2114 Grandview Rd',
            'Sat May 02 2026 00:00:00 GMT-0400 (Eastern Daylight Time)'
        ].join('; '),
        calendarFutureGigEvents: [
            '2099-07-31',
            'Fri Jul 31 2099 00:00:00 GMT-0400 (Eastern Daylight Time)',
            '2099-08-14 6:00pm ET | BOOKED | Bummin Beaver | 11610 E Washington St',
            '2000-01-01'
        ].join('; '),
        calendarPastGigCount: '68',
        calendarFutureGigCount: '14',
        calendarTotalGigsPlayed: '82'
    });

    assert.deepEqual(stats.pastDates, ['2000-01-01', '2025-06-14', '2026-05-02']);
    assert.deepEqual(stats.futureDates, ['2099-07-31', '2099-08-14']);
    assert.equal(stats.pastCount, 3);
    assert.equal(stats.futureCount, 2);
    assert.equal(stats.totalCount, 5);

    const booking = schema.normalizeVenue({
        calendarPastGigEvents: '2025-06-14; 2025-06-14 2:00pm ET | COMPLETED | Venue',
        calendarPastGigCount: '12',
        calendarTotalGigsPlayed: '99'
    });
    assert.equal(booking.calendarPastGigCount, 1);
    assert.equal(booking.calendarFutureGigCount, 0);
    assert.equal(booking.calendarTotalGigsPlayed, 1);
});

test('gig stats treat count columns as generated output, not source data', () => {
    const schema = loadBookingSchema();
    const stats = schema.getVenueGigStats({
        calendarPastGigCount: '7',
        calendarFutureGigCount: '2',
        calendarTotalGigsPlayed: '99',
        calendarLastGigDate: '2025-01-01',
        calendarNextGigDate: '2099-01-01'
    });

    assert.deepEqual(stats.pastDates, []);
    assert.deepEqual(stats.futureDates, []);
    assert.equal(stats.pastCount, 0);
    assert.equal(stats.futureCount, 0);
    assert.equal(stats.totalCount, 0);
});

test('gig stats do not count ZIP codes or historical ids as fake dates', () => {
    const schema = loadBookingSchema();
    const stats = schema.getVenueGigStats({
        calendarPastGigEvents: [
            '2024-03-28 | COMPLETED | Lost Trail Winery | 5228 State St NE',
            'OH 44721 | historical-2024-03-28-lost-trail-winery-live',
            'last played=2024-03-28.'
        ].join('; ')
    });

    assert.deepEqual(stats.pastDates, ['2024-03-28']);
    assert.equal(schema.extractGigDates('OH 44280 | historical venue id').length, 0);
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

    assert.deepEqual(ids(groups.followUps), []);
    assert.equal(groups.all.find(v => v.id === 'follow-up').booking.nextFollowUpDate, '2000-01-01');
    assert.deepEqual(ids(groups.newProspects), ['prospect']);
    assert.deepEqual(ids(groups.interested), ['interested']);
    assert.deepEqual(ids(groups.priorityLeads), ['priority']);
    assert.deepEqual(ids(groups.booked), ['booked', 'post-gig']);
    assert.deepEqual(ids(groups.upcomingGigs), ['booked']);
    assert.deepEqual(ids(groups.postGigFollowUps), ['post-gig']);
    assert.deepEqual(ids(groups.notAFit), ['not-fit', 'dnc']);
    assert.deepEqual(ids(groups.missingInfo), ['missing']);
    assert.deepEqual(ids(groups.doNotContact), ['not-fit', 'dnc']);
    assert.deepEqual(ids(groups.today), []);
    assert.equal(groups.stateSummary.length, schema.CONTACT_STATUS_VALUES.length);
    assert.deepEqual(Array.from(groups.stateSummary.slice(0, 4), item => item.status), [
        schema.CONTACT_STATUS.RESPONDED_NEEDS_ACTION,
        schema.CONTACT_STATUS.FOLLOW_UP_NEEDED,
        schema.CONTACT_STATUS.NEEDS_REVIEW,
        schema.CONTACT_STATUS.BOOKED
    ]);
    assert.equal(groups.statusGroups[schema.CONTACT_STATUS.BOOKED].length, 2);
    assert.equal(groups.statusGroups[schema.CONTACT_STATUS.RESPONDED_NEEDS_ACTION].length, 1);
    assert.equal(groups.statusGroups[schema.CONTACT_STATUS.TOLD_NO_CLOSED_NO_MUSIC].length, 2);
    assert.equal(groups.stateSummary.reduce((sum, item) => sum + item.count, 0), groups.all.length);
});

test('agenda shows only today and next two Eastern days without changing source dates', () => {
    const schema = loadBookingSchema('2026-09-12T02:00:00Z'); // Still Sep 11 Eastern.
    const row = (id, date, status = 'Sent') => ({id, name: id, contactStatus: status, nextFollowUpDate: date});
    const rows = [row('old', '2026-09-10'), row('today', '2026-09-11'),
        row('tomorrow', '2026-09-12'), row('day2', '2026-09-13', 'Interested'),
        row('later', '2026-09-14'), row('undated', ''), row('closed', '2026-09-11', 'Told No / Closed / No Music'),
        {id: 'gig', name: 'Gig', contactStatus: 'Booked', eventDate: '2026-09-12'},
        {id: 'old-gig', name: 'Past Gig', contactStatus: 'Booked', eventDate: '2026-09-10'}];
    const before = JSON.stringify(rows);
    const groups = schema.getDashboardGroups(rows);
    assert.deepEqual(Array.from(groups.dailyAgendaSections, s => s.id), ['today', 'tomorrow', 'dayAfter']);
    assert.deepEqual(Array.from(groups.dailyAgenda, x => x.venueId), ['today', 'gig', 'tomorrow', 'day2']);
    assert.equal(groups.dailyAgenda.at(-1).type, 'interestedDue');
    assert.equal(JSON.stringify(rows), before);
    assert.equal(groups.all.find(v => v.id === 'old').booking.nextFollowUpDate, '2026-09-10');
    assert.equal(groups.followUps.some(v => v.id === 'old'), false);
    assert.equal(schema.getAgendaTargetIds(rows).has('old'), false);
});

test('agenda advances through month end and Eastern daylight-saving changes', () => {
    for (const [now, dates] of [
        ['2026-12-31T17:00:00Z', ['2026-12-31', '2027-01-01', '2027-01-02']],
        ['2026-11-01T04:30:00Z', ['2026-11-01', '2026-11-02', '2026-11-03']],
        ['2026-03-08T05:30:00Z', ['2026-03-08', '2026-03-09', '2026-03-10']]
    ]) {
        const schema = loadBookingSchema(now);
        const sections = schema.getDailyAgendaSections(dates.map((date, i) => ({id: String(i), contactStatus: 'Sent', nextFollowUpDate: date})));
        assert.deepEqual(Array.from(sections, s => s.date), dates);
        assert.deepEqual(Array.from(sections, s => s.items.length), [1, 1, 1]);
    }
});

test('agenda keeps a gig and a scheduled follow-up at the same venue as separate tasks', () => {
    const schema = loadBookingSchema('2026-09-11T14:00:00Z');
    const rows = [{id: 'both', name: 'Both', contactStatus: 'Booked', eventDate: '2026-09-11', nextFollowUpDate: '2026-09-12'}];
    assert.deepEqual(Array.from(schema.getDailyAgenda(rows), x => x.type), ['upcomingGig', 'followUpDue']);
    assert.equal(schema.getDailyAgenda(rows, 1).length, 1);
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

    assert.deepEqual(ids(schema.filterVenues(venues, 'brighten waiting')), ['brewery']);
    assert.deepEqual(ids(schema.filterVenues(venues, 'madison taylor')), ['winery']);
    assert.deepEqual(ids(schema.filterVenues(venues, 'pub bar akron')), ['pub']);
    assert.deepEqual(ids(schema.filterVenues(venues, 'missing')), []);
    assert.equal(schema.filterVenues(venues, '').length, 3);
});

 test('agenda includes saved Future Gigs even without the legacy event-date column', () => {
    const schema = loadBookingSchema('2026-09-11T14:00:00Z');
    const rows = [{id: 'calendar', name: 'Calendar venue', contactStatus: 'Played in the Past',
        calendarFutureGigEvents: '2026-09-11; 2026-09-13; 2026-09-20'}];
    const agenda = schema.getDailyAgenda(rows);
    assert.deepEqual(Array.from(agenda, x => x.eventDate), ['2026-09-11', '2026-09-13']);
    assert.deepEqual(Array.from(agenda, x => x.venue.booking.eventDate), ['2026-09-11', '2026-09-13']);
 });
