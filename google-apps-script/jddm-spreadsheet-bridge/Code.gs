/**
 * Just Dee Dee Music Map spreadsheet bridge.
 *
 * Install:
 * 1. Open the Google Sheet.
 * 2. Extensions > Apps Script.
 * 3. Paste this file into Code.gs.
 * 4. Deploy > New deployment > Web app.
 * 5. Execute as: Me.
 * 6. Who has access: Anyone with the link.
 * 7. Copy the /exec URL into config/firebaseConfig.example.js as
 *    window.JDDM_SPREADSHEET_API_URL.
 *
 * Generated spreadsheet columns:
 * - R: Longitude
 * - S: Latitude
 * - T: Site ID
 *
 * Booking CRM columns are appended when missing. They are never inserted into
 * the middle of the sheet or written over existing headers.
 */

var JDDM_BRIDGE_CONFIG = {
  SHEET_NAME: '', // Leave blank to use the first sheet.
  EDIT_TOKEN: '', // Optional prototype guard. If set, frontend token must match.
  CALENDAR_GIG_SHEET_NAME: 'CalendarGigs',
  CALENDAR_REVIEW_SHEET_NAME: 'CalendarDuplicateReview',
  CALENDAR_TIMEZONE: 'America/New_York',
  CALENDAR_IDS: [
    'justdeedeemusic@gmail.com',
    '051b2fd8ffc9844eed9867801c9a348f546e282a484f7a33f47543273162a7ba@group.calendar.google.com'
  ],
  CALENDAR_ICS_URLS: [
    'https://calendar.google.com/calendar/ical/051b2fd8ffc9844eed9867801c9a348f546e282a484f7a33f47543273162a7ba%40group.calendar.google.com/public/basic.ics'
  ],
  CALENDAR_SYNC_START_DATE: '2020-01-01',
  CALENDAR_SYNC_END_DATE: '2030-12-31'
};

var JDDM_SCHEMA_VERSION = '2026-05-07-calendar-review-global-gigs';

var MAP_GENERATED_COLUMNS = [
  { key: 'longitude', header: 'Longitude', column: 18 }, // R
  { key: 'latitude', header: 'Latitude', column: 19 },   // S
  { key: 'siteId', header: 'Site ID', column: 20 }       // T
];

var BOOKING_GENERATED_COLUMNS = [
  { key: 'contactStatus', header: 'contactStatus' },
  { key: 'draftStatus', header: 'draftStatus' },
  { key: 'lastContactedDate', header: 'lastContactedDate' },
  { key: 'nextFollowUpDate', header: 'nextFollowUpDate' },
  { key: 'doNotContact', header: 'doNotContact' },
  { key: 'priority', header: 'priority' },
  { key: 'bestFitScore', header: 'bestFitScore' },
  { key: 'websiteBookingEvents', header: 'websiteBookingEvents' },
  { key: 'calendarGigEvents', header: 'calendarGigEvents' },
  { key: 'calendarPastGigEvents', header: 'calendarPastGigEvents' },
  { key: 'calendarFutureGigEvents', header: 'calendarFutureGigEvents' },
  { key: 'calendarLastGigDate', header: 'calendarLastGigDate' },
  { key: 'calendarNextGigDate', header: 'calendarNextGigDate' },
  { key: 'calendarPastGigCount', header: 'calendarPastGigCount' },
  { key: 'calendarFutureGigCount', header: 'calendarFutureGigCount' },
  { key: 'calendarTotalGigsPlayed', header: 'calendarTotalGigsPlayed' },
  { key: 'calendarLastSyncedAt', header: 'calendarLastSyncedAt' }
];

var GENERATED_COLUMNS = MAP_GENERATED_COLUMNS.concat(BOOKING_GENERATED_COLUMNS);

var PLAIN_TEXT_SHEET_COLUMNS = [
  'upcoming event date',
  'upcoming event time',
  'websiteBookingEvents',
  'calendarGigEvents',
  'calendarPastGigEvents',
  'calendarFutureGigEvents',
  'calendarLastGigDate',
  'calendarNextGigDate',
  'calendarLastSyncedAt'
];

var OUTPUT_COLUMNS = [
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
  'private event',
  'played',
  'contactStatus',
  'draftStatus',
  'lastContactedDate',
  'nextFollowUpDate',
  'doNotContact',
  'priority',
  'bestFitScore',
  'websiteBookingEvents',
  'calendarGigEvents',
  'calendarPastGigEvents',
  'calendarFutureGigEvents',
  'calendarLastGigDate',
  'calendarNextGigDate',
  'calendarPastGigCount',
  'calendarFutureGigCount',
  'calendarTotalGigsPlayed',
  'calendarLastSyncedAt'
];

var CALENDAR_GIG_SHEET_HEADERS = [
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

var CALENDAR_REVIEW_SHEET_HEADERS = [
  'reviewKey',
  'firstSeenAt',
  'lastSeenAt',
  'calendarEventId',
  'sourceCalendarName',
  'eventDate',
  'eventTime',
  'eventEndTime',
  'status',
  'venueName',
  'summary',
  'location',
  'address',
  'sourceUrl',
  'suggestedPlace',
  'possibleMatches',
  'isDuplicate',
  'duplicateVenueSiteId',
  'duplicateVenueName',
  'reviewStatus',
  'notes',
  'promotedAt',
  'promotedSiteId'
];

var BUNDLED_CALENDAR_GIGS_CSV_GZIP_BASE64_PARTS = [
  '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',
  'vvgsgA7M7P8PPdEADQy8AAA='
];

var CATEGORY_NAMES = [
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

function doGet(e) {
  if (!e || !e.parameter) {
    return jsonOutput_(setupJddmCalendarAutomation_());
  }
  return routeRequest_(Object.assign({ action: 'csv' }, e && e.parameter ? e.parameter : {}));
}

function doPost(e) {
  var payload = {};
  try {
    payload = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
  } catch (error) {
    return jsonOutput_({ ok: false, code: 'BAD_JSON', message: 'Request JSON could not be read.' });
  }
  return routeRequest_(payload);
}

function routeRequest_(payload) {
  try {
    requireToken_(payload);
    var action = String(payload.action || 'csv');

    if (action === 'health') {
      return jsonOutput_({
        ok: true,
        sheetName: getSheet_().getName(),
        schemaVersion: JDDM_SCHEMA_VERSION,
        generatedColumns: GENERATED_COLUMNS
      });
    }

    if (action === 'schema') {
      return jsonOutput_(ensureGeneratedColumns_());
    }

    if (action === 'csv') {
      if (String(payload.autofill || '1') !== '0') {
        syncGeneratedColumns_({
          limit: Number(payload.autofillLimit || 5),
          geocodeMissing: true
        });
      }
      return csvOutput_(buildNormalizedCsv_());
    }

    if (action === 'syncGeneratedColumns') {
      return jsonOutput_(syncGeneratedColumns_(payload));
    }

    if (action === 'importCoordinates') {
      return jsonOutput_(importCoordinates_(payload));
    }

    if (action === 'stageWebsiteBookingEvents') {
      return jsonOutput_(stageWebsiteBookingEvents_(payload));
    }

    if (action === 'syncCalendarGigEvents') {
      return jsonOutput_(syncCalendarGigEvents_(payload));
    }

    if (action === 'runCalendarAutomation') {
      return jsonOutput_(runJddmCalendarSyncTrigger_());
    }

    if (action === 'setupCalendarAutomation' || action === 'installCalendarAutomation') {
      return jsonOutput_(setupJddmCalendarAutomation_());
    }

    if (action === 'syncPlayedFromLastGigDates') {
      return jsonOutput_(syncPlayedFromLastGigDates_(payload));
    }

    if (action === 'syncManualPlayedHistory') {
      return jsonOutput_(syncManualPlayedHistory_(payload));
    }

    if (action === 'importBundledCalendarGigs') {
      return jsonOutput_(importBundledCalendarGigsAndUpdateVenues_());
    }

    if (action === 'getVenue') {
      return jsonOutput_(getVenue_(payload.id));
    }

    if (action === 'saveVenue') {
      return jsonOutput_(saveVenue_(payload));
    }

    if (action === 'setPlayed') {
      return jsonOutput_(setPlayed_(payload));
    }

    return jsonOutput_({ ok: false, code: 'UNKNOWN_ACTION', message: 'Unknown spreadsheet bridge action.' });
  } catch (error) {
    return jsonOutput_({
      ok: false,
      code: error.code || 'BRIDGE_ERROR',
      message: error.message || String(error)
    });
  }
}

function requireToken_(payload) {
  if (!JDDM_BRIDGE_CONFIG.EDIT_TOKEN) return;
  if (String(payload.token || '') !== JDDM_BRIDGE_CONFIG.EDIT_TOKEN) {
    var error = new Error('Spreadsheet edit token did not match.');
    error.code = 'BAD_TOKEN';
    throw error;
  }
}

function getSheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (JDDM_BRIDGE_CONFIG.SHEET_NAME) {
    var namedSheet = spreadsheet.getSheetByName(JDDM_BRIDGE_CONFIG.SHEET_NAME);
    if (!namedSheet) throw new Error('Sheet not found: ' + JDDM_BRIDGE_CONFIG.SHEET_NAME);
    return namedSheet;
  }
  return spreadsheet.getSheets()[0];
}

function jsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function csvOutput_(csv) {
  return ContentService
    .createTextOutput(csv)
    .setMimeType(ContentService.MimeType.CSV);
}

function clean_(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, JDDM_BRIDGE_CONFIG.CALENDAR_TIMEZONE, 'yyyy-MM-dd');
  }
  return String(value).trim();
}

function normalizeHeader_(header) {
  return clean_(header).toLowerCase();
}

function getSheetValues_() {
  ensureGeneratedColumns_();
  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();
  if (!values.length) throw new Error('Spreadsheet has no header row.');
  return {
    sheet: sheet,
    headers: values[0].map(clean_),
    rows: values.slice(1)
  };
}

function makeHeaderMap_(headers) {
  var map = {};
  headers.forEach(function(header, index) {
    map[normalizeHeader_(header)] = index;
  });
  return map;
}

function findHeaderColumn_(headers, header) {
  var target = normalizeHeader_(header);
  for (var index = 0; index < headers.length; index++) {
    if (normalizeHeader_(headers[index]) === target) return index + 1;
  }
  return 0;
}

function appendGeneratedHeader_(sheet, headers, header) {
  var column = headers.length + 1;
  sheet.getRange(1, column).setValue(header);
  headers.push(header);
  return column;
}

function getByHeader_(row, headerMap, header) {
  var index = headerMap[normalizeHeader_(header)];
  if (index === undefined || index < 0) return '';
  return clean_(row[index]);
}

function getRawByHeader_(row, headerMap, header) {
  var index = headerMap[normalizeHeader_(header)];
  if (index === undefined || index < 0) return '';
  return row[index];
}

function hasHeader_(headerMap, header) {
  return headerMap[normalizeHeader_(header)] !== undefined;
}

function setByHeader_(rowValues, headerMap, header, value) {
  var index = headerMap[normalizeHeader_(header)];
  if (index === undefined || index < 0) return;
  rowValues[index] = value;
}

function ensureGeneratedColumns_() {
  var sheet = getSheet_();
  var maxPreferredColumn = MAP_GENERATED_COLUMNS.reduce(function(max, columnSpec) {
    return Math.max(max, columnSpec.column || 0);
  }, 0);
  var maxColumns = Math.max(sheet.getLastColumn(), maxPreferredColumn, 1);
  var headerRange = sheet.getRange(1, 1, 1, maxColumns);
  var headers = headerRange.getValues()[0].map(clean_);
  var changed = [];
  var preserved = [];
  var resolvedColumns = [];

  GENERATED_COLUMNS.forEach(function(columnSpec) {
    var existingColumn = findHeaderColumn_(headers, columnSpec.header);
    if (existingColumn) {
      resolvedColumns.push(Object.assign({}, columnSpec, { column: existingColumn }));
      return;
    }

    if (columnSpec.column) {
      var index = columnSpec.column - 1;
      if (!headers[index]) {
        sheet.getRange(1, columnSpec.column).setValue(columnSpec.header);
        headers[index] = columnSpec.header;
        changed.push(columnSpec.header);
        resolvedColumns.push(Object.assign({}, columnSpec, { column: columnSpec.column }));
        return;
      }

      var appendedFixedColumn = appendGeneratedHeader_(sheet, headers, columnSpec.header);
      changed.push(columnSpec.header);
      preserved.push({
        header: columnSpec.header,
        preferredColumn: columnSpec.column,
        existingHeader: headers[index],
        actualColumn: appendedFixedColumn
      });
      resolvedColumns.push(Object.assign({}, columnSpec, { column: appendedFixedColumn }));
      return;
    }

    var appendedColumn = appendGeneratedHeader_(sheet, headers, columnSpec.header);
    changed.push(columnSpec.header);
    resolvedColumns.push(Object.assign({}, columnSpec, { column: appendedColumn }));
  });

  applyPlainTextSheetColumnFormats_(sheet, headers);

  return {
    ok: true,
    schemaVersion: JDDM_SCHEMA_VERSION,
    sheetName: sheet.getName(),
    changedHeaders: changed,
    preservedHeaders: preserved,
    columns: resolvedColumns
  };
}

function applyPlainTextSheetColumnFormats_(sheet, headers) {
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  PLAIN_TEXT_SHEET_COLUMNS.forEach(function(header) {
    var column = findHeaderColumn_(headers, header);
    if (!column) return;
    sheet.getRange(2, column, rowCount, 1).setNumberFormat('@');
  });
}

function isBlankVenueRow_(row, headerMap) {
  return ![
    getByHeader_(row, headerMap, 'Place'),
    getByHeader_(row, headerMap, 'venue name'),
    getByHeader_(row, headerMap, 'name'),
    getByHeader_(row, headerMap, 'address'),
    getByHeader_(row, headerMap, 'city')
  ].filter(Boolean).length;
}

function isValidCoordinate_(value) {
  var numberValue = Number(value);
  return Number.isFinite(numberValue) && Math.abs(numberValue) > 0.000001;
}

function roundCoordinate_(value) {
  var numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '';
  return String(Math.round(numberValue * 1000000) / 1000000);
}

