const DEFAULT_TIMEZONE = 'America/New_York';

const EXCLUDED_SUMMARY_PATTERNS = [
    /^camping\b/i,
    /^flight\b/i,
    /\bbirthday\b/i,
    /^easter$/i
];

export function parseJddmCalendarIcs(icsText, options = {}) {
    return parseJddmCalendarIcsEvents(icsText, options)
        .filter(event => event.availabilityType === 'gig')
        .map(({ availabilityType, ...event }) => event);
}

export function parseJddmCalendarAvailabilityBlocks(icsText, options = {}) {
    return parseJddmCalendarIcsEvents(icsText, options)
        .filter(event => event.availabilityType === 'blocked')
        .map(({ availabilityType, ...event }) => ({
            ...event,
            status: 'BLOCKED'
        }));
}

export function parseJddmCalendarIcsEvents(icsText, options = {}) {
    const timezone = options.timezone || DEFAULT_TIMEZONE;
    const sourceUrl = options.sourceUrl || '';
    const sourceCapturedAt = options.sourceCapturedAt || new Date().toISOString();
    const lines = unfoldIcsLines(icsText);
    const events = [];
    let calendarName = '';
    let current = null;

    for (const line of lines) {
        if (line.startsWith('X-WR-CALNAME:')) {
            calendarName = unescapeIcsText(line.slice('X-WR-CALNAME:'.length));
            continue;
        }

        if (line === 'BEGIN:VEVENT') {
            current = {};
            continue;
        }

        if (line === 'END:VEVENT') {
            if (current) {
                const event = normalizeIcsEvent(current, {
                    timezone,
                    sourceUrl,
                    sourceCapturedAt,
                    sourceCalendarName: calendarName
                });
                if (event) {
                    events.push({
                        ...event,
                        availabilityType: isLikelyJddmGig(event) ? 'gig' : 'blocked'
                    });
                }
            }
            current = null;
            continue;
        }

        if (!current) continue;
        const separator = line.indexOf(':');
        if (separator < 0) continue;
        const rawName = line.slice(0, separator);
        const propertyName = rawName.split(';')[0].toUpperCase();
        current[propertyName] = {
            rawName,
            value: line.slice(separator + 1)
        };
    }

    return dedupeCalendarEvents(events).sort(compareGigEvents);
}

export function splitPastFutureCalendarGigs(events, options = {}) {
    const now = options.now ? new Date(options.now) : new Date();
    const today = formatIsoDate(now, options.timezone || DEFAULT_TIMEZONE);
    return {
        past: events.filter((event) => event.eventDate < today && event.status !== 'PROPOSED'),
        future: events.filter((event) => event.eventDate >= today && event.status !== 'PROPOSED'),
        proposed: events.filter((event) => event.status === 'PROPOSED')
    };
}

