/**
 * Just Dee Dee Music Sheet Bridge
 *
 * Lean contract:
 * - The spreadsheet is the app storage layer.
 * - Status is the only row-highlight authority.
 * - Calendar sync writes gig facts into the right-side computer section.
 * - Purge/setup is explicit. Health/csv never delete columns.
 */

var JDDM_SCHEMA_VERSION = '2026-05-08-simplified-crm-statuses';
var EDIT_TOKEN = '';
var JDDM_TIMEZONE = 'America/New_York';
var JDDM_CALENDAR_IDS = [
  'justdeedeemusic@gmail.com',
  '051b2fd8ffc9844eed9867801c9a348f546e282a484f7a33f47543273162a7ba@group.calendar.google.com'
];
var JDDM_SHEET_NAME_HINTS = ['Sheet1', 'JustDeeDeeMusic Master Venue Spreadsheet', 'Master Venue', 'Venues'];
var JDDM_ARCHIVE_PREFIX = 'JDDM Archive ';

var JDDM_CRM_STATUS_OPTIONS = [
  'Not Set',
  'Needs Review',
  'Not Contacted Yet',
  'Draft Ready',
  'Contacted - Waiting on Reply',
  'Follow Up Needed',
  'Responded - Needs Action',
  'Told No / Closed / No Music',
  'Booked',
  'Played in the Past',
  'Played in the Past - Awaiting Reply',
  'Open Microphone'
];

var JDDM_STORAGE_COLUMNS = [
  'Place Name',
  'Address',
  'City',
  'Zip',
  'State',
  'Place ID',
  'Longitude',
  'Latitude',
  'Status',
  'Last Contacted',
  'Contact Name',
  'Email/Contact',
  'Phone Number',
  'Booking Contact',
  'Contact Type',
  'Priority',
  'Next Follow Up',
  'Past Gigs',
  'Future Gigs',
  'Last Played',
  'Next Booked',
  'Past Gig Count',
  'Future Gig Count',
  'Total Gig Count',
  'Last Synced',
  'Venue Type',
  'Website',
  'Notes'
];

var JDDM_COLUMN_SPECS = [
  { header: 'Place Name', width: 220 },
  { header: 'Address', width: 260 },
  { header: 'City', width: 150 },
  { header: 'Zip', width: 90 },
  { header: 'State', width: 70 },
  { header: 'Place ID', width: 180 },
  { header: 'Longitude', width: 110 },
  { header: 'Latitude', width: 110 },
  { header: 'Status', width: 200, validation: JDDM_CRM_STATUS_OPTIONS },
  { header: 'Last Contacted', width: 130, numberFormat: 'yyyy-mm-dd' },
  { header: 'Contact Name', width: 170 },
  { header: 'Email/Contact', width: 220 },
  { header: 'Phone Number', width: 130 },
  { header: 'Booking Contact', width: 220 },
  { header: 'Contact Type', width: 150 },
  { header: 'Priority', width: 110 },
  { header: 'Next Follow Up', width: 130, numberFormat: 'yyyy-mm-dd' },
  { header: 'Past Gigs', width: 280 },
  { header: 'Future Gigs', width: 280 },
  { header: 'Last Played', width: 130, numberFormat: 'yyyy-mm-dd' },
  { header: 'Next Booked', width: 130, numberFormat: 'yyyy-mm-dd' },
  { header: 'Past Gig Count', width: 105 },
  { header: 'Future Gig Count', width: 115 },
  { header: 'Total Gig Count', width: 115 },
  { header: 'Last Synced', width: 180 },
  { header: 'Venue Type', width: 160 },
  { header: 'Website', width: 220 },
  { header: 'Notes', width: 320 }
];

var JDDM_CANONICAL_HEADERS = JDDM_COLUMN_SPECS.map(function(column) { return column.header; });

var JDDM_ROW_HIGHLIGHT_COLORS = {
  NONE: '#ffffff',
  BOOKED: '#38761d',
  PLAYED: '#d9ead3',
  OPEN_MIC: '#fff2cc',
  CLOSED: '#cc0000',
  FONT_DARK: '#000000',
  FONT_LIGHT: '#ffffff'
};

var HEADER_ALIASES = {
  'Place Name': ['Place Name', 'Venue Name', 'venue name', 'name', 'Location'],
  'Address': ['Address', 'address', 'street address', 'Venue Address'],
  'City': ['City', 'city', 'town'],
  'Zip': ['Zip', 'zip', 'zip code', 'postal code'],
  'State': ['State', 'state'],
  'Place ID': ['Place ID', 'Site ID', 'site id', 'id', 'venue id', 'Map Site ID'],
  'Longitude': ['Longitude', 'longitude', 'lng', 'lon', 'Map Longitude'],
  'Latitude': ['Latitude', 'latitude', 'lat', 'Map Latitude'],
  'Status': ['CRM Status', 'crm status', 'contactStatus', 'contact status', 'Status'],
  'Last Contacted': ['Last Contacted', 'CRM Last Contacted', 'lastContactedDate', 'last contacted date', 'Contacted'],
  'Contact Name': ['Contact Name', 'contactName', 'contact name', 'CRM Contact Name'],
  'Email/Contact': ['Email/Contact', 'Email', 'email', 'contactEmail', 'CRM Email/Contact'],
  'Phone Number': ['Phone Number', 'Phone', 'phone', 'contactPhone', 'CRM Phone'],
  'Booking Contact': ['Booking Contact', 'booking/contact info', 'booking contact', 'contact'],
  'Contact Type': ['Contact Type', 'CRM Contact Type'],
  'Priority': ['Priority', 'CRM Priority', 'priority', 'Rank'],
  'Next Follow Up': ['Next Follow Up', 'CRM Next Follow Up', 'nextFollowUpDate', 'next follow up date', 'next follow-up date'],
  'Past Gigs': ['Past Gigs', 'Gig Past Dates', 'calendarPastGigEvents', 'past gig events'],
  'Future Gigs': ['Future Gigs', 'Gig Future Dates', 'calendarFutureGigEvents', 'future gig events'],
  'Last Played': ['Last Played', 'Gig Last Played', 'calendarLastGigDate', 'lastGigDate', 'last gig date'],
  'Next Booked': ['Next Booked', 'Gig Next Booked', 'calendarNextGigDate', 'nextGigDate', 'next gig date'],
  'Past Gig Count': ['Past Gig Count', 'Gig Past Count', 'calendarPastGigCount', 'pastGigs', 'past gigs'],
  'Future Gig Count': ['Future Gig Count', 'Gig Future Count', 'calendarFutureGigCount', 'futureGigs', 'future gigs'],
  'Total Gig Count': ['Total Gig Count', 'calendarTotalGigsPlayed', 'totalGigsPlayed', 'total gigs played'],
  'Last Synced': ['Last Synced', 'CRM Last Synced', 'calendarLastSyncedAt'],
  'Venue Type': ['Venue Type', 'venue type', 'category', 'type', 'Type', 'CRM Venue Type'],
  'Website': ['Website', 'website', 'website/social link', 'social link', 'link', 'CRM Website'],
  'Notes': ['Notes', 'notes', 'Useful/Important/Other Info', 'description', 'CRM Notes']
};