function buildGeocodeQuery_(row, headerMap) {
  var parsedPlace = parsePlace_(getByHeader_(row, headerMap, 'Place'));
  var name = getByHeader_(row, headerMap, 'venue name') || parsedPlace.name;
  var address = getByHeader_(row, headerMap, 'address') || parsedPlace.address;
  var city = getByHeader_(row, headerMap, 'city') || parsedPlace.city;
  var state = getByHeader_(row, headerMap, 'state') || parsedPlace.state || 'OH';
  var zip = getByHeader_(row, headerMap, 'zip') || parsedPlace.zip;
  var directPlace = getByHeader_(row, headerMap, 'Place');

  if (address || city || zip) {
    return [name, address, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  }

  return directPlace || name;
}

function geocodeRow_(row, headerMap) {
  var query = buildGeocodeQuery_(row, headerMap);
  if (!query) return null;

  try {
    var response = Maps.newGeocoder().geocode(query);
    if (!response || response.status !== 'OK' || !response.results || !response.results.length) return null;
    var location = response.results[0].geometry && response.results[0].geometry.location;
    if (!location) return null;
    return {
      latitude: roundCoordinate_(location.lat),
      longitude: roundCoordinate_(location.lng),
      query: query
    };
  } catch (error) {
    return null;
  }
}

function parsePlace_(value) {
  var raw = clean_(value).replace(/\s+/g, ' ');
  if (!raw) return {};

  var parts = raw.split(',').map(function(part) { return clean_(part); }).filter(Boolean);
  var parsed = {
    name: parts[0] || raw,
    address: '',
    city: '',
    state: 'OH',
    zip: ''
  };

  if (parts.length >= 3) {
    var stateZip = parts[parts.length - 1].match(/\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/i);
    parsed.city = parts[parts.length - 2] || '';
    parsed.address = parts.slice(1, -2).join(', ');
    if (stateZip) {
      parsed.state = stateZip[1].toUpperCase();
      parsed.zip = stateZip[2];
    }
    return parsed;
  }

  var inlineMatch = raw.match(/^(.*?),?\s+(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  if (inlineMatch) {
    parsed.name = clean_(inlineMatch[1]);
    parsed.city = clean_(inlineMatch[2]);
    parsed.state = inlineMatch[3].toUpperCase();
    parsed.zip = inlineMatch[4];
  }

  return parsed;
}

function slugify_(value) {
  return clean_(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeBoolean_(value) {
  var lower = clean_(value).toLowerCase();
  return ['true', 'yes', 'y', '1', 'private'].indexOf(lower) >= 0 ? 'TRUE' : '';
}

function normalizePlayed_(value) {
  var lower = clean_(value).toLowerCase();
  return ['true', 'yes', 'y', '1', 'played', 'visited'].indexOf(lower) >= 0;
}

function playedText_(value) {
  return normalizePlayed_(value) ? 'Yes' : 'No';
}

function hasPlayedDateEvidence_(row, headerMap) {
  if (hasLastPlayedDateEvidence_(row, headerMap)) return true;
  if (isPositiveCount_(getByHeader_(row, headerMap, 'calendarPastGigCount'))) return true;
  if (isPositiveCount_(getByHeader_(row, headerMap, 'calendarTotalGigsPlayed'))) return true;
  return false;
}

function hasLastPlayedDateEvidence_(row, headerMap) {
  var dateHeaders = [
    'calendarLastGigDate',
    'last played',
    'lastPlayed',
    'lastPlayedDate',
    'last gig',
    'lastGigDate',
    'last gig date'
  ];

  for (var index = 0; index < dateHeaders.length; index++) {
    if (isPlayedDateValue_(getRawByHeader_(row, headerMap, dateHeaders[index]))) return true;
  }

  return false;
}

function getLastPlayedIsoDateFromRow_(row, headerMap) {
  var dateHeaders = [
    'calendarLastGigDate',
    'last played',
    'lastPlayed',
    'lastPlayedDate',
    'last gig',
    'lastGigDate',
    'last gig date'
  ];

  var best = '';
  dateHeaders.forEach(function(header) {
    var iso = normalizeDateValueToIso_(getRawByHeader_(row, headerMap, header));
    if (iso && (!best || iso > best)) best = iso;
  });
  return best;
}

function normalizeDateValueToIso_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, JDDM_BRIDGE_CONFIG.CALENDAR_TIMEZONE, 'yyyy-MM-dd');
  }

  var text = clean_(value);
  if (!text || /^(no|none|never|n\/a|na|false)$/i.test(text)) return '';

  var iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    return [
      iso[1],
      pad2_(Number(iso[2])),
      pad2_(Number(iso[3]))
    ].join('-');
  }

  var slashed = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (slashed) {
    var year = Number(slashed[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return [
      String(year),
      pad2_(Number(slashed[1])),
      pad2_(Number(slashed[2]))
    ].join('-');
  }

  var dashed = text.match(/\b(\d{1,2})-(\d{1,2})-(\d{2,4})\b/);
  if (dashed) {
    var dashedYear = Number(dashed[3]);
    if (dashedYear < 100) dashedYear += dashedYear >= 70 ? 1900 : 2000;
    return [
      String(dashedYear),
      pad2_(Number(dashed[1])),
      pad2_(Number(dashed[2]))
    ].join('-');
  }

  return '';
}

function pad2_(value) {
  return String(value || 0).padStart(2, '0');
}

function isExplicitPlayedNo_(row, headerMap) {
  var text = clean_(getByHeader_(row, headerMap, 'Played')).toLowerCase();
  return ['no', 'n', 'false', '0', 'not yet', 'never'].indexOf(text) >= 0;
}

function isPlayedDateValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return true;
  var text = clean_(value);
  if (!text) return false;
  if (/^(no|none|never|n\/a|na|false)$/i.test(text)) return false;
  return /\b\d{4}-\d{1,2}-\d{1,2}\b/.test(text) ||
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(text) ||
    /\b\d{1,2}-\d{1,2}-\d{2,4}\b/.test(text);
}

function isPositiveCount_(value) {
  var text = clean_(value).replace(/,/g, '');
  if (!text) return false;
  var numberValue = Number(text);
  return Number.isFinite(numberValue) && numberValue > 0;
}

function countNumber_(value) {
  var text = clean_(value).replace(/,/g, '');
  if (!text) return 0;
  var numberValue = Number(text);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function hasManualPlayedHistory_(row, headerMap) {
  return normalizePlayed_(getByHeader_(row, headerMap, 'Played')) ||
    hasLastPlayedDateEvidence_(row, headerMap);
}

function normalizeCategory_(value, isPrivate) {
  if (isPrivate) return 'Private Event';
  var raw = clean_(value);
  for (var i = 0; i < CATEGORY_NAMES.length; i++) {
    if (CATEGORY_NAMES[i].toLowerCase() === raw.toLowerCase()) return CATEGORY_NAMES[i];
  }

  var lower = raw.toLowerCase();
  if (lower.indexOf('golf') >= 0) return 'Other Venue';
  if (lower.indexOf('brew') >= 0) return 'Brewery';
  if (lower.indexOf('wine') >= 0) return 'Winery';
  if (
    lower.indexOf('restaurant') >= 0 ||
    lower.indexOf('grille') >= 0 ||
    lower.indexOf('grill') >= 0 ||
    lower.indexOf('bistro') >= 0 ||
    lower.indexOf('diner') >= 0 ||
    lower.indexOf('eatery') >= 0 ||
    lower.indexOf('dining') >= 0 ||
    lower.indexOf('food') >= 0
  ) return 'Restaurant';
  if (lower.indexOf('festival') >= 0 || lower.indexOf('fair') >= 0) return 'Festival';
  if (lower.indexOf('coffee') >= 0 || lower.indexOf('cafe') >= 0) return 'Coffee Shop';
  if (lower.indexOf('pub') >= 0 || lower.indexOf('bar') >= 0 || lower.indexOf('tavern') >= 0) return 'Pub/Bar';
  if (lower.indexOf('gallery') >= 0 || lower.indexOf('art') >= 0) return 'Art Gallery';
  if (lower.indexOf('farm') >= 0 || lower.indexOf('market') >= 0) return 'Farm/Farmers Market';
  if (lower.indexOf('private') >= 0 || lower.indexOf('wedding') >= 0 || lower.indexOf('party') >= 0) return 'Private Event';
  return 'Other Venue';
}

function buildBookingContact_(row, headerMap) {
  return [
    getByHeader_(row, headerMap, 'Contact Name'),
    getByHeader_(row, headerMap, 'Email/Contact'),
    getByHeader_(row, headerMap, 'Phone Number'),
    getByHeader_(row, headerMap, 'Contact Type')
  ].filter(Boolean).join(' | ');
}

function buildNotes_(row, headerMap) {
  var pairs = [
    ['Rank', getByHeader_(row, headerMap, 'Rank')],
    ['Contacted', getByHeader_(row, headerMap, 'Contacted')],
    ['Want', getByHeader_(row, headerMap, 'Want')],
    ['Times contacted', getByHeader_(row, headerMap, '#Times')],
    ['Card', getByHeader_(row, headerMap, 'Card')],
    ['Played', getByHeader_(row, headerMap, 'Played')],
    ['Music', getByHeader_(row, headerMap, 'Music')],
    ['Days/Months', getByHeader_(row, headerMap, 'Days/Months')],
    ['Status', getByHeader_(row, headerMap, 'Status')],
    ['Yearly Booking', getByHeader_(row, headerMap, 'Yearly Booking')],
    ['Notes', getByHeader_(row, headerMap, 'Notes')]
  ];

  return pairs
    .filter(function(pair) { return pair[1]; })
    .map(function(pair) { return pair[0] + ': ' + pair[1]; })
    .join('\n');
}

function makeVenueId_(row, headerMap, rowIndex, usedIds) {
  var explicit = getByHeader_(row, headerMap, 'Site ID') || getByHeader_(row, headerMap, 'id');
  var parsedPlace = parsePlace_(getByHeader_(row, headerMap, 'Place'));
  var base = explicit || [
    getByHeader_(row, headerMap, 'venue name') || parsedPlace.name,
    getByHeader_(row, headerMap, 'city') || parsedPlace.city,
    getByHeader_(row, headerMap, 'state') || parsedPlace.state,
    getByHeader_(row, headerMap, 'zip') || parsedPlace.zip
  ].filter(Boolean).join(' ');
  var id = slugify_(base) || ('venue-row-' + (rowIndex + 2));
  var suffix = 2;
  var original = id;

  while (usedIds[id]) {
    id = original + '-' + suffix;
    suffix++;
  }

  usedIds[id] = true;
  return id;
}

function normalizeRow_(row, headerMap, id) {
  var parsedPlace = parsePlace_(getByHeader_(row, headerMap, 'Place'));
  var privateEvent = normalizeBoolean_(getByHeader_(row, headerMap, 'private event'));
  var venueName = getByHeader_(row, headerMap, 'venue name') || parsedPlace.name;
  var venueType = normalizeCategory_(getByHeader_(row, headerMap, 'venue type') || venueName, Boolean(privateEvent));
  var notes = [getByHeader_(row, headerMap, 'notes'), buildNotes_(row, headerMap)].filter(Boolean).join('\n');
  var bookingContact = getByHeader_(row, headerMap, 'booking/contact info') || buildBookingContact_(row, headerMap);
  var latitude = getByHeader_(row, headerMap, 'Latitude') || getByHeader_(row, headerMap, 'lat');
  var longitude = getByHeader_(row, headerMap, 'Longitude') || getByHeader_(row, headerMap, 'lng') || getByHeader_(row, headerMap, 'long');
  var played = playedText_(getByHeader_(row, headerMap, 'Played') || (hasPlayedDateEvidence_(row, headerMap) ? 'Yes' : ''));
  var contactStatus = getByHeader_(row, headerMap, 'contactStatus') || getByHeader_(row, headerMap, 'Status');
  var draftStatus = getByHeader_(row, headerMap, 'draftStatus');
  var lastContactedDate = getByHeader_(row, headerMap, 'lastContactedDate') || getByHeader_(row, headerMap, 'Contacted');
  var nextFollowUpDate = getByHeader_(row, headerMap, 'nextFollowUpDate');
  var priority = getByHeader_(row, headerMap, 'priority') || getByHeader_(row, headerMap, 'Rank');
  var bestFitScore = getByHeader_(row, headerMap, 'bestFitScore') || getByHeader_(row, headerMap, 'best fit score');
  var websiteBookingEvents = getByHeader_(row, headerMap, 'websiteBookingEvents') || getByHeader_(row, headerMap, 'website booking events');
  var doNotContact = normalizeBoolean_(
    getByHeader_(row, headerMap, 'doNotContact') ||
    getByHeader_(row, headerMap, 'DNC') ||
    (contactStatus === 'Do Not Contact' ? 'TRUE' : '')
  );

  return {
    id: id,
    'venue name': venueName,
    address: getByHeader_(row, headerMap, 'address') || parsedPlace.address,
    city: getByHeader_(row, headerMap, 'city') || parsedPlace.city,
    state: getByHeader_(row, headerMap, 'state') || parsedPlace.state || 'OH',
    zip: getByHeader_(row, headerMap, 'zip') || parsedPlace.zip,
    latitude: latitude,
    longitude: longitude,
    'venue type': venueType,
    'website/social link': getByHeader_(row, headerMap, 'website/social link') || getByHeader_(row, headerMap, 'Website'),
    notes: notes,
    'booking/contact info': bookingContact,
    'upcoming event date': getByHeader_(row, headerMap, 'upcoming event date'),
    'upcoming event time': getByHeader_(row, headerMap, 'upcoming event time'),
    'private event': privateEvent,
    played: played,
    contactStatus: contactStatus,
    draftStatus: draftStatus,
    lastContactedDate: lastContactedDate,
    nextFollowUpDate: nextFollowUpDate,
    priority: priority,
    bestFitScore: bestFitScore,
    doNotContact: doNotContact,
    websiteBookingEvents: websiteBookingEvents,
    calendarGigEvents: getByHeader_(row, headerMap, 'calendarGigEvents'),
    calendarPastGigEvents: getByHeader_(row, headerMap, 'calendarPastGigEvents'),
    calendarFutureGigEvents: getByHeader_(row, headerMap, 'calendarFutureGigEvents'),
    calendarLastGigDate: getByHeader_(row, headerMap, 'calendarLastGigDate'),
    calendarNextGigDate: getByHeader_(row, headerMap, 'calendarNextGigDate'),
    calendarPastGigCount: getByHeader_(row, headerMap, 'calendarPastGigCount'),
    calendarFutureGigCount: getByHeader_(row, headerMap, 'calendarFutureGigCount'),
    calendarTotalGigsPlayed: getByHeader_(row, headerMap, 'calendarTotalGigsPlayed'),
    calendarLastSyncedAt: getByHeader_(row, headerMap, 'calendarLastSyncedAt')
  };
}

function getIndexedRows_() {
  var data = getSheetValues_();
  var headerMap = makeHeaderMap_(data.headers);
  var usedIds = {};
  var indexed = data.rows.map(function(row, index) {
    var id = makeVenueId_(row, headerMap, index, usedIds);
    return {
      id: id,
      rowNumber: index + 2,
      row: row,
      rawFields: rowToRawFields_(data.headers, row),
      venue: normalizeRow_(row, headerMap, id)
    };
  });

  data.headerMap = headerMap;
  data.indexed = indexed;
  return data;
}

function rowToRawFields_(headers, row) {
  var fields = {};
  headers.forEach(function(header, index) {
    if (!header) return;
    fields[header] = clean_(row[index]);
  });
  return fields;
}

function findVenueById_(id) {
  var data = getIndexedRows_();
  var target = clean_(id);
  var match = data.indexed.filter(function(item) { return item.id === target; })[0];
  if (!match) {
    var error = new Error('Venue row was not found in the spreadsheet.');
    error.code = 'VENUE_NOT_FOUND';
    throw error;
  }
  return { data: data, match: match };
}

function getVenue_(id) {
  var found = findVenueById_(id);
  return {
    ok: true,
    id: found.match.id,
    rowNumber: found.match.rowNumber,
    rawFields: found.match.rawFields,
    venue: normalizedToClientVenue_(found.match.venue)
  };
}

function normalizedToClientVenue_(venue) {
  return {
    id: venue.id,
    name: venue['venue name'],
    address: venue.address,
    city: venue.city,
    state: venue.state,
    zip: venue.zip,
    lat: venue.latitude,
    lng: venue.longitude,
    venueType: venue['venue type'],
    website: venue['website/social link'],
    notes: venue.notes,
    bookingContact: venue['booking/contact info'],
    eventDate: venue['upcoming event date'],
    eventTime: venue['upcoming event time'],
    privateEvent: normalizeBoolean_(venue['private event']),
    played: normalizePlayed_(venue.played),
    contactStatus: venue.contactStatus,
    draftStatus: venue.draftStatus,
    lastContactedDate: venue.lastContactedDate,
    nextFollowUpDate: venue.nextFollowUpDate,
    priority: venue.priority,
    bestFitScore: venue.bestFitScore,
    doNotContact: normalizeBoolean_(venue.doNotContact),
    websiteBookingEvents: venue.websiteBookingEvents,
    calendarGigEvents: venue.calendarGigEvents,
    calendarPastGigEvents: venue.calendarPastGigEvents,
    calendarFutureGigEvents: venue.calendarFutureGigEvents,
    calendarLastGigDate: venue.calendarLastGigDate,
    calendarNextGigDate: venue.calendarNextGigDate,
    calendarPastGigCount: venue.calendarPastGigCount,
    calendarFutureGigCount: venue.calendarFutureGigCount,
    calendarTotalGigsPlayed: venue.calendarTotalGigsPlayed,
    calendarLastSyncedAt: venue.calendarLastSyncedAt
  };
}

function saveVenue_(payload) {
  ensureGeneratedColumns_();
  var found = findVenueById_(payload.id);
  var sheet = found.data.sheet;
  var headers = found.data.headers;
  var headerMap = found.data.headerMap;
  var rowValues = found.match.row.slice();
  while (rowValues.length < headers.length) rowValues.push('');

  var rawFields = payload.rawFields || {};
  Object.keys(rawFields).forEach(function(header) {
    setByHeader_(rowValues, headerMap, header, rawFields[header]);
  });

  var venue = payload.venue || {};
  if (Object.keys(venue).length > 0) {
    venue.id = found.match.id;
    writeVenueFields_(rowValues, headerMap, venue, rawFields);
  }

  sheet.getRange(found.match.rowNumber, 1, 1, headers.length).setValues([rowValues]);

  return {
    ok: true,
    action: 'updated',
    id: found.match.id,
    rowNumber: found.match.rowNumber,
    venue: normalizedToClientVenue_(normalizeRow_(rowValues, headerMap, found.match.id)),
    rawFields: rowToRawFields_(headers, rowValues),
    csv: buildNormalizedCsv_()
  };
}

function writeVenueFields_(rowValues, headerMap, venue, rawFields) {
  var name = clean_(venue.name);
  var address = clean_(venue.address);
  var city = clean_(venue.city);
  var state = clean_(venue.state) || 'OH';
  var zip = clean_(venue.zip);

  if (name || address || city || zip) {
    setByHeader_(rowValues, headerMap, 'Place', [name, address, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', '));
  }

  setByHeader_(rowValues, headerMap, 'venue name', name);
  setByHeader_(rowValues, headerMap, 'address', address);
  setByHeader_(rowValues, headerMap, 'city', city);
  setByHeader_(rowValues, headerMap, 'state', state);
  setByHeader_(rowValues, headerMap, 'zip', zip);
  setByHeader_(rowValues, headerMap, 'Longitude', clean_(venue.lng));
  setByHeader_(rowValues, headerMap, 'Latitude', clean_(venue.lat));
  setByHeader_(rowValues, headerMap, 'Site ID', clean_(venue.id || rawFields && rawFields['Site ID']));
  setByHeader_(rowValues, headerMap, 'venue type', clean_(venue.venueType));
  setByHeader_(rowValues, headerMap, 'Website', clean_(venue.website));
  setByHeader_(rowValues, headerMap, 'website/social link', clean_(venue.website));
  if (!rawFields || !Object.prototype.hasOwnProperty.call(rawFields, 'Notes')) {
    setByHeader_(rowValues, headerMap, 'Notes', clean_(venue.notes));
  }
  setByHeader_(rowValues, headerMap, 'booking/contact info', clean_(venue.bookingContact));
  setByHeader_(rowValues, headerMap, 'upcoming event date', clean_(venue.eventDate));
  setByHeader_(rowValues, headerMap, 'upcoming event time', clean_(venue.eventTime));
  setByHeader_(rowValues, headerMap, 'private event', venue.privateEvent ? 'TRUE' : '');
  if (Object.prototype.hasOwnProperty.call(venue, 'played')) {
    setByHeader_(rowValues, headerMap, 'Played', playedText_(venue.played));
  }
  if (Object.prototype.hasOwnProperty.call(venue, 'contactStatus')) {
    setByHeader_(rowValues, headerMap, 'Status', clean_(venue.contactStatus));
    setByHeader_(rowValues, headerMap, 'contactStatus', clean_(venue.contactStatus));
  }
  if (Object.prototype.hasOwnProperty.call(venue, 'draftStatus')) {
    setByHeader_(rowValues, headerMap, 'draftStatus', clean_(venue.draftStatus));
  }
  if (Object.prototype.hasOwnProperty.call(venue, 'lastContactedDate')) {
    setByHeader_(rowValues, headerMap, 'Contacted', clean_(venue.lastContactedDate));
    setByHeader_(rowValues, headerMap, 'lastContactedDate', clean_(venue.lastContactedDate));
  }
  if (Object.prototype.hasOwnProperty.call(venue, 'nextFollowUpDate')) {
    setByHeader_(rowValues, headerMap, 'nextFollowUpDate', clean_(venue.nextFollowUpDate));
  }
  if (Object.prototype.hasOwnProperty.call(venue, 'doNotContact')) {
    setByHeader_(rowValues, headerMap, 'doNotContact', venue.doNotContact ? 'TRUE' : '');
    setByHeader_(rowValues, headerMap, 'DNC', venue.doNotContact ? 'Yes' : '');
  }
  if (Object.prototype.hasOwnProperty.call(venue, 'priority')) {
    setByHeader_(rowValues, headerMap, 'priority', clean_(venue.priority));
    setByHeader_(rowValues, headerMap, 'Rank', clean_(venue.priority));
  }
  if (Object.prototype.hasOwnProperty.call(venue, 'bestFitScore')) {
    setByHeader_(rowValues, headerMap, 'bestFitScore', clean_(venue.bestFitScore));
    setByHeader_(rowValues, headerMap, 'best fit score', clean_(venue.bestFitScore));
  }
  if (Object.prototype.hasOwnProperty.call(venue, 'websiteBookingEvents')) {
    setByHeader_(rowValues, headerMap, 'websiteBookingEvents', clean_(venue.websiteBookingEvents));
  }
  if (Object.prototype.hasOwnProperty.call(venue, 'calendarGigEvents')) {
    setByHeader_(rowValues, headerMap, 'calendarGigEvents', clean_(venue.calendarGigEvents));
  }
  if (Object.prototype.hasOwnProperty.call(venue, 'calendarPastGigEvents')) {
    setByHeader_(rowValues, headerMap, 'calendarPastGigEvents', clean_(venue.calendarPastGigEvents));
  }
  if (Object.prototype.hasOwnProperty.call(venue, 'calendarFutureGigEvents')) {
    setByHeader_(rowValues, headerMap, 'calendarFutureGigEvents', clean_(venue.calendarFutureGigEvents));
  }
  if (Object.prototype.hasOwnProperty.call(venue, 'calendarLastGigDate')) {
    setByHeader_(rowValues, headerMap, 'calendarLastGigDate', clean_(venue.calendarLastGigDate));
  }
  if (Object.prototype.hasOwnProperty.call(venue, 'calendarNextGigDate')) {
    setByHeader_(rowValues, headerMap, 'calendarNextGigDate', clean_(venue.calendarNextGigDate));
  }
  if (Object.prototype.hasOwnProperty.call(venue, 'calendarPastGigCount')) {
    setByHeader_(rowValues, headerMap, 'calendarPastGigCount', clean_(venue.calendarPastGigCount));
  }
  if (Object.prototype.hasOwnProperty.call(venue, 'calendarFutureGigCount')) {
    setByHeader_(rowValues, headerMap, 'calendarFutureGigCount', clean_(venue.calendarFutureGigCount));
  }
  if (Object.prototype.hasOwnProperty.call(venue, 'calendarTotalGigsPlayed')) {
    setByHeader_(rowValues, headerMap, 'calendarTotalGigsPlayed', clean_(venue.calendarTotalGigsPlayed));
  }
  if (Object.prototype.hasOwnProperty.call(venue, 'calendarLastSyncedAt')) {
    setByHeader_(rowValues, headerMap, 'calendarLastSyncedAt', clean_(venue.calendarLastSyncedAt));
  }
}

function setPlayed_(payload) {
  ensureGeneratedColumns_();
  var found = findVenueById_(payload.id);
  var sheet = found.data.sheet;
  var headers = found.data.headers;
  var headerMap = found.data.headerMap;
  var rowValues = found.match.row.slice();
  while (rowValues.length < headers.length) rowValues.push('');

  var nextPlayed = playedText_(payload.played);
  setByHeader_(rowValues, headerMap, 'Played', nextPlayed);
  sheet.getRange(found.match.rowNumber, 1, 1, headers.length).setValues([rowValues]);

  return {
    ok: true,
    action: 'setPlayed',
    id: found.match.id,
    rowNumber: found.match.rowNumber,
    played: normalizePlayed_(nextPlayed),
    venue: normalizedToClientVenue_(normalizeRow_(rowValues, headerMap, found.match.id)),
    rawFields: rowToRawFields_(headers, rowValues),
    csv: buildNormalizedCsv_()
  };
}

function syncGeneratedColumns_(payload) {
  ensureGeneratedColumns_();
  var data = getSheetValues_();
  var headerMap = makeHeaderMap_(data.headers);
  var usedIds = {};
  var limit = Math.max(1, Math.min(Number(payload && payload.limit || 25), 5000));
  var geocodeMissing = !payload || payload.geocodeMissing !== false;
  var startRow = Math.max(2, Number(payload && payload.startRow || 2));
  var rowCount = Number(payload && payload.rowCount || 0);
  var endRow = rowCount > 0 ? startRow + rowCount - 1 : Number.POSITIVE_INFINITY;
  var changedRows = [];
  var skippedRows = [];
  var geocodedRows = [];
  var rowUpdates = [];

  data.rows.forEach(function(row, index) {
    if (isBlankVenueRow_(row, headerMap)) return;

    var rowValues = row.slice();
    while (rowValues.length < data.headers.length) rowValues.push('');

    var siteId = makeVenueId_(rowValues, headerMap, index, usedIds);
    var rowNumber = index + 2;
    if (rowNumber < startRow || rowNumber > endRow || changedRows.length >= limit) return;

    var existingSiteId = getByHeader_(rowValues, headerMap, 'Site ID');
    var longitude = getByHeader_(rowValues, headerMap, 'Longitude') || getByHeader_(rowValues, headerMap, 'lng') || getByHeader_(rowValues, headerMap, 'long');
    var latitude = getByHeader_(rowValues, headerMap, 'Latitude') || getByHeader_(rowValues, headerMap, 'lat');
    var changed = false;

    if (existingSiteId !== siteId) {
      setByHeader_(rowValues, headerMap, 'Site ID', siteId);
      changed = true;
    }

    if ((!isValidCoordinate_(longitude) || !isValidCoordinate_(latitude)) && geocodeMissing) {
      var geocoded = geocodeRow_(rowValues, headerMap);
      if (geocoded && isValidCoordinate_(geocoded.longitude) && isValidCoordinate_(geocoded.latitude)) {
        setByHeader_(rowValues, headerMap, 'Longitude', geocoded.longitude);
        setByHeader_(rowValues, headerMap, 'Latitude', geocoded.latitude);
        geocodedRows.push({ rowNumber: rowNumber, siteId: siteId, query: geocoded.query });
        changed = true;
      } else {
        skippedRows.push({ rowNumber: rowNumber, siteId: siteId, reason: 'GEOCODE_FAILED' });
      }
    }

    if (!normalizePlayed_(getByHeader_(rowValues, headerMap, 'Played')) && hasPlayedDateEvidence_(rowValues, headerMap)) {
      setByHeader_(rowValues, headerMap, 'Played', 'Yes');
      changed = true;
    }

    if (changed) {
      rowUpdates.push({ rowNumber: rowNumber, rowValues: rowValues });
      changedRows.push({ rowNumber: rowNumber, siteId: siteId });
    }
  });

  rowUpdates.forEach(function(update) {
    data.sheet.getRange(update.rowNumber, 1, 1, data.headers.length).setValues([update.rowValues]);
  });

  return {
    ok: true,
    schemaVersion: JDDM_SCHEMA_VERSION,
    changedCount: changedRows.length,
    geocodedCount: geocodedRows.length,
    skippedCount: skippedRows.length,
    limit: limit,
    startRow: startRow,
    endRow: endRow === Number.POSITIVE_INFINITY ? null : endRow,
    changedRows: changedRows,
    geocodedRows: geocodedRows,
    skippedRows: skippedRows.slice(0, 25)
  };
}

function syncPlayedFromLastGigDates_(payload) {
  ensureGeneratedColumns_();
  var data = getSheetValues_();
  var headerMap = makeHeaderMap_(data.headers);
  var limit = Math.max(1, Math.min(Number(payload && payload.limit || 5000), 5000));
  var updates = [];

  data.rows.forEach(function(row, index) {
    if (updates.length >= limit || isBlankVenueRow_(row, headerMap)) return;
    if (normalizePlayed_(getByHeader_(row, headerMap, 'Played'))) return;
    if (!hasPlayedDateEvidence_(row, headerMap)) return;

    var rowValues = row.slice();
    while (rowValues.length < data.headers.length) rowValues.push('');
    setByHeader_(rowValues, headerMap, 'Played', 'Yes');
    updates.push({
      rowNumber: index + 2,
      rowValues: rowValues
    });
  });

  batchWriteSparseRows_(data.sheet, updates, data.headers.length);

  return {
    ok: true,
    action: 'syncPlayedFromLastGigDates',
    updatedCount: updates.length,
    updatedRows: updates.map(function(update) {
      return { rowNumber: update.rowNumber };
    }).slice(0, 100)
  };
}

function syncManualPlayedHistory_(payload) {
  ensureGeneratedColumns_();
  var nowIso = new Date().toISOString();
  var data = getSheetValues_();
  var headerMap = makeHeaderMap_(data.headers);
  var limit = Math.max(1, Math.min(Number(payload && payload.limit || 5000), 5000));
  var updates = [];

  data.rows.forEach(function(row, index) {
    if (updates.length >= limit || isBlankVenueRow_(row, headerMap)) return;

    var rowValues = row.slice();
    while (rowValues.length < data.headers.length) rowValues.push('');

    var manualHistory = getManualPlayedHistory_(rowValues, headerMap);
    if (!manualHistory.hasHistory) return;

    var changed = false;
    function writeIfChanged(header, value) {
      var nextValue = clean_(value);
      if (getByHeader_(rowValues, headerMap, header) === nextValue) return;
      setByHeader_(rowValues, headerMap, header, nextValue);
      changed = true;
    }

    writeIfChanged('Played', 'Yes');

    var existingCalendarCount = Math.max(
      countNumber_(getByHeader_(rowValues, headerMap, 'calendarPastGigCount')),
      countNumber_(getByHeader_(rowValues, headerMap, 'calendarTotalGigsPlayed'))
    );
    if (manualHistory.count > existingCalendarCount) {
      writeIfChanged('calendarPastGigCount', String(manualHistory.count));
      writeIfChanged('calendarTotalGigsPlayed', String(manualHistory.count));
    }

    if (manualHistory.lastPlayedDate) {
      writeIfChanged('calendarLastGigDate', chooseLatestIsoDate_(getByHeader_(rowValues, headerMap, 'calendarLastGigDate'), manualHistory.lastPlayedDate));
    }

    var eventsText = getByHeader_(rowValues, headerMap, 'calendarGigEvents');
    var cleanedEventsText = replaceLegacyManualHistoryNote_(eventsText, manualHistory.note);
    if ((cleanedEventsText !== eventsText || !eventsText || manualHistory.count > existingCalendarCount) && manualHistory.note) {
      writeIfChanged('calendarGigEvents', appendCalendarHistoryNote_(cleanedEventsText, manualHistory.note));
    }

    if (changed) {
      setByHeader_(rowValues, headerMap, 'calendarLastSyncedAt', nowIso);
      updates.push({
        rowNumber: index + 2,
        rowValues: rowValues,
        count: manualHistory.count,
        lastPlayedDate: manualHistory.lastPlayedDate
      });
    }
  });

  batchWriteSparseRows_(data.sheet, updates, data.headers.length);

  return {
    ok: true,
    action: 'syncManualPlayedHistory',
    updatedCount: updates.length,
    updatedRows: updates.map(function(update) {
      return {
        rowNumber: update.rowNumber,
        count: update.count,
        lastPlayedDate: update.lastPlayedDate
      };
    }).slice(0, 100)
  };
}

function importCoordinates_(payload) {
  ensureGeneratedColumns_();
  var rows = payload && Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) {
    return { ok: false, code: 'NO_ROWS', message: 'No coordinate rows were provided.' };
  }

  var data = getIndexedRows_();
  var byId = {};
  data.indexed.forEach(function(item) {
    byId[item.id] = item;
  });

  var limit = Math.max(1, Math.min(Number(payload.limit || rows.length), 5000));
  var updated = [];
  var missing = [];

  rows.slice(0, limit).forEach(function(input) {
    var id = clean_(input.id || input.siteId || input['Site ID']);
    var longitude = clean_(input.longitude || input.lng || input.long || input.Longitude);
    var latitude = clean_(input.latitude || input.lat || input.Latitude);
    if (!id || !isValidCoordinate_(longitude) || !isValidCoordinate_(latitude)) return;

    var item = byId[id];
    if (!item) {
      missing.push(id);
      return;
    }

    var rowValues = item.row.slice();
    while (rowValues.length < data.headers.length) rowValues.push('');
    setByHeader_(rowValues, data.headerMap, 'Longitude', roundCoordinate_(longitude));
    setByHeader_(rowValues, data.headerMap, 'Latitude', roundCoordinate_(latitude));
    setByHeader_(rowValues, data.headerMap, 'Site ID', id);
    data.sheet.getRange(item.rowNumber, 1, 1, data.headers.length).setValues([rowValues]);
    updated.push({ rowNumber: item.rowNumber, siteId: id });
  });

  return {
    ok: true,
    schemaVersion: JDDM_SCHEMA_VERSION,
    updatedCount: updated.length,
    missingCount: missing.length,
    updatedRows: updated,
    missingIds: missing.slice(0, 50)
  };
}

function stageWebsiteBookingEvents_(payload) {
  ensureGeneratedColumns_();
  var events = payload && Array.isArray(payload.events) ? payload.events : [];
  if (!events.length) {
    return { ok: false, code: 'NO_EVENTS', message: 'No website booking events were provided.' };
  }

  var data = getIndexedRows_();
  var matchIndex = buildWebsiteBookingMatchIndex_(data.indexed);
  var grouped = {};
  var matched = [];
  var unmatched = [];
  var dryRun = !payload || payload.dryRun !== false;
  var format = payload && payload.format === 'json' ? 'json' : 'text';
  var mode = payload && payload.mode === 'append' ? 'append' : 'replace';
  var limit = Math.max(1, Math.min(Number(payload && payload.limit || events.length), 1000));

  events.slice(0, limit).forEach(function(event, index) {
    var match = findWebsiteBookingVenueMatch_(event, matchIndex);
    var stagedEvent = normalizeWebsiteBookingEventForSheet_(event);

    if (!match) {
      unmatched.push({
        eventIndex: index,
        eventDate: stagedEvent.eventDate,
        eventTime: stagedEvent.eventTime,
        venueName: stagedEvent.venueName,
        location: stagedEvent.location,
        reason: 'NO_CONFIDENT_VENUE_MATCH'
      });
      return;
    }

    if (!grouped[match.item.id]) {
      grouped[match.item.id] = {
        item: match.item,
        events: []
      };
    }

    grouped[match.item.id].events.push(stagedEvent);
    matched.push({
      eventIndex: index,
      id: match.item.id,
      rowNumber: match.item.rowNumber,
      venueName: match.item.venue['venue name'],
      matchType: match.matchType
    });
  });

  var updatedRows = [];
  if (!dryRun) {
    Object.keys(grouped).forEach(function(id) {
      var group = grouped[id];
      var rowValues = group.item.row.slice();
      while (rowValues.length < data.headers.length) rowValues.push('');

      var stagedEvents = group.events;
      if (mode === 'append') {
        stagedEvents = dedupeWebsiteBookingEventsForSheet_(
          parseWebsiteBookingEventsCell_(getByHeader_(rowValues, data.headerMap, 'websiteBookingEvents')).concat(stagedEvents)
        );
      }

      setByHeader_(
        rowValues,
        data.headerMap,
        'websiteBookingEvents',
        formatWebsiteBookingEventsForCell_(stagedEvents, format)
      );
      data.sheet.getRange(group.item.rowNumber, 1, 1, data.headers.length).setValues([rowValues]);
      updatedRows.push({
        id: id,
        rowNumber: group.item.rowNumber,
        eventCount: stagedEvents.length
      });
    });
  }

  return {
    ok: true,
    action: 'stageWebsiteBookingEvents',
    dryRun: dryRun,
    mode: mode,
    format: format,
    stagedColumn: 'websiteBookingEvents',
    receivedCount: events.length,
    consideredCount: Math.min(events.length, limit),
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
    updatedRowCount: updatedRows.length,
    matchedRows: matched.slice(0, 50),
    updatedRows: updatedRows,
    unmatchedEvents: unmatched.slice(0, 50)
  };
}

function syncCalendarGigEvents_(payload) {
  ensureGeneratedColumns_();
  var dryRun = !payload || payload.dryRun !== false;
  var updateVenueRows = !payload || payload.updateVenueRows !== false;
  var now = new Date();
  var nowIso = now.toISOString();
  console.log('JDDM calendar sync started at ' + nowIso);
  var calendarUrls = payload && Array.isArray(payload.calendarUrls) && payload.calendarUrls.length
    ? payload.calendarUrls
    : JDDM_BRIDGE_CONFIG.CALENDAR_ICS_URLS;
  var calendarIds = payload && Array.isArray(payload.calendarIds) && payload.calendarIds.length
    ? payload.calendarIds
    : JDDM_BRIDGE_CONFIG.CALENDAR_IDS;
  var limit = Math.max(1, Math.min(Number(payload && payload.limit || 2000), 5000));
  var fetched = [];
  var events = [];

  calendarIds.forEach(function(calendarId) {
    try {
      console.log('Reading CalendarApp source: ' + calendarId);
      var calendarEvents = readCalendarAppEvents_(calendarId, {
        capturedAt: nowIso,
        timezone: JDDM_BRIDGE_CONFIG.CALENDAR_TIMEZONE,
        timeMin: payload && payload.timeMin,
        timeMax: payload && payload.timeMax
      });
      fetched.push({
        sourceType: 'CalendarApp',
        sourceUrl: calendarId,
        eventCount: calendarEvents.length
      });
      events = events.concat(calendarEvents);
      console.log('CalendarApp source read complete: ' + calendarId + ' events=' + calendarEvents.length);
    } catch (error) {
      console.log('CalendarApp source failed: ' + calendarId + ' error=' + (error && error.message ? error.message : error));
      fetched.push({
        sourceType: 'CalendarApp',
        sourceUrl: calendarId,
        eventCount: 0,
        error: error && error.message ? error.message : String(error)
      });
    }
  });

  calendarUrls.forEach(function(url) {
    try {
      console.log('Reading ICS source: ' + url);
      var icsText = fetchCalendarIcs_(url);
      var parsed = parseCalendarIcs_(icsText, {
        sourceUrl: url,
        capturedAt: nowIso,
        timezone: JDDM_BRIDGE_CONFIG.CALENDAR_TIMEZONE
      });
      fetched.push({
        sourceType: 'ICS',
        sourceUrl: url,
        eventCount: parsed.length
      });
      events = events.concat(parsed);
      console.log('ICS source read complete: ' + url + ' events=' + parsed.length);
    } catch (error) {
      console.log('ICS source failed: ' + url + ' error=' + (error && error.message ? error.message : error));
      fetched.push({
        sourceType: 'ICS',
        sourceUrl: url,
        eventCount: 0,
        error: error && error.message ? error.message : String(error)
      });
    }
  });

  events = dedupeCalendarGigEvents_(events)
    .filter(isLikelyCalendarGigEvent_)
    .slice(0, limit);
  console.log('JDDM calendar sync normalized events=' + events.length + ' dryRun=' + dryRun + ' updateVenueRows=' + updateVenueRows);

  var data = getIndexedRows_();
  var matchIndex = buildCalendarGigMatchIndex_(data.indexed);
  var matched = [];
  var unmatched = [];
  var unmatchedReviewEvents = [];
  var groupedByVenueId = {};
  var gigRows = [];

  events.forEach(function(event) {
    var match = findCalendarGigVenueMatch_(event, matchIndex);
    var gig = normalizeCalendarGigForSheet_(event, match, nowIso);
    gigRows.push(gig);

    if (match) {
      matched.push({
        calendarEventId: event.eventId,
        venueSiteId: match.item.id,
        venueName: match.item.venue['venue name'],
        gigDate: event.eventDate,
        matchType: match.matchType
      });

      if (!groupedByVenueId[match.item.id]) {
        groupedByVenueId[match.item.id] = {
          item: match.item,
          events: []
        };
      }
      groupedByVenueId[match.item.id].events.push(event);
    } else {
      unmatched.push({
        calendarEventId: event.eventId,
        summary: event.summary,
        location: event.location,
        gigDate: event.eventDate,
        reason: event.isPrivateEvent ? 'PRIVATE_OR_PLACEHOLDER_EVENT' : 'NO_CONFIDENT_VENUE_MATCH'
      });
      if (shouldStageCalendarReviewEvent_(event)) unmatchedReviewEvents.push(event);
    }
  });

  var updatedGigRows = [];
  var updatedVenueRows = [];
  var calendarReview = { stagedCount: 0, promotedCount: 0, updatedCount: 0, insertedCount: 0 };

  if (!dryRun) {
    console.log('Upserting CalendarGigs rows=' + gigRows.length);
    updatedGigRows = upsertCalendarGigRows_(gigRows);
    console.log('CalendarGigs upsert complete rows=' + updatedGigRows.length);
    if (updateVenueRows) {
      console.log('Updating venue rows from calendar groups=' + Object.keys(groupedByVenueId).length);
      updatedVenueRows = updateVenueRowsFromCalendarGigs_(data, groupedByVenueId, nowIso);
      console.log('Venue row calendar update complete rows=' + updatedVenueRows.length);
    }
    calendarReview = stageCalendarReviewRows_(unmatchedReviewEvents, nowIso);
    console.log('Calendar review rows staged=' + calendarReview.stagedCount + ' promoted=' + calendarReview.promotedCount);
  }

  return {
    ok: true,
    action: 'syncCalendarGigEvents',
    dryRun: dryRun,
    updateVenueRows: updateVenueRows,
    schemaVersion: JDDM_SCHEMA_VERSION,
    fetchedSources: fetched,
    receivedCount: events.length,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
    calendarReview: calendarReview,
    updatedGigRowCount: updatedGigRows.length,
    updatedVenueRowCount: updatedVenueRows.length,
    matchedRows: matched.slice(0, 75),
    unmatchedEvents: unmatched.slice(0, 75),
    updatedGigRows: updatedGigRows.slice(0, 75),
    updatedVenueRows: updatedVenueRows.slice(0, 75)
  };
}

function runJddmCalendarSyncTrigger() {
  return runJddmCalendarSyncTrigger_();
}

function runJddmCalendarSyncTrigger_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.log('JDDM 5-minute calendar sync skipped because a previous sync is still running.');
    return {
      ok: false,
      action: 'runJddmCalendarSyncTrigger',
      skipped: true,
      reason: 'LOCK_BUSY'
    };
  }

  try {
    var sync = syncCalendarGigEvents_({
      dryRun: false,
      updateVenueRows: true,
      limit: 3000
    });
    var played = syncPlayedFromLastGigDates_({ limit: 5000 });
    var manual = syncManualPlayedHistory_({ limit: 5000 });
    console.log(
      'JDDM 5-minute calendar sync complete. Calendar gigs=' + sync.updatedGigRowCount +
      ', venue rows=' + sync.updatedVenueRowCount +
      ', played rows=' + played.updatedCount +
      ', manual history rows=' + manual.updatedCount +
      ', review staged=' + ((sync.calendarReview && sync.calendarReview.stagedCount) || 0) +
      ', review promoted=' + ((sync.calendarReview && sync.calendarReview.promotedCount) || 0) +
      ', unmatched/private=' + sync.unmatchedCount
    );
    return {
      ok: true,
      action: 'runJddmCalendarSyncTrigger',
      sync: sync,
      played: played,
      manual: manual
    };
  } finally {
    lock.releaseLock();
  }
}

