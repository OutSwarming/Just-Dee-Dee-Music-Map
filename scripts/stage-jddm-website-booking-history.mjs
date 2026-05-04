#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
    filterPastBookings,
    mergeJddmWebsiteBookings,
    parseJddmWebsiteBookings
} from './lib/jddmWebsiteBookingsParser.mjs';

const LIVE_SOURCES = [
    'https://www.justdeedeemusic.com/calendar/',
    'https://www.justdeedeemusic.com/'
];
const ARCHIVE_TARGETS = [
    'www.justdeedeemusic.com/calendar/',
    'www.justdeedeemusic.com/'
];
const DEFAULT_JSON_OUT = 'data/staged/jddm-website-booking-history.json';
const DEFAULT_CSV_OUT = 'data/staged/jddm-website-booking-history.csv';
const USER_AGENT = 'JDDM booking history stager/1.0 (+https://github.com/OutSwarming/Just-Dee-Dee-Music-Map)';
const REQUEST_TIMEOUT_MS = 20000;
const CDX_TIMEOUT_MS = 60000;
const KNOWN_ARCHIVE_SNAPSHOTS = [
    ['20250916021555', 'https://www.justdeedeemusic.com/calendar/'],
    ['20251112122835', 'https://www.justdeedeemusic.com/calendar/'],
    ['20231217163654', 'http://www.justdeedeemusic.com/'],
    ['20240903203540', 'https://www.justdeedeemusic.com/'],
    ['20241231151846', 'https://www.justdeedeemusic.com/'],
    ['20250228191446', 'https://www.justdeedeemusic.com/'],
    ['20250609062903', 'https://www.justdeedeemusic.com/'],
    ['20250916002133', 'https://www.justdeedeemusic.com/'],
    ['20251009035354', 'https://www.justdeedeemusic.com/'],
    ['20251112101632', 'https://www.justdeedeemusic.com/'],
    ['20251207024247', 'https://www.justdeedeemusic.com/'],
    ['20260120202824', 'https://www.justdeedeemusic.com/'],
    ['20260218202025', 'https://www.justdeedeemusic.com/'],
    ['20260313132322', 'https://www.justdeedeemusic.com/']
];

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const now = options.now ? new Date(options.now) : new Date();
    const sourceReports = [];
    const collections = [];

    for (const sourceUrl of LIVE_SOURCES) {
        const report = await pullSource({
            sourceUrl,
            capturedAt: now.toISOString(),
            snapshotDate: now,
            now
        });
        sourceReports.push(report.summary);
        if (report.bookings.length) collections.push(report.bookings);
    }

    if (!options.noArchive) {
        const snapshots = await findArchiveSnapshots(options);
        const reports = await mapWithConcurrency(snapshots, 4, (snapshot) => pullSource({
                sourceUrl: snapshot.archiveUrl,
                capturedAt: snapshot.capturedAt,
                snapshotDate: snapshot.snapshotDate,
                now
        }));

        for (const report of reports) {
            sourceReports.push(report.summary);
            if (report.bookings.length) collections.push(report.bookings);
        }
    }

    const allRecoveredBookings = mergeJddmWebsiteBookings(collections);
    const pastBookings = filterPastBookings(allRecoveredBookings, { now });
    const payload = {
        ok: true,
        generatedAt: new Date().toISOString(),
        mode: 'public-site-and-archive-past-booking-history',
        cutoffDate: toIsoDate(now),
        sourceCount: sourceReports.length,
        recoveredEventCount: allRecoveredBookings.length,
        pastEventCount: pastBookings.length,
        coverage: getCoverage(pastBookings),
        sources: sourceReports,
        limitations: [
            'This file stages events recoverable from the public website and public Web Archive snapshots only.',
            'It is not guaranteed to be all-time history unless the original Google Calendar/ICS export is provided.',
            'No Google Sheet writes were performed.'
        ],
        bookings: pastBookings
    };

    if (options.write) {
        await writeStagedFiles(payload, options);
    }

    printSummary(payload, options);
}

async function pullSource({ sourceUrl, capturedAt, snapshotDate, now }) {
    try {
        const html = await fetchText(sourceUrl);
        const bookings = parseJddmWebsiteBookings(html, {
            sourceUrl,
            sourceCapturedAt: capturedAt,
            snapshotDate,
            now
        });

        return {
            summary: {
                ok: true,
                sourceUrl,
                capturedAt,
                parsedEventCount: bookings.length
            },
            bookings
        };
    } catch (error) {
        return {
            summary: {
                ok: false,
                sourceUrl,
                capturedAt,
                parsedEventCount: 0,
                error: error && error.message ? error.message : String(error)
            },
            bookings: []
        };
    }
}

