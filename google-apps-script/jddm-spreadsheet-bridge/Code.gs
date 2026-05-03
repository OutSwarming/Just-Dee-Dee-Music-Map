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
 */

var JDDM_BRIDGE_CONFIG = {
  SHEET_NAME: '', // Leave blank to use the first sheet.
  EDIT_TOKEN: '' // Optional prototype guard. If set, frontend token must match.
};

var JDDM_SCHEMA_VERSION = '2026-05-03-rst-generated-columns';

var GENERATED_COLUMNS = [
  { key: 'longitude', header: 'Longitude', column: 18 }, // R
  { key: 'latitude', header: 'Latitude', column: 19 },   // S
  { key: 'siteId', header: 'Site ID', column: 20 }       // T
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
  'private event'
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

    if (action === 'getVenue') {
      return jsonOutput_(getVenue_(payload.id));
    }

    if (action === 'saveVenue') {
      return jsonOutput_(saveVenue_(payload));
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

function getByHeader_(row, headerMap, header) {
  var index = headerMap[normalizeHeader_(header)];
  if (index === undefined || index < 0) return '';
  return clean_(row[index]);
}

function setByHeader_(rowValues, headerMap, header, value) {
  var index = headerMap[normalizeHeader_(header)];
  if (index === undefined || index < 0) return;
  rowValues[index] = value;
}

function ensureGeneratedColumns_() {
  var sheet = getSheet_();
  var maxColumns = Math.max(sheet.getLastColumn(), 20);
  var headerRange = sheet.getRange(1, 1, 1, maxColumns);
  var headers = headerRange.getValues()[0].map(clean_);
  var changed = [];

  GENERATED_COLUMNS.forEach(function(columnSpec) {
    var index = columnSpec.column - 1;
    if (headers[index] !== columnSpec.header) {
      sheet.getRange(1, columnSpec.column).setValue(columnSpec.header);
      headers[index] = columnSpec.header;
      changed.push(columnSpec.header);
    }
  });

  return {
    ok: true,
    schemaVersion: JDDM_SCHEMA_VERSION,
    sheetName: sheet.getName(),
    changedHeaders: changed,
    columns: GENERATED_COLUMNS
  };
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
    ['Times booked', getByHeader_(row, headerMap, '#Times')],
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
    'private event': privateEvent
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
    privateEvent: venue['private event'] === 'TRUE'
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
  venue.id = found.match.id;
  writeVenueFields_(rowValues, headerMap, venue, rawFields);

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
}

function syncGeneratedColumns_(payload) {
  ensureGeneratedColumns_();
  var data = getSheetValues_();
  var headerMap = makeHeaderMap_(data.headers);
  var usedIds = {};
  var limit = Math.max(1, Math.min(Number(payload && payload.limit || 25), 200));
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
    if (range.getRow() < 2 || range.getColumn() >= 18) return;
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

function installJddmAutoFillTrigger() {
  var result = setupJddmMapBridge();
  notifyUser_(
    'JDDM auto-fill trigger installed. Headers changed: ' + result.schema.changedHeaders.join(', ') +
    '. Initial changed rows: ' + result.sync.changedCount +
    '. New/edited rows will fill Longitude, Latitude, and Site ID.'
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

function notifyUser_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    console.log(message);
  }
}
