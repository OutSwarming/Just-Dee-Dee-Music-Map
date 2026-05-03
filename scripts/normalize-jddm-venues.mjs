#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const OUTPUT_COLUMNS = [
    'id',
    'venue name',
    'address',
    'city',
    'state',
    'zip',
    'latitude',
    'longitude',
    'venue type',
    'website/social link',
    'notes',
    'booking/contact info',
    'upcoming event date',
    'upcoming event time',
    'private event'
];

const CATEGORY_NAMES = [
    'Brewery',
    'Winery',
    'Restaurant',
    'Festival',
    'Coffee Shop',
    'Pub/Bar',
    'Art Gallery',
    'Farm/Farmers Market',
    'Private Event',
    'Other Venue'
];

const ALIASES = {
    id: ['id', 'venue id', 'venue_id', 'place id'],
    place: ['place'],
    rank: ['rank'],
    contacted: ['contacted'],
    want: ['want'],
    times: ['#times', 'times'],
    'contact type': ['contact type'],
    card: ['card'],
    played: ['played'],
    music: ['music'],
    'days/months': ['days/months', 'days', 'months'],
    'contact name': ['contact name'],
    'email/contact': ['email/contact', 'email', 'contact email'],
    'phone number': ['phone number', 'phone'],
    status: ['status'],
    'yearly booking': ['yearly booking'],
    'venue name': ['venue name', 'name', 'location', 'business'],
    address: ['address', 'street address', 'venue address'],
    city: ['city', 'town'],
    state: ['state'],
    zip: ['zip', 'zip code', 'zipcode', 'postal code'],
    latitude: ['latitude', 'lat'],
    longitude: ['longitude', 'lng', 'lon', 'long'],
    'venue type': ['venue type', 'category', 'type'],
    'website/social link': ['website/social link', 'website', 'social link', 'url', 'link'],
    notes: ['notes', 'description', 'info', 'details'],
    'booking/contact info': ['booking/contact info', 'booking contact', 'contact', 'email', 'phone'],
    'upcoming event date': ['upcoming event date', 'event date', 'date'],
    'upcoming event time': ['upcoming event time', 'event time', 'time'],
    'private event': ['private event', 'private event flag', 'private']
};

function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];

        if (char === '"' && inQuotes && next === '"') {
            cell += '"';
            i++;
            continue;
        }
        if (char === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (char === ',' && !inQuotes) {
            row.push(cell);
            cell = '';
            continue;
        }
        if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && next === '\n') i++;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
            continue;
        }
        cell += char;
    }

    if (cell || row.length) {
        row.push(cell);
        rows.push(row);
    }

    return rows.filter(values => values.some(value => String(value).trim()));
}

function normalizeHeader(header) {
    return String(header || '').trim().toLowerCase();
}

function makeHeaderMap(headers) {
    const normalizedHeaders = headers.map(normalizeHeader);
    const map = {};

    [...new Set([...OUTPUT_COLUMNS, ...Object.keys(ALIASES)])].forEach(column => {
        const aliases = [column, ...(ALIASES[column] || [])].map(normalizeHeader);
        const index = normalizedHeaders.findIndex(header => aliases.includes(header));
        map[column] = index;
    });

    return map;
}

function getCell(row, headerMap, column) {
    const index = headerMap[column];
    if (index === undefined || index < 0) return '';
    return String(row[index] ?? '').trim();
}

function getSourceCell(row, headers, columnName) {
    const target = normalizeHeader(columnName);
    const index = headers.map(normalizeHeader).findIndex(header => header === target);
    if (index < 0) return '';
    return String(row[index] ?? '').trim();
}