function doGet(e) {
  return routeRequest_(Object.assign({}, e && e.parameter ? e.parameter : {}));
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
    requireToken_(payload || {});
    var action = String((payload && payload.action) || 'csv');
    if (action === 'health') return jsonOutput_(getHealth_());
    if (action === 'schema') return jsonOutput_(getSchema_());
    if (action === 'csv') return csvOutput_(buildCsv_());
    if (action === 'syncArtistSourceAudit') return jsonOutput_(syncArtistSourceAudit_(payload));
    if (action === 'setupComputerSection' || action === 'syncComputerSection') return jsonOutput_(setupComputerSection_(payload));
    if (action === 'purgeAndSetup' || action === 'purgeSheet') return jsonOutput_(purgeAndSetup_(payload));
    if (action === 'migrateCrmStatuses' || action === 'simplifyCrmStatuses') return jsonOutput_(migrateCrmStatuses_(payload));
    if (action === 'restoreFromCsv' || action === 'restoreCsv') return jsonOutput_(restoreFromCsv_(payload));
    if (action === 'applyRowHighlighting') return jsonOutput_(applyRowHighlighting_(payload));
    if (action === 'recalculateGigCounts' || action === 'fixGigCounts') return jsonOutput_(recalculateGigCounts_(payload));
    if (action === 'cleanupCalendarOnlyRows' || action === 'removeCalendarOnlyRows') return jsonOutput_(cleanupCalendarOnlyRows_(payload));
    if (action === 'getVenue') return jsonOutput_(getVenue_(payload));
    if (action === 'saveVenue') return jsonOutput_(saveVenue_(payload));
    if (action === 'setPlayed') return jsonOutput_(setPlayed_(payload));
    if (action === 'syncCalendarGigEvents' || action === 'runCalendarAutomation') return jsonOutput_(syncCalendarGigEvents_(payload));
    if (action === 'installCalendarAutomation' || action === 'setupCalendarAutomation') return jsonOutput_(installCalendarAutomation_());
    return jsonOutput_({ ok: false, code: 'UNKNOWN_ACTION', message: 'Unknown action: ' + action });
  } catch (error) {
    return jsonOutput_({
      ok: false,
      code: error && error.code ? error.code : 'BRIDGE_ERROR',
      message: error && error.message ? error.message : String(error)
    });
  }
}