function setupJddmCalendarAutomation_() {
  installJddmAutoFillTrigger_();
  var trigger = installJddmCalendarSyncTrigger_();
  var firstRun = runJddmCalendarSyncTrigger_();
  return {
    ok: true,
    action: 'setupJddmCalendarAutomation',
    trigger: trigger,
    firstRun: firstRun
  };
}

function fetchCalendarIcs_(url) {
  if (!url) return '';
  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true
  });
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Calendar ICS fetch failed with HTTP ' + code + ': ' + url);
  }
  return response.getContentText();
}

function readCalendarAppEvents_(calendarId, options) {
  var calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) {
    throw new Error('Calendar is unavailable to this Apps Script account: ' + calendarId);
  }

  var timeMin = parseIsoDateForCalendarSync_(options.timeMin || JDDM_BRIDGE_CONFIG.CALENDAR_SYNC_START_DATE, false);
  var timeMax = parseIsoDateForCalendarSync_(options.timeMax || JDDM_BRIDGE_CONFIG.CALENDAR_SYNC_END_DATE, true);
  var events = calendar.getEvents(timeMin, timeMax);

  return events.map(function(event) {
    return normalizeCalendarAppEvent_(event, {
      calendarId: calendarId,
      sourceCalendarName: calendar.getName ? calendar.getName() : calendarId,
      capturedAt: options.capturedAt,
      timezone: options.timezone
    });
  });
}

