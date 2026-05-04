const PRIVATE_EVENT_PATTERN = /\bprivate event\b/i;
const PUBLIC_PLACEHOLDER_PATTERN = /\bscheduled public event\b/i;

const CATEGORY_RULES = [
    ['Brewery', /\b(brew|brewing|brewery)\b/i],
    ['Winery', /\b(wine|winery|vineyard)\b/i],
    ['Restaurant', /\b(restaurant|grille|grill|bistro|diner|eatery|panini)\b/i],
    ['Festival', /\b(festival|fair|crocker park|main street)\b/i],
    ['Coffee Shop', /\b(coffee|cafe)\b/i],
    ['Pub/Bar', /\b(pub|bar|tavern|lounge|pint)\b/i],
    ['Art Gallery', /\b(gallery|art)\b/i],
    ['Farm/Farmers Market', /\b(farm|farmers|market)\b/i]
];

export function parseJddmWebsiteBookings(html, options = {}) {
    const sourceUrl = options.sourceUrl || 'https://www.justdeedeemusic.com/calendar/';
    const now = options.now ? new Date(options.now) : new Date();
    const year = Number(options.year || now.getFullYear());
    const headBlocks = extractDateBlocks(html);
    const bookings = [];

    headBlocks.forEach((block, blockIndex) => {
        const dateInfo = parseDateLabel(block.dateLabel, year);
        if (!dateInfo) return;

        block.eventHtmlBlocks.forEach((eventHtml, eventIndex) => {
            const title = extractText(eventHtml, /<b class="ical_summary">([\s\S]*?)<\/b>/i);
            if (!title) return;

            const details = extractDetails(eventHtml);
            const location = details.location || '';
            const venueName = deriveVenueName(title, location);
            const locationParts = parseLocation(location);
            const privateEvent = PRIVATE_EVENT_PATTERN.test(title);
            const publicPlaceholder = PUBLIC_PLACEHOLDER_PATTERN.test(title);
            const startTime = normalizeTime(details.startTime || dateInfo.time);
            const endTime = normalizeTime(details.endTime);

            bookings.push({
                eventId: details.id || makeEventId(dateInfo.isoDate, startTime, title, blockIndex, eventIndex),
                eventDate: dateInfo.isoDate,
                eventDay: dateInfo.dayName,
                eventTime: startTime,
                eventEndTime: endTime,
                title: normalizeWhitespace(title),
                venueName,
                venueType: inferVenueType(venueName, title, privateEvent),
                location,
                address: locationParts.address,
                city: locationParts.city,
                state: locationParts.state,
                zip: locationParts.zip,
                isPrivateEvent: privateEvent,
                isPublicPlaceholder: publicPlaceholder,
                sourceUrl,
                sourceBlockIndex: blockIndex,
                notes: buildNotes({ title, location, privateEvent, publicPlaceholder })
            });
        });
    });

    return dedupeBookings(bookings);
}

export function filterFutureBookings(bookings, options = {}) {
    const now = options.now ? new Date(options.now) : new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return bookings.filter((booking) => {
        const eventDate = parseIsoDate(booking.eventDate);
        return eventDate && eventDate >= today;
    });
}

function extractDateBlocks(html) {
    const blocks = [];
    const blockPattern = /<li class="list-group-item py-0 head">([\s\S]*?)(?=<li class="list-group-item py-0 head">|<br class="clear">|$)/gi;
    let blockMatch;

    while ((blockMatch = blockPattern.exec(html))) {
        const blockHtml = blockMatch[1];
        const dateLabel = extractText(blockHtml, /<span class="ical-date">([\s\S]*?)<\/span>/i);
        const eventHtmlBlocks = [];
        const eventPattern = /<li class="list-group-item py-0">([\s\S]*?)<\/li>/gi;
        let eventMatch;

        while ((eventMatch = eventPattern.exec(blockHtml))) {
            eventHtmlBlocks.push(eventMatch[1]);
        }

        if (dateLabel && eventHtmlBlocks.length) {
            blocks.push({ dateLabel, eventHtmlBlocks });
        }
    }

    return blocks;
}

function extractDetails(eventHtml) {
    const detailsMatch = eventHtml.match(/<div class="ical_details" id="([^"]*)"[^>]*>([\s\S]*?)<\/div>/i);
    const detailsHtml = detailsMatch ? detailsMatch[2] : '';
    const timeMatches = [...detailsHtml.matchAll(/<span class="time">([\s\S]*?)<\/span>/gi)]
        .map((match) => stripTags(decodeHtml(match[1])));

    return {
        id: detailsMatch ? normalizeWhitespace(detailsMatch[1]) : '',
        startTime: timeMatches[0] || '',
        endTime: timeMatches[1] || '',
        location: extractText(detailsHtml, /<span class="location">([\s\S]*?)<\/span>/i)
    };
}

function parseDateLabel(label, year) {
    const match = normalizeWhitespace(label).match(/^(\d{1,2})-(\d{1,2})\s+\(([^)]+)\)\s+(.+)$/);
    if (!match) return null;

    return {
        isoDate: `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`,
        dayName: match[3],
        time: match[4]
    };
}

