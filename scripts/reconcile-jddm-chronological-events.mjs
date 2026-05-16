#!/usr/bin/env node
import fs from 'node:fs/promises';
import https from 'node:https';

const DEFAULT_SOURCE = 'data/staged/JustDeeDeeMusic Chronological Events V2.csv';
const DEFAULT_OUT_JSON = 'data/staged/jddm-chronological-reconciliation-report.json';
const DEFAULT_OUT_CSV = 'data/staged/jddm-master-past-not-in-chronological.csv';
const DEFAULT_PAYLOAD = 'data/staged/jddm-chronological-import-payload.json';
const DEFAULT_CALENDAR_SOURCE = 'data/staged/jddm-calendar-gigs.csv';
const DEFAULT_COMBINED_CALENDAR_GIGS = 'data/staged/jddm-calendar-gigs-combined-19col.csv';
const DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyOems33yVzMEq_ucgoajSg3cYCq-68sM1ngKP2d0pdvA3OpJCG34ZAAM-cIeQouDKu/exec';

const CALENDAR_GIG_HEADERS = [
  'gigId',
  'calendarEventId',
  'calendarId',
  'sourceCalendarName',
  'venueSiteId',
  'venueName',
  'gigDate',
  'startTime',
  'endTime',
  'status',
  'address',
  'location',
  'summary',
  'description',
  'isPrivateEvent',
  'isAllDay',
  'sourceUrl',
  'lastSeenAt',
  'updatedAt'
];

const MONTHS = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12'
};

const VENUE_ALIASES = new Map([
  ['amy s arbors', 'amys arbors'],
  ['baci winery', 'baci winery'],
  ['bascule brewery and public house', 'bascule brewery and public house'],
  ['brighten brewing company', 'brighten brewing company'],
  ['brighton brewing company', 'brighten brewing company'],
  ['brighton brewing', 'brighten brewing company'],
  ['castaway craig s pub grub', 'castaway craigs'],
  ['castaway craigs lake milton', 'castaway craigs'],
  ['das weinhaus open mic', 'das weinhaus'],
  ['debonne vineyards', 'debonne vineyards'],
  ['debonne', 'debonne vineyards'],
  ['halliday winery', 'hallidays winery'],
  ['hallidays winery', 'hallidays winery'],
  ['haymaker farmers market', 'haymakers farmers market'],
  ['haymakers farmers market', 'haymakers farmers market'],
  ['hoppy dude brews', 'hoppy dude brews'],
  ['little birdie wine nest', 'little birdie wine nest'],
  ['olesias taverne of richfield', 'olesias'],
  ['olesia s taverne of richfield', 'olesias'],
  ['olesia s', 'olesias'],
  ['pint and pie works', 'pint and pie works'],
  ['pint pie works', 'pint and pie works'],
  ['the pint and pie works', 'pint and pie works'],
  ['the pint pie works', 'pint and pie works'],
  ['seville farm market', 'seville farmers market'],
  ['seville farmers market', 'seville farmers market'],
  ['sevilles christmas preview', 'sevilles christmas preview'],
  ['seville s christmas preview', 'sevilles christmas preview'],
  ['lorain summer market', 'second saturdays downtown lorain'],
  ['second saturdays downtown lorain', 'second saturdays downtown lorain'],
  ['main street wooster pavilion', 'main street wooster'],
  ['wooster famers market', 'wooster farmers market'],
  ['wooster farmers market', 'wooster farmers market'],
  ['ridge rail', 'ridge and rail'],
  ['ridge and rail', 'ridge and rail'],
  ['the ugly bunny winery', 'ugly bunny winery'],
  ['ugly bunny winery', 'ugly bunny winery']
]);

const ADDRESS_VENUE_HINTS = [
  { pattern: /8055\s+Leavitt/i, venueName: 'ESP Brewing' },
  { pattern: /1664\s+N(?:orth)?\s+Main/i, venueName: 'New Berlin Brewing Company' },
  { pattern: /1664\s+North\s+Main/i, venueName: 'New Berlin Brewing Company' },
  { pattern: /3232\s+Erhart/i, venueName: 'Das Weinhaus' },
  { pattern: /201\s+E\s+Bridge/i, venueName: 'Unplugged Brewing Co.' }
];

