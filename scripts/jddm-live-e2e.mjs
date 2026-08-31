#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseCsv } from './dee-dee-local-text-reminders.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_BRIDGE_URL = 'https://us-central1-barkrangermap-auth.cloudfunctions.net/jddmSpreadsheetBridge';
const ARTIST_SHEETS = ['Events', 'Event_Artists', 'Venue_Artist_History'];

function hasFlag(flag) {
    return process.argv.includes(flag);
}

function argValue(flag) {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? String(process.argv[index + 1] || '') : '';
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function postBridge(bridgeUrl, action, payload = {}) {
    const response = await fetch(bridgeUrl, {
        method: 'POST',
        redirect: 'follow',
        cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, ...payload }),
        signal: AbortSignal.timeout(90000)
    });
    const text = await response.text();
    let result;
    try {
        result = JSON.parse(text);
    } catch {
        throw new Error(`${action} returned a non-JSON response (HTTP ${response.status}).`);
    }
    if (!response.ok || !result || result.ok === false) {
        throw new Error(`${action} failed: ${(result && result.message) || `HTTP ${response.status}`}`);
    }
    return result;
}

function validateArtistConnections(tables) {
    const events = parseCsv(tables.Events.csv);
    const eventArtists = parseCsv(tables.Event_Artists.csv);
    const history = parseCsv(tables.Venue_Artist_History.csv);
    assert(events.length > 0, 'Events is empty.');
    assert(eventArtists.length > 0, 'Event_Artists is empty.');
    assert(history.length > 0, 'Venue_Artist_History is empty.');

    const eventIds = new Set(events.map(row => row.event_id).filter(Boolean));
    const missingEventArtistLinks = eventArtists.filter(row => row.event_id && !eventIds.has(row.event_id));
    const missingHistoryLinks = history.filter(row => row.last_event_id && !eventIds.has(row.last_event_id));
    const seenHistoryKeys = new Set();
    const duplicateHistoryKeys = [];
    history.forEach(row => {
        const key = `${row.venue_id}|${row.artist_id}`;
        if (seenHistoryKeys.has(key)) duplicateHistoryKeys.push(key);
        seenHistoryKeys.add(key);
    });
    const furiousGeorgeRows = history.filter(row => /furious george/i.test(row.artist_name || ''));

    assert(missingEventArtistLinks.length === 0, `Event_Artists has ${missingEventArtistLinks.length} broken event links.`);
    assert(missingHistoryLinks.length === 0, `Who Plays There has ${missingHistoryLinks.length} broken last-event links.`);
    assert(duplicateHistoryKeys.length === 0, `Who Plays There has ${duplicateHistoryKeys.length} duplicate venue/artist rows.`);
    assert(furiousGeorgeRows.length > 0, 'Who Plays There has no Furious George rows.');

    return {
        events: events.length,
        eventArtists: eventArtists.length,
        whoPlaysThere: history.length,
        furiousGeorgeVenues: furiousGeorgeRows.length
    };
}

async function verifyFixedReminderSchedule() {
    const { stdout } = await execFileAsync('launchctl', ['print', `gui/${process.getuid()}/com.justdeedeemusic.local-text-reminders`]);
    const hours = [9, 12, 16, 19];
    hours.forEach(hour => assert(stdout.includes(`"Hour" => ${hour}`), `Reminder schedule is missing hour ${hour}.`));
    assert(!/StartInterval|start interval/i.test(stdout), 'Reminder schedule still contains an interval trigger.');
    return hours.map(hour => `${String(hour).padStart(2, '0')}:00`);
}