export function toCalendarGigCsv(events) {
    const headers = [
        'calendarEventId',
        'sourceCalendarName',
        'eventDate',
        'eventTime',
        'eventEndTime',
        'status',
        'venueName',
        'summary',
        'location',
        'isPrivateEvent',
        'isAllDay',
        'sourceUrl'
    ];
    const rows = events.map((event) => headers.map((header) => csvEscape(event[header])));
    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

function normalizeIcsEvent(rawEvent, options) {
    const start = parseIcsDate(rawEvent.DTSTART, options.timezone);
    const end = parseIcsDate(rawEvent.DTEND, options.timezone);
    const summary = unescapeIcsText(rawEvent.SUMMARY && rawEvent.SUMMARY.value);
    const location = unescapeIcsText(rawEvent.LOCATION && rawEvent.LOCATION.value);
    const description = unescapeIcsText(rawEvent.DESCRIPTION && rawEvent.DESCRIPTION.value);
    const calendarEventId = unescapeIcsText(rawEvent.UID && rawEvent.UID.value);

    if (!calendarEventId || !summary || !start.eventDate) return null;

    const isPrivateEvent = /\bprivate\b/i.test(summary);
    const isPlaceholder = /\bscheduled (private|public) event\b/i.test(summary) || /\btour\b/i.test(summary);

    return {
        calendarEventId,
        eventId: calendarEventId,
        sourceCalendarName: options.sourceCalendarName || '',
        eventDate: start.eventDate,
        eventEndDate: end.eventDate,
        eventTime: start.eventTime,
        eventEndTime: end.eventTime,
        status: inferStatus(summary, start.eventDate, options.timezone),
        venueName: deriveVenueName(summary, location, isPrivateEvent),
        summary,
        location,
        address: location,
        description,
        isPrivateEvent,
        isPublicPlaceholder: isPlaceholder,
        isAllDay: start.isAllDay,
        sourceUrl: options.sourceUrl,
        sourceCapturedAt: options.sourceCapturedAt
    };
}

function isLikelyJddmGig(event) {
    const summary = String(event.summary || '').trim();
    if (!summary) return false;
    if (EXCLUDED_SUMMARY_PATTERNS.some((pattern) => pattern.test(summary))) return false;
    if (event.isAllDay && !event.isPrivateEvent && !event.isPublicPlaceholder && !/\btour\b/i.test(summary)) {
        return false;
    }
    return true;
}

function inferStatus(summary, eventDate, timezone) {
    if (/\b(proposed|hold)\b/i.test(summary)) return 'PROPOSED';
    const today = formatIsoDate(new Date(), timezone);
    return eventDate < today ? 'COMPLETED' : 'BOOKED';
}

function deriveVenueName(summary, location, isPrivateEvent) {
    if (isPrivateEvent) return 'Private Event';
    return String(summary || '')
        .replace(/\s*-\s*proposed\s*$/i, '')
        .replace(/^JustDeeDeeMusic\s+Live\s+@\s+/i, '')
        .replace(/^Live Music with JustDeeDeeMusic at\s+/i, '')
        .trim() || String(location || '').trim();
}

function unfoldIcsLines(icsText) {
    return String(icsText || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .reduce((lines, line) => {
            if (/^[ \t]/.test(line) && lines.length) {
                lines[lines.length - 1] += line.slice(1);
            } else {
                lines.push(line);
            }
            return lines;
        }, []);
}

function parseIcsDate(property, timezone) {
    if (!property || !property.value) return { eventDate: '', eventTime: '', isAllDay: false };
    const value = String(property.value).trim();
    const isAllDay = property.rawName.includes('VALUE=DATE') || /^\d{8}$/.test(value);

    if (isAllDay) {
        return {
            eventDate: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`,
            eventTime: '',
            isAllDay: true
        };
    }

    const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
    if (!match) return { eventDate: '', eventTime: '', isAllDay: false };
    if (!value.endsWith('Z')) {
        return {
            eventDate: `${match[1]}-${match[2]}-${match[3]}`,
            eventTime: formatLocalTime(Number(match[4]), Number(match[5])),
            isAllDay: false
        };
    }

    const date = new Date(Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
        Number(match[6])
    ));

    return {
        eventDate: formatIsoDate(date, timezone),
        eventTime: formatTime(date, timezone),
        isAllDay: false
    };
}

function formatLocalTime(hour24, minute) {
    const suffix = hour24 >= 12 ? 'pm' : 'am';
    const hour12 = hour24 % 12 || 12;
    return `${hour12}:${String(minute).padStart(2, '0')}${suffix}`;
}

function formatIsoDate(date, timezone) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

function formatTime(date, timezone) {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    }).format(date).toLowerCase().replace(/\s/g, '');
}

function unescapeIcsText(value = '') {
    return String(value)
        .replace(/\\n/g, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, '\\')
        .trim();
}

function dedupeCalendarEvents(events) {
    const seen = new Set();
    return events.filter((event) => {
        const key = [
            event.calendarEventId,
            event.eventDate,
            event.eventTime,
            normalizeKey(event.summary),
            normalizeKey(event.location)
        ].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function compareGigEvents(a, b) {
    const dateCompare = String(a.eventDate || '').localeCompare(String(b.eventDate || ''));
    if (dateCompare) return dateCompare;
    return String(a.eventTime || '').localeCompare(String(b.eventTime || ''));
}

function normalizeKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function csvEscape(value) {
    const text = String(value === undefined || value === null ? '' : value);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}
