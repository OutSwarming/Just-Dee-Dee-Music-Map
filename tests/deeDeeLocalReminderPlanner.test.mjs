import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildReminderBody,
    appendArtistSyncWarning,
    extractGigDates,
    getServicePriorityForHealth,
    isDataFresh,
    isVerifiedMessageStatus,
    loadPlannerSnapshot,
    parseCsv,
    processReminderQueue,
    updateDeliveryHealth
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

test('follow-up reminders sort real dates before undated rows regardless of display format', async () => {
    const liveCsv = [
        'Place Name,Status,Next Follow Up,Priority',
        'Undated Priority Room,Follow Up Needed,,10',
        'Newer Due Room,Follow Up Needed,01/02/2024,2',
        'Oldest Due Room,Follow Up Needed,Wed Jan 01 2020 00:00:00 GMT-0500 (Eastern Standard Time),1'
    ].join('\n');

    const snapshot = await loadPlannerSnapshot({ venueCsvText: liveCsv });

    assert.deepEqual(
        snapshot.followUps.map(venue => venue.name),
        ['Oldest Due Room', 'Newer Due Room', 'Undated Priority Room']
    );
});

test('reminder freshness rejects data older than the two-day safety window', () => {
    const now = Date.parse('2026-08-30T12:00:00Z');
    assert.equal(isDataFresh(now - (47 * 60 * 60 * 1000), now), true);
    assert.equal(isDataFresh(now - (49 * 60 * 60 * 1000), now), false);
});

test('calendar reminders suppress totals when the calendar snapshot is stale', () => {
    const body = buildReminderBody(
        { id: 'available-dates', body: 'Hey Dee Dee! Check dates.\n\nhttps://example.test' },
        {
            calendarDataFresh: false,
            newPlaces: [],
            missingInfo: [],
            followUps: [],
            responded: [],
            futureGigs: [],
            blockedEvents: [],
            availability: {
                weekends: { dates: ['2099-01-01'], busyCount: 99 },
                weekdays: { dates: ['2099-01-02'], busyCount: 99 }
            }
        }
    );

    assert.match(body, /more than two days old/i);
    assert.doesNotMatch(body, /99 booked/i);
    assert.doesNotMatch(body, /2099-01-01/);
});

test('message delivery verification requires a readable successful Messages row', () => {
    assert.equal(isVerifiedMessageStatus(null), false);
    assert.equal(isVerifiedMessageStatus({ verified: false, error: 0, isSent: true }), false);
    assert.equal(isVerifiedMessageStatus({ verified: true, error: 1, isSent: true }), false);
    assert.equal(isVerifiedMessageStatus({ verified: true, error: 0, isSent: false, isDelivered: false }), false);
    assert.equal(isVerifiedMessageStatus({ verified: true, error: 0, isSent: true, isDelivered: false }), true);
});

test('delivery health recommends a provider fallback after 48 unverified hours', () => {
    const recipient = '+15555550123';
    const firstAttempt = new Date('2026-08-28T10:00:00Z');
    const afterWindow = new Date('2026-08-30T10:00:01Z');
    const first = updateDeliveryHealth({}, [{ recipient, service: 'iMessage', verified: false }], firstAttempt);
    const stale = updateDeliveryHealth(first, [{ recipient, service: 'iMessage', verified: false }], afterWindow);
    const recovered = updateDeliveryHealth(stale, [{ recipient, service: 'iMessage', verified: true }], new Date('2026-08-30T11:00:00Z'));

    assert.equal(first.fallbackRecommended, false);
    assert.equal(stale.fallbackRecommended, true);
    assert.deepEqual(stale.staleRecipients, [recipient]);
    assert.equal(recovered.fallbackRecommended, false);
    assert.equal(recovered.recipients[recipient].unverifiedSince, null);
});

test('delivery verification permission gaps do not trigger a false provider failure', () => {
    const recipient = '+15555550123';
    const firstAttempt = new Date('2026-08-28T10:00:00Z');
    const afterWindow = new Date('2026-08-30T10:00:01Z');
    const first = updateDeliveryHealth({}, [{
        recipient,
        service: 'iMessage',
        verified: false,
        verificationUnavailable: true,
        verificationReason: 'Messages database access denied.'
    }], firstAttempt);
    const later = updateDeliveryHealth(first, [], afterWindow);

    assert.equal(first.recipients[recipient].lastVerificationUnavailable, true);
    assert.equal(first.recipients[recipient].unverifiedSince, null);
    assert.equal(later.fallbackRecommended, false);
});

test('scheduled delivery switches from iMessage-first to SMS-first after the fallback window', () => {
    const recipient = '+15555550123';
    const firstAttempt = new Date('2026-08-28T10:00:00Z');
    const afterWindow = new Date('2026-08-30T10:00:01Z');
    const first = updateDeliveryHealth({}, [{ recipient, service: 'iMessage', verified: false }], firstAttempt);
    const stale = updateDeliveryHealth(first, [], afterWindow);

    assert.deepEqual(getServicePriorityForHealth(first), ['iMessage', 'SMS']);
    assert.deepEqual(getServicePriorityForHealth(stale), ['SMS', 'iMessage']);
});

test('stale artist sync is visibly added to reminder text', () => {
    const body = appendArtistSyncWarning('Normal reminder', {
        artistSyncFresh: false,
        artistSyncUpdatedAt: '2026-08-30T00:00:00Z'
    });
    assert.match(body, /Who Plays There are stale or failed/i);
    assert.match(body, /2026-08-30/);
});

test('queued web reminder crosses the bridge and local Messages worker connection', async () => {
    const requests = [];
    const sent = [];
    const fetchImpl = async (_url, options) => {
        const body = JSON.parse(options.body);
        requests.push(body);
        if (body.action === 'getPendingReminders') {
            return {
                ok: true,
                text: async () => JSON.stringify({
                    ok: true,
                    reminders: [{ requestId: 'queue-1', reminderId: 'follow-ups' }]
                })
            };
        }
        return { ok: true, text: async () => JSON.stringify({ ok: true, status: 'sent' }) };
    };

    const result = await processReminderQueue({
        fetchImpl,
        bridgeUrl: 'https://example.test/bridge',
        state: {},
        sendReminderImpl: async reminder => sent.push(reminder.id)
    });

    assert.deepEqual(sent, ['follow-ups']);
    assert.deepEqual(requests.map(request => request.action), ['getPendingReminders', 'completeReminder']);
    assert.equal(requests[1].requestId, 'queue-1');
    assert.equal(result.sent, 1);
    assert.equal(result.failed, 0);
});