function parseArgs(argv) {
  const args = {
    source: DEFAULT_SOURCE,
    endpoint: DEFAULT_ENDPOINT,
    outJson: DEFAULT_OUT_JSON,
    outCsv: DEFAULT_OUT_CSV,
    payload: DEFAULT_PAYLOAD,
    calendarSource: DEFAULT_CALENDAR_SOURCE,
    combinedCalendarGigs: DEFAULT_COMBINED_CALENDAR_GIGS,
    import: false,
    importDryRun: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--import') {
      args.import = true;
    } else if (arg === '--dry-run-import') {
      args.import = true;
      args.importDryRun = true;
    } else if (arg.startsWith('--source=')) {
      args.source = arg.slice('--source='.length);
    } else if (arg.startsWith('--endpoint=')) {
      args.endpoint = arg.slice('--endpoint='.length);
    } else if (arg.startsWith('--out-json=')) {
      args.outJson = arg.slice('--out-json='.length);
    } else if (arg.startsWith('--out-csv=')) {
      args.outCsv = arg.slice('--out-csv='.length);
    } else if (arg.startsWith('--payload=')) {
      args.payload = arg.slice('--payload='.length);
    } else if (arg.startsWith('--calendar-source=')) {
      args.calendarSource = arg.slice('--calendar-source='.length);
    } else if (arg.startsWith('--combined-calendar-gigs=')) {
      args.combinedCalendarGigs = arg.slice('--combined-calendar-gigs='.length);
    }
  }
  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => String(value || '').trim()));
}

function rowsToObjects(rows) {
  const headers = rows[0].map((header) => String(header || '').trim());
  return rows.slice(1).map((row, rowIndex) => {
    const item = { _rowNumber: rowIndex + 2 };
    headers.forEach((header, index) => {
      item[header] = row[index] || '';
    });
    return item;
  });
}

function toKey(value) {
  const base = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return VENUE_ALIASES.get(base) || base;
}

function slugify(value) {
  return toKey(value)
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function venueKeys(value) {
  const full = toKey(value);
  const keys = new Set();
  if (full) keys.add(full);

  const beforeNumber = full.replace(/\s+\d.*$/, '').trim();
  if (beforeNumber && beforeNumber.length >= 4) keys.add(VENUE_ALIASES.get(beforeNumber) || beforeNumber);

  const withoutCommonSuffix = beforeNumber
    .replace(/\b(company|co|inc|llc|event center|ristorante|pub and grub|tavern)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (withoutCommonSuffix && withoutCommonSuffix.length >= 4) {
    keys.add(VENUE_ALIASES.get(withoutCommonSuffix) || withoutCommonSuffix);
  }

  return [...keys];
}

function parseLongDate(value) {
  const match = String(value || '').match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/i);
  if (!match) return '';
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return '';
  return `${match[3]}-${month}-${String(match[2]).padStart(2, '0')}`;
}

function cleanVenueName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*@\s*/g, ' @ ')
    .replace(/THIS SUNDAY!!!/i, '')
    .replace(/with originals.*$/i, '')
    .replace(/[!]+$/g, '')
    .trim();
}

function deriveVenueName(eventName, address) {
  let text = cleanVenueName(eventName)
    .replace(/Just\s*Dee\s*Dee\s*Music/ig, 'JustDeeDeeMusic')
    .replace(/JustDeeDeeMuisc/ig, 'JustDeeDeeMusic')
    .replace(/JustDeeDeeMusc/ig, 'JustDeeDeeMusic');

  for (const hint of ADDRESS_VENUE_HINTS) {
    if (hint.pattern.test(address) && !/@|\bat\s+|\bback\s+at\b|\breturns\s+to\b/i.test(text)) {
      return hint.venueName;
    }
  }

  const atSign = text.match(/@\s*(.+)$/);
  if (atSign) return cleanVenueName(atSign[1]);

  const explicitAt = text.match(/\bat\s+(.+)$/i);
  if (explicitAt) return cleanVenueName(explicitAt[1]);

  const returnsTo = text.match(/\breturns\s+to\s+(.+)$/i);
  if (returnsTo) return cleanVenueName(returnsTo[1]);

  const backAt = text.match(/\bback\s+at\s+(.+)$/i);
  if (backAt) return cleanVenueName(backAt[1]);

  const pizzaLab = text.match(/&\s*(.+)$/);
  if (pizzaLab) return cleanVenueName(pizzaLab[1]);

  const addressText = cleanVenueName(address);
  if (addressText && !/\d/.test(addressText)) return addressText;
  return text;
}