function parseIsoDateForCalendarSync_(value, endOfDay) {
  var text = clean_(value);
  var match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return endOfDay ? new Date(2030, 11, 31, 23, 59, 59) : new Date(2020, 0, 1, 0, 0, 0);
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0
  );
}

function normalizeCalendarAppEvent_(event, options) {
  var start = event.getStartTime();
  var end = event.getEndTime();
  var summary = clean_(event.getTitle());
  var location = clean_(event.getLocation && event.getLocation());
  var description = clean_(event.getDescription && event.getDescription());
  var eventDate = Utilities.formatDate(start, options.timezone, 'yyyy-MM-dd');
  var isAllDay = event.isAllDayEvent && event.isAllDayEvent();
  var privateEvent = isPrivateCalendarEvent_(summary);

  return {
    eventId: event.getId(),
    calendarId: slugify_(options.calendarId),
    sourceCalendarName: options.sourceCalendarName || options.calendarId,
    eventDate: eventDate,
    eventEndDate: Utilities.formatDate(end, options.timezone, 'yyyy-MM-dd'),
    eventTime: isAllDay ? '' : Utilities.formatDate(start, options.timezone, 'h:mma').toLowerCase(),
    eventEndTime: isAllDay ? '' : Utilities.formatDate(end, options.timezone, 'h:mma').toLowerCase(),
    isAllDay: Boolean(isAllDay),
    summary: summary,
    venueName: deriveCalendarVenueName_(summary, location, privateEvent),
    location: location,
    address: location,
    description: description,
    isPrivateEvent: privateEvent,
    isPublicPlaceholder: isCalendarPlaceholderEvent_(summary),
    status: inferCalendarGigStatus_(summary, eventDate),
    sourceUrl: options.calendarId,
    sourceCapturedAt: options.capturedAt || ''
  };
}

function parseCalendarIcs_(icsText, options) {
  var lines = unfoldIcsLines_(icsText);
  var calendarName = '';
  var events = [];
  var current = null;

  lines.forEach(function(line) {
    if (line.indexOf('X-WR-CALNAME:') === 0) {
      calendarName = unescapeIcsText_(line.substring('X-WR-CALNAME:'.length));
      return;
    }

    if (line === 'BEGIN:VEVENT') {
      current = {};
      return;
    }

    if (line === 'END:VEVENT') {
      if (current) {
        events.push(normalizeCalendarIcsEvent_(current, {
          sourceUrl: options.sourceUrl,
          sourceCalendarName: calendarName,
          capturedAt: options.capturedAt,
          timezone: options.timezone
        }));
      }
      current = null;
      return;
    }

    if (!current) return;
    var separator = line.indexOf(':');
    if (separator < 0) return;
    var nameAndParams = line.substring(0, separator);
    var value = line.substring(separator + 1);
    var propertyName = nameAndParams.split(';')[0].toUpperCase();
    current[propertyName] = {
      rawName: nameAndParams,
      value: value
    };
  });

  return events.filter(function(event) {
    return event.eventId && event.summary && event.eventDate;
  });
}

function unfoldIcsLines_(icsText) {
  return clean_(icsText)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .reduce(function(lines, line) {
      if (/^[ \t]/.test(line) && lines.length) {
        lines[lines.length - 1] += line.substring(1);
      } else {
        lines.push(line);
      }
      return lines;
    }, []);
}

function normalizeCalendarIcsEvent_(rawEvent, options) {
  var start = parseCalendarIcsDate_(rawEvent.DTSTART);
  var end = parseCalendarIcsDate_(rawEvent.DTEND);
  var eventId = unescapeIcsText_(rawEvent.UID && rawEvent.UID.value);
  var summary = unescapeIcsText_(rawEvent.SUMMARY && rawEvent.SUMMARY.value);
  var location = unescapeIcsText_(rawEvent.LOCATION && rawEvent.LOCATION.value);
  var description = unescapeIcsText_(rawEvent.DESCRIPTION && rawEvent.DESCRIPTION.value);
  var privateEvent = isPrivateCalendarEvent_(summary);
  var status = inferCalendarGigStatus_(summary, start.date);

  return {
    eventId: eventId,
    calendarId: slugify_(options.sourceCalendarName || options.sourceUrl),
    sourceCalendarName: options.sourceCalendarName || '',
    eventDate: start.date,
    eventEndDate: end.date,
    eventTime: start.time,
    eventEndTime: end.time,
    isAllDay: start.isAllDay,
    summary: summary,
    venueName: deriveCalendarVenueName_(summary, location, privateEvent),
    location: location,
    address: location,
    description: description,
    isPrivateEvent: privateEvent,
    isPublicPlaceholder: isCalendarPlaceholderEvent_(summary),
    status: status,
    sourceUrl: options.sourceUrl || '',
    sourceCapturedAt: options.capturedAt || ''
  };
}