async function main() {
    if (!hasFlag('--execute')) {
        throw new Error('Live writes are guarded. Re-run with --execute. Add --exercise-artist-write and --send-reminder for the complete production test.');
    }

    const bridgeUrl = argValue('--bridge-url') || process.env.JDDM_SPREADSHEET_BRIDGE_URL || DEFAULT_BRIDGE_URL;
    const runToken = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const venueId = `jddm-e2e-${runToken}`;
    const venueName = `JDDM E2E Healthcheck ${runToken}`;
    let created = false;
    const summary = { bridgeUrl, venueCreateEdit: false, artistRead: false, artistWrite: false, reminderQueue: false };

    try {
        const health = await postBridge(bridgeUrl, 'health');
        assert(health.capabilities && health.capabilities.reliableVenueWrites, 'Bridge does not advertise reliable venue writes.');
        assert(health.capabilities.artistTrackerReadWrite, 'Bridge does not advertise artist read/write support.');
        assert(health.capabilities.reminderQueue, 'Bridge does not advertise reminder queue support.');
        assert(health.capabilities.guardedEndToEndCleanup, 'Bridge does not advertise guarded test cleanup.');

        const createResult = await postBridge(bridgeUrl, 'createVenue', {
            requestId: `create-${runToken}`,
            rawFields: {
                'Place Name': venueName,
                Address: 'Temporary automated test record',
                City: 'Cleveland',
                State: 'OH',
                Zip: '44101',
                'Place ID': venueId,
                Longitude: '-81.6944',
                Latitude: '41.4993',
                Status: 'Follow Up Needed',
                Priority: '10',
                'Next Follow Up': '2020-01-01',
                Notes: `[JDDM E2E TEST] ${runToken}`
            }
        });
        created = true;
        assert(createResult.rawFields && createResult.rawFields['Place ID'] === venueId, 'Created venue ID did not round-trip.');
        assert(createResult.csv === undefined, 'Create response unexpectedly returned the entire spreadsheet.');

        await postBridge(bridgeUrl, 'saveVenue', {
            requestId: `save-${runToken}`,
            id: venueId,
            rawFields: { Status: 'Not Contacted Yet', 'Next Follow Up': '2099-01-01' }
        });
        const saved = await postBridge(bridgeUrl, 'getVenue', { id: venueId });
        assert(saved.rawFields.Status === 'Not Contacted Yet', 'Edited status did not round-trip.');
        assert(String(saved.rawFields['Next Follow Up']).includes('2099'), 'Edited follow-up date did not round-trip.');
        summary.venueCreateEdit = true;

        const tables = {};
        for (const sheetName of ARTIST_SHEETS) {
            tables[sheetName] = await postBridge(bridgeUrl, 'getArtistTrackerTable', { sheetName });
        }
        summary.artistConnections = validateArtistConnections(tables);
        summary.artistRead = true;

        if (hasFlag('--exercise-artist-write')) {
            const writeResult = await postBridge(bridgeUrl, 'syncArtistTrackerTable', {
                sheetName: 'Venue_Artist_History',
                csv: tables.Venue_Artist_History.csv
            });
            assert(writeResult.rowCount === tables.Venue_Artist_History.rowCount, 'Artist no-op write changed the history row count.');
            const readBack = await postBridge(bridgeUrl, 'getArtistTrackerTable', { sheetName: 'Venue_Artist_History' });
            assert(readBack.csv === tables.Venue_Artist_History.csv, 'Artist history changed during its no-op bridge write.');
            summary.artistWrite = true;
        }

        if (hasFlag('--send-reminder')) {
            const requestId = `live-reminder-${runToken}`;
            await postBridge(bridgeUrl, 'queueReminder', { reminderId: 'follow-ups', requestId });
            const pendingBefore = await postBridge(bridgeUrl, 'getPendingReminders', { limit: 50 });
            assert(pendingBefore.reminders.some(reminder => reminder.requestId === requestId), 'Queued reminder was not visible to the worker.');
            await execFileAsync(process.execPath, ['scripts/dee-dee-local-text-reminders.mjs', '--process-queue'], {
                cwd: process.cwd(),
                env: { ...process.env, JDDM_SPREADSHEET_BRIDGE_URL: bridgeUrl },
                timeout: 180000
            });
            const pendingAfter = await postBridge(bridgeUrl, 'getPendingReminders', { limit: 50 });
            assert(!pendingAfter.reminders.some(reminder => reminder.requestId === requestId), 'Reminder worker did not complete the queued request.');
            summary.reminderQueue = true;
        }

        summary.fixedReminderTimes = await verifyFixedReminderSchedule();
    } finally {
        if (created) await postBridge(bridgeUrl, 'deleteTestVenue', { id: venueId });
    }

    console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
}

main().catch(error => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
});