function parseHistoricalRows(rows) {
  const seen = new Set();
  const events = [];
  for (const row of rows) {
    const eventDate = parseLongDate(row.Date);
    const eventName = String(row['Event Name'] || '').trim();
    const address = String(row.Address || '').trim();
    if (!eventDate || !eventName) continue;
    const venueName = deriveVenueName(eventName, address);
    const keys = venueKeys(venueName);
    const venueKey = keys[0] || toKey(venueName);
    const duplicateKey = `${eventDate}|${venueKey}`;
    if (seen.has(duplicateKey)) continue;
    seen.add(duplicateKey);
    events.push({
      eventDate,
      eventName,
      venueName,
      venueKey,
      venueKeys: keys,
      address,
      time: String(row.Time || '').trim(),
      sourceRowNumber: row._rowNumber
    });
  }
  return events.sort((left, right) => `${left.eventDate}|${left.venueKey}`.localeCompare(`${right.eventDate}|${right.venueKey}`));
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        resolve(httpsGet(response.headers.location));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve(body));
      response.on('error', reject);
    }).on('error', reject);
  });
}

async function httpsGetJson(url) {
  const body = await httpsGet(url);
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`Redirect response was not JSON: ${body.slice(0, 500)}`);
  }
}

function httpsPostJson(url, payload, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      }
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirectCount >= 5) {
          reject(new Error(`Too many redirects while posting to ${url}`));
          return;
        }
        resolve(httpsGetJson(response.headers.location));
        return;
      }

      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        responseBody += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(responseBody));
        } catch (error) {
          reject(new Error(`Import response was not JSON: ${responseBody.slice(0, 500)}`));
        }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function parseMasterPastEvents(masterRows) {
  const events = [];
  for (const row of masterRows) {
    const venueName = row['venue name'] || '';
    const venueKeysForRow = venueKeys(venueName);
    const siteId = row.id || '';
    const lines = String(row.calendarPastGigEvents || '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const match = line.match(/^(\d{4}-\d{2}-\d{2})(?:\s+([^|]+?))?\s*\|\s*([^|]+)\s*\|\s*([^|]+)/);
      if (!match) continue;
      const summary = match[4].trim();
      const summaryKeys = venueKeys(deriveVenueName(summary, ''));
      events.push({
        eventDate: match[1],
        eventTime: (match[2] || '').replace(/\s*ET\s*$/, '').trim(),
        status: match[3].trim(),
        summary,
        venueName,
        venueKey: venueKeysForRow[0] || toKey(venueName),
        venueKeys: [...new Set([...venueKeysForRow, ...summaryKeys])],
        siteId,
        line
      });
    }
  }
  return events;
}