function parseCalendarIcsDate_(property) {
  if (!property || !property.value) return { date: '', time: '', isAllDay: false };
  var rawName = property.rawName || '';
  var value = clean_(property.value);
  var isAllDay = rawName.indexOf('VALUE=DATE') >= 0 || /^\d{8}$/.test(value);

  if (isAllDay) {
    return {
      date: value.substring(0, 4) + '-' + value.substring(4, 6) + '-' + value.substring(6, 8),
      time: '',
      isAllDay: true
    };
  }

  var match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) return { date: '', time: '', isAllDay: false };
  if (value.charAt(value.length - 1) !== 'Z') {
    return {
      date: match[1] + '-' + match[2] + '-' + match[3],
      time: formatCalendarLocalTime_(Number(match[4]), Number(match[5])),
      isAllDay: false
    };
  }
  var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])));
  var timezone = JDDM_BRIDGE_CONFIG.CALENDAR_TIMEZONE;
  return {
    date: Utilities.formatDate(date, timezone, 'yyyy-MM-dd'),
    time: Utilities.formatDate(date, timezone, 'h:mma').toLowerCase(),
    isAllDay: false
  };
}

function formatCalendarLocalTime_(hour24, minute) {
  var suffix = hour24 >= 12 ? 'pm' : 'am';
  var hour12 = hour24 % 12 || 12;
  return hour12 + ':' + ('0' + minute).slice(-2) + suffix;
}