function deriveVenueName(title, location) {
    const normalizedTitle = normalizeWhitespace(title).replace(/JustDeeDeeMuisc/g, 'JustDeeDeeMusic');
    const atMatch = normalizedTitle.match(/\s@\s(.+)$/i);
    if (atMatch) return cleanVenueName(atMatch[1]);

    const atWordMatch = normalizedTitle.match(/\bat\s+(.+)$/i);
    if (atWordMatch) return cleanVenueName(atWordMatch[1]);

    if (PRIVATE_EVENT_PATTERN.test(normalizedTitle)) return 'Private Event';
    if (PUBLIC_PLACEHOLDER_PATTERN.test(normalizedTitle)) return 'Scheduled Public Event';

    return cleanVenueName(location || normalizedTitle);
}

function cleanVenueName(value) {
    return normalizeWhitespace(value)
        .replace(/^JustDeeDeeMusic\s+/i, '')
        .replace(/^Live\s+/i, '')
        .replace(/\s+[-–]\s+.*$/i, '')
        .trim();
}

function parseLocation(location) {
    const normalized = normalizeWhitespace(location)
        .replace(/\s*,\s*/g, ', ')
        .replace(/,\s*OH,\s*United States,\s*Ohio\s+(\d{5}(?:-\d{4})?)/i, ', OH $1')
        .replace(/,\s*United States,\s*Ohio\s+(\d{5}(?:-\d{4})?)/i, ', OH $1')
        .replace(/,\s*United States,\s*Ohio\b/i, ', OH');

    if (!normalized) {
        return { address: '', city: '', state: '', zip: '' };
    }

    const zipMatch = normalized.match(/\b(?:(OH|Ohio)\s*)?(\d{5}(?:-\d{4})?)\b/i);
    const parts = normalized.split(',').map((part) => part.trim()).filter(Boolean);
    let state = zipMatch && zipMatch[1] ? normalizeState(zipMatch[1]) : '';
    let zip = zipMatch ? zipMatch[2] : '';
    let city = '';
    let address = normalized;

    if (parts.length >= 3) {
        const stateZipPart = parts[parts.length - 1];
        const stateZipMatch = stateZipPart.match(/\b([A-Z]{2}|Ohio)?\s*(\d{5}(?:-\d{4})?)?\b/i);
        city = parts[parts.length - 2] || '';
        address = parts.slice(0, -2).join(', ');
        state = state || normalizeState(stateZipMatch && stateZipMatch[1]);
        zip = zip || (stateZipMatch && stateZipMatch[2]) || '';
    } else if (parts.length === 2) {
        address = parts[0];
        city = '';
    }

    return {
        address,
        city,
        state,
        zip
    };
}

function inferVenueType(venueName, title, isPrivateEvent) {
    if (isPrivateEvent) return 'Private Event';
    const haystack = `${venueName} ${title}`;
    const match = CATEGORY_RULES.find(([, pattern]) => pattern.test(haystack));
    return match ? match[0] : 'Other Venue';
}

function buildNotes({ title, location, privateEvent, publicPlaceholder }) {
    const notes = [`Website calendar title: ${normalizeWhitespace(title)}`];
    if (location) notes.push(`Website calendar location: ${normalizeWhitespace(location)}`);
    if (privateEvent) notes.push('Private event from public calendar.');
    if (publicPlaceholder) notes.push('Public event placeholder from website; venue/location may still need confirmation.');
    return notes.join('\n');
}

function dedupeBookings(bookings) {
    const seen = new Map();
    const deduped = [];

    bookings.forEach((booking) => {
        const locationParts = parseLocation(booking.location);
        const key = [
            booking.eventDate,
            booking.eventTime,
            normalizeDedupeText([
                locationParts.address,
                locationParts.city,
                locationParts.state,
                locationParts.zip
            ].filter(Boolean).join(' ') || booking.venueName)
        ].join('|');
        const existing = seen.get(key);

        if (!existing) {
            seen.set(key, booking);
            deduped.push(booking);
            return;
        }

        existing.duplicateTitles = [...(existing.duplicateTitles || []), booking.title];
        existing.notes = `${existing.notes}\nPossible duplicate website calendar title: ${booking.title}`;
    });

    return deduped;
}

function makeEventId(date, time, title, blockIndex, eventIndex) {
    return [
        date,
        normalizeDedupeText(time),
        normalizeDedupeText(title).slice(0, 80),
        blockIndex,
        eventIndex
    ].filter(Boolean).join('-');
}

function normalizeDedupeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function parseIsoDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function extractText(html, pattern) {
    const match = html.match(pattern);
    return match ? normalizeWhitespace(stripTags(decodeHtml(match[1]))) : '';
}

function normalizeTime(value) {
    return normalizeWhitespace(value)
        .replace(/[;-]+$/g, '')
        .trim();
}

function normalizeState(value) {
    if (!value) return '';
    return /^ohio$/i.test(value) ? 'OH' : String(value).toUpperCase();
}

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripTags(value) {
    return String(value || '').replace(/<[^>]*>/g, '');
}

function decodeHtml(value) {
    return String(value || '')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#039;/g, "'")
        .replace(/&rsquo;/g, "'")
        .replace(/&lsquo;/g, "'")
        .replace(/&ldquo;/g, '"')
        .replace(/&rdquo;/g, '"')
        .replace(/&ndash;/g, '-')
        .replace(/&mdash;/g, '-');
}