function compareMasterToHistorical(masterPastEvents, historicalEvents) {
  const historicalDateVenue = new Set();
  for (const event of historicalEvents) {
    for (const key of event.venueKeys || [event.venueKey]) {
      historicalDateVenue.add(`${event.eventDate}|${key}`);
    }
  }
  const historicalDateOnly = new Set(historicalEvents.map((event) => event.eventDate));
  return masterPastEvents
    .filter((event) => !(event.venueKeys || [event.venueKey]).some((key) => historicalDateVenue.has(`${event.eventDate}|${key}`)))
    .map((event) => ({
      ...event,
      historicalHasSameDate: historicalDateOnly.has(event.eventDate)
    }))
    .sort((left, right) => `${left.eventDate}|${left.venueName}`.localeCompare(`${right.eventDate}|${right.venueName}`));
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toReportCsv(rows) {
  const headers = ['eventDate', 'eventTime', 'venueName', 'summary', 'siteId', 'historicalHasSameDate', 'masterLine'];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(header === 'masterLine' ? row.line : row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function toImportPayload(historicalEvents) {
  return {
    action: 'importHistoricalPastEvents',
    dryRun: false,
    sourceName: 'JustDeeDeeMusic Chronological Events V2',
    sourceUrl: 'data/staged/JustDeeDeeMusic Chronological Events V2.csv',
    events: historicalEvents.map((event) => ({
      eventDate: event.eventDate,
      eventName: event.eventName,
      venueName: canonicalImportVenueName(event.venueName),
      address: event.address,
      time: event.time,
      sourceRowNumber: event.sourceRowNumber
    }))
  };
}

function canonicalImportVenueName(value) {
  const key = toKey(value);
  const canonical = {
    'debonne vineyards': 'Debonne Vineyards'
  };
  return canonical[key] || value;
}

function normalizeBooleanCell(value) {
  return /^true|yes|1$/i.test(String(value || '').trim()) ? 'TRUE' : '';
}

function makeCalendarGigIdFromRow(row) {
  return slugify([row.sourceCalendarName, row.calendarEventId].filter(Boolean).join(' ')) ||
    slugify([row.eventDate, row.eventTime, row.summary].join(' '));
}

function makeHistoricalGigId(event) {
  return slugify(['historical', event.eventDate, canonicalImportVenueName(event.venueName), event.eventName, event.sourceRowNumber].join(' '));
}

function calendarRowToCanonical(row, nowIso) {
  const location = String(row.location || '').trim();
  return {
    gigId: makeCalendarGigIdFromRow(row),
    calendarEventId: row.calendarEventId || '',
    calendarId: slugify(row.sourceCalendarName || ''),
    sourceCalendarName: row.sourceCalendarName || '',
    venueSiteId: '',
    venueName: row.venueName || '',
    gigDate: row.eventDate || '',
    startTime: row.eventTime || '',
    endTime: row.eventEndTime || '',
    status: row.status || '',
    address: location,
    location,
    summary: row.summary || '',
    description: '',
    isPrivateEvent: normalizeBooleanCell(row.isPrivateEvent),
    isAllDay: normalizeBooleanCell(row.isAllDay),
    sourceUrl: row.sourceUrl || '',
    lastSeenAt: nowIso,
    updatedAt: nowIso
  };
}

function historicalEventToCanonical(event, nowIso) {
  const venueName = canonicalImportVenueName(event.venueName);
  return {
    gigId: makeHistoricalGigId(event),
    calendarEventId: makeHistoricalGigId(event),
    calendarId: 'justdeedeemusic-chronological-events-v2',
    sourceCalendarName: 'JustDeeDeeMusic Chronological Events V2',
    venueSiteId: '',
    venueName,
    gigDate: event.eventDate,
    startTime: /^not\s+listed$/i.test(event.time) ? '' : event.time,
    endTime: '',
    status: 'COMPLETED',
    address: event.address,
    location: event.address,
    summary: event.eventName,
    description: `Imported from historical chronological events source row ${event.sourceRowNumber}.`,
    isPrivateEvent: '',
    isAllDay: /^not\s+listed$/i.test(event.time) || !event.time ? 'TRUE' : '',
    sourceUrl: 'data/staged/JustDeeDeeMusic Chronological Events V2.csv',
    lastSeenAt: nowIso,
    updatedAt: nowIso
  };
}

function toCombinedCalendarGigsCsv(calendarRows, historicalEvents) {
  const nowIso = new Date().toISOString();
  const rows = [];
  const seen = new Set();
  const add = (row) => {
    const key = row.gigId || `${row.sourceCalendarName}|${row.calendarEventId}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };

  calendarRows.forEach((row) => add(calendarRowToCanonical(row, nowIso)));
  historicalEvents.forEach((event) => add(historicalEventToCanonical(event, nowIso)));

  return [
    CALENDAR_GIG_HEADERS.join(','),
    ...rows.map((row) => CALENDAR_GIG_HEADERS.map((header) => csvEscape(row[header])).join(','))
  ].join('\n') + '\n';
}

async function main() {
  const args = parseArgs(process.argv);
  const historicalText = await fs.readFile(args.source, 'utf8');
  const historicalEvents = parseHistoricalRows(rowsToObjects(parseCsv(historicalText)));
  const calendarText = await fs.readFile(args.calendarSource, 'utf8');
  const calendarRows = rowsToObjects(parseCsv(calendarText));
  const masterCsv = await httpsGet(`${args.endpoint}?action=csv&autofill=0`);
  const masterRows = rowsToObjects(parseCsv(masterCsv));
  const masterPastEvents = parseMasterPastEvents(masterRows);
  const masterPastNotInHistorical = compareMasterToHistorical(masterPastEvents, historicalEvents);
  const payload = toImportPayload(historicalEvents);
  const report = {
    source: args.source,
    historicalEventCount: historicalEvents.length,
    masterVenueCount: masterRows.length,
    masterPastEventCount: masterPastEvents.length,
    masterPastNotInHistoricalCount: masterPastNotInHistorical.length,
    masterPastNotInHistorical,
    historicalEvents
  };

  await fs.writeFile(args.outJson, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(args.outCsv, toReportCsv(masterPastNotInHistorical));
  await fs.writeFile(args.payload, `${JSON.stringify(payload, null, 2)}\n`);
  await fs.writeFile(args.combinedCalendarGigs, toCombinedCalendarGigsCsv(calendarRows, historicalEvents));

  console.log(JSON.stringify({
    historicalEventCount: historicalEvents.length,
    sourceCalendarGigCount: calendarRows.length,
    combinedCalendarGigCount: calendarRows.length + historicalEvents.length,
    masterVenueCount: masterRows.length,
    masterPastEventCount: masterPastEvents.length,
    masterPastNotInHistoricalCount: masterPastNotInHistorical.length,
    outJson: args.outJson,
    outCsv: args.outCsv,
    payload: args.payload,
    combinedCalendarGigs: args.combinedCalendarGigs
  }, null, 2));

  if (args.import) {
    const importPayload = args.importDryRun ? { ...payload, dryRun: true } : payload;
    const result = await httpsPostJson(args.endpoint, importPayload);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