async function findArchiveSnapshots(options) {
    if (options.knownArchiveOnly) {
        return KNOWN_ARCHIVE_SNAPSHOTS.map(([timestamp, original]) => makeSnapshot(timestamp, original));
    }

    const snapshots = [];

    for (const target of ARCHIVE_TARGETS) {
        const params = new URLSearchParams({
            url: target,
            output: 'json',
            fl: 'timestamp,original,statuscode,mimetype,digest',
            filter: 'statuscode:200',
            collapse: 'digest',
            from: '202001',
            to: '202605'
        });
        try {
            const rows = await fetchJson(`https://web.archive.org/cdx?${params.toString()}`, {
                timeoutMs: CDX_TIMEOUT_MS
            });

            rows.slice(1).forEach(([timestamp, original]) => {
                snapshots.push(makeSnapshot(timestamp, original));
            });
        } catch (error) {
            KNOWN_ARCHIVE_SNAPSHOTS
                .filter(([, original]) => normalizeArchiveTarget(original) === normalizeArchiveTarget(target))
                .forEach(([timestamp, original]) => snapshots.push(makeSnapshot(timestamp, original)));
        }
    }

    return [...new Map(snapshots.map((snapshot) => [
        `${snapshot.timestamp}|${snapshot.original}`,
        snapshot
    ])).values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function makeSnapshot(timestamp, original) {
    return {
        timestamp,
        original,
        archiveUrl: `https://web.archive.org/web/${timestamp}id_/${original}`,
        capturedAt: timestampToIso(timestamp),
        snapshotDate: timestampToDate(timestamp)
    };
}

async function fetchText(url, options = {}) {
    const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(options.timeoutMs || REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}`);
    return response.text();
}

async function fetchJson(url, options = {}) {
    const text = await fetchText(url, options);
    return JSON.parse(text);
}

async function mapWithConcurrency(items, limit, mapper) {
    const results = [];
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex++;
            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

async function writeStagedFiles(payload, options) {
    const jsonOut = options.jsonOut || DEFAULT_JSON_OUT;
    const csvOut = options.csvOut || DEFAULT_CSV_OUT;
    await fs.mkdir(path.dirname(jsonOut), { recursive: true });
    await fs.mkdir(path.dirname(csvOut), { recursive: true });
    await fs.writeFile(jsonOut, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await fs.writeFile(csvOut, toBookingCsv(payload.bookings), 'utf8');
}

function toBookingCsv(bookings) {
    const columns = [
        'eventId',
        'eventDate',
        'eventDay',
        'eventTime',
        'eventEndTime',
        'title',
        'venueName',
        'venueType',
        'location',
        'address',
        'city',
        'state',
        'zip',
        'isPrivateEvent',
        'isPublicPlaceholder',
        'sourceCapturedAts',
        'sourceUrls',
        'notes'
    ];
    const rows = [
        columns,
        ...bookings.map((booking) => columns.map((column) => {
            const value = booking[column];
            return Array.isArray(value) ? value.join(' | ') : value;
        }))
    ];

    return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
}

function csvEscape(value) {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

function getCoverage(bookings) {
    const dates = bookings.map((booking) => booking.eventDate).filter(Boolean).sort();
    return {
        earliestEventDate: dates[0] || '',
        latestEventDate: dates[dates.length - 1] || ''
    };
}

function parseArgs(args) {
    const options = {
        csvOut: '',
        jsonOut: '',
        knownArchiveOnly: false,
        noArchive: false,
        now: '',
        write: true
    };

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--no-archive') {
            options.noArchive = true;
        } else if (arg === '--known-archive-only') {
            options.knownArchiveOnly = true;
        } else if (arg === '--no-write') {
            options.write = false;
        } else if (arg === '--json-out') {
            options.jsonOut = args[++index];
        } else if (arg === '--csv-out') {
            options.csvOut = args[++index];
        } else if (arg === '--now') {
            options.now = args[++index];
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return options;
}

function printSummary(payload, options) {
    console.log(`Staged ${payload.pastEventCount} past events from ${payload.sourceCount} public sources.`);
    if (payload.coverage.earliestEventDate) {
        console.log(`Coverage: ${payload.coverage.earliestEventDate} through ${payload.coverage.latestEventDate}`);
    }
    payload.bookings.slice(-10).forEach((booking) => {
        const venue = booking.venueName || booking.title;
        const place = booking.city ? `, ${booking.city}` : '';
        console.log(`- ${booking.eventDate} ${booking.eventTime} | ${venue}${place}`);
    });
    if (options.write) {
        console.log(`Wrote ${options.jsonOut || DEFAULT_JSON_OUT}`);
        console.log(`Wrote ${options.csvOut || DEFAULT_CSV_OUT}`);
    }
}

function printHelp() {
    console.log(`Usage:
  npm run bookings:website:history
  node scripts/stage-jddm-website-booking-history.mjs --no-write

Options:
  --no-archive       Use only the current public website.
  --known-archive-only
                     Skip CDX discovery and use the checked known public snapshots.
  --no-write         Preview counts without writing staged files.
  --json-out <path>  JSON output path. Defaults to ${DEFAULT_JSON_OUT}
  --csv-out <path>   CSV output path. Defaults to ${DEFAULT_CSV_OUT}
  --now <date>       Date used for past/future filtering.
`);
}

function timestampToIso(timestamp) {
    const date = timestampToDate(timestamp);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function timestampToDate(timestamp) {
    const text = String(timestamp || '');
    return new Date(
        Number(text.slice(0, 4)),
        Number(text.slice(4, 6)) - 1,
        Number(text.slice(6, 8)),
        Number(text.slice(8, 10)),
        Number(text.slice(10, 12)),
        Number(text.slice(12, 14))
    );
}

function normalizeArchiveTarget(value) {
    return String(value || '')
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .replace(/\/+$/g, '')
        .toLowerCase();
}

function toIsoDate(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

main().catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exitCode = 1;
});