function unescapeIcsText_(value) {
  return clean_(value)
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

function isPrivateCalendarEvent_(summary) {
  var lower = clean_(summary).toLowerCase();
  return lower.indexOf('private') >= 0 || lower.indexOf('scheduled private event') >= 0;
}

function isCalendarPlaceholderEvent_(summary) {
  var lower = clean_(summary).toLowerCase();
  return lower.indexOf('scheduled public event') >= 0 ||
    lower.indexOf('scheduled private event') >= 0 ||
    lower.indexOf('holiday tour') >= 0 ||
    lower.indexOf('winter tour') >= 0 ||
    lower.indexOf('spring tour') >= 0 ||
    lower.indexOf('summer tour') >= 0;
}

function isLikelyCalendarGigEvent_(event) {
  var lower = clean_(event.summary).toLowerCase();
  if (!lower) return false;
  if (lower.indexOf('camping ') === 0) return false;
  if (lower === 'easter') return false;
  if (lower.indexOf('flight ') === 0) return false;
  if (lower.indexOf('birthday') >= 0) return false;
  if (event.isAllDay && !event.isPrivateEvent && !event.isPublicPlaceholder && lower.indexOf('tour') < 0) return false;
  return true;
}

function inferCalendarGigStatus_(summary, eventDate) {
  var lower = clean_(summary).toLowerCase();
  if (lower.indexOf('proposed') >= 0 || lower.indexOf('hold') >= 0) return 'PROPOSED';
  if (eventDate && eventDate < Utilities.formatDate(new Date(), JDDM_BRIDGE_CONFIG.CALENDAR_TIMEZONE, 'yyyy-MM-dd')) return 'COMPLETED';
  return 'BOOKED';
}

function deriveCalendarVenueName_(summary, location, isPrivateEvent) {
  if (isPrivateEvent) return 'Private Event';
  var cleaned = clean_(summary)
    .replace(/\s*-\s*proposed\s*$/i, '')
    .replace(/\s+Open Mic$/i, ' Open Mic')
    .replace(/^JustDeeDeeMusic\s+Live\s+@\s+/i, '')
    .replace(/^Live Music with JustDeeDeeMusic at\s+/i, '')
    .replace(/^JDDM\s+\d{4}\s+Scheduled\s+Public\s+Event$/i, '');
  if (cleaned) return cleaned;
  return clean_(location) || summary;
}

function dedupeCalendarGigEvents_(events) {
  var seen = {};
  var deduped = [];

  events.forEach(function(event) {
    var key = [
      event.eventId || '',
      event.eventDate,
      event.eventTime,
      websiteBookingTextKey_(event.summary),
      websiteBookingTextKey_(event.location)
    ].join('|');
    if (seen[key]) return;
    seen[key] = true;
    deduped.push(event);
  });

  return deduped.sort(function(a, b) {
    var dateCompare = String(a.eventDate || '').localeCompare(String(b.eventDate || ''));
    if (dateCompare) return dateCompare;
    return String(a.eventTime || '').localeCompare(String(b.eventTime || ''));
  });
}

function buildCalendarGigMatchIndex_(indexedRows) {
  return buildWebsiteBookingMatchIndex_(indexedRows);
}

var CALENDAR_GIG_VENUE_ALIASES = {
  'amish door market': ['The Market at Amish Door Village'],
  'brighton brewing': ['Brighten Brewing Company'],
  'crocker park': ['Crocker Park 177 Market St'],
  'das weinhaus open mic': ['Das Weinhaus'],
  'haymaker farmers market music': ['Haymakers Farmers Market'],
  'halliday winery': ['Hallidays Winery'],
  'lala s in lakes trial': ["Lala's in the Lakes"],
  'lorain brewing': ['Lorain Brewing Company and Event Center'],
  'madison brewing': ['Madison Brewing Company'],
  'markko vineyard': ['Markko Vineyard and Winery'],
  'old fish house huron': ['Old Fish House'],
  'paninis brunswick': ['Paninis Grill 3520 Center Rd'],
  'secret at center': ['Secret of Center 3511 Center Road'],
  'south river vineyard': ['South River Winery'],
  'wooster famers market': ['Wooster Farmers Market']
};

function findCalendarGigVenueMatch_(event, matchIndex) {
  if (event.isPrivateEvent || event.isPublicPlaceholder) return null;
  var parsedLocation = parsePlace_(event.location);
  var candidates = calendarGigVenueNameCandidates_(event);

  for (var index = 0; index < candidates.length; index++) {
    var directMatch = findWebsiteBookingVenueMatch_({
      siteId: event.siteId,
      venueName: candidates[index],
      address: event.address,
      city: parsedLocation.city,
      isPrivateEvent: false,
      isPublicPlaceholder: false
    }, matchIndex);
    if (directMatch) return directMatch;
  }

  for (var looseIndex = 0; looseIndex < candidates.length; looseIndex++) {
    var looseMatch = findUniqueCalendarGigNameContainsMatch_(candidates[looseIndex], matchIndex);
    if (looseMatch) return looseMatch;
  }

  return null;
}

function calendarGigVenueNameCandidates_(event) {
  var candidates = [];
  var seen = {};

  addCalendarGigVenueCandidate_(candidates, seen, event.venueName || event.summary);
  addCalendarGigVenueCandidate_(candidates, seen, event.summary);
  addCalendarGigLocationVenueCandidate_(candidates, seen, parsePlace_(event.location).name);

  for (var index = 0; index < candidates.length; index++) {
    var simplified = simplifyCalendarGigVenueName_(candidates[index]);
    addCalendarGigVenueCandidate_(candidates, seen, simplified);

    calendarGigVenueAliasesFor_(candidates[index]).forEach(function(alias) {
      addCalendarGigVenueCandidate_(candidates, seen, alias);
      addCalendarGigVenueCandidate_(candidates, seen, simplifyCalendarGigVenueName_(alias));
    });
  }

  return candidates;
}

function addCalendarGigVenueCandidate_(candidates, seen, value) {
  var cleaned = clean_(value);
  var key = websiteBookingTextKey_(cleaned);
  if (!key || seen[key]) return;
  seen[key] = true;
  candidates.push(cleaned);
}

function addCalendarGigLocationVenueCandidate_(candidates, seen, value) {
  var key = websiteBookingTextKey_(value);
  if (!key || key.split(' ').length < 2) return;
  addCalendarGigVenueCandidate_(candidates, seen, value);
}

function simplifyCalendarGigVenueName_(value) {
  return clean_(value)
    .replace(/^new event\s+/i, '')
    .replace(/\s*-\s*proposed\s*$/i, '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s*-\s*lake milton\s*$/i, '')
    .replace(/\s+open mic$/i, '')
    .replace(/\s+music$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function calendarGigVenueAliasesFor_(value) {
  return CALENDAR_GIG_VENUE_ALIASES[websiteBookingTextKey_(value)] || [];
}

function findUniqueCalendarGigNameContainsMatch_(candidate, matchIndex) {
  var candidateKey = websiteBookingTextKey_(candidate);
  if (!candidateKey || candidateKey.length < 5) return null;

  var matches = [];
  var seen = {};
  Object.keys(matchIndex.byVenueName || {}).forEach(function(venueKey) {
    if (!isCalendarGigLooseVenueNameMatch_(candidateKey, venueKey)) return;
    (matchIndex.byVenueName[venueKey] || []).forEach(function(item) {
      var id = item && (item.id || item.rowNumber);
      if (!id || seen[id]) return;
      seen[id] = true;
      matches.push(item);
    });
  });

  if (matches.length === 1) return { item: matches[0], matchType: 'venue-name-contains' };
  return null;
}

function isCalendarGigLooseVenueNameMatch_(candidateKey, venueKey) {
  if (!candidateKey || !venueKey) return false;
  if (candidateKey.length < 5 || venueKey.length < 5) return false;
  if (candidateKey === venueKey) return true;
  if (venueKey.indexOf(candidateKey) >= 0 || candidateKey.indexOf(venueKey) >= 0) return true;

  var compactCandidate = candidateKey.replace(/\s+/g, '');
  var compactVenue = venueKey.replace(/\s+/g, '');
  if (compactCandidate.length < 5 || compactVenue.length < 5) return false;
  return compactVenue.indexOf(compactCandidate) >= 0 || compactCandidate.indexOf(compactVenue) >= 0;
}

function normalizeCalendarGigForSheet_(event, match, nowIso) {
  var venue = match && match.item ? match.item.venue : {};
  return {
    gigId: makeCalendarGigId_(event),
    calendarEventId: event.eventId,
    calendarId: event.calendarId,
    sourceCalendarName: event.sourceCalendarName,
    venueSiteId: match && match.item ? match.item.id : '',
    venueName: match && match.item ? venue['venue name'] : event.venueName,
    gigDate: event.eventDate,
    startTime: event.eventTime,
    endTime: '',
    status: event.status,
    address: event.address,
    location: event.location,
    summary: event.summary,
    description: event.description,
    isPrivateEvent: event.isPrivateEvent ? 'TRUE' : '',
    isAllDay: event.isAllDay ? 'TRUE' : '',
    sourceUrl: event.sourceUrl,
    lastSeenAt: nowIso,
    updatedAt: nowIso
  };
}

function makeCalendarGigId_(event) {
  return slugify_([event.calendarId, event.eventId].filter(Boolean).join(' ')) ||
    slugify_([event.eventDate, event.eventTime, event.summary].join(' '));
}

function ensureCalendarGigSheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(JDDM_BRIDGE_CONFIG.CALENDAR_GIG_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(JDDM_BRIDGE_CONFIG.CALENDAR_GIG_SHEET_NAME);
  }

  var maxColumns = Math.max(sheet.getLastColumn(), CALENDAR_GIG_SHEET_HEADERS.length, 1);
  var headers = sheet.getRange(1, 1, 1, maxColumns).getValues()[0].map(clean_);

  CALENDAR_GIG_SHEET_HEADERS.forEach(function(header, index) {
    if (!headers[index]) {
      sheet.getRange(1, index + 1).setValue(header);
      headers[index] = header;
    }
  });

  return {
    sheet: sheet,
    headers: headers,
    headerMap: makeHeaderMap_(headers)
  };
}

function upsertCalendarGigRows_(gigRows) {
  var data = ensureCalendarGigSheet_();
  var values = data.sheet.getDataRange().getValues();
  var headerMap = makeHeaderMap_(values[0].map(clean_));
  var existingByGigId = {};
  values.slice(1).forEach(function(row, index) {
    var gigId = getByHeader_(row, headerMap, 'gigId');
    if (gigId) existingByGigId[gigId] = { rowNumber: index + 2, row: row };
  });

  var updated = [];
  var inserts = [];
  var updateQueue = [];
  gigRows.forEach(function(gig) {
    var rowValues = CALENDAR_GIG_SHEET_HEADERS.map(function(header) {
      return clean_(gig[header]);
    });
    var existing = existingByGigId[gig.gigId];
    if (existing) {
      updateQueue.push({
        rowNumber: existing.rowNumber,
        rowValues: rowValues
      });
      updated.push({ action: 'updated', rowNumber: existing.rowNumber, gigId: gig.gigId });
    } else {
      inserts.push({ gigId: gig.gigId, rowValues: rowValues });
    }
  });

  batchWriteSparseRows_(data.sheet, updateQueue, CALENDAR_GIG_SHEET_HEADERS.length);

  if (inserts.length) {
    var startRow = Math.max(data.sheet.getLastRow() + 1, 2);
    data.sheet.getRange(startRow, 1, inserts.length, CALENDAR_GIG_SHEET_HEADERS.length)
      .setValues(inserts.map(function(item) { return item.rowValues; }));
    inserts.forEach(function(item, index) {
      updated.push({ action: 'inserted', rowNumber: startRow + index, gigId: item.gigId });
    });
  }

  return updated;
}

function shouldStageCalendarReviewEvent_(event) {
  return Boolean(event) &&
    !event.isPrivateEvent &&
    !event.isPublicPlaceholder &&
    clean_(event.venueName || event.summary);
}

function ensureCalendarReviewSheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(JDDM_BRIDGE_CONFIG.CALENDAR_REVIEW_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(JDDM_BRIDGE_CONFIG.CALENDAR_REVIEW_SHEET_NAME);
  }

  var maxColumns = Math.max(sheet.getLastColumn(), CALENDAR_REVIEW_SHEET_HEADERS.length, 1);
  var headers = sheet.getRange(1, 1, 1, maxColumns).getValues()[0].map(clean_);
  CALENDAR_REVIEW_SHEET_HEADERS.forEach(function(header, index) {
    if (!headers[index]) {
      sheet.getRange(1, index + 1).setValue(header);
      headers[index] = header;
    }
  });

  sheet.setFrozenRows(1);
  var duplicateColumn = findHeaderColumn_(headers, 'isDuplicate');
  if (duplicateColumn) {
    var validation = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Yes', 'No'], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, duplicateColumn, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(validation);
  }

  return {
    sheet: sheet,
    headers: headers,
    headerMap: makeHeaderMap_(headers)
  };
}

function stageCalendarReviewRows_(events, nowIso) {
  var data = ensureCalendarReviewSheet_();
  var values = data.sheet.getDataRange().getValues();
  var headerMap = makeHeaderMap_((values[0] || CALENDAR_REVIEW_SHEET_HEADERS).map(clean_));
  var mainData = getIndexedRows_();
  var matchIndex = buildCalendarGigMatchIndex_(mainData.indexed);
  var existingByReviewKey = {};
  values.slice(1).forEach(function(row, index) {
    var reviewKey = getByHeader_(row, headerMap, 'reviewKey');
    if (reviewKey) existingByReviewKey[reviewKey] = { rowNumber: index + 2, row: row };
  });

  var updateQueue = [];
  var inserts = [];
  (events || []).filter(shouldStageCalendarReviewEvent_).forEach(function(event) {
    var review = normalizeCalendarReviewForSheet_(event, nowIso);
    review.possibleMatches = summarizeCalendarReviewPossibleMatches_(event, matchIndex);
    var existing = existingByReviewKey[review.reviewKey];
    if (existing) {
      var rowValues = existing.row.slice();
      while (rowValues.length < data.headers.length) rowValues.push('');
      writeCalendarReviewEventFields_(rowValues, data.headerMap, review, false);
      updateQueue.push({ rowNumber: existing.rowNumber, rowValues: rowValues });
    } else {
      var newRow = data.headers.map(function(header) { return clean_(review[header]); });
      inserts.push(newRow);
    }
  });

  batchWriteSparseRows_(data.sheet, updateQueue, data.headers.length);
  if (inserts.length) {
    var startRow = Math.max(data.sheet.getLastRow() + 1, 2);
    data.sheet.getRange(startRow, 1, inserts.length, data.headers.length).setValues(inserts);
  }

  var promoted = promoteCalendarReviewRows_(nowIso);
  return {
    ok: true,
    action: 'stageCalendarReviewRows',
    stagedCount: (events || []).filter(shouldStageCalendarReviewEvent_).length,
    updatedCount: updateQueue.length,
    insertedCount: inserts.length,
    promotedCount: promoted.promotedCount,
    promotedRows: promoted.promotedRows
  };
}

function normalizeCalendarReviewForSheet_(event, nowIso) {
  var venueName = clean_(event.venueName || event.summary);
  var location = clean_(event.location || event.address);
  return {
    reviewKey: makeCalendarGigId_(event),
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    calendarEventId: event.eventId,
    sourceCalendarName: event.sourceCalendarName || event.calendarId || event.sourceUrl,
    eventDate: event.eventDate,
    eventTime: event.eventTime,
    eventEndTime: event.eventEndTime,
    status: event.status,
    venueName: venueName,
    summary: event.summary,
    location: location,
    address: event.address || location,
    sourceUrl: event.sourceUrl,
    suggestedPlace: [venueName, location].filter(Boolean).join(', '),
    possibleMatches: '',
    isDuplicate: '',
    duplicateVenueSiteId: '',
    duplicateVenueName: '',
    reviewStatus: 'Needs Review',
    notes: '',
    promotedAt: '',
    promotedSiteId: ''
  };
}

function summarizeCalendarReviewPossibleMatches_(event, matchIndex) {
  var match = findCalendarGigVenueMatch_(event, matchIndex);
  if (!match || !match.item) return '';
  return formatCalendarReviewPossibleMatch_(match.item, match.matchType || 'match');
}

function formatCalendarReviewPossibleMatch_(item, matchType) {
  var venue = item.venue || {};
  var venueName = venue['venue name'] || item.id;
  var cityState = [venue.city, venue.state].filter(Boolean).join(', ');
  return [matchType, item.id, venueName, cityState].filter(Boolean).join(' | ');
}

function writeCalendarReviewEventFields_(rowValues, headerMap, review, overwriteFirstSeen) {
  if (overwriteFirstSeen || !getByHeader_(rowValues, headerMap, 'firstSeenAt')) {
    setByHeader_(rowValues, headerMap, 'firstSeenAt', review.firstSeenAt);
  }
  [
    'reviewKey',
    'lastSeenAt',
    'calendarEventId',
    'sourceCalendarName',
    'eventDate',
    'eventTime',
    'eventEndTime',
    'status',
    'venueName',
    'summary',
    'location',
    'address',
    'sourceUrl',
    'suggestedPlace',
    'possibleMatches'
  ].forEach(function(header) {
    setByHeader_(rowValues, headerMap, header, clean_(review[header]));
  });
  if (!getByHeader_(rowValues, headerMap, 'reviewStatus')) {
    setByHeader_(rowValues, headerMap, 'reviewStatus', review.reviewStatus);
  }
}

function promoteCalendarReviewRows_(nowIso) {
  var reviewData = ensureCalendarReviewSheet_();
  var values = reviewData.sheet.getDataRange().getValues();
  if (values.length < 2) return { promotedCount: 0, promotedRows: [] };

  var headerMap = makeHeaderMap_(values[0].map(clean_));
  var mainData = getIndexedRows_();
  var matchIndex = buildCalendarGigMatchIndex_(mainData.indexed);
  var existingIds = {};
  mainData.indexed.forEach(function(item) { existingIds[item.id] = true; });

  var reviewUpdates = [];
  var promotedRows = [];
  values.slice(1).forEach(function(row, index) {
    var rowValues = row.slice();
    while (rowValues.length < reviewData.headers.length) rowValues.push('');

    var duplicateAnswer = clean_(getByHeader_(rowValues, headerMap, 'isDuplicate')).toLowerCase();
    var alreadyPromoted = clean_(getByHeader_(rowValues, headerMap, 'promotedAt'));
    if (alreadyPromoted || (duplicateAnswer !== 'yes' && duplicateAnswer !== 'no')) return;

    var event = normalizeCalendarReviewRowToEvent_(rowValues, headerMap);
    if (!event.eventDate || !event.summary) return;

    var target = duplicateAnswer === 'yes'
      ? findCalendarReviewPromotionTarget_(rowValues, headerMap, matchIndex, event)
      : null;
    if (duplicateAnswer === 'yes' && !target) {
      setByHeader_(rowValues, headerMap, 'reviewStatus', 'Duplicate marked yes; add duplicateVenueSiteId or duplicateVenueName');
      reviewUpdates.push({ rowNumber: index + 2, rowValues: rowValues });
      return;
    }

    var result = target
      ? mergeCalendarReviewEventIntoVenueRow_(mainData, target, event, nowIso)
      : appendCalendarReviewVenueToMainSheet_(mainData, event, nowIso, existingIds);

    setByHeader_(rowValues, headerMap, 'reviewStatus', result.action === 'merged' ? 'Merged into existing venue' : 'Promoted as new venue');
    setByHeader_(rowValues, headerMap, 'promotedAt', nowIso);
    setByHeader_(rowValues, headerMap, 'promotedSiteId', result.siteId);
    reviewUpdates.push({ rowNumber: index + 2, rowValues: rowValues });
    promotedRows.push({
      reviewRowNumber: index + 2,
      action: result.action,
      venueSiteId: result.siteId,
      venueRowNumber: result.rowNumber
    });
  });

  batchWriteSparseRows_(reviewData.sheet, reviewUpdates, reviewData.headers.length);
  return {
    promotedCount: promotedRows.length,
    promotedRows: promotedRows.slice(0, 75)
  };
}

function normalizeCalendarReviewRowToEvent_(row, headerMap) {
  var summary = getByHeader_(row, headerMap, 'summary') || getByHeader_(row, headerMap, 'venueName');
  var location = getByHeader_(row, headerMap, 'location') || getByHeader_(row, headerMap, 'address');
  return {
    eventId: getByHeader_(row, headerMap, 'calendarEventId') || getByHeader_(row, headerMap, 'reviewKey'),
    calendarId: slugify_(getByHeader_(row, headerMap, 'sourceCalendarName') || getByHeader_(row, headerMap, 'sourceUrl')),
    sourceCalendarName: getByHeader_(row, headerMap, 'sourceCalendarName'),
    eventDate: getByHeader_(row, headerMap, 'eventDate'),
    eventTime: getByHeader_(row, headerMap, 'eventTime'),
    eventEndTime: getByHeader_(row, headerMap, 'eventEndTime'),
    isAllDay: false,
    summary: summary,
    venueName: getByHeader_(row, headerMap, 'venueName') || deriveCalendarVenueName_(summary, location, false),
    location: location,
    address: getByHeader_(row, headerMap, 'address') || location,
    description: getByHeader_(row, headerMap, 'notes'),
    isPrivateEvent: false,
    isPublicPlaceholder: false,
    status: getByHeader_(row, headerMap, 'status') || inferCalendarGigStatus_(summary, getByHeader_(row, headerMap, 'eventDate')),
    sourceUrl: getByHeader_(row, headerMap, 'sourceUrl')
  };
}

function findCalendarReviewPromotionTarget_(row, headerMap, matchIndex, event) {
  var explicitSiteId = getByHeader_(row, headerMap, 'duplicateVenueSiteId');
  if (explicitSiteId && matchIndex.byId && matchIndex.byId[explicitSiteId]) {
    return matchIndex.byId[explicitSiteId];
  }

  var duplicateVenueName = getByHeader_(row, headerMap, 'duplicateVenueName');
  if (duplicateVenueName) {
    var duplicateMatch = findCalendarGigVenueMatch_(Object.assign({}, event, {
      venueName: duplicateVenueName,
      summary: duplicateVenueName,
      isPrivateEvent: false,
      isPublicPlaceholder: false
    }), matchIndex);
    if (duplicateMatch) return duplicateMatch.item;
  }

  var eventMatch = findCalendarGigVenueMatch_(event, matchIndex);
  return eventMatch ? eventMatch.item : null;
}

function appendLineIfMissing_(currentText, line) {
  var current = clean_(currentText);
  var nextLine = clean_(line);
  if (!nextLine) return current;
  if (current.indexOf(nextLine) >= 0) return current;
  return current ? current + '\n' + nextLine : nextLine;
}

function mergeCalendarReviewEventIntoVenueRow_(mainData, target, event, nowIso) {
  var today = Utilities.formatDate(new Date(), JDDM_BRIDGE_CONFIG.CALENDAR_TIMEZONE, 'yyyy-MM-dd');
  var isPast = event.eventDate < today && event.status !== 'PROPOSED';
  var isFuture = event.eventDate >= today && event.status !== 'PROPOSED';
  var line = formatCalendarGigEventsForCell_([event]);
  var rowValues = target.row.slice();
  while (rowValues.length < mainData.headers.length) rowValues.push('');

  var allEventsText = getByHeader_(rowValues, mainData.headerMap, 'calendarGigEvents');
  var alreadyPresent = event.eventId && allEventsText.indexOf(event.eventId) >= 0;
  setByHeader_(rowValues, mainData.headerMap, 'calendarGigEvents', alreadyPresent ? allEventsText : appendLineIfMissing_(allEventsText, line));
  if (isPast) {
    var pastEventsText = getByHeader_(rowValues, mainData.headerMap, 'calendarPastGigEvents');
    setByHeader_(rowValues, mainData.headerMap, 'calendarPastGigEvents', alreadyPresent ? pastEventsText : appendLineIfMissing_(pastEventsText, line));
    if (!alreadyPresent) {
      var pastCount = Math.max(
        countNumber_(getByHeader_(rowValues, mainData.headerMap, 'calendarPastGigCount')),
        countNumber_(getByHeader_(rowValues, mainData.headerMap, 'calendarTotalGigsPlayed'))
      ) + 1;
      setByHeader_(rowValues, mainData.headerMap, 'calendarPastGigCount', String(pastCount));
      setByHeader_(rowValues, mainData.headerMap, 'calendarTotalGigsPlayed', String(pastCount));
    }
    setByHeader_(rowValues, mainData.headerMap, 'calendarLastGigDate', chooseLatestIsoDate_(getByHeader_(rowValues, mainData.headerMap, 'calendarLastGigDate'), event.eventDate));
    setByHeader_(rowValues, mainData.headerMap, 'Played', 'Yes');
  }
  if (isFuture) {
    var futureEventsText = getByHeader_(rowValues, mainData.headerMap, 'calendarFutureGigEvents');
    setByHeader_(rowValues, mainData.headerMap, 'calendarFutureGigEvents', alreadyPresent ? futureEventsText : appendLineIfMissing_(futureEventsText, line));
    if (!alreadyPresent) {
      var futureCount = countNumber_(getByHeader_(rowValues, mainData.headerMap, 'calendarFutureGigCount')) + 1;
      setByHeader_(rowValues, mainData.headerMap, 'calendarFutureGigCount', String(futureCount));
    }
    var currentNext = getByHeader_(rowValues, mainData.headerMap, 'calendarNextGigDate');
    if (!currentNext || event.eventDate < currentNext) {
      setByHeader_(rowValues, mainData.headerMap, 'calendarNextGigDate', event.eventDate);
      setByHeader_(rowValues, mainData.headerMap, 'upcoming event date', event.eventDate);
      setByHeader_(rowValues, mainData.headerMap, 'upcoming event time', formatCalendarGigTimeEt_(event));
    }
  }
  setByHeader_(rowValues, mainData.headerMap, 'calendarLastSyncedAt', nowIso);
  mainData.sheet.getRange(target.rowNumber, 1, 1, mainData.headers.length).setValues([rowValues]);
  return { action: 'merged', siteId: target.id, rowNumber: target.rowNumber };
}

function appendCalendarReviewVenueToMainSheet_(mainData, event, nowIso, existingIds) {
  var today = Utilities.formatDate(new Date(), JDDM_BRIDGE_CONFIG.CALENDAR_TIMEZONE, 'yyyy-MM-dd');
  var isPast = event.eventDate < today && event.status !== 'PROPOSED';
  var isFuture = event.eventDate >= today && event.status !== 'PROPOSED';
  var parsed = parsePlace_(event.location || event.address);
  var venueName = clean_(event.venueName || event.summary);
  var siteId = makeUniqueSiteId_(slugify_([venueName, parsed.city || parsed.address || event.location].filter(Boolean).join(' ')), existingIds);
  var line = formatCalendarGigEventsForCell_([event]);
  var rowValues = mainData.headers.map(function() { return ''; });

  setByHeader_(rowValues, mainData.headerMap, 'Place', [venueName, event.location].filter(Boolean).join(', '));
  setByHeader_(rowValues, mainData.headerMap, 'venue name', venueName);
  setByHeader_(rowValues, mainData.headerMap, 'address', parsed.address || event.address || event.location);
  setByHeader_(rowValues, mainData.headerMap, 'city', parsed.city);
  setByHeader_(rowValues, mainData.headerMap, 'state', parsed.state || 'OH');
  setByHeader_(rowValues, mainData.headerMap, 'zip', parsed.zip);
  setByHeader_(rowValues, mainData.headerMap, 'venue type', normalizeCategory_(venueName, false));
  setByHeader_(rowValues, mainData.headerMap, 'Site ID', siteId);
  setByHeader_(rowValues, mainData.headerMap, 'Status', isFuture ? 'Booked' : 'Calendar Review');
  setByHeader_(rowValues, mainData.headerMap, 'contactStatus', isFuture ? 'Booked' : 'Calendar Review');
  setByHeader_(rowValues, mainData.headerMap, 'Notes', 'Promoted from CalendarDuplicateReview from unmatched calendar event ' + clean_(event.eventId) + '.');
  setByHeader_(rowValues, mainData.headerMap, 'calendarGigEvents', line);
  setByHeader_(rowValues, mainData.headerMap, 'calendarPastGigEvents', isPast ? line : '');
  setByHeader_(rowValues, mainData.headerMap, 'calendarFutureGigEvents', isFuture ? line : '');
  setByHeader_(rowValues, mainData.headerMap, 'calendarLastGigDate', isPast ? event.eventDate : '');
  setByHeader_(rowValues, mainData.headerMap, 'calendarNextGigDate', isFuture ? event.eventDate : '');
  setByHeader_(rowValues, mainData.headerMap, 'calendarPastGigCount', isPast ? '1' : '');
  setByHeader_(rowValues, mainData.headerMap, 'calendarFutureGigCount', isFuture ? '1' : '');
  setByHeader_(rowValues, mainData.headerMap, 'calendarTotalGigsPlayed', isPast ? '1' : '');
  setByHeader_(rowValues, mainData.headerMap, 'calendarLastSyncedAt', nowIso);
  if (isPast) setByHeader_(rowValues, mainData.headerMap, 'Played', 'Yes');
  if (isFuture) {
    setByHeader_(rowValues, mainData.headerMap, 'upcoming event date', event.eventDate);
    setByHeader_(rowValues, mainData.headerMap, 'upcoming event time', formatCalendarGigTimeEt_(event));
  }

  var geocoded = geocodeRow_(rowValues, mainData.headerMap);
  if (geocoded) {
    setByHeader_(rowValues, mainData.headerMap, 'Longitude', geocoded.longitude);
    setByHeader_(rowValues, mainData.headerMap, 'Latitude', geocoded.latitude);
  }

  var rowNumber = Math.max(mainData.sheet.getLastRow() + 1, 2);
  mainData.sheet.getRange(rowNumber, 1, 1, mainData.headers.length).setValues([rowValues]);
  existingIds[siteId] = true;
  return { action: 'inserted', siteId: siteId, rowNumber: rowNumber };
}

function makeUniqueSiteId_(base, existingIds) {
  var root = clean_(base) || 'calendar-review-venue';
  var candidate = root;
  var suffix = 2;
  while (existingIds[candidate]) {
    candidate = root + '-' + suffix;
    suffix++;
  }
  return candidate;
}

function updateVenueRowsFromCalendarGigs_(data, groupedByVenueId, nowIso) {
  var today = Utilities.formatDate(new Date(), JDDM_BRIDGE_CONFIG.CALENDAR_TIMEZONE, 'yyyy-MM-dd');
  var updated = [];
  var rowWriteQueue = [];

  Object.keys(groupedByVenueId).forEach(function(venueId) {
    var group = groupedByVenueId[venueId];
    var events = group.events.sort(function(a, b) {
      return String(a.eventDate || '').localeCompare(String(b.eventDate || ''));
    });
    var past = events.filter(function(event) { return event.eventDate < today && event.status !== 'PROPOSED'; });
    var future = events.filter(function(event) { return event.eventDate >= today && event.status !== 'PROPOSED'; });
    var next = future[0] || null;
    var last = past[past.length - 1] || null;
    var rowValues = group.item.row.slice();
    while (rowValues.length < data.headers.length) rowValues.push('');

    var manualHistory = getManualPlayedHistory_(rowValues, data.headerMap);
    var calendarPastCount = past.length;
    var totalPlayedCount = Math.max(calendarPastCount, manualHistory.count);
    var calendarGigEventsText = formatCalendarGigEventsForCell_(events);
    var calendarPastGigEventsText = formatCalendarGigEventsForCell_(past);
    var calendarFutureGigEventsText = formatCalendarGigEventsForCell_(future);
    if (manualHistory.hasHistory && manualHistory.count > calendarPastCount) {
      calendarGigEventsText = appendCalendarHistoryNote_(calendarGigEventsText, manualHistory.note);
      calendarPastGigEventsText = appendCalendarHistoryNote_(calendarPastGigEventsText, manualHistory.note);
    }

    setByHeader_(rowValues, data.headerMap, 'calendarGigEvents', calendarGigEventsText);
    setByHeader_(rowValues, data.headerMap, 'calendarPastGigEvents', calendarPastGigEventsText);
    setByHeader_(rowValues, data.headerMap, 'calendarFutureGigEvents', calendarFutureGigEventsText);
    setByHeader_(rowValues, data.headerMap, 'calendarLastGigDate', chooseLatestIsoDate_(last ? last.eventDate : '', manualHistory.lastPlayedDate));
    setByHeader_(rowValues, data.headerMap, 'calendarNextGigDate', next ? next.eventDate : '');
    setByHeader_(rowValues, data.headerMap, 'calendarPastGigCount', totalPlayedCount > 0 ? String(totalPlayedCount) : '');
    setByHeader_(rowValues, data.headerMap, 'calendarFutureGigCount', future.length > 0 ? String(future.length) : '');
    setByHeader_(rowValues, data.headerMap, 'calendarTotalGigsPlayed', totalPlayedCount > 0 ? String(totalPlayedCount) : '');
    setByHeader_(rowValues, data.headerMap, 'calendarLastSyncedAt', nowIso);

    if (calendarPastCount > 0 || manualHistory.hasHistory) {
      setByHeader_(rowValues, data.headerMap, 'Played', 'Yes');
    }

    if (next) {
      setByHeader_(rowValues, data.headerMap, 'upcoming event date', next.eventDate);
      setByHeader_(rowValues, data.headerMap, 'upcoming event time', formatCalendarGigTimeEt_(next));
      setByHeader_(rowValues, data.headerMap, 'contactStatus', 'Booked');
      setByHeader_(rowValues, data.headerMap, 'Status', 'Booked');
    }

    rowWriteQueue.push({
      rowNumber: group.item.rowNumber,
      rowValues: rowValues
    });
    updated.push({
      venueSiteId: venueId,
      rowNumber: group.item.rowNumber,
      totalEvents: events.length,
      totalPastGigs: calendarPastCount,
      totalFutureGigs: future.length,
      totalPlayedCount: totalPlayedCount,
      lastGigDate: chooseLatestIsoDate_(last ? last.eventDate : '', manualHistory.lastPlayedDate),
      nextGigDate: next ? next.eventDate : ''
    });
  });

  batchWriteSparseRows_(data.sheet, rowWriteQueue, data.headers.length);
  return updated;
}

function getManualPlayedHistory_(row, headerMap) {
  var explicitPlayed = normalizePlayed_(getByHeader_(row, headerMap, 'Played'));
  var lastPlayedDate = getLastPlayedIsoDateFromRow_(row, headerMap);
  var existingCalendarCount = Math.max(
    countNumber_(getByHeader_(row, headerMap, 'calendarPastGigCount')),
    countNumber_(getByHeader_(row, headerMap, 'calendarTotalGigsPlayed'))
  );
  var count = existingCalendarCount;
  var hasHistory = explicitPlayed || Boolean(lastPlayedDate);

  if (hasHistory && count <= 0) count = 1;

  return {
    hasHistory: hasHistory,
    count: count,
    lastPlayedDate: lastPlayedDate,
    note: formatManualPlayedHistoryNote_(explicitPlayed, count, lastPlayedDate)
  };
}

function formatManualPlayedHistoryNote_(explicitPlayed, count, lastPlayedDate) {
  var parts = [];
  if (explicitPlayed) parts.push('Played=Yes');
  if (count > 0) parts.push('recorded count=' + count);
  if (lastPlayedDate) parts.push('last played=' + lastPlayedDate);
  if (!parts.length) return '';
  return 'Manual sheet history: ' + parts.join('; ') + '.';
}

function appendCalendarHistoryNote_(eventsText, note) {
  if (!note) return eventsText || '';
  if (!eventsText) return note;
  if (eventsText.indexOf(note) >= 0) return eventsText;
  return eventsText + '\n' + note;
}

function replaceLegacyManualHistoryNote_(eventsText, note) {
  if (!eventsText || !note) return eventsText || '';
  return eventsText.replace(/Manual sheet history:[^\n]*Calendar export currently starts[^\n]*/g, note);
}

function chooseLatestIsoDate_(left, right) {
  var leftIso = normalizeDateValueToIso_(left);
  var rightIso = normalizeDateValueToIso_(right);
  if (!leftIso) return rightIso;
  if (!rightIso) return leftIso;
  return leftIso >= rightIso ? leftIso : rightIso;
}

function updateVenuesFromCalendarGigsSheet_() {
  ensureGeneratedColumns_();
  var nowIso = new Date().toISOString();
  var data = getIndexedRows_();
  var gigData;
  var rebuiltCalendarGigs = false;

  try {
    gigData = getCalendarGigsSheetValues_();
  } catch (error) {
    importBundledCalendarGigsSheet_();
    rebuiltCalendarGigs = true;
    gigData = getCalendarGigsSheetValues_();
  }

  var matchIndex = buildCalendarGigMatchIndex_(data.indexed);
  var groupedByVenueId = {};
  var matched = [];
  var unmatched = [];
  var unmatchedReviewEvents = [];

  gigData.rows.forEach(function(row, index) {
    var event = normalizeCalendarGigSheetRow_(row, gigData.headerMap);
    if (!event.eventDate || !event.summary) return;

    var match = findCalendarGigVenueMatch_(event, matchIndex);
    if (match) {
      matched.push({
        rowNumber: index + 2,
        calendarEventId: event.eventId,
        venueSiteId: match.item.id,
        venueName: match.item.venue['venue name'],
        gigDate: event.eventDate,
        matchType: match.matchType
      });

      if (!groupedByVenueId[match.item.id]) {
        groupedByVenueId[match.item.id] = {
          item: match.item,
          events: []
        };
      }
      groupedByVenueId[match.item.id].events.push(event);
    } else {
      unmatched.push({
        rowNumber: index + 2,
        calendarEventId: event.eventId,
        summary: event.summary,
        location: event.location,
        gigDate: event.eventDate,
        reason: event.isPrivateEvent ? 'PRIVATE_OR_PLACEHOLDER_EVENT' : 'NO_CONFIDENT_VENUE_MATCH'
      });
      if (shouldStageCalendarReviewEvent_(event)) unmatchedReviewEvents.push(event);
    }
  });

  var updatedVenueRows = updateVenueRowsFromCalendarGigs_(data, groupedByVenueId, nowIso);
  var calendarReview = stageCalendarReviewRows_(unmatchedReviewEvents, nowIso);
  return {
    ok: true,
    action: 'updateVenuesFromCalendarGigsSheet',
    rebuiltCalendarGigs: rebuiltCalendarGigs,
    importedCalendarGigRows: rebuiltCalendarGigs ? gigData.rows.length : 0,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
    calendarReview: calendarReview,
    updatedVenueRowCount: updatedVenueRows.length,
    matchedRows: matched.slice(0, 75),
    unmatchedEvents: unmatched.slice(0, 75),
    updatedVenueRows: updatedVenueRows.slice(0, 75)
  };
}

function getCalendarGigsSheetValues_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(JDDM_BRIDGE_CONFIG.CALENDAR_GIG_SHEET_NAME);
  if (!sheet) {
    throw new Error('CalendarGigs sheet was not found. Import or paste data/staged/jddm-calendar-gigs.csv into a sheet named CalendarGigs first.');
  }
  var values = sheet.getDataRange().getValues();
  if (!values.length) {
    throw new Error('CalendarGigs sheet has no header row.');
  }

  if (values[0].length === 1 && clean_(values[0][0]).indexOf(',') !== -1) {
    values = parseCalendarGigsSingleColumnCsvPaste_(values);
  }

  var headers = values[0].map(clean_);
  var headerMap = makeHeaderMap_(headers);
  if (!hasHeader_(headerMap, 'eventDate') && !hasHeader_(headerMap, 'gigDate') && !hasHeader_(headerMap, 'date')) {
    throw new Error('CalendarGigs headers were not recognized. Make sure row 1 includes eventDate, summary, and venueName, or paste the CSV starting in cell A1.');
  }

  return {
    sheet: sheet,
    headers: headers,
    headerMap: headerMap,
    rows: values.slice(1)
  };
}

function parseCalendarGigsSingleColumnCsvPaste_(values) {
  var parsed = [];

  values.forEach(function(row) {
    var line = clean_(row[0]);
    if (!line) return;
    parsed.push(parseCalendarGigsCsvLine_(line));
  });

  return parsed;
}

function parseCalendarGigsCsvLine_(line) {
  var cells = [];
  var current = '';
  var inQuotes = false;

  for (var index = 0; index < line.length; index += 1) {
    var character = line.charAt(index);
    var nextCharacter = line.charAt(index + 1);

    if (character === '"' && inQuotes && nextCharacter === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += character;
  }

  cells.push(current);
  return cells;
}

function importBundledCalendarGigsSheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(JDDM_BRIDGE_CONFIG.CALENDAR_GIG_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(JDDM_BRIDGE_CONFIG.CALENDAR_GIG_SHEET_NAME);
  }

  var csvText = getBundledCalendarGigsCsvText_();
  var rows = parseCalendarGigsCsvText_(csvText);
  if (rows.length < 2) {
    throw new Error('Bundled CalendarGigs data did not decode into rows.');
  }

  var width = rows.reduce(function(max, row) {
    return Math.max(max, row.length);
  }, 0);
  var paddedRows = rows.map(function(row) {
    var padded = row.slice();
    while (padded.length < width) padded.push('');
    return padded;
  });

  sheet.clear();
  sheet.getRange(1, 1, paddedRows.length, width).setValues(paddedRows);
  sheet.setFrozenRows(1);

  return {
    ok: true,
    action: 'importBundledCalendarGigsSheet',
    rowCount: Math.max(paddedRows.length - 1, 0),
    columnCount: width
  };
}

function importBundledCalendarGigsAndUpdateVenues_() {
  var importResult = importBundledCalendarGigsSheet_();
  var updateResult = updateVenuesFromCalendarGigsSheet_();
  var manualResult = syncManualPlayedHistory_({ limit: 5000 });
  updateResult.action = 'importBundledCalendarGigsAndUpdateVenues';
  updateResult.importedCalendarGigRows = importResult.rowCount;
  updateResult.calendarGigColumnCount = importResult.columnCount;
  updateResult.manualHistoryRowsUpdated = manualResult.updatedCount;
  return updateResult;
}

function getBundledCalendarGigsCsvText_() {
  var encoded = BUNDLED_CALENDAR_GIGS_CSV_GZIP_BASE64_PARTS.join('');
  var blob = Utilities.newBlob(Utilities.base64Decode(encoded), 'application/gzip', 'jddm-calendar-gigs.csv.gz');
  return Utilities.ungzip(blob).getDataAsString('UTF-8');
}

function parseCalendarGigsCsvText_(text) {
  var rows = [];
  var row = [];
  var cell = '';
  var inQuotes = false;

  for (var index = 0; index < text.length; index += 1) {
    var character = text.charAt(index);
    var nextCharacter = text.charAt(index + 1);

    if (character === '"' && inQuotes && nextCharacter === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && nextCharacter === '\n') index += 1;
      row.push(cell);
      if (row.some(function(value) { return clean_(value); })) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += character;
  }

  row.push(cell);
  if (row.some(function(value) { return clean_(value); })) rows.push(row);
  return rows;
}

function normalizeCalendarGigSheetRow_(row, headerMap) {
  var summary = getByHeader_(row, headerMap, 'summary') || getByHeader_(row, headerMap, 'title');
  var location = getByHeader_(row, headerMap, 'location') || getByHeader_(row, headerMap, 'address');
  var privateText = getByHeader_(row, headerMap, 'isPrivateEvent') || getByHeader_(row, headerMap, 'private event');
  var isPrivateEvent = normalizeBoolean_(privateText) === 'TRUE' || isPrivateCalendarEvent_(summary);
  var eventDate = getByHeader_(row, headerMap, 'eventDate') || getByHeader_(row, headerMap, 'gigDate') || getByHeader_(row, headerMap, 'date');
  var status = getByHeader_(row, headerMap, 'status') || inferCalendarGigStatus_(summary, eventDate);
  var venueName = getByHeader_(row, headerMap, 'venueName') || deriveCalendarVenueName_(summary, location, isPrivateEvent);

  return {
    eventId: getByHeader_(row, headerMap, 'calendarEventId') || getByHeader_(row, headerMap, 'eventId') || getByHeader_(row, headerMap, 'gigId'),
    calendarId: slugify_(getByHeader_(row, headerMap, 'sourceCalendarName') || getByHeader_(row, headerMap, 'calendarId')),
    sourceCalendarName: getByHeader_(row, headerMap, 'sourceCalendarName'),
    eventDate: eventDate,
    eventTime: getByHeader_(row, headerMap, 'eventTime') || getByHeader_(row, headerMap, 'startTime'),
    eventEndTime: getByHeader_(row, headerMap, 'eventEndTime') || getByHeader_(row, headerMap, 'endTime'),
    isAllDay: normalizeBoolean_(getByHeader_(row, headerMap, 'isAllDay')) === 'TRUE',
    summary: summary,
    venueName: venueName,
    location: location,
    address: getByHeader_(row, headerMap, 'address') || location,
    description: getByHeader_(row, headerMap, 'description'),
    isPrivateEvent: isPrivateEvent,
    isPublicPlaceholder: isCalendarPlaceholderEvent_(summary),
    status: status,
    sourceUrl: getByHeader_(row, headerMap, 'sourceUrl')
  };
}

function batchWriteSparseRows_(sheet, rowWriteQueue, width) {
  if (!rowWriteQueue.length) return;
  rowWriteQueue.sort(function(a, b) {
    return a.rowNumber - b.rowNumber;
  });

  var chunk = [];
  var chunkStart = 0;
  var previousRow = 0;

  rowWriteQueue.forEach(function(item) {
    if (!chunk.length) {
      chunk = [item.rowValues];
      chunkStart = item.rowNumber;
      previousRow = item.rowNumber;
      return;
    }

    if (item.rowNumber === previousRow + 1) {
      chunk.push(item.rowValues);
      previousRow = item.rowNumber;
      return;
    }

    sheet.getRange(chunkStart, 1, chunk.length, width).setValues(chunk);
    chunk = [item.rowValues];
    chunkStart = item.rowNumber;
    previousRow = item.rowNumber;
  });

  if (chunk.length) {
    sheet.getRange(chunkStart, 1, chunk.length, width).setValues(chunk);
  }
}

function formatCalendarGigEventsForCell_(events) {
  return events.map(function(event) {
    return [
      formatCalendarGigDateTimeEt_(event),
      event.status,
      event.summary,
      event.location,
      event.eventId
    ].filter(Boolean).join(' | ');
  }).join('\n');
}

function formatCalendarGigDateTimeEt_(event) {
  return [event.eventDate, formatCalendarGigTimeEt_(event)].filter(Boolean).join(' ');
}

function formatCalendarGigTimeEt_(event) {
  return event && event.eventTime ? event.eventTime + ' ET' : '';
}

function buildWebsiteBookingMatchIndex_(indexedRows) {
  var index = {
    byId: {},
    byVenueCity: {},
    byAddressCity: {},
    byVenueName: {}
  };

  indexedRows.forEach(function(item) {
    var venue = item.venue || {};
    var venueName = venue['venue name'];
    var city = venue.city;
    var address = venue.address;

    index.byId[item.id] = item;
    addWebsiteBookingMatchCandidate_(index.byVenueCity, websiteBookingMatchKey_(venueName, city), item);
    addWebsiteBookingMatchCandidate_(index.byAddressCity, websiteBookingMatchKey_(address, city), item);
    addWebsiteBookingMatchCandidate_(index.byVenueName, websiteBookingTextKey_(venueName), item);
  });

  return index;
}

function addWebsiteBookingMatchCandidate_(bucket, key, item) {
  if (!key) return;
  if (!bucket[key]) bucket[key] = [];
  bucket[key].push(item);
}

function findWebsiteBookingVenueMatch_(event, matchIndex) {
  var siteId = clean_(event && (event.siteId || event.venueId || event.id));
  if (siteId && matchIndex.byId[siteId]) {
    return { item: matchIndex.byId[siteId], matchType: 'id' };
  }

  if (isPlaceholderWebsiteBookingEvent_(event)) return null;

  var venueName = clean_(event && event.venueName);
  var city = clean_(event && event.city);
  var address = clean_(event && event.address);
  var candidates = [
    ['venue-city', matchIndex.byVenueCity[websiteBookingMatchKey_(venueName, city)]],
    ['address-city', matchIndex.byAddressCity[websiteBookingMatchKey_(address, city)]],
    ['venue-name', matchIndex.byVenueName[websiteBookingTextKey_(venueName)]]
  ];

  for (var index = 0; index < candidates.length; index++) {
    var matchType = candidates[index][0];
    var rows = candidates[index][1] || [];
    if (rows.length === 1) {
      return { item: rows[0], matchType: matchType };
    }
  }

  return null;
}

function isPlaceholderWebsiteBookingEvent_(event) {
  var venueName = clean_(event && event.venueName).toLowerCase();
  return Boolean(
    event && (event.isPrivateEvent || event.isPublicPlaceholder) ||
    venueName === 'private event' ||
    venueName === 'scheduled public event'
  );
}

function normalizeWebsiteBookingEventForSheet_(event) {
  return {
    eventId: clean_(event && event.eventId),
    eventDate: clean_(event && event.eventDate),
    eventDay: clean_(event && event.eventDay),
    eventTime: clean_(event && event.eventTime),
    eventEndTime: clean_(event && event.eventEndTime),
    title: clean_(event && event.title),
    venueName: clean_(event && event.venueName),
    venueType: clean_(event && event.venueType),
    location: clean_(event && event.location),
    address: clean_(event && event.address),
    city: clean_(event && event.city),
    state: clean_(event && event.state),
    zip: clean_(event && event.zip),
    isPrivateEvent: Boolean(event && event.isPrivateEvent),
    isPublicPlaceholder: Boolean(event && event.isPublicPlaceholder),
    sourceUrl: clean_(event && event.sourceUrl),
    sourceCapturedAt: clean_(event && event.sourceCapturedAt),
    notes: clean_(event && event.notes)
  };
}

function formatWebsiteBookingEventsForCell_(events, format) {
  var deduped = dedupeWebsiteBookingEventsForSheet_(events);
  if (format === 'json') return JSON.stringify(deduped);

  return deduped.map(function(event) {
    var timeRange = [event.eventTime, event.eventEndTime].filter(Boolean).join('-');
    return [
      event.eventDate,
      timeRange,
      event.title || event.venueName,
      event.location,
      event.sourceUrl
    ].filter(Boolean).join(' | ');
  }).join('\n');
}

function parseWebsiteBookingEventsCell_(value) {
  var text = clean_(value);
  if (!text) return [];

  if (text.charAt(0) === '[') {
    try {
      var parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeWebsiteBookingEventForSheet_);
      }
    } catch (error) {
      return [];
    }
  }

  return text.split(/\n+/).map(function(line) {
    var parts = line.split('|').map(clean_);
    return normalizeWebsiteBookingEventForSheet_({
      eventDate: parts[0],
      eventTime: parts[1],
      title: parts[2],
      location: parts[3],
      sourceUrl: parts[4]
    });
  }).filter(function(event) {
    return event.eventDate || event.title || event.location;
  });
}