function parsePlace(value) {
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    if (!raw) return {};

    const parts = raw.split(',').map(part => part.trim()).filter(Boolean);
    const parsed = {
        name: parts[0] || raw,
        address: '',
        city: '',
        state: 'OH',
        zip: ''
    };

    if (parts.length >= 3) {
        const stateZip = parts[parts.length - 1].match(/\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/i);
        parsed.city = parts[parts.length - 2] || '';
        parsed.address = parts.slice(1, -2).join(', ');
        if (stateZip) {
            parsed.state = stateZip[1].toUpperCase();
            parsed.zip = stateZip[2];
        }
        return parsed;
    }

    const inlineMatch = raw.match(/^(.*?),?\s+(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
    if (inlineMatch) {
        parsed.name = inlineMatch[1].trim();
        parsed.city = inlineMatch[2].trim();
        parsed.state = inlineMatch[3].toUpperCase();
        parsed.zip = inlineMatch[4];
    }

    return parsed;
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function normalizeCategory(value, isPrivate) {
    if (isPrivate) return 'Private Event';
    const raw = String(value || '').trim();
    const direct = CATEGORY_NAMES.find(category => category.toLowerCase() === raw.toLowerCase());
    if (direct) return direct;

    const lower = raw.toLowerCase();
    if (lower.includes('golf')) return 'Other Venue';
    if (lower.includes('brew')) return 'Brewery';
    if (lower.includes('wine')) return 'Winery';
    if (
        lower.includes('restaurant') ||
        lower.includes('grille') ||
        lower.includes('grill') ||
        lower.includes('bistro') ||
        lower.includes('diner') ||
        lower.includes('eatery') ||
        lower.includes('dining') ||
        lower.includes('food')
    ) return 'Restaurant';
    if (lower.includes('festival') || lower.includes('fair')) return 'Festival';
    if (lower.includes('coffee') || lower.includes('cafe')) return 'Coffee Shop';
    if (lower.includes('pub') || lower.includes('bar') || lower.includes('tavern')) return 'Pub/Bar';
    if (lower.includes('gallery') || lower.includes('art')) return 'Art Gallery';
    if (lower.includes('farm') || lower.includes('market')) return 'Farm/Farmers Market';
    if (lower.includes('private') || lower.includes('wedding') || lower.includes('party')) return 'Private Event';
    return 'Other Venue';
}

function buildBookingContact(row, headers) {
    const parts = [
        getSourceCell(row, headers, 'Contact Name'),
        getSourceCell(row, headers, 'Email/Contact'),
        getSourceCell(row, headers, 'Phone Number'),
        getSourceCell(row, headers, 'Contact Type')
    ].filter(Boolean);
    return parts.join(' | ');
}

function buildNotes(row, headers) {
    const pairs = [
        ['Rank', getSourceCell(row, headers, 'Rank')],
        ['Contacted', getSourceCell(row, headers, 'Contacted')],
        ['Want', getSourceCell(row, headers, 'Want')],
        ['Times booked', getSourceCell(row, headers, '#Times')],
        ['Card', getSourceCell(row, headers, 'Card')],
        ['Played', getSourceCell(row, headers, 'Played')],
        ['Music', getSourceCell(row, headers, 'Music')],
        ['Days/Months', getSourceCell(row, headers, 'Days/Months')],
        ['Status', getSourceCell(row, headers, 'Status')],
        ['Yearly Booking', getSourceCell(row, headers, 'Yearly Booking')],
        ['Notes', getSourceCell(row, headers, 'Notes')]
    ];

    return pairs
        .filter(([, value]) => value)
        .map(([label, value]) => `${label}: ${value}`)
        .join('\n');
}

function normalizeBoolean(value) {
    const lower = String(value || '').trim().toLowerCase();
    return ['true', 'yes', 'y', '1', 'private'].includes(lower) ? 'TRUE' : '';
}

function makeVenueId(row, headerMap, rowIndex, usedIds) {
    const explicit = getCell(row, headerMap, 'id');
    const parsedPlace = parsePlace(getCell(row, headerMap, 'place'));
    const base = explicit || [
        getCell(row, headerMap, 'venue name') || parsedPlace.name,
        getCell(row, headerMap, 'city') || parsedPlace.city,
        getCell(row, headerMap, 'state') || parsedPlace.state,
        getCell(row, headerMap, 'zip') || parsedPlace.zip
    ].filter(Boolean).join(' ');
    let id = slugify(base) || `venue-row-${rowIndex + 2}`;
    let suffix = 2;
    while (usedIds.has(id)) {
        id = `${slugify(base) || `venue-row-${rowIndex + 2}`}-${suffix}`;
        suffix++;
    }
    usedIds.add(id);
    return id;
}

function csvEscape(value) {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

function toCsv(rows) {
    return rows.map(row => row.map(csvEscape).join(',')).join('\n') + '\n';
}

async function main() {
    const sourcePath = process.argv[2];
    const outputPath = process.argv[3] || 'assets/data/jddm-venues.csv';

    if (!sourcePath) {
        console.error('Usage: node scripts/normalize-jddm-venues.mjs <source.csv> [output.csv]');
        process.exit(1);
    }

    if (!sourcePath.toLowerCase().endsWith('.csv')) {
        console.error('Please export the spreadsheet as CSV first. This script does not read XLSX directly.');
        process.exit(1);
    }

    const sourceText = await fs.readFile(sourcePath, 'utf8');
    const rows = parseCsv(sourceText);
    if (rows.length < 2) {
        throw new Error('Source CSV has no data rows.');
    }

    const [headers, ...dataRows] = rows;
    const headerMap = makeHeaderMap(headers);
    const usedIds = new Set();
    const missingCoordinates = [];

    const normalized = dataRows.map((row, rowIndex) => {
        const parsedPlace = parsePlace(getCell(row, headerMap, 'place'));
        const privateEvent = normalizeBoolean(getCell(row, headerMap, 'private event'));
        const venueName = getCell(row, headerMap, 'venue name') || parsedPlace.name;
        const venueType = normalizeCategory(getCell(row, headerMap, 'venue type') || venueName, Boolean(privateEvent));
        const output = {
            id: makeVenueId(row, headerMap, rowIndex, usedIds),
            'venue name': venueName,
            address: getCell(row, headerMap, 'address') || parsedPlace.address,
            city: getCell(row, headerMap, 'city') || parsedPlace.city,
            state: getCell(row, headerMap, 'state') || parsedPlace.state || 'OH',
            zip: getCell(row, headerMap, 'zip') || parsedPlace.zip,
            latitude: getCell(row, headerMap, 'latitude'),
            longitude: getCell(row, headerMap, 'longitude'),
            'venue type': venueType,
            'website/social link': getCell(row, headerMap, 'website/social link'),
            notes: [getCell(row, headerMap, 'notes'), buildNotes(row, headers)].filter(Boolean).join('\n'),
            'booking/contact info': getCell(row, headerMap, 'booking/contact info') || buildBookingContact(row, headers),
            'upcoming event date': getCell(row, headerMap, 'upcoming event date'),
            'upcoming event time': getCell(row, headerMap, 'upcoming event time'),
            'private event': privateEvent
        };

        if (!output.latitude || !output.longitude) {
            missingCoordinates.push(output);
        }

        return OUTPUT_COLUMNS.map(column => output[column]);
    });

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, toCsv([OUTPUT_COLUMNS, ...normalized]), 'utf8');

    if (missingCoordinates.length > 0) {
        const geocodePath = 'data/jddm-geocode-needed.csv';
        await fs.mkdir(path.dirname(geocodePath), { recursive: true });
        await fs.writeFile(
            geocodePath,
            toCsv([OUTPUT_COLUMNS, ...missingCoordinates.map(row => OUTPUT_COLUMNS.map(column => row[column]))]),
            'utf8'
        );
        console.warn(`Missing coordinates: ${missingCoordinates.length}. Review ${geocodePath} before importing pins.`);
    }

    console.log(`Normalized ${normalized.length} venue row(s) to ${outputPath}.`);
}

main().catch(error => {
    console.error(error.message || error);
    process.exit(1);
});
