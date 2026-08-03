import assert from 'node:assert/strict';
import test from 'node:test';
import {
    extractGigDates,
    loadPlannerSnapshot,
    parseCsv
} from '../scripts/dee-dee-local-text-reminders.mjs';

test('reminder CSV parser preserves quoted live-map fields', () => {
    const rows = parseCsv([
        'Place Name,City,Notes',
        '"Room, The",Akron,"Call, then email"'
    ].join('\n'));
    assert.deepEqual(rows, [{ 'Place Name': 'Room, The', City: 'Akron', Notes: 'Call, then email' }]);
});

test('reminder planner extracts current future gigs from the live map CSV snapshot', async () => {
    const liveCsv = [
        'Place Name,Status,Email/Contact,Future Gigs,Next Booked',
        'Live New Room,Not Contacted Yet,bookings@example.com,2099-08-15; 2099-09-20,2099-08-15',
        'Follow Up Room,Follow Up Needed,booking@example.com,,'
    ].join('\n');

    const snapshot = await loadPlannerSnapshot({ venueCsvText: liveCsv });

    assert.equal(snapshot.venueDataSource, 'injected');
    assert.ok(snapshot.newPlaces.some(venue => venue.name === 'Live New Room'));
    assert.ok(snapshot.followUps.some(venue => venue.name === 'Follow Up Room'));
    assert.ok(snapshot.futureGigs.some(gig => gig.eventDate === '2099-08-15' && gig.venueName === 'Live New Room'));
    assert.deepEqual(extractGigDates('2099-08-15; Sun Sep 20 2099'), ['2099-08-15', '2099-09-20']);
});