function dedupeWebsiteBookingEventsForSheet_(events) {
  var seen = {};
  var deduped = [];

  events.forEach(function(event) {
    var normalized = normalizeWebsiteBookingEventForSheet_(event);
    var key = [
      normalized.eventDate,
      normalized.eventTime,
      websiteBookingTextKey_(normalized.venueName || normalized.title),
      websiteBookingTextKey_(normalized.location)
    ].join('|');

    if (seen[key]) return;
    seen[key] = true;
    deduped.push(normalized);
  });

  return deduped;
}

function websiteBookingMatchKey_(primary, secondary) {
  var first = websiteBookingTextKey_(primary);
  var second = websiteBookingTextKey_(secondary);
  return first && second ? first + '|' + second : '';
}

function websiteBookingTextKey_(value) {
  return clean_(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(the|and|llc|inc)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildNormalizedCsv_() {
  var data = getIndexedRows_();
  var rows = [OUTPUT_COLUMNS];

  data.indexed.forEach(function(item) {
    rows.push(OUTPUT_COLUMNS.map(function(column) {
      return item.venue[column];
    }));
  });

  return rows.map(function(row) {
    return row.map(csvEscape_).join(',');
  }).join('\n') + '\n';
}

function csvEscape_(value) {
  var text = String(value === undefined || value === null ? '' : value);
  if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function handleJddmEditTrigger(e) {
  try {
    if (!e || !e.range) return;
    var range = e.range;
    if (range.getRow() < 2) return;
    syncGeneratedColumns_({
      startRow: range.getRow(),
      rowCount: range.getNumRows(),
      limit: Math.min(Math.max(range.getNumRows(), 1), 25),
      geocodeMissing: true
    });
  } catch (error) {
    console.error('JDDM auto-fill failed: ' + (error && error.message ? error.message : error));
  }
}

function onEdit(e) {
  handleJddmEditTrigger(e);
}

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('JDDM Map')
      .addItem('Set up map columns + auto-fill', 'setupJddmMapBridge')
      .addItem('Fill generated map columns', 'menuSyncGeneratedColumns')
      .addSeparator()
      .addItem('Sync Google Calendar gigs now', 'menuSyncCalendarGigEvents')
      .addItem('Auto-mark Played from last gig dates', 'menuSyncPlayedFromLastGigDates')
      .addItem('Blend manual played history', 'menuSyncManualPlayedHistory')
      .addItem('Process Calendar duplicate review', 'menuProcessCalendarDuplicateReview')
      .addItem('Install 5-minute Calendar -> map sync', 'installJddmCalendarSyncTrigger')
      .addSeparator()
      .addItem('Import bundled CalendarGigs + update venues', 'menuImportBundledCalendarGigsAndUpdateVenues')
      .addItem('Update venues from CalendarGigs sheet', 'menuUpdateVenuesFromCalendarGigsSheet')
      .addItem('Install auto-fill trigger', 'installJddmAutoFillTrigger')
      .addToUi();
  } catch (error) {
    console.log('JDDM menu unavailable in this Apps Script context.');
  }
}

function menuSyncGeneratedColumns() {
  var result = syncGeneratedColumns_({ limit: 200, geocodeMissing: true });
  notifyUser_(
    'JDDM Map columns updated: changed rows=' + result.changedCount +
    ', geocoded rows=' + result.geocodedCount +
    ', skipped rows=' + result.skippedCount
  );
}

function menuSyncCalendarGigEvents() {
  var result = runJddmCalendarSyncTrigger_();
  if (result.skipped) {
    notifyUser_('JDDM calendar sync skipped because the previous sync is still running.');
    return;
  }
  var sync = result.sync || {};
  var played = result.played || {};
  var manual = result.manual || {};
  var review = sync.calendarReview || {};
  notifyUser_(
    'JDDM calendar sync complete. Calendar gigs=' + (sync.updatedGigRowCount || 0) +
    ', venue rows updated=' + (sync.updatedVenueRowCount || 0) +
    ', Played rows updated=' + (played.updatedCount || 0) +
    ', manual history rows=' + (manual.updatedCount || 0) +
    ', review staged=' + (review.stagedCount || 0) +
    ', review promoted=' + (review.promotedCount || 0) +
    ', unmatched/private=' + (sync.unmatchedCount || 0)
  );
}

function menuSyncCalendarGigEventsQuickTest() {
  var result = syncCalendarGigEvents_({
    dryRun: false,
    timeMin: '2025-01-01',
    timeMax: '2026-12-31',
    limit: 250,
    updateVenueRows: true
  });
  notifyUser_(
    'JDDM quick calendar sync complete. Calendar gigs=' + result.updatedGigRowCount +
    ', venue rows updated=' + result.updatedVenueRowCount +
    ', unmatched/private=' + result.unmatchedCount +
    '. If this worked, run the full Sync Google Calendar gigs next.'
  );
}

function menuSyncCalendarGigEvents2024To2026() {
  var result = syncCalendarGigEvents_({
    dryRun: false,
    timeMin: '2024-01-01',
    timeMax: '2026-12-31',
    limit: 1000,
    updateVenueRows: true
  });
  notifyUser_(
    'JDDM 2024-2026 calendar sync complete. Calendar gigs=' + result.updatedGigRowCount +
    ', venue rows updated=' + result.updatedVenueRowCount +
    ', unmatched/private=' + result.unmatchedCount
  );
}

function menuSyncCalendarGigEvents2024() {
  var result = syncCalendarGigEvents_({
    dryRun: false,
    timeMin: '2024-01-01',
    timeMax: '2024-12-31',
    limit: 500,
    updateVenueRows: true
  });
  notifyUser_(
    'JDDM 2024 calendar sync complete. Calendar gigs=' + result.updatedGigRowCount +
    ', venue rows updated=' + result.updatedVenueRowCount +
    ', unmatched/private=' + result.unmatchedCount
  );
}

function menuSyncCalendarGigEvents2025() {
  var result = syncCalendarGigEvents_({
    dryRun: false,
    timeMin: '2025-01-01',
    timeMax: '2025-12-31',
    limit: 500,
    updateVenueRows: true
  });
  notifyUser_(
    'JDDM 2025 calendar sync complete. Calendar gigs=' + result.updatedGigRowCount +
    ', venue rows updated=' + result.updatedVenueRowCount +
    ', unmatched/private=' + result.unmatchedCount
  );
}

function menuSyncCalendarGigEvents2026() {
  var result = syncCalendarGigEvents_({
    dryRun: false,
    timeMin: '2026-01-01',
    timeMax: '2026-12-31',
    limit: 500,
    updateVenueRows: true
  });
  notifyUser_(
    'JDDM 2026 calendar sync complete. Calendar gigs=' + result.updatedGigRowCount +
    ', venue rows updated=' + result.updatedVenueRowCount +
    ', unmatched/private=' + result.unmatchedCount
  );
}

function menuSyncCalendarGigEvents2027To2030() {
  var result = syncCalendarGigEvents_({
    dryRun: false,
    timeMin: '2027-01-01',
    timeMax: '2030-12-31',
    limit: 1000,
    updateVenueRows: true
  });
  notifyUser_(
    'JDDM 2027-2030 calendar sync complete. Calendar gigs=' + result.updatedGigRowCount +
    ', venue rows updated=' + result.updatedVenueRowCount +
    ', unmatched/private=' + result.unmatchedCount
  );
}

function menuSyncCalendarGigEventsTinyTest() {
  var result = syncCalendarGigEvents_({
    dryRun: false,
    timeMin: '2025-01-01',
    timeMax: '2025-12-31',
    limit: 25,
    updateVenueRows: false
  });
  notifyUser_(
    'JDDM tiny calendar sync complete. Calendar gigs=' + result.updatedGigRowCount +
    ', venue rows updated=' + result.updatedVenueRowCount +
    ', fetched sources=' + result.fetchedSources.length +
    '. This test skips venue-row updates.'
  );
}

function menuImportBundledCalendarGigsAndUpdateVenues() {
  var result = importBundledCalendarGigsAndUpdateVenues_();
  notifyUser_(
    'JDDM bundled CalendarGigs imported. Calendar gigs=' + result.importedCalendarGigRows +
    ', venue rows updated=' + result.updatedVenueRowCount +
    ', matched gigs=' + result.matchedCount +
    ', unmatched/private=' + result.unmatchedCount
  );
}

function menuUpdateVenuesFromCalendarGigsSheet() {
  var result = updateVenuesFromCalendarGigsSheet_();
  notifyUser_(
    'JDDM venue summaries updated from CalendarGigs. Venue rows updated=' + result.updatedVenueRowCount +
    ', matched gigs=' + result.matchedCount +
    ', unmatched/private=' + result.unmatchedCount
  );
}

function menuProcessCalendarDuplicateReview() {
  var result = stageCalendarReviewRows_([], new Date().toISOString());
  notifyUser_(
    'JDDM CalendarDuplicateReview processed. Rows promoted=' + result.promotedCount +
    '. Mark column Q isDuplicate = Yes to merge with an existing venue, or No to add as a new venue.'
  );
}

function menuSyncPlayedFromLastGigDates() {
  var result = syncPlayedFromLastGigDates_({ limit: 5000 });
  notifyUser_('JDDM Played column updated from last-played dates. Rows updated=' + result.updatedCount + '.');
}

function menuSyncManualPlayedHistory() {
  var result = syncManualPlayedHistory_({ limit: 5000 });
  notifyUser_('JDDM manual played history blended into generated fields. Rows updated=' + result.updatedCount + '.');
}

function installJddmAutoFillTrigger() {
  var result = setupJddmMapBridge();
  notifyUser_(
    'JDDM auto-fill trigger installed. Headers changed: ' + result.schema.changedHeaders.join(', ') +
    '. Initial changed rows: ' + result.sync.changedCount +
    '. New/edited rows will fill Longitude, Latitude, and Site ID.'
  );
}

function installJddmCalendarSyncTrigger() {
  var result = setupJddmCalendarAutomation_();
  var sync = result.firstRun && result.firstRun.sync ? result.firstRun.sync : {};
  var played = result.firstRun && result.firstRun.played ? result.firstRun.played : {};
  var manual = result.firstRun && result.firstRun.manual ? result.firstRun.manual : {};
  notifyUser_(
    'JDDM 5-minute calendar automation installed. First run: Calendar gigs=' + (sync.updatedGigRowCount || 0) +
    ', venue rows=' + (sync.updatedVenueRowCount || 0) +
    ', Played rows=' + (played.updatedCount || 0) +
    ', manual history rows=' + (manual.updatedCount || 0) +
    ', unmatched/private=' + (sync.unmatchedCount || 0) +
    '.'
  );
}

function setupJddmMapBridge() {
  var schema = ensureGeneratedColumns_();
  installJddmAutoFillTrigger_();
  var sync = syncGeneratedColumns_({ limit: 25, geocodeMissing: true });
  return {
    ok: true,
    schema: schema,
    sync: sync
  };
}

function installJddmAutoFillTrigger_() {
  var spreadsheet = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction && trigger.getHandlerFunction() === 'handleJddmEditTrigger') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('handleJddmEditTrigger')
    .forSpreadsheet(spreadsheet)
    .onEdit()
    .create();
}

function installJddmCalendarSyncTrigger_() {
  var handler = 'runJddmCalendarSyncTrigger';
  var deleted = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    var triggerHandler = trigger.getHandlerFunction && trigger.getHandlerFunction();
    if (triggerHandler === handler || triggerHandler === 'menuSyncCalendarGigEvents') {
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    }
  });
  var trigger = ScriptApp.newTrigger(handler)
    .timeBased()
    .everyMinutes(5)
    .create();
  return {
    ok: true,
    action: 'installJddmCalendarSyncTrigger',
    handler: handler,
    cadence: 'every 5 minutes',
    deletedTriggerCount: deleted,
    triggerUniqueId: trigger && trigger.getUniqueId ? trigger.getUniqueId() : ''
  };
}

function notifyUser_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    console.log(message);
  }
}