function requireToken_(payload) {
  if (!EDIT_TOKEN) return;
  if (String(payload.token || '') !== EDIT_TOKEN) {
    var error = new Error('Spreadsheet edit token is missing or invalid.');
    error.code = 'BAD_TOKEN';
    throw error;
  }
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function csvOutput_(value) {
  return ContentService.createTextOutput(value).setMimeType(ContentService.MimeType.CSV);
}

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_() {
  var ss = getSpreadsheet_();
  var sheets = ss.getSheets();
  for (var i = 0; i < JDDM_SHEET_NAME_HINTS.length; i++) {
    var sheet = ss.getSheetByName(JDDM_SHEET_NAME_HINTS[i]);
    if (sheet) return sheet;
  }
  for (var j = 0; j < sheets.length; j++) {
    var name = sheets[j].getName();
    if (name.indexOf(JDDM_ARCHIVE_PREFIX) !== 0 && name !== 'CalendarGigs' && name !== 'CalendarDuplicateReview') return sheets[j];
  }
  return sheets[0];
}

function clean_(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function normalizeKey_(value) {
  return clean_(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function makeHeaderMap_(headers) {
  var map = {};
  var rawMap = {};
  var canonicalMap = {};
  var canonicalRanks = {};
  (headers || []).forEach(function(header, index) {
    var key = normalizeKey_(header);
    if (key && rawMap[key] === undefined) rawMap[key] = index;
    var canonical = canonicalHeader_(header);
    var canonicalKey = normalizeKey_(canonical);
    var rank = headerAliasRank_(canonical, header);
    if (canonicalKey && (canonicalMap[canonicalKey] === undefined || rank < canonicalRanks[canonicalKey])) {
      canonicalMap[canonicalKey] = index;
      canonicalRanks[canonicalKey] = rank;
    }
  });
  Object.keys(rawMap).forEach(function(key) { map[key] = rawMap[key]; });
  Object.keys(canonicalMap).forEach(function(key) { map[key] = canonicalMap[key]; });
  map.__raw = rawMap;
  map.__canonical = canonicalMap;
  return map;
}

function headerAliasRank_(canonical, header) {
  var key = normalizeKey_(header);
  var aliases = HEADER_ALIASES[canonical] || [canonical];
  for (var i = 0; i < aliases.length; i++) {
    if (normalizeKey_(aliases[i]) === key) return i;
  }
  return normalizeKey_(canonical) === key ? aliases.length : aliases.length + 1;
}

function canonicalHeader_(header) {
  var key = normalizeKey_(header);
  for (var canonical in HEADER_ALIASES) {
    if (normalizeKey_(canonical) === key) return canonical;
    var aliases = HEADER_ALIASES[canonical] || [];
    for (var i = 0; i < aliases.length; i++) {
      if (normalizeKey_(aliases[i]) === key) return canonical;
    }
  }
  return header;
}

function readHeaders_(sheet) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(clean_);
}

function getData_() {
  var sheet = getSheet_();
  var lastRow = Math.max(sheet.getLastRow(), 1);
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  var headers = (values[0] || []).map(clean_);
  return {
    sheet: sheet,
    headers: headers,
    headerMap: makeHeaderMap_(headers),
    rows: values.slice(1)
  };
}

function getByHeader_(row, headerMap, header) {
  var canonicalMap = headerMap.__canonical || headerMap;
  var index = canonicalMap[normalizeKey_(canonicalHeader_(header))];
  if (index === undefined) return '';
  return clean_(row[index]);
}

function getRawByHeader_(row, headerMap, header) {
  var canonicalMap = headerMap.__canonical || headerMap;
  var index = canonicalMap[normalizeKey_(canonicalHeader_(header))];
  return index === undefined ? '' : row[index];
}

function getExactByHeader_(row, headerMap, header) {
  var rawMap = headerMap.__raw || headerMap;
  var index = rawMap[normalizeKey_(header)];
  if (index === undefined) return '';
  return clean_(row[index]);
}

function getFirstByHeaders_(row, headerMap, headers) {
  for (var i = 0; i < headers.length; i++) {
    var value = getExactByHeader_(row, headerMap, headers[i]);
    if (value) return value;
  }
  for (var j = 0; j < headers.length; j++) {
    var fallback = getByHeader_(row, headerMap, headers[j]);
    if (fallback) return fallback;
  }
  return '';
}

function setByHeader_(row, headerMap, header, value) {
  var canonicalMap = headerMap.__canonical || headerMap;
  var index = canonicalMap[normalizeKey_(canonicalHeader_(header))];
  if (index !== undefined) row[index] = value;
}

function toNumber_(value) {
  var number = Number(clean_(value));
  return Number.isFinite(number) ? number : 0;
}

function isTrue_(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1';
}

function isFalse_(value) {
  return value === false || String(value).toLowerCase() === 'false' || String(value) === '0';
}

function slugify_(value) {
  return clean_(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parsePlace_(value) {
  var text = clean_(value);
  var result = { name: text, address: '', city: '', state: 'OH', zip: '' };
  if (!text) return result;
  var parts = text.split(',').map(clean_).filter(Boolean);
  if (parts.length >= 3) {
    result.name = parts[0];
    result.address = parts[1];
    result.city = parts[2];
    var stateZip = parts[3] || '';
    var match = stateZip.match(/\b([A-Z]{2})\b\s*(\d{5})?/i);
    if (match) {
      result.state = match[1].toUpperCase();
      result.zip = match[2] || '';
    }
  }
  return result;
}

function normalizeCrmStatus_(value) {
  var text = clean_(value);
  var loose = normalizeKey_(text);
  if (!loose) return '';
  if (loose === 'crm status' || loose === 'status') return '';
  if (/not set|unset|unknown|tbd/.test(loose)) return 'Not Set';
  if (/need.*contact|needs? review|missing.*info|missing.*contact|review/.test(loose)) return 'Needs Review';
  if (/^booked|confirmed|scheduled/.test(loose)) return 'Booked';
  if (/played.*past.*await|played.*past.*reply|await.*reply.*played.*past/.test(loose)) return 'Played in the Past - Awaiting Reply';
  if (/played.*past|past.*played|played before|has played/.test(loose)) return 'Played in the Past';
  if (/open mic|open microphone/.test(loose)) return 'Open Microphone';
  if (/told no closed no music|closed.*not booking|not booking.*closed|no live music|no music|venue.*said.*no|said.*no.*jddm|said no|declined|rejected|do not contact|dnc|not interested|bad fit|not a fit|too far|no longer operating|permanently closed|closed operating|\bclosed\b|duplicate|merge/.test(loose)) return 'Told No / Closed / No Music';
  if (/follow up|followup/.test(loose)) return 'Follow Up Needed';
  if (/waiting.*reply|contacted.*waiting|sent|emailed|outreach sent/.test(loose)) return 'Contacted - Waiting on Reply';
  if (/respond|response|replied|reply received|interested|waitlist|maybe later/.test(loose)) return 'Responded - Needs Action';
  if (/not contacted|never contacted|new prospect/.test(loose)) return 'Not Contacted Yet';
  if (/draft ready|ready.*draft/.test(loose)) return 'Draft Ready';
  for (var i = 0; i < JDDM_CRM_STATUS_OPTIONS.length; i++) {
    if (normalizeKey_(JDDM_CRM_STATUS_OPTIONS[i]) === loose) return JDDM_CRM_STATUS_OPTIONS[i];
  }
  return 'Needs Review';
}

function isClosedHighlightStatus_(status) {
  var normalized = normalizeCrmStatus_(status);
  return normalized === 'Told No / Closed / No Music';
}

function isBlankVenueRow_(row, headerMap) {
  return !getFirstByHeaders_(row, headerMap, ['Place Name', 'Venue Name', 'Place', 'Address', 'Place ID', 'Site ID']);
}

function classifyVenueRowHighlight_(row, headerMap) {
  var status = normalizeCrmStatus_(getByHeader_(row, headerMap, 'Status'));
  if (status === 'Booked') return 'BOOKED';
  if (status === 'Played in the Past' || status === 'Played in the Past - Awaiting Reply') return 'PLAYED';
  if (status === 'Open Microphone') return 'OPEN_MIC';
  if (isClosedHighlightStatus_(status)) return 'CLOSED';
  return 'NONE';
}

function isPlayedStatus_(status) {
  var normalized = normalizeCrmStatus_(status);
  return normalized === 'Booked' || normalized === 'Played in the Past' || normalized === 'Played in the Past - Awaiting Reply';
}

function rowToCanonical_(row, sourceHeaderMap) {
  var parsedPlace = parsePlace_(getFirstByHeaders_(row, sourceHeaderMap, ['Place']));
  var next = {};
  JDDM_CANONICAL_HEADERS.forEach(function(header) { next[header] = ''; });

  JDDM_CANONICAL_HEADERS.forEach(function(header) {
    var aliases = HEADER_ALIASES[header] || [header];
    next[header] = getFirstByHeaders_(row, sourceHeaderMap, aliases);
  });

  next['Place Name'] = next['Place Name'] || parsedPlace.name;
  next.Address = next.Address || parsedPlace.address;
  next.City = next.City || parsedPlace.city;
  next.State = next.State || parsedPlace.state || 'OH';
  next.Zip = next.Zip || parsedPlace.zip;
  next['Place ID'] = next['Place ID'] || slugify_([next['Place Name'], next.City, next.State].filter(Boolean).join(' '));
  normalizeGigFactsObject_(next, { moveExpiredFuture: false });
  next.Status = normalizeCrmStatus_(next.Status) || 'Not Set';
  return JDDM_CANONICAL_HEADERS.map(function(header) { return next[header]; });
}

function normalizeGigFactsObject_(object, options) {
  options = options || {};
  var today = options.today || parseIsoDate_(new Date());
  var moveExpiredFuture = options.moveExpiredFuture === true;
  var pastDates = uniqueSortedDates_(splitDates_(object['Past Gigs']));
  var futureDates = uniqueSortedDates_(splitDates_(object['Future Gigs']));
  if (moveExpiredFuture) {
    var stillFuture = [];
    futureDates.forEach(function(date) {
      if (date && date < today) pastDates.push(date);
      else if (date) stillFuture.push(date);
    });
    pastDates = uniqueSortedDates_(pastDates);
    futureDates = uniqueSortedDates_(stillFuture);
  }
  object['Past Gigs'] = pastDates.length ? pastDates.join('; ') : '';
  object['Future Gigs'] = futureDates.length ? futureDates.join('; ') : '';
  object['Last Played'] = pastDates.length ? pastDates[pastDates.length - 1] : '';
  object['Next Booked'] = futureDates.length ? futureDates[0] : '';
  object['Past Gig Count'] = pastDates.length ? pastDates.length : '';
  object['Future Gig Count'] = futureDates.length ? futureDates.length : '';
  object['Total Gig Count'] = (pastDates.length || futureDates.length) ? pastDates.length + futureDates.length : '';
  return {
    pastCount: pastDates.length,
    futureCount: futureDates.length,
    totalCount: pastDates.length + futureDates.length
  };
}

function canonicalizeRows_(data) {
  return data.rows
    .filter(function(row) { return !isBlankVenueRow_(row, data.headerMap); })
    .map(function(row) { return rowToCanonical_(row, data.headerMap); });
}

function trySheetOp_(label, callback) {
  try {
    callback();
    return { ok: true, label: label };
  } catch (error) {
    return { ok: false, label: label, message: error && error.message ? error.message : String(error) };
  }
}

function formatSheet_(sheet) {
  var warnings = [];
  warnings.push(trySheetOp_('freeze header', function() { sheet.setFrozenRows(1); }));
  warnings.push(trySheetOp_('header style', function() {
    sheet.getRange(1, 1, 1, JDDM_CANONICAL_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#134f5c')
      .setFontColor('#ffffff');
  }));
  warnings = warnings.concat(formatHeaderSections_(sheet));

  JDDM_CANONICAL_HEADERS.forEach(function(header, index) {
    var column = index + 1;
    var spec = JDDM_COLUMN_SPECS.filter(function(item) { return item.header === header; })[0];
    var width = spec && spec.width ? spec.width : (column <= 8 ? 140 : 180);
    warnings.push(trySheetOp_('width ' + header, function() { sheet.setColumnWidth(column, width); }));
    if (spec && spec.numberFormat) {
      warnings.push(trySheetOp_('number format ' + header, function() {
        sheet.getRange(2, column, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat(spec.numberFormat);
      }));
    }
    if (spec && spec.validation) {
      warnings.push(trySheetOp_('dropdown ' + header, function() {
        var validation = SpreadsheetApp.newDataValidation()
          .requireValueInList(spec.validation, true)
          .setAllowInvalid(false)
          .build();
        sheet.getRange(2, column, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(validation);
      }));
    }
  });
  return warnings.filter(function(item) { return !item.ok; });
}

function formatHeaderSections_(sheet) {
  var sectionColors = {
    place: '#134f5c',
    status: '#7f6000',
    contact: '#0b5394',
    gigs: '#38761d',
    extras: '#666666'
  };
  var sections = getSheetSections_();
  var warnings = [];
  Object.keys(sections).forEach(function(section) {
    var headers = sections[section] || [];
    if (!headers.length) return;
    var start = JDDM_CANONICAL_HEADERS.indexOf(headers[0]) + 1;
    if (start < 1) return;
    warnings.push(trySheetOp_('section style ' + section, function() {
      sheet.getRange(1, start, 1, headers.length)
        .setBackground(sectionColors[section] || '#134f5c')
        .setFontColor('#ffffff')
        .setFontWeight('bold');
    }));
  });
  return warnings.filter(function(item) { return !item.ok; });
}

function writeCanonicalSheet_(sheet, rows) {
  sheet.clear();
  sheet.getRange(1, 1, 1, JDDM_CANONICAL_HEADERS.length).setValues([JDDM_CANONICAL_HEADERS]);
  if (rows.length) sheet.getRange(2, 1, rows.length, JDDM_CANONICAL_HEADERS.length).setValues(rows);
  var maxColumns = sheet.getMaxColumns();
  if (maxColumns > JDDM_CANONICAL_HEADERS.length) {
    sheet.deleteColumns(JDDM_CANONICAL_HEADERS.length + 1, maxColumns - JDDM_CANONICAL_HEADERS.length);
  }
  return formatSheet_(sheet);
}

function headersAreCanonical_(headers) {
  if ((headers || []).length !== JDDM_CANONICAL_HEADERS.length) return false;
  for (var i = 0; i < JDDM_CANONICAL_HEADERS.length; i++) {
    if (clean_(headers[i]) !== JDDM_CANONICAL_HEADERS[i]) return false;
  }
  return true;
}

function rewriteStorageSheet_(options, actionName) {
  options = options || {};
  var ss = getSpreadsheet_();
  var sourceSheet = getSheet_();
  var originalName = sourceSheet.getName();
  var data = getData_();
  var rows = canonicalizeRows_(data);
  var timestamp = Utilities.formatDate(new Date(), JDDM_TIMEZONE, 'yyyyMMdd-HHmmss');
  var shouldArchive = isTrue_(options.archive);
  var shouldReplace = !shouldArchive && !isTrue_(options.inPlace) && !headersAreCanonical_(data.headers);
  var archiveName = shouldArchive ? JDDM_ARCHIVE_PREFIX + timestamp : null;
  var cleanSheet = sourceSheet;
  var replacedSheet = false;

  if (shouldArchive) {
    sourceSheet.setName(archiveName);
    cleanSheet = ss.insertSheet(originalName, 0);
  } else if (shouldReplace) {
    cleanSheet = ss.insertSheet(originalName + ' Clean ' + timestamp, 0);
    replacedSheet = true;
  }

  var warnings = writeCanonicalSheet_(cleanSheet, rows);
  ss.setActiveSheet(cleanSheet);
  if (typeof ss.moveActiveSheet === 'function') ss.moveActiveSheet(1);

  if (replacedSheet && typeof ss.deleteSheet === 'function') {
    ss.deleteSheet(sourceSheet);
    cleanSheet.setName(originalName);
  }

  var formatting = isFalse_(options.applyFormatting)
    ? { ok: true, skipped: true }
    : applyRowHighlighting_({ limit: Number(options.limit) || 5000 });

  return {
    ok: true,
    action: actionName,
    schemaVersion: JDDM_SCHEMA_VERSION,
    sheetName: cleanSheet.getName(),
    archivedSheetName: archiveName,
    replacedSheet: replacedSheet,
    keptColumns: JDDM_CANONICAL_HEADERS,
    columns: JDDM_CANONICAL_HEADERS,
    sections: getSheetSections_(),
    purgedColumns: data.headers.filter(function(header) {
      return header && JDDM_CANONICAL_HEADERS.indexOf(header) < 0;
    }),
    rowCount: rows.length,
    formatting: formatting,
    warnings: warnings
  };
}

function setupComputerSection_(options) {
  return rewriteStorageSheet_(options || {}, 'setupComputerSection');
}

function purgeAndSetup_(options) {
  return rewriteStorageSheet_(options || {}, 'purgeAndSetup');
}

function syncArtistSourceAudit_(payload) {
  payload = payload || {};
  var csv = String(payload.csv || '');
  var values = payload.values;
  if (csv) values = Utilities.parseCsv(csv);
  if (!values || !values.length || !values[0] || !values[0].length) {
    return { ok: false, code: 'EMPTY_ARTIST_SOURCE_AUDIT', message: 'Artist source audit CSV or values are required.' };
  }

  var sheetName = clean_(payload.sheetName || 'Artist_Source_Audit');
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  sheet.clear();
  ensureSheetSize_(sheet, values.length, values[0].length);
  sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
  formatArtistSourceAuditSheet_(sheet, values.length, values[0].length);

  return {
    ok: true,
    action: 'syncArtistSourceAudit',
    sheetName: sheetName,
    rowCount: Math.max(values.length - 1, 0),
    columnCount: values[0].length
  };
}

function ensureSheetSize_(sheet, rows, columns) {
  rows = Math.max(Number(rows) || 1, 1);
  columns = Math.max(Number(columns) || 1, 1);
  if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (sheet.getMaxColumns() < columns) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns - sheet.getMaxColumns());
}

function formatArtistSourceAuditSheet_(sheet, rowCount, columnCount) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, columnCount)
    .setFontWeight('bold')
    .setBackground('#134f5c')
    .setFontColor('#ffffff');
  var filter = sheet.getFilter();
  if (filter) filter.remove();
  if (rowCount > 1) sheet.getRange(1, 1, rowCount, columnCount).createFilter();

  var widths = [220, 110, 140, 90, 280, 150, 280, 150, 240, 130, 120, 120, 110, 150, 220, 520];
  for (var i = 0; i < columnCount; i++) sheet.setColumnWidth(i + 1, widths[i] || 180);
  if (rowCount > 1 && columnCount >= 8) {
    sheet.getRange(2, 6, rowCount - 1, 1).setBackground('#fff2cc');
    sheet.getRange(2, 8, rowCount - 1, 1).setBackground('#fff2cc');
  }
  sheet.autoResizeRows(1, Math.min(rowCount, 200));
}

function getSchema_() {
  return {
    ok: true,
    schemaVersion: JDDM_SCHEMA_VERSION,
    columns: JDDM_CANONICAL_HEADERS,
    sections: getSheetSections_(),
    statusOptions: JDDM_CRM_STATUS_OPTIONS,
    highlightRules: {
      Booked: JDDM_ROW_HIGHLIGHT_COLORS.BOOKED,
      'Played in the Past': JDDM_ROW_HIGHLIGHT_COLORS.PLAYED,
      'Played in the Past - Awaiting Reply': JDDM_ROW_HIGHLIGHT_COLORS.PLAYED,
      'Open Microphone': JDDM_ROW_HIGHLIGHT_COLORS.OPEN_MIC,
      'Told No / Closed / No Music': JDDM_ROW_HIGHLIGHT_COLORS.CLOSED
    }
  };
}

function getHealth_() {
  var sheet = getSheet_();
  var schema = getSchema_();
  schema.sheetName = sheet.getName();
  schema.storageColumns = JDDM_STORAGE_COLUMNS;
  schema.generatedColumns = JDDM_COLUMN_SPECS.map(function(column) { return { header: column.header }; });
  return Object.assign(schema, {
    ok: true,
    sheetName: sheet.getName()
  });
}

function getSheetSections_() {
  return {
    place: ['Place Name', 'Address', 'City', 'Zip', 'State', 'Place ID', 'Longitude', 'Latitude'],
    status: ['Status', 'Last Contacted'],
    contact: ['Contact Name', 'Email/Contact', 'Phone Number', 'Booking Contact', 'Contact Type', 'Priority', 'Next Follow Up'],
    gigs: ['Past Gigs', 'Future Gigs', 'Last Played', 'Next Booked', 'Past Gig Count', 'Future Gig Count', 'Total Gig Count', 'Last Synced'],
    extras: ['Venue Type', 'Website', 'Notes']
  };
}

function appendPreviousStatusNote_(notes, previousStatus) {
  var current = clean_(notes);
  var previous = clean_(previousStatus);
  if (!previous) return current;
  var line = 'Previous CRM status: ' + previous;
  if (current.indexOf(line) >= 0) return current;
  return current ? current + '\n' + line : line;
}

function migrateCrmStatuses_(options) {
  options = options || {};
  var data = getData_();
  var sheet = data.sheet;
  var statusMap = data.headerMap.__canonical || data.headerMap;
  var statusColumn = statusMap[normalizeKey_('Status')];
  var notesColumn = statusMap[normalizeKey_('Notes')];
  if (statusColumn === undefined) return { ok: false, code: 'NO_STATUS_COLUMN', message: 'Status column is missing.' };

  var dryRun = isTrue_(options.dryRun);
  var limit = Math.max(1, Math.min(Number(options.limit || 5000), 5000));
  var changed = [];
  var counts = {};

  data.rows.forEach(function(row, index) {
    if (changed.length >= limit || isBlankVenueRow_(row, data.headerMap)) return;
    var rowNumber = index + 2;
    var currentStatus = clean_(row[statusColumn]);
    var normalizedStatus = normalizeCrmStatus_(currentStatus) || 'Not Set';
    counts[normalizedStatus] = (counts[normalizedStatus] || 0) + 1;
    if (normalizeKey_(currentStatus) === normalizeKey_(normalizedStatus)) return;

    var nextRow = row.slice();
    nextRow[statusColumn] = normalizedStatus;
    if (notesColumn !== undefined && currentStatus) {
      nextRow[notesColumn] = appendPreviousStatusNote_(nextRow[notesColumn], currentStatus);
    }
    changed.push({
      rowNumber: rowNumber,
      placeName: getByHeader_(row, data.headerMap, 'Place Name'),
      from: currentStatus,
      to: normalizedStatus,
      row: nextRow
    });
  });

  if (!dryRun) {
    changed.forEach(function(item) {
      sheet.getRange(item.rowNumber, 1, 1, data.headers.length).setValues([item.row]);
    });
  }

  var formatting = dryRun
    ? { ok: true, skipped: true }
    : applyRowHighlighting_({ limit: Number(options.formatLimit || options.limit) || 5000 });

  return {
    ok: true,
    action: 'migrateCrmStatuses',
    dryRun: dryRun,
    schemaVersion: JDDM_SCHEMA_VERSION,
    changedRows: changed.length,
    counts: counts,
    sampleChanges: changed.slice(0, 50).map(function(item) {
      return {
        rowNumber: item.rowNumber,
        placeName: item.placeName,
        from: item.from,
        to: item.to
      };
    }),
    formatting: formatting
  };
}

function restoreFromCsv_(payload) {
  payload = payload || {};
  var csv = String(payload.csv || '');
  if (!csv) return { ok: false, code: 'NO_CSV', message: 'CSV payload is required.' };

  var parsed = Utilities.parseCsv(csv);
  if (!parsed || parsed.length < 2) return { ok: false, code: 'EMPTY_CSV', message: 'CSV payload has no venue rows.' };

  var headers = (parsed[0] || []).map(clean_);
  var sourceHeaderMap = makeHeaderMap_(headers);
  var rows = parsed.slice(1)
    .filter(function(row) { return !isBlankVenueRow_(row, sourceHeaderMap); })
    .map(function(row) { return rowToCanonical_(row, sourceHeaderMap); });

  var sheet = getSheet_();
  var warnings = writeCanonicalSheet_(sheet, rows);
  var formatting = isFalse_(payload.applyFormatting)
    ? { ok: true, skipped: true }
    : applyRowHighlighting_({ limit: Number(payload.limit) || 5000 });

  return {
    ok: true,
    action: 'restoreFromCsv',
    schemaVersion: JDDM_SCHEMA_VERSION,
    sheetName: sheet.getName(),
    rowCount: rows.length,
    columns: JDDM_CANONICAL_HEADERS,
    formatting: formatting,
    warnings: warnings
  };
}

function applyRowHighlighting_(options) {
  options = options || {};
  var data = getData_();
  var sheet = data.sheet;
  var width = Math.max(sheet.getLastColumn(), data.headers.length, 1);
  var startRow = Math.max(2, Number(options.startRow || 2));
  var rowCount = Number(options.rowCount || 0);
  var endRow = rowCount > 0 ? startRow + rowCount - 1 : Number.POSITIVE_INFINITY;
  var limit = Math.max(1, Math.min(Number(options.limit || 5000), 5000));
  var backgrounds = [];
  var fontColors = [];
  var counts = { BOOKED: 0, PLAYED: 0, OPEN_MIC: 0, CLOSED: 0, NONE: 0 };

  data.rows.forEach(function(row, index) {
    var rowNumber = index + 2;
    if (rowNumber < startRow || rowNumber > endRow || backgrounds.length >= limit) return;
    var state = isBlankVenueRow_(row, data.headerMap) ? 'NONE' : classifyVenueRowHighlight_(row, data.headerMap);
    var background = JDDM_ROW_HIGHLIGHT_COLORS[state] || JDDM_ROW_HIGHLIGHT_COLORS.NONE;
    var fontColor = state === 'BOOKED' || state === 'CLOSED'
      ? JDDM_ROW_HIGHLIGHT_COLORS.FONT_LIGHT
      : JDDM_ROW_HIGHLIGHT_COLORS.FONT_DARK;
    backgrounds.push(Array(width).fill(background));
    fontColors.push(Array(width).fill(fontColor));
    counts[state] = (counts[state] || 0) + 1;
  });

  var warnings = [];
  if (backgrounds.length) {
    warnings.push(trySheetOp_('row backgrounds', function() {
      sheet.getRange(startRow, 1, backgrounds.length, width).setBackgrounds(backgrounds);
    }));
    warnings.push(trySheetOp_('row font colors', function() {
      sheet.getRange(startRow, 1, fontColors.length, width).setFontColors(fontColors);
    }));
  }

  return {
    ok: true,
    action: 'applyRowHighlighting',
    formattedRows: backgrounds.length,
    startRow: startRow,
    endRow: backgrounds.length ? startRow + backgrounds.length - 1 : null,
    rowStates: counts,
    colors: {
      booked: JDDM_ROW_HIGHLIGHT_COLORS.BOOKED,
      playedInThePast: JDDM_ROW_HIGHLIGHT_COLORS.PLAYED,
      playedInThePastAwaitingReply: JDDM_ROW_HIGHLIGHT_COLORS.PLAYED,
      openMicrophone: JDDM_ROW_HIGHLIGHT_COLORS.OPEN_MIC,
      toldNoClosedNoMusic: JDDM_ROW_HIGHLIGHT_COLORS.CLOSED,
      closedStatuses: JDDM_ROW_HIGHLIGHT_COLORS.CLOSED
    },
    warnings: warnings.filter(function(item) { return !item.ok; })
  };
}

function recalculateGigCounts_(options) {
  options = options || {};
  var data = getData_();
  var today = parseIsoDate_(new Date());
  var dryRun = isTrue_(options.dryRun);
  var moveExpiredFuture = !isFalse_(options.moveExpiredFuture);
  var checkedRows = 0;
  var changedRows = 0;
  var clearedBogusTotalRows = 0;
  var samples = [];

  data.rows.forEach(function(row, index) {
    if (isBlankVenueRow_(row, data.headerMap)) return;
    checkedRows++;
    var rowNumber = index + 2;
    var next = row.slice();
    var before = {
      pastGigs: getByHeader_(next, data.headerMap, 'Past Gigs'),
      futureGigs: getByHeader_(next, data.headerMap, 'Future Gigs'),
      lastPlayed: getByHeader_(next, data.headerMap, 'Last Played'),
      nextBooked: getByHeader_(next, data.headerMap, 'Next Booked'),
      pastCount: getByHeader_(next, data.headerMap, 'Past Gig Count'),
      futureCount: getByHeader_(next, data.headerMap, 'Future Gig Count'),
      totalCount: getByHeader_(next, data.headerMap, 'Total Gig Count')
    };
    var object = rowObject_(next, data.headerMap);
    var stats = normalizeGigFactsObject_(object, { moveExpiredFuture: moveExpiredFuture, today: today });
    ['Past Gigs', 'Future Gigs', 'Last Played', 'Next Booked', 'Past Gig Count', 'Future Gig Count', 'Total Gig Count'].forEach(function(header) {
      setByHeader_(next, data.headerMap, header, object[header]);
    });
    setByHeader_(next, data.headerMap, 'Last Synced', new Date());

    var after = {
      pastGigs: getByHeader_(next, data.headerMap, 'Past Gigs'),
      futureGigs: getByHeader_(next, data.headerMap, 'Future Gigs'),
      lastPlayed: getByHeader_(next, data.headerMap, 'Last Played'),
      nextBooked: getByHeader_(next, data.headerMap, 'Next Booked'),
      pastCount: getByHeader_(next, data.headerMap, 'Past Gig Count'),
      futureCount: getByHeader_(next, data.headerMap, 'Future Gig Count'),
      totalCount: getByHeader_(next, data.headerMap, 'Total Gig Count')
    };
    var changed = JSON.stringify(before) !== JSON.stringify(after);
    if (!changed) return;
    changedRows++;
    if (toNumber_(before.totalCount) > 0 && !toNumber_(after.totalCount)) clearedBogusTotalRows++;
    if (!dryRun) data.sheet.getRange(rowNumber, 1, 1, data.headers.length).setValues([next]);
    if (samples.length < 50) {
      samples.push({
        rowNumber: rowNumber,
        placeName: getByHeader_(next, data.headerMap, 'Place Name'),
        before: before,
        after: after,
        counts: stats
      });
    }
  });

  return {
    ok: true,
    action: 'recalculateGigCounts',
    dryRun: dryRun,
    moveExpiredFuture: moveExpiredFuture,
    checkedRows: checkedRows,
    changedRows: changedRows,
    clearedBogusTotalRows: clearedBogusTotalRows,
    samples: samples
  };
}

function rowHasCoordinates_(row, headerMap) {
  return Boolean(getByHeader_(row, headerMap, 'Longitude') && getByHeader_(row, headerMap, 'Latitude'));
}

function isCalendarOnlyRow_(row, headerMap) {
  if (rowHasCoordinates_(row, headerMap)) return false;
  if (getByHeader_(row, headerMap, 'Address') || getByHeader_(row, headerMap, 'City')) return false;
  if (getByHeader_(row, headerMap, 'Email/Contact') || getByHeader_(row, headerMap, 'Phone Number')) return false;
  if (getByHeader_(row, headerMap, 'Booking Contact') || getByHeader_(row, headerMap, 'Website')) return false;

  var status = normalizeCrmStatus_(getByHeader_(row, headerMap, 'Status'));
  var hasGigFacts = Boolean(
    getByHeader_(row, headerMap, 'Past Gigs') ||
    getByHeader_(row, headerMap, 'Future Gigs') ||
    getByHeader_(row, headerMap, 'Last Played') ||
    getByHeader_(row, headerMap, 'Next Booked') ||
    toNumber_(getByHeader_(row, headerMap, 'Past Gig Count')) ||
    toNumber_(getByHeader_(row, headerMap, 'Future Gig Count'))
  );
  return hasGigFacts && (status === 'Booked' || status === 'Played in the Past' || status === 'Needs Review' || status === 'Not Set');
}

function cleanupCalendarOnlyRows_(options) {
  options = options || {};
  var data = getData_();
  var matches = [];
  data.rows.forEach(function(row, index) {
    if (!isCalendarOnlyRow_(row, data.headerMap)) return;
    matches.push({
      rowNumber: index + 2,
      placeName: getByHeader_(row, data.headerMap, 'Place Name'),
      status: getByHeader_(row, data.headerMap, 'Status'),
      pastGigs: getByHeader_(row, data.headerMap, 'Past Gigs'),
      futureGigs: getByHeader_(row, data.headerMap, 'Future Gigs')
    });
  });

  if (!isTrue_(options.dryRun)) {
    for (var i = matches.length - 1; i >= 0; i--) {
      data.sheet.deleteRows(matches[i].rowNumber, 1);
    }
  }

  var formatting = isTrue_(options.dryRun)
    ? { ok: true, skipped: true }
    : applyRowHighlighting_({ limit: Number(options.limit) || 5000 });

  return {
    ok: true,
    action: 'cleanupCalendarOnlyRows',
    dryRun: isTrue_(options.dryRun),
    removedRows: isTrue_(options.dryRun) ? 0 : matches.length,
    matchedRows: matches.length,
    matches: matches.slice(0, 50),
    formatting: formatting
  };
}

function escapeCsv_(value) {
  var text = clean_(value);
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function buildCsv_() {
  var data = getData_();
  var lines = [data.headers.map(escapeCsv_).join(',')];
  data.rows.forEach(function(row) {
    if (isBlankVenueRow_(row, data.headerMap)) return;
    lines.push(data.headers.map(function(_header, index) { return escapeCsv_(row[index]); }).join(','));
  });
  return lines.join('\n');
}

function findRowById_(data, id) {
  var target = clean_(id);
  if (!target) return -1;
  for (var i = 0; i < data.rows.length; i++) {
    var row = data.rows[i];
    if (getByHeader_(row, data.headerMap, 'Place ID') === target) return i + 2;
  }
  return -1;
}

function rowObject_(row, headerMap) {
  var object = {};
  JDDM_CANONICAL_HEADERS.forEach(function(header) {
    object[header] = getRawByHeader_(row, headerMap, header);
  });
  object.played = isPlayedStatus_(object.Status);
  object.visited = object.played;
  object.contactStatus = object.Status;
  object.calendarPastGigEvents = object['Past Gigs'];
  object.calendarFutureGigEvents = object['Future Gigs'];
  object.calendarLastGigDate = object['Last Played'];
  object.calendarNextGigDate = object['Next Booked'];
  object.calendarPastGigCount = object['Past Gig Count'];
  object.calendarFutureGigCount = object['Future Gig Count'];
  object.calendarTotalGigsPlayed = object['Total Gig Count'];
  return object;
}

function rawFieldsFromRow_(row, headerMap) {
  var object = {};
  JDDM_CANONICAL_HEADERS.forEach(function(header) {
    object[header] = getRawByHeader_(row, headerMap, header);
  });
  return object;
}

function getVenue_(payload) {
  var data = getData_();
  var rowNumber = findRowById_(data, payload.id);
  if (rowNumber < 0) return { ok: false, code: 'NOT_FOUND', message: 'Venue was not found.' };
  var row = data.rows[rowNumber - 2];
  return {
    ok: true,
    rowNumber: rowNumber,
    rawFields: rawFieldsFromRow_(row, data.headerMap),
    venue: rowObject_(row, data.headerMap)
  };
}

function normalizeRawFieldHeader_(header) {
  var key = normalizeKey_(header);
  if (key === 'status' || key === 'crm status' || key === 'contactstatus' || key === 'contact status') return 'Status';
  if (key === 'played') return 'Status';
  for (var canonical in HEADER_ALIASES) {
    var aliases = HEADER_ALIASES[canonical] || [];
    for (var i = 0; i < aliases.length; i++) {
      if (normalizeKey_(aliases[i]) === key) return canonical;
    }
  }
  return '';
}

function saveVenue_(payload) {
  var data = getData_();
  var rowNumber = findRowById_(data, payload.id);
  if (rowNumber < 0) return { ok: false, code: 'NOT_FOUND', message: 'Venue was not found.' };
  var row = data.rows[rowNumber - 2].slice();
  var rawFields = payload.rawFields || {};
  var venue = payload.venue || {};

  Object.keys(rawFields).forEach(function(header) {
    var canonical = normalizeRawFieldHeader_(header);
    if (!canonical) return;
    var value = rawFields[header];
    if (canonical === 'Status') value = normalizeCrmStatus_(value);
    setByHeader_(row, data.headerMap, canonical, value);
  });

  if (venue.contactStatus) setByHeader_(row, data.headerMap, 'Status', normalizeCrmStatus_(venue.contactStatus));
  if (venue.nextFollowUpDate !== undefined) setByHeader_(row, data.headerMap, 'Next Follow Up', clean_(venue.nextFollowUpDate));
  if (venue.priority !== undefined) setByHeader_(row, data.headerMap, 'Priority', clean_(venue.priority));
  if (venue.bestFitScore !== undefined && !getByHeader_(row, data.headerMap, 'Priority')) {
    setByHeader_(row, data.headerMap, 'Priority', clean_(venue.bestFitScore));
  }
  if (venue.notes !== undefined) setByHeader_(row, data.headerMap, 'Notes', clean_(venue.notes));

  data.sheet.getRange(rowNumber, 1, 1, data.headers.length).setValues([row]);
  applyRowHighlighting_({ startRow: rowNumber, rowCount: 1, limit: 1 });
  return { ok: true, action: 'saveVenue', rowNumber: rowNumber, venue: rowObject_(row, data.headerMap) };
}

function setPlayed_(payload) {
  var data = getData_();
  var rowNumber = findRowById_(data, payload.id);
  if (rowNumber < 0) return { ok: false, code: 'NOT_FOUND', message: 'Venue was not found.' };
  var status = payload.played ? 'Played in the Past' : 'Needs Review';
  var statusMap = data.headerMap.__canonical || data.headerMap;
  var statusColumn = statusMap[normalizeKey_('Status')];
  if (statusColumn === undefined) return { ok: false, code: 'NO_STATUS_COLUMN', message: 'Status column is missing.' };
  data.sheet.getRange(rowNumber, statusColumn + 1).setValue(status);
  applyRowHighlighting_({ startRow: rowNumber, rowCount: 1, limit: 1 });
  return { ok: true, action: 'setPlayed', rowNumber: rowNumber, played: Boolean(payload.played), status: status };
}

function parseIsoDate_(value) {
  var text = clean_(value);
  if (!text) return '';
  var iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return isoFromDateParts_(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  var slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    var slashYear = Number(slash[3].length === 2 ? '20' + slash[3] : slash[3]);
    return isoFromDateParts_(slashYear, Number(slash[1]), Number(slash[2]));
  }
  var date = value instanceof Date ? value : new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, JDDM_TIMEZONE, 'yyyy-MM-dd');
}

function isoFromDateParts_(year, month, day) {
  var date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return '';
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0')
  ].join('-');
}

function hasExplicitGigDatePattern_(value) {
  var text = clean_(value);
  return /\b\d{4}-\d{1,2}-\d{1,2}\b/.test(text) ||
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(text) ||
    /\b(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i.test(text);
}

function splitDates_(value) {
  var text = clean_(value);
  if (!text) return [];

  var dates = [];
  function addDate(candidate) {
    if (!hasExplicitGigDatePattern_(candidate)) return;
    var date = parseIsoDate_(candidate);
    if (date) dates.push(date);
  }

  (text.match(/\b\d{4}-\d{1,2}-\d{1,2}\b/g) || []).forEach(addDate);
  (text.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g) || []).forEach(addDate);
  (text.match(/\b(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi) || []).forEach(addDate);

  text.split(/[;\n]+/)
    .map(function(part) { return clean_(String(part).split('|')[0]); })
    .forEach(addDate);

  return uniqueSortedDates_(dates);
}

function uniqueSortedDates_(dates) {
  var seen = {};
  dates.forEach(function(date) {
    if (date) seen[date] = true;
  });
  return Object.keys(seen).sort();
}

var JDDM_CALENDAR_TOKEN_STOPWORDS = {
  at: true,
  and: true,
  the: true,
  with: true,
  live: true,
  music: true,
  just: true,
  dee: true,
  deedeemusic: true,
  jddm: true,
  scheduled: true,
  public: true,
  private: true,
  event: true,
  open: true,
  mic: true,
  microphone: true
};

function safeCalendarEventCall_(event, methodName, fallback) {
  try {
    if (event && typeof event[methodName] === 'function') return event[methodName]();
  } catch (error) {
    return fallback;
  }
  return fallback;
}

function normalizeCalendarVenueName_(title) {
  var text = clean_(title)
    .replace(/^just\s*dee\s*dee\s*music\s+live\s*@\s*/i, '')
    .replace(/^justdeedeemusic\s+live\s*@\s*/i, '')
    .replace(/^live\s+music\s+with\s+just\s*dee\s*dee\s*music\s+at\s+/i, '')
    .replace(/^live\s+music\s+with\s+justdeedeemusic\s+at\s+/i, '')
    .replace(/\s+-\s*(proposed|hold)\s*$/i, '')
    .replace(/\s+\((trial|proposed|hold)\)\s*$/i, '')
    .trim();
  return text || clean_(title);
}

function isRealCalendarGig_(event) {
  var loose = normalizeKey_([event.title, event.location].join(' '));
  if (!event.date || !event.title) return false;
  if (/^camping\b|^flight\b|\bbirthday\b|^easter$/.test(loose)) return false;
  if (/\b(proposed|hold)\b/.test(loose)) return false;
  if (/^(jddm )?scheduled (public|private) event$/.test(loose)) return false;
  if (/^(jddm )?private event$|^private event$/.test(loose)) return false;
  if (event.isAllDay && /\btour\b/.test(loose)) return false;
  if (event.isAllDay && !event.location && /\b(holiday|summer)\b/.test(loose)) return false;
  return true;
}

function calendarTokenBase_(token) {
  var text = clean_(token);
  if (text.length > 5 && /ies$/.test(text)) return text.slice(0, -3) + 'y';
  if (text.length > 5 && /ers$/.test(text)) return text.slice(0, -1);
  if (text.length > 4 && /s$/.test(text)) return text.slice(0, -1);
  return text;
}

function calendarTokens_(value) {
  return normalizeKey_(value)
    .split(' ')
    .map(calendarTokenBase_)
    .filter(function(token) {
      return token.length > 2 && !JDDM_CALENDAR_TOKEN_STOPWORDS[token];
    });
}

function editDistanceAtMostOne_(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  var edits = 0;
  var i = 0;
  var j = 0;
  while (i < a.length && j < b.length) {
    if (a.charAt(i) === b.charAt(j)) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function calendarTokensMatch_(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (calendarTokenBase_(a) === calendarTokenBase_(b)) return true;
  return Math.min(a.length, b.length) >= 5 && editDistanceAtMostOne_(a, b);
}

function calendarTokenScore_(eventTokens, rowTokens) {
  var score = 0;
  eventTokens.forEach(function(eventToken) {
    for (var i = 0; i < rowTokens.length; i++) {
      if (calendarTokensMatch_(eventToken, rowTokens[i])) {
        score++;
        break;
      }
    }
  });
  return score;
}

function parseCalendarLocation_(location) {
  var result = { address: clean_(location), city: '', state: 'OH', zip: '' };
  var parts = clean_(location).split(',').map(clean_).filter(Boolean);
  if (parts.length >= 2) {
    result.address = parts[0];
    result.city = parts[1];
  }
  if (parts.length >= 3) {
    var match = parts[2].match(/\b([A-Z]{2})\b\s*(\d{5})?/i);
    if (match) {
      result.state = match[1].toUpperCase();
      result.zip = match[2] || '';
    }
  }
  return result;
}

function getCalendarEvents_() {
  var start = new Date(2010, 0, 1);
  var end = new Date();
  end.setFullYear(end.getFullYear() + 2);
  var events = [];
  JDDM_CALENDAR_IDS.forEach(function(calendarId) {
    var calendar = CalendarApp.getCalendarById(calendarId);
    if (!calendar) return;
    calendar.getEvents(start, end).forEach(function(event) {
      var title = clean_(event.getTitle());
      var location = clean_(event.getLocation());
      if (!title && !location) return;
      var nextEvent = {
        title: title,
        venueName: normalizeCalendarVenueName_(title),
        location: location,
        date: parseIsoDate_(safeCalendarEventCall_(event, 'getStartTime', null)),
        id: calendarId + ':' + safeCalendarEventCall_(event, 'getId', ''),
        isAllDay: Boolean(safeCalendarEventCall_(event, 'isAllDayEvent', false))
      };
      if (isRealCalendarGig_(nextEvent)) events.push(nextEvent);
    });
  });
  return events;
}

function findEventRow_(data, event) {
  var eventVenueKey = normalizeKey_(event.venueName || event.title);
  var eventLocationKey = normalizeKey_(event.location);
  var eventVenueTokens = calendarTokens_(event.venueName || event.title);
  var eventTokens = calendarTokens_([event.venueName, event.title, event.location].join(' '));
  var bestRow = -1;
  var bestScore = 0;
  data.rows.forEach(function(row, index) {
    if (isBlankVenueRow_(row, data.headerMap)) return;
    var rowName = getByHeader_(row, data.headerMap, 'Place Name') || getByHeader_(row, data.headerMap, 'Venue Name');
    var rowAddress = getByHeader_(row, data.headerMap, 'Address');
    var rowCity = getByHeader_(row, data.headerMap, 'City');
    var rowNameKey = normalizeKey_(rowName);
    var rowLocationKey = normalizeKey_([rowAddress, rowCity].join(' '));
    var rowTokens = calendarTokens_([rowName, rowAddress, rowCity].join(' '));
    var rowVenueTokens = calendarTokens_(rowName);
    if (!rowNameKey && !rowLocationKey) return;
    var score = 0;
    if (eventVenueKey && rowNameKey && (eventVenueKey.indexOf(rowNameKey) >= 0 || rowNameKey.indexOf(eventVenueKey) >= 0)) score += 8;
    if (eventLocationKey && rowLocationKey && rowLocationKey.length > 8 && eventLocationKey.indexOf(rowLocationKey) >= 0) score += 8;
    score += calendarTokenScore_(eventVenueTokens, rowVenueTokens) * 2;
    score += calendarTokenScore_(eventTokens, rowTokens);
    if (score > bestScore) {
      bestScore = score;
      bestRow = index + 2;
    }
  });
  return bestScore >= 4 ? bestRow : -1;
}

function appendVenueFromEvent_(data, event) {
  var name = event.venueName || event.title || event.location || 'Calendar Venue';
  var parsedLocation = parseCalendarLocation_(event.location);
  var row = JDDM_CANONICAL_HEADERS.map(function(header) {
    return '';
  });
  var map = makeHeaderMap_(JDDM_CANONICAL_HEADERS);
  setByHeader_(row, map, 'Place Name', name);
  setByHeader_(row, map, 'Address', parsedLocation.address);
  setByHeader_(row, map, 'City', parsedLocation.city);
  setByHeader_(row, map, 'State', parsedLocation.state || 'OH');
  setByHeader_(row, map, 'Zip', parsedLocation.zip);
  setByHeader_(row, map, 'Place ID', slugify_([name, parsedLocation.city, parsedLocation.state].filter(Boolean).join(' ')));
  setByHeader_(row, map, 'Status', 'Needs Review');
  setByHeader_(row, map, 'Notes', 'Created from Google Calendar future gig. Review venue details and coordinates.');
  data.sheet.appendRow(row);
  return data.sheet.getLastRow();
}

function summarizeCalendarEvent_(event) {
  return {
    id: event.id,
    date: event.date,
    title: event.title,
    venueName: event.venueName,
    location: event.location
  };
}

function seedCalendarRowsWithExistingFuture_(data, target) {
  data.rows.forEach(function(row, index) {
    if (isBlankVenueRow_(row, data.headerMap)) return;
    if (!splitDates_(getByHeader_(row, data.headerMap, 'Future Gigs')).length) return;
    var rowNumber = index + 2;
    if (!target[rowNumber]) target[rowNumber] = { past: [], future: [] };
  });
}

function todayIso_() {
  return Utilities.formatDate(new Date(), JDDM_TIMEZONE, 'yyyy-MM-dd');
}

function syncCalendarGigEvents_(payload) {
  setupComputerSection_({ applyFormatting: false });
  var data = getData_();
  var today = todayIso_();
  var events = getCalendarEvents_();
  var touched = {};
  var addMissing = payload && payload.addMissing !== undefined ? isTrue_(payload.addMissing) : true;
  var replaceFutureGigs = !(payload && isFalse_(payload.replaceFutureGigs));
  var addedRows = [];
  var unmatchedFutureEvents = [];
  var unmatchedPastEvents = [];

  if (replaceFutureGigs) seedCalendarRowsWithExistingFuture_(data, touched);

  events.forEach(function(event) {
    if (!event.date) return;
    var rowNumber = findEventRow_(data, event);
    if (rowNumber < 0) {
      if (event.date >= today && addMissing) {
        rowNumber = appendVenueFromEvent_(data, event);
        addedRows.push({ rowNumber: rowNumber, event: summarizeCalendarEvent_(event) });
        data = getData_();
      } else {
        if (event.date >= today) unmatchedFutureEvents.push(summarizeCalendarEvent_(event));
        else unmatchedPastEvents.push(summarizeCalendarEvent_(event));
        return;
      }
    }
    if (!touched[rowNumber]) touched[rowNumber] = { past: [], future: [] };
    if (event.date >= today) touched[rowNumber].future.push(event.date);
    else touched[rowNumber].past.push(event.date);
  });

  Object.keys(touched).forEach(function(rowNumberText) {
    var rowNumber = Number(rowNumberText);
    var row = data.rows[rowNumber - 2].slice();
    var currentPast = splitDates_(getByHeader_(row, data.headerMap, 'Past Gigs'));
    var currentFuture = splitDates_(getByHeader_(row, data.headerMap, 'Future Gigs'));
    var expiredFutureDates = currentFuture.filter(function(date) {
      return date && date < today;
    });
    var past = uniqueSortedDates_(currentPast.concat(expiredFutureDates, touched[rowNumber].past));
    var future = replaceFutureGigs
      ? uniqueSortedDates_(touched[rowNumber].future)
      : uniqueSortedDates_(currentFuture.concat(touched[rowNumber].future));
    setByHeader_(row, data.headerMap, 'Past Gigs', past.join('; '));
    setByHeader_(row, data.headerMap, 'Future Gigs', future.join('; '));
    setByHeader_(row, data.headerMap, 'Last Played', past.length ? past[past.length - 1] : '');
    setByHeader_(row, data.headerMap, 'Next Booked', future.length ? future[0] : '');
    setByHeader_(row, data.headerMap, 'Past Gig Count', past.length);
    setByHeader_(row, data.headerMap, 'Future Gig Count', future.length);
    setByHeader_(row, data.headerMap, 'Total Gig Count', past.length + future.length);
    setByHeader_(row, data.headerMap, 'Last Synced', new Date());
    data.sheet.getRange(rowNumber, 1, 1, data.headers.length).setValues([row]);
  });

  var formatting = applyRowHighlighting_({ limit: 5000 });
  return {
    ok: true,
    action: 'syncCalendarGigEvents',
    eventCount: events.length,
    updatedRows: Object.keys(touched).length,
    addedRows: addedRows,
    unmatchedFutureEvents: unmatchedFutureEvents,
    unmatchedPastEventCount: unmatchedPastEvents.length,
    replaceFutureGigs: replaceFutureGigs,
    formatting: formatting
  };
}

function installCalendarAutomation_() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction && trigger.getHandlerFunction() === 'runJddmCalendarSyncTrigger') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('runJddmCalendarSyncTrigger').timeBased().everyMinutes(5).create();
  return { ok: true, action: 'installCalendarAutomation', everyMinutes: 5 };
}

function runJddmCalendarSyncTrigger() {
  return syncCalendarGigEvents_({ addMissing: true });
}

function onEdit(e) {
  if (!e || !e.range) return;
  var sheet = getSheet_();
  if (e.range.getSheet().getName() !== sheet.getName()) return;
  var headers = readHeaders_(sheet);
  var headerMap = makeHeaderMap_(headers);
  var statusMap = headerMap.__canonical || headerMap;
  var statusColumn = statusMap[normalizeKey_('Status')];
  if (statusColumn === undefined || e.range.getColumn() !== statusColumn + 1 || e.range.getRow() < 2) return;
  applyRowHighlighting_({ startRow: e.range.getRow(), rowCount: 1, limit: 1 });
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('JDDM Map')
    .addItem('Purge to clean storage sheet', 'menuPurgeAndSetup')
    .addItem('Setup CRM storage section', 'menuSetupComputerSection')
    .addItem('Simplify CRM statuses', 'menuMigrateCrmStatuses')
    .addItem('Sync Google Calendar gigs', 'menuSyncCalendarGigEvents')
    .addItem('Apply CRM row colors', 'menuApplyRowHighlighting')
    .addToUi();
}

function menuPurgeAndSetup() {
  var result = purgeAndSetup_({ archive: true });
  SpreadsheetApp.getUi().alert('JDDM sheet purged into clean storage. Rows kept=' + result.rowCount + '. Archive=' + result.archivedSheetName);
}

function menuSetupComputerSection() {
  var result = setupComputerSection_({ applyFormatting: true });
  SpreadsheetApp.getUi().alert('JDDM CRM storage setup complete. Rows=' + result.rowCount);
}

function menuMigrateCrmStatuses() {
  var result = migrateCrmStatuses_({ limit: 5000 });
  SpreadsheetApp.getUi().alert('JDDM CRM statuses simplified. Changed rows=' + result.changedRows);
}

function menuSyncCalendarGigEvents() {
  var result = syncCalendarGigEvents_({ addMissing: true });
  SpreadsheetApp.getUi().alert('JDDM calendar sync complete. Updated rows=' + result.updatedRows + ', added rows=' + result.addedRows.length + ', events=' + result.eventCount);
}

function menuApplyRowHighlighting() {
  var result = applyRowHighlighting_({ limit: 5000 });
  SpreadsheetApp.getUi().alert('JDDM row colors applied. Rows=' + result.formattedRows);
}
