#!/usr/bin/env node
import fs from 'node:fs/promises';
import {
    filterFutureBookings,
    parseJddmWebsiteBookings
} from './lib/jddmWebsiteBookingsParser.mjs';

const DEFAULT_URL = 'https://www.justdeedeemusic.com/calendar/';

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const url = options.url || DEFAULT_URL;
    const response = await fetch(url, {
        headers: {
            'user-agent': 'JDDM booking importer/1.0 (+https://github.com/OutSwarming/Just-Dee-Dee-Music-Map)'
        }
    });

    if (!response.ok) {
        throw new Error(`Website calendar request failed: ${response.status} ${response.statusText}`);
    }

    const pulledAt = new Date().toISOString();
    const html = await response.text();
    const parsedBookings = parseJddmWebsiteBookings(html, {
        sourceUrl: url,
        year: options.year,
        now: options.now,
        sourceCapturedAt: pulledAt
    });
    const bookings = options.includePast
        ? parsedBookings
        : filterFutureBookings(parsedBookings, { now: options.now });
    const payload = {
        ok: true,
        sourceUrl: url,
        pulledAt,
        mode: options.includePast ? 'all-events' : 'future-events',
        count: bookings.length,
        bookings
    };

    if (options.out) {
        await fs.writeFile(options.out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    }

    if (options.json || options.out) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }

    printSummary(payload);
}

function parseArgs(args) {
    const options = {
        includePast: false,
        json: false,
        now: undefined,
        out: '',
        url: '',
        year: undefined
    };

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--include-past') {
            options.includePast = true;
        } else if (arg === '--json') {
            options.json = true;
        } else if (arg === '--out') {
            options.out = args[++index];
        } else if (arg === '--url') {
            options.url = args[++index];
        } else if (arg === '--year') {
            options.year = Number(args[++index]);
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

function printSummary(payload) {
    console.log(`Pulled ${payload.count} ${payload.mode.replace('-', ' ')} from ${payload.sourceUrl}`);
    payload.bookings.slice(0, 12).forEach((booking) => {
        const venue = booking.venueName || booking.title;
        const place = booking.city ? `, ${booking.city}` : '';
        console.log(`- ${booking.eventDate} ${booking.eventTime} | ${venue}${place}`);
    });

    if (payload.bookings.length > 12) {
        console.log(`...${payload.bookings.length - 12} more`);
    }

    console.log('Use --json for full normalized records or --out <path> to save a review file.');
}

function printHelp() {
    console.log(`Usage:
  npm run bookings:website:preview
  node scripts/pull-jddm-website-bookings.mjs --json
  node scripts/pull-jddm-website-bookings.mjs --out data/jddm-website-bookings-preview.json

Options:
  --url <url>       Calendar page URL. Defaults to ${DEFAULT_URL}
  --year <year>     Year to apply to MM-DD website dates.
  --now <date>      Date used for future filtering, useful for tests.
  --include-past    Include events earlier than today.
  --json            Print full normalized JSON.
  --out <path>      Save full normalized JSON to a file.
`);
}

main().catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exitCode = 1;
});
