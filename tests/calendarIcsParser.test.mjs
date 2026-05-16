import assert from 'node:assert/strict';
import test from 'node:test';
import {
    parseJddmCalendarAvailabilityBlocks,
    parseJddmCalendarIcs,
    splitPastFutureCalendarGigs
} from '../scripts/lib/jddmCalendarIcsParser.mjs';

const FIXTURE_ICS = `BEGIN:VCALENDAR
X-WR-CALNAME:justdeedeemusic@gmail.com
BEGIN:VEVENT
DTSTART:20250823T220000Z
DTEND:20250824T010000Z
UID:bummin@example.com
SUMMARY:Bummin\\' Beaver Brewery
LOCATION:11610 E Washington St\\, Chagrin Falls\\, OH 44023
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260521
DTEND;VALUE=DATE:20260522
UID:camping@example.com
SUMMARY:Camping Gilead State Park
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260601
DTEND;VALUE=DATE:20260605
UID:vacation@example.com
SUMMARY:Vacation
END:VEVENT
BEGIN:VEVENT
DTSTART:20260424T220000Z
DTEND:20260425T010000Z
UID:proposed@example.com
SUMMARY:Bait House Brewery - Proposed
END:VEVENT
BEGIN:VEVENT
DTSTART:20241013T180000Z
DTEND:20241013T190000Z
UID:private@example.com
SUMMARY:JDDM Private Event
END:VEVENT
END:VCALENDAR`;

test('parseJddmCalendarIcs extracts gigs and filters obvious non-gig calendar blocks', () => {
    const gigs = parseJddmCalendarIcs(FIXTURE_ICS, {
        sourceUrl: 'calendar.ics',
        sourceCapturedAt: '2026-05-06T12:00:00Z',
        timezone: 'America/New_York'
    });

    assert.deepEqual(gigs.map((gig) => gig.calendarEventId), [
        'private@example.com',
        'bummin@example.com',
        'proposed@example.com'
    ]);

    const bummin = gigs.find((gig) => gig.calendarEventId === 'bummin@example.com');
    assert.equal(bummin.eventDate, '2025-08-23');
    assert.equal(bummin.eventTime, '6:00pm');
    assert.equal(bummin.eventEndTime, '9:00pm');
    assert.equal(bummin.venueName, "Bummin' Beaver Brewery");
    assert.equal(bummin.location, '11610 E Washington St, Chagrin Falls, OH 44023');

    const privateGig = gigs.find((gig) => gig.calendarEventId === 'private@example.com');
    assert.equal(privateGig.isPrivateEvent, true);
    assert.equal(privateGig.venueName, 'Private Event');

    const proposed = gigs.find((gig) => gig.calendarEventId === 'proposed@example.com');
    assert.equal(proposed.status, 'PROPOSED');
});

test('parseJddmCalendarAvailabilityBlocks keeps non-gig blocked dates', () => {
    const blocks = parseJddmCalendarAvailabilityBlocks(FIXTURE_ICS, {
        sourceUrl: 'calendar.ics',
        sourceCapturedAt: '2026-05-06T12:00:00Z',
        timezone: 'America/New_York'
    });

    assert.deepEqual(blocks.map((block) => block.calendarEventId), [
        'camping@example.com',
        'vacation@example.com'
    ]);

    const vacation = blocks.find((block) => block.calendarEventId === 'vacation@example.com');
    assert.equal(vacation.status, 'BLOCKED');
    assert.equal(vacation.eventDate, '2026-06-01');
    assert.equal(vacation.eventEndDate, '2026-06-05');
    assert.equal(vacation.summary, 'Vacation');
});

test('splitPastFutureCalendarGigs separates completed, booked, and proposed events', () => {
    const gigs = parseJddmCalendarIcs(FIXTURE_ICS, {
        timezone: 'America/New_York'
    });
    const split = splitPastFutureCalendarGigs(gigs, {
        now: '2026-05-06T12:00:00-04:00',
        timezone: 'America/New_York'
    });

    assert.deepEqual(split.past.map((gig) => gig.calendarEventId), [
        'private@example.com',
        'bummin@example.com'
    ]);
    assert.deepEqual(split.future.map((gig) => gig.calendarEventId), []);
    assert.deepEqual(split.proposed.map((gig) => gig.calendarEventId), ['proposed@example.com']);
});
