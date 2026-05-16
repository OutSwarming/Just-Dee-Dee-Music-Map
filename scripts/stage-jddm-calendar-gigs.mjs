#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
    parseJddmCalendarAvailabilityBlocks,
    parseJddmCalendarIcs,
    splitPastFutureCalendarGigs,
    toCalendarGigCsv
} from './lib/jddmCalendarIcsParser.mjs';

const DEFAULT_INPUTS = [
    '/Users/carterswarm/Downloads/Google Calendar Export.ical/justdeedeemusic@gmail.com.ics',
    '/Users/carterswarm/Downloads/Google Calendar Export.ical/JDDM Web Events_051b2fd8ffc9844eed9867801c9a348f546e282a484f7a33f47543273162a7ba@group.calendar.google.com.ics'
];
const DEFAULT_JSON_OUT = 'data/staged/jddm-calendar-gigs.json';
const DEFAULT_CSV_OUT = 'data/staged/jddm-calendar-gigs.csv';

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const inputs = options.inputs.length ? options.inputs : DEFAULT_INPUTS;
    const collections = [];
    const blockCollections = [];
    const sources = [];

    for (const input of inputs) {
        const icsText = await readInput(input);
        const sourceCapturedAt = new Date().toISOString();
        const events = parseJddmCalendarIcs(icsText, {
            sourceUrl: input,
            sourceCapturedAt
        });
        const blockedEvents = parseJddmCalendarAvailabilityBlocks(icsText, {
            sourceUrl: input,
            sourceCapturedAt
        });
        collections.push(events);
        blockCollections.push(blockedEvents);
        sources.push({
            input,
            parsedGigCount: events.length,
            parsedBlockedCount: blockedEvents.length
        });
    }

    const gigs = mergeEvents(collections.flat());
    const blockedEvents = mergeEvents(blockCollections.flat());
    const split = splitPastFutureCalendarGigs(gigs, { now: options.now });
    const payload = {
        ok: true,
        generatedAt: new Date().toISOString(),
        mode: 'jddm-google-calendar-ics-gig-staging',
        sourceCount: sources.length,
        gigCount: gigs.length,
        pastGigCount: split.past.length,
        futureGigCount: split.future.length,
        proposedGigCount: split.proposed.length,
        blockedEventCount: blockedEvents.length,
        sources,
        gigs,
        blockedEvents
    };

    if (options.write) {
        await fs.mkdir(path.dirname(options.jsonOut), { recursive: true });
        await fs.writeFile(options.jsonOut, `${JSON.stringify(payload, null, 2)}\n`);
        await fs.writeFile(options.csvOut, `${toCalendarGigCsv(gigs)}\n`);
    }

    printSummary(payload, options);
}

async function readInput(input) {
    if (/^https?:\/\//i.test(input)) {
        const response = await fetch(input);
        if (!response.ok) throw new Error(`Failed to fetch ${input}: HTTP ${response.status}`);
        return response.text();
    }
    return fs.readFile(input, 'utf8');
}

function mergeEvents(events) {
    const seen = new Set();
    return events.filter((event) => {
        const key = [
            event.calendarEventId,
            event.eventDate,
            event.eventTime,
            event.summary,
            event.location
        ].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).sort((a, b) => {
        const dateCompare = String(a.eventDate || '').localeCompare(String(b.eventDate || ''));
        if (dateCompare) return dateCompare;
        return String(a.eventTime || '').localeCompare(String(b.eventTime || ''));
    });
}

function parseArgs(args) {
    const options = {
        inputs: [],
        jsonOut: DEFAULT_JSON_OUT,
        csvOut: DEFAULT_CSV_OUT,
        write: false,
        now: undefined
    };

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--input') {
            options.inputs.push(args[index + 1]);
            index += 1;
        } else if (arg === '--json-out') {
            options.jsonOut = args[index + 1];
            index += 1;
        } else if (arg === '--csv-out') {
            options.csvOut = args[index + 1];
            index += 1;
        } else if (arg === '--now') {
            options.now = args[index + 1];
            index += 1;
        } else if (arg === '--write') {
            options.write = true;
        } else if (!arg.startsWith('--')) {
            options.inputs.push(arg);
        }
    }

    return options;
}

function printSummary(payload, options) {
    console.log(`Parsed ${payload.gigCount} calendar gig event(s) from ${payload.sourceCount} source(s).`);
    console.log(`Past: ${payload.pastGigCount}`);
    console.log(`Future: ${payload.futureGigCount}`);
    console.log(`Proposed: ${payload.proposedGigCount}`);
    console.log(`Blocked: ${payload.blockedEventCount}`);
    if (options.write) {
        console.log(`Wrote ${options.jsonOut}`);
        console.log(`Wrote ${options.csvOut}`);
    } else {
        console.log('Dry run only. Pass --write to save staged JSON/CSV.');
    }
}

main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
