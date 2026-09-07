const contacts = require('./contactRecords');
const { calendarDate, contactDetails } = require('./venueFields');
const { createHash } = require('crypto');

const SPREADSHEET_ID = '16Sp11KboYq1dyL5e4tlFKxZEc9VnPaa0eCffyG2_xBk';
const MAIN_SHEET = 'Sheet1';
const REMINDER_SHEET = 'ReminderQueue';
const WEBSITE_GIG_SHEET = 'WebsiteGigs';
const SCHEMA_VERSION = '2026-08-31-firebase-shared-bridge';

const CANONICAL_HEADERS = [
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

const STATUS_OPTIONS = [
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

const REMINDER_IDS = new Set(['today-plan', 'available-dates', 'follow-ups', 'calendar-cleanup']);
const REMINDER_HEADERS = ['Request ID', 'Requested At', 'Reminder ID', 'Status', 'Sent At', 'Result'];
const WEBSITE_GIG_HEADERS = ['Event ID', 'Event Date', 'Title', 'Venue Name', 'Location', 'Source URL', 'Last Seen'];
const ARTIST_TRACKER_SHEETS = [
    'Venues',
    'Artists',
    'Events',
    'Event_Artists',
    'Venue_Artist_History',
    'Review_Queue'
];

const HEADER_ALIASES = {
    'Place Name': ['Place Name', 'Venue Name', 'venue name', 'name', 'Location'],
    Address: ['Address', 'address', 'street address', 'Venue Address'],
    City: ['City', 'city', 'town'],
    Zip: ['Zip', 'zip', 'zip code', 'postal code'],
    State: ['State', 'state'],
    'Place ID': ['Place ID', 'Site ID', 'site id', 'id', 'venue id', 'Map Site ID'],
    Longitude: ['Longitude', 'longitude', 'lng', 'lon', 'Map Longitude'],
    Latitude: ['Latitude', 'latitude', 'lat', 'Map Latitude'],
    Status: ['CRM Status', 'crm status', 'contactStatus', 'contact status', 'Status', 'Played'],
    'Last Contacted': ['Last Contacted', 'CRM Last Contacted', 'lastContactedDate', 'last contacted date', 'Contacted'],
    'Contact Name': ['Contact Name', 'contactName', 'contact name', 'CRM Contact Name'],
    'Email/Contact': ['Email/Contact', 'Email', 'email', 'contactEmail', 'CRM Email/Contact'],
    'Phone Number': ['Phone Number', 'Phone', 'phone', 'contactPhone', 'CRM Phone'],
    'Booking Contact': ['Booking Contact', 'booking/contact info', 'booking contact', 'contact'],
    'Contact Type': ['Contact Type', 'CRM Contact Type'],
    Priority: ['Priority', 'CRM Priority', 'priority', 'Rank', 'bestFitScore'],
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
    Website: ['Website', 'website', 'website/social link', 'social link', 'link', 'CRM Website'],
    'Contact Details': ['Contact Details', 'contactDetails'],
    Notes: ['Notes', 'notes', 'Useful/Important/Other Info', 'description', 'CRM Notes']
};

function clean(value) {
    return String(value === undefined || value === null ? '' : value).trim();
}

function normalizeKey(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function canonicalHeader(header) {
    const key = normalizeKey(header);
    for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
        if (normalizeKey(canonical) === key || aliases.some(alias => normalizeKey(alias) === key)) return canonical;
    }
    return '';
}

function makeHeaderMap(headers) {
    const map = new Map();
    headers.forEach((header, index) => {
        const canonical = canonicalHeader(header) || clean(header);
        if (canonical && !map.has(canonical)) map.set(canonical, index);
    });
    return map;
}

function normalizeStatus(value) {
    const text = clean(value);
    const loose = normalizeKey(text);
    if (!loose) return '';
    if (value === true || loose === 'true' || loose === 'yes') return 'Played in the Past';
    if (value === false || loose === 'false' || loose === 'no') return 'Needs Review';
    if (/not set|unset|unknown|tbd/.test(loose)) return 'Not Set';
    if (/need.*contact|needs? review|missing.*info|missing.*contact|review/.test(loose)) return 'Needs Review';
    if (/^booked|confirmed|scheduled/.test(loose)) return 'Booked';
    if (/played.*past.*await|played.*past.*reply|await.*reply.*played.*past/.test(loose)) return 'Played in the Past - Awaiting Reply';
    if (/played.*past|past.*played|played before|has played/.test(loose)) return 'Played in the Past';
    if (/open mic|open microphone/.test(loose)) return 'Open Microphone';
    if (/told no|closed|no live music|no music|declined|rejected|do not contact|not interested|bad fit|not a fit|duplicate/.test(loose)) {
        return 'Told No / Closed / No Music';
    }
    if (/follow up|followup/.test(loose)) return 'Follow Up Needed';
    if (/waiting.*reply|contacted.*waiting|sent|emailed|outreach sent/.test(loose)) return 'Contacted - Waiting on Reply';
    if (/respond|response|replied|reply received|interested|waitlist|maybe later/.test(loose)) return 'Responded - Needs Action';
    if (/not contacted|never contacted|new prospect/.test(loose)) return 'Not Contacted Yet';
    if (/draft ready|ready.*draft/.test(loose)) return 'Draft Ready';
    return STATUS_OPTIONS.find(option => normalizeKey(option) === loose) || text;
}

function padRow(row, width) {
    const next = Array.isArray(row) ? row.slice(0, width) : [];
    while (next.length < width) next.push('');
    return next;
}

function getCell(row, headerMap, header) {
    const index = headerMap.get(header);
    return index === undefined ? '' : row[index];
}

function setCell(row, headerMap, header, value) {
    const index = headerMap.get(header);
    if (index !== undefined) row[index] = value;
}

function slugify(value) {
    return clean(value)
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function isoDate(value) {
    const text = clean(value);
    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    const usMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!usMatch) return '';
    return `${usMatch[3]}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}`;
}

function gigDates(value) {
    const matches = String(value || '').match(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/g) || [];
    return [...new Set(matches.map(isoDate).filter(Boolean))].sort();
}

function parseUsLocation(value) {
    const parts = clean(value).split(',').map(clean).filter(Boolean);
    const result = { address: '', city: '', state: '', zip: '' };
    if (!parts.length) return result;
    const stateZip = parts[parts.length - 1].match(/^([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/i);
    if (stateZip) {
        result.state = stateZip[1].toUpperCase();
        result.zip = clean(stateZip[2]);
        parts.pop();
        result.city = clean(parts.pop());
        result.address = parts.join(', ');
        return result;
    }
    result.address = clean(value);
    return result;
}

function columnName(index) {
    let value = Number(index) + 1;
    let result = '';
    while (value > 0) {
        const remainder = (value - 1) % 26;
        result = String.fromCharCode(65 + remainder) + result;
        value = Math.floor((value - 1) / 26);
    }
    return result;
}

function escapeCsv(value) {
    const text = clean(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function valuesToCsv(values) {
    return (values || []).map(row => (row || []).map(escapeCsv).join(',')).join('\n');
}

function parseCsv(csv) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const source = String(csv || '');
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (quoted) {
            if (char === '"' && source[index + 1] === '"') {
                field += '"';
                index += 1;
            } else if (char === '"') {
                quoted = false;
            } else {
                field += char;
            }
        } else if (char === '"') {
            quoted = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\n') {
            row.push(field.replace(/\r$/, ''));
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += char;
        }
    }
    if (field || row.length) {
        row.push(field.replace(/\r$/, ''));
        rows.push(row);
    }
    return rows;
}

function schemaPayload() {
    return {
        ok: true,
        schemaVersion: SCHEMA_VERSION,
        columns: CANONICAL_HEADERS.slice(),
        storageColumns: CANONICAL_HEADERS.slice(),
        generatedColumns: CANONICAL_HEADERS.map(header => ({ header })),
        sections: {
            place: CANONICAL_HEADERS.slice(0, 8),
            status: CANONICAL_HEADERS.slice(8, 10),
            contact: CANONICAL_HEADERS.slice(10, 17),
            gigs: CANONICAL_HEADERS.slice(17, 25),
            extras: CANONICAL_HEADERS.slice(25)
        },
        statusOptions: STATUS_OPTIONS.slice(),
        highlightRules: {
            Booked: '#38761d',
            'Played in the Past': '#d9ead3',
            'Played in the Past - Awaiting Reply': '#d9ead3',
            'Open Microphone': '#fff2cc',
            'Told No / Closed / No Music': '#cc0000'
        }
    };
}

function rowObject(row, headerMap) {
    const object = {};
    CANONICAL_HEADERS.forEach(header => {
        object[header] = getCell(row, headerMap, header);
    });
    object.played = /^Played in the Past/.test(clean(object.Status));
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

function rawFieldsFromRow(row, headerMap) {
    const result = {};
    CANONICAL_HEADERS.forEach(header => {
        result[header] = getCell(row, headerMap, header);
    });
    return result;
}

function isBlankVenueRow(row, headerMap) {
    return !clean(getCell(row, headerMap, 'Place Name')) && !clean(getCell(row, headerMap, 'Place ID'));
}

function createGoogleSheetsGateway({ google, spreadsheetId = SPREADSHEET_ID }) {
    const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    let metadataCache = null;

    async function metadata(refresh = false) {
        if (metadataCache && !refresh) return metadataCache;
        const response = await sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'properties(title,timeZone),sheets(properties(sheetId,title,index,gridProperties))'
        });
        metadataCache = response.data;
        return metadataCache;
    }

    async function sheetProperties(title) {
        const workbook = await metadata();
        return (workbook.sheets || []).map(item => item.properties).find(item => item.title === title) || null;
    }

    async function ensureSheet(title, headers) {
        let properties = await sheetProperties(title);
        if (!properties) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: {
                                title,
                                gridProperties: { frozenRowCount: 1 }
                            }
                        }
                    }]
                }
            });
            metadataCache = null;
            properties = await sheetProperties(title);
            if (headers && headers.length) {
                await updateValues(`${title}!A1:${columnName(headers.length - 1)}1`, [headers]);
                await formatHeader(title, headers.length);
            }
        }
        return properties;
    }

    async function ensureColumns(title, width) {
        // A legacy setup or restore can replace the tab while this instance stays
        // warm. Re-resolve both its ID and dimensions before every venue operation.
        const workbook = await metadata(true);
        const properties = (workbook.sheets || []).map(item => item.properties).find(item => item.title === title);
        if (!properties) throw new Error(`Sheet not found: ${title}`);
        if (properties.gridProperties.columnCount < width) {
            await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{
                updateSheetProperties: { properties: { sheetId: properties.sheetId, gridProperties: { columnCount: width } }, fields: 'gridProperties.columnCount' }
            }] } });
            metadataCache = null;
        }
    }

    async function getValues(range) {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
            valueRenderOption: 'FORMATTED_VALUE',
            dateTimeRenderOption: 'FORMATTED_STRING'
        });
        return response.data.values || [];
    }

    async function getSheetValues(title) {
        const properties = await sheetProperties(title);
        if (!properties) throw new Error(`Sheet not found: ${title}`);
        const width = Math.max(1, Number(properties.gridProperties && properties.gridProperties.columnCount) || 1);
        return getValues(`${title}!A:${columnName(width - 1)}`);
    }

    async function updateValues(range, values, options = {}) {
        const response = await sheets.spreadsheets.values.update({
            spreadsheetId,
            range,
            valueInputOption: options.raw ? 'RAW' : 'USER_ENTERED',
            requestBody: { values }
        });
        return response.data;
    }

    async function appendValues(range, values, options = {}) {
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range,
            valueInputOption: options.raw ? 'RAW' : 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values }
        });
        return response.data;
    }

    async function clearValues(range) {
        await sheets.spreadsheets.values.clear({ spreadsheetId, range, requestBody: {} });
    }

    async function formatHeader(title, width) {
        const properties = await sheetProperties(title);
        if (!properties) return;
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [
                    {
                        updateSheetProperties: {
                            properties: { sheetId: properties.sheetId, gridProperties: { frozenRowCount: 1 } },
                            fields: 'gridProperties.frozenRowCount'
                        }
                    },
                    {
                        repeatCell: {
                            range: { sheetId: properties.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: width },
                            cell: {
                                userEnteredFormat: {
                                    backgroundColor: { red: 0.0745, green: 0.3098, blue: 0.3608 },
                                    textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true }
                                }
                            },
                            fields: 'userEnteredFormat(backgroundColor,textFormat)'
                        }
                    }
                ]
            }
        });
    }

    async function replaceSheetValues(title, values) {
        if (!values.length || !values[0] || !values[0].length) throw new Error(`No values supplied for ${title}.`);
        const properties = await ensureSheet(title);
        const existingWidth = Math.max(1, Number(properties.gridProperties && properties.gridProperties.columnCount) || 1);
        const desiredWidth = values[0].length;
        if (desiredWidth > existingWidth) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        appendDimension: {
                            sheetId: properties.sheetId,
                            dimension: 'COLUMNS',
                            length: desiredWidth - existingWidth
                        }
                    }]
                }
            });
            metadataCache = null;
        }
        await clearValues(`${title}!A:${columnName(existingWidth - 1)}`);
        await updateValues(`${title}!A1:${columnName(desiredWidth - 1)}${values.length}`, values);
        await formatHeader(title, desiredWidth);
    }

    async function formatVenueRow(rowNumber, status, width) {
        const properties = await sheetProperties(MAIN_SHEET);
        if (!properties) return;
        let background = { red: 1, green: 1, blue: 1 };
        let foreground = { red: 0, green: 0, blue: 0 };
        if (status === 'Booked') {
            background = { red: 0.2196, green: 0.4627, blue: 0.1137 };
            foreground = { red: 1, green: 1, blue: 1 };
        } else if (/^Played in the Past/.test(status)) {
            background = { red: 0.851, green: 0.918, blue: 0.827 };
        } else if (status === 'Open Microphone') {
            background = { red: 1, green: 0.949, blue: 0.8 };
        } else if (status === 'Told No / Closed / No Music') {
            background = { red: 0.8, green: 0, blue: 0 };
            foreground = { red: 1, green: 1, blue: 1 };
        }
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    repeatCell: {
                        range: {
                            sheetId: properties.sheetId,
                            startRowIndex: rowNumber - 1,
                            endRowIndex: rowNumber,
                            startColumnIndex: 0,
                            endColumnIndex: width
                        },
                        cell: { userEnteredFormat: { backgroundColor: background, textFormat: { foregroundColor: foreground } } },
                        fields: 'userEnteredFormat(backgroundColor,textFormat.foregroundColor)'
                    }
                }]
            }
        });
    }

    async function deleteRow(title, rowNumber) {
        const properties = await sheetProperties(title);
        if (!properties) throw new Error(`Sheet not found: ${title}`);
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    deleteDimension: {
                        range: { sheetId: properties.sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber }
                    }
                }]
            }
        });
    }

    return {
        metadata,
        ensureSheet,
        getValues,
        getSheetValues,
        ensureColumns,
        updateValues,
        appendValues,
        clearValues,
        replaceSheetValues,
        formatVenueRow,
        deleteRow
    };
}

function createFirestoreIdempotencyStore({ firestore, Timestamp }) {
    const collection = firestore.collection('_jddmBridgeRequests');
    function reference(requestId) {
        const key = createHash('sha256').update(clean(requestId)).digest('hex');
        return collection.doc(key);
    }
    return {
        async acquire(requestId) {
            if (!clean(requestId)) return { state: 'acquired' };
            const ref = reference(requestId);
            return firestore.runTransaction(async transaction => {
                const snapshot = await transaction.get(ref);
                const now = Date.now();
                const data = snapshot.exists ? snapshot.data() : null;
                if (data && data.state === 'complete' && data.result) return { state: 'complete', result: data.result };
                if (data && data.state === 'processing' && Number(data.leaseExpiresAt || 0) > now) return { state: 'processing' };
                transaction.set(ref, {
                    requestId: clean(requestId),
                    state: 'processing',
                    leaseExpiresAt: now + 2 * 60 * 1000,
                    updatedAt: Timestamp.fromMillis(now)
                });
                return { state: 'acquired' };
            });
        },
        async complete(requestId, result) {
            if (!clean(requestId)) return;
            await reference(requestId).set({
                requestId: clean(requestId),
                state: 'complete',
                result,
                leaseExpiresAt: 0,
                updatedAt: Timestamp.fromMillis(Date.now())
            }, { merge: true });
        },
        async fail(requestId, message) {
            if (!clean(requestId)) return;
            await reference(requestId).set({
                state: 'failed',
                error: clean(message).slice(0, 500),
                leaseExpiresAt: 0,
                updatedAt: Timestamp.fromMillis(Date.now())
            }, { merge: true });
        }
    };
}

function createJddmSpreadsheetBridgeService({ gateway, idempotency = null, geocode = null, now = () => new Date(), notifier = null, calendarReview = null, websiteState = null }) {
    // Best-effort Discord notifications. These must never block or fail a sheet
    // write, so every call is awaited inside a try/catch that swallows errors.
    async function notifyNewPlace(venue) {
        if (!notifier || typeof notifier.newPlace !== 'function') return;
        try {
            await notifier.newPlace(venue);
        } catch (error) {
            console.error('[jddmBridge] new-place notification failed:', error && error.message ? error.message : error);
        }
    }
    async function notifyFollowUp(venue, followUpDate, previousDate = '') {
        if (!notifier || typeof notifier.followUp !== 'function') return;
        try {
            await notifier.followUp({ venue, date: calendarDate(followUpDate), previousDate: calendarDate(previousDate), addedAt: now() });
        } catch (error) {
            console.error('[jddmBridge] follow-up notification failed:', error && error.message ? error.message : error);
        }
    }

    async function loadMainData() {
        if (gateway.ensureColumns) await gateway.ensureColumns(MAIN_SHEET, CANONICAL_HEADERS.length);
        const values = await gateway.getValues(`${MAIN_SHEET}!A:${columnName(CANONICAL_HEADERS.length - 1)}`);
        const headers = padRow(values[0] || [], CANONICAL_HEADERS.length).map(clean);
        const headerMap = makeHeaderMap(headers);
        const rows = (values.slice(1) || []).map(source => {
            const row = padRow(source, headers.length);
            for (const header of ['Next Follow Up', 'Last Contacted']) {
                const index = headerMap.get(header);
                if (index !== undefined) row[index] = calendarDate(row[index]) || row[index];
            }
            return row;
        });
        return { headers, headerMap, rows };
    }

    function findRowById(data, id) {
        const target = clean(id);
        if (!target) return -1;
        const index = data.rows.findIndex(row => clean(getCell(row, data.headerMap, 'Place ID')) === target);
        return index < 0 ? -1 : index + 2;
    }

    function applyFields(row, headerMap, fields) {
        Object.entries(fields || {}).forEach(([header, rawValue]) => {
            const canonical = canonicalHeader(header);
            if (!canonical) return;
            let value = canonical === 'Status' ? normalizeStatus(rawValue) : rawValue;
            if (canonical === 'Next Follow Up' || canonical === 'Last Contacted') {
                value = calendarDate(rawValue);
                if (clean(rawValue) && !value) throw new Error(`${canonical} must be a valid calendar date.`);
            }
            if (canonical === 'Contact Details') return;
            if (canonical === 'Booking Contact' && String(rawValue).startsWith(contacts.PREFIX)) value = contacts.encode(contacts.tidy(contacts.decode(rawValue)));
            setCell(row, headerMap, canonical, value);
        });
        const supplied = Object.keys(fields || {}).find(header => canonicalHeader(header) === 'Contact Details');
        const current = getCell(row, headerMap, 'Booking Contact');
        if (supplied) {
            if (contacts.decode(current)) throw new Error('The contact editor has been updated. Refresh the map before saving so each person stays linked to their details.');
            const legacy = Object.fromEntries([...headerMap].map(([h,i])=>[h,row[i]]));
            legacy['Contact Details'] = JSON.stringify(contactDetails(fields[supplied]));
            const migrated = contacts.tidy(contacts.read(legacy));
            setCell(row, headerMap, 'Booking Contact', contacts.encode(migrated));
            Object.entries(contacts.summary(migrated)).forEach(([h,v])=>setCell(row,headerMap,h,v));
        } else if (Object.prototype.hasOwnProperty.call(fields || {}, 'Booking Contact') && contacts.decode(current)) {
            const parsed = contacts.decode(current);
            Object.entries(contacts.summary(parsed)).forEach(([h,v])=>setCell(row,headerMap,h,v));
        }
    }

    async function health() {
        const metadata = await gateway.metadata();
        const main = (metadata.sheets || []).map(item => item.properties).find(item => item.title === MAIN_SHEET);
        return {
            ...schemaPayload(),
            sheetName: MAIN_SHEET,
            spreadsheetName: metadata.properties && metadata.properties.title,
            capabilities: {
                firebaseHosted: true,
                artistTrackerReadWrite: true,
                reminderQueue: true,
                websiteGigReconciliation: true,
                reliableVenueWrites: true,
                guardedEndToEndCleanup: true,
                geocoding: Boolean(geocode)
            },
            sheetId: main ? main.sheetId : null
        };
    }

    async function csv() {
        const data = await loadMainData();
        return valuesToCsv([
            data.headers,
            ...data.rows.filter(row => !isBlankVenueRow(row, data.headerMap))
        ]);
    }

    async function getVenue(payload) {
        const data = await loadMainData();
        const rowNumber = findRowById(data, payload.id);
        if (rowNumber < 0) return { ok: false, code: 'NOT_FOUND', message: 'Venue was not found.' };
        const row = data.rows[rowNumber - 2];
        return { ok: true, action: 'getVenue', rowNumber, rawFields: rawFieldsFromRow(row, data.headerMap), venue: rowObject(row, data.headerMap) };
    }

    async function saveVenue(payload) {
        const data = await loadMainData();
        const rowNumber = findRowById(data, payload.id);
        if (rowNumber < 0) return { ok: false, code: 'NOT_FOUND', message: 'Venue was not found.' };
        const row = data.rows[rowNumber - 2].slice();
        const before = row.slice();
        applyFields(row, data.headerMap, payload.rawFields);
        applyFields(row, data.headerMap, payload.venue);
        if (payload.venue && payload.venue.contactStatus !== undefined) setCell(row, data.headerMap, 'Status', normalizeStatus(payload.venue.contactStatus));
        for (const [header, expected] of Object.entries(payload.expectedRawFields || {})) {
            const canonical = canonicalHeader(header), index = data.headerMap.get(canonical);
            if (index === undefined || !Object.keys(payload.rawFields || {}).some(h=>canonicalHeader(h) === canonical)) continue;
            const expectedValue = ['Next Follow Up','Last Contacted'].includes(canonical) ? calendarDate(expected) || expected : expected;
            if (String(before[index] ?? '') !== String(expectedValue ?? '') && row[index] !== before[index]) {
                return {ok:false,code:'VENUE_CONFLICT',message:'This venue changed in another window. Your draft has been kept. Use Reload Row to review the latest saved version before editing again.'};
            }
        }
        const changedIndexes = row.map((value, index) => value === before[index] ? -1 : index).filter(index => index >= 0);
        const groups = [];
        changedIndexes.forEach(index => {
            const last = groups[groups.length - 1];
            if (last && index === last.end + 1) last.end = index;
            else groups.push({ start: index, end: index });
        });
        for (const group of groups) {
            const range = `${MAIN_SHEET}!${columnName(group.start)}${rowNumber}:${columnName(group.end)}${rowNumber}`;
            await gateway.updateValues(range, [row.slice(group.start, group.end + 1)], { raw: true });
        }
        const statusIndex = data.headerMap.get('Status');
        if (statusIndex !== undefined && changedIndexes.includes(statusIndex)) {
            await gateway.formatVenueRow(rowNumber, clean(row[statusIndex]), data.headers.length);
        }
        const followUpIndex = data.headerMap.get('Next Follow Up');
        const followUpDate = clean(getCell(row, data.headerMap, 'Next Follow Up'));
        const previousDate = calendarDate(getCell(before, data.headerMap, 'Next Follow Up'));
        if (followUpIndex !== undefined && changedIndexes.includes(followUpIndex) && calendarDate(followUpDate) !== previousDate) {
            await notifyFollowUp(rowObject(row, data.headerMap), followUpDate, previousDate);
        }
        return {
            ok: true,
            action: 'saveVenue',
            requestId: clean(payload.requestId),
            rowNumber,
            changedHeaders: changedIndexes.map(index => data.headers[index]),
            venue: rowObject(row, data.headerMap),
            rawFields: rawFieldsFromRow(row, data.headerMap)
        };
    }

    async function createVenue(payload) {
        const requestId = clean(payload.requestId);
        if (idempotency && requestId) {
            const acquired = await idempotency.acquire(requestId);
            if (acquired.state === 'complete') return { ...acquired.result, replayed: true };
            if (acquired.state === 'processing') {
                return { ok: false, code: 'REQUEST_IN_PROGRESS', message: 'This place is already being added. Please wait a moment.', retryable: true };
            }
        }
        try {
            const data = await loadMainData();
            if (JSON.stringify(data.headers) !== JSON.stringify(CANONICAL_HEADERS)) {
                return { ok: false, code: 'SCHEMA_NOT_READY', message: 'The master sheet columns do not match the bridge schema.' };
            }
            const row = Array(data.headers.length).fill('');
            applyFields(row, data.headerMap, payload.rawFields);
            applyFields(row, data.headerMap, payload.venue);
            const name = clean(getCell(row, data.headerMap, 'Place Name'));
            if (!name) return { ok: false, code: 'PLACE_NAME_REQUIRED', message: 'Place Name is required.' };
            if (!clean(getCell(row, data.headerMap, 'Status'))) setCell(row, data.headerMap, 'Status', 'Needs Review');
            if (!clean(getCell(row, data.headerMap, 'State'))) setCell(row, data.headerMap, 'State', 'OH');
            const addressKey = normalizeKey([
                getCell(row, data.headerMap, 'Address'),
                getCell(row, data.headerMap, 'City'),
                getCell(row, data.headerMap, 'State')
            ].join(' '));
            const duplicateIndex = data.rows.findIndex(existing => {
                const existingName = normalizeKey(getCell(existing, data.headerMap, 'Place Name'));
                const existingAddress = normalizeKey([
                    getCell(existing, data.headerMap, 'Address'),
                    getCell(existing, data.headerMap, 'City'),
                    getCell(existing, data.headerMap, 'State')
                ].join(' '));
                return existingName === normalizeKey(name) && (!addressKey || existingAddress === addressKey);
            });
            if (duplicateIndex >= 0) {
                return { ok: false, code: 'DUPLICATE_VENUE', message: 'That place is already on the map.', rowNumber: duplicateIndex + 2 };
            }
            const baseId = clean(getCell(row, data.headerMap, 'Place ID')) || slugify([
                name,
                getCell(row, data.headerMap, 'City'),
                getCell(row, data.headerMap, 'State'),
                getCell(row, data.headerMap, 'Zip')
            ].filter(Boolean).join(' ')) || `venue-${now().getTime()}`;
            let id = baseId;
            let suffix = 2;
            while (findRowById(data, id) >= 0) {
                id = `${baseId}-${suffix}`;
                suffix += 1;
            }
            setCell(row, data.headerMap, 'Place ID', id);
            const hasCoordinates = clean(getCell(row, data.headerMap, 'Latitude')) && clean(getCell(row, data.headerMap, 'Longitude'));
            if (!hasCoordinates && geocode) {
                const query = [
                    getCell(row, data.headerMap, 'Address'),
                    getCell(row, data.headerMap, 'City'),
                    getCell(row, data.headerMap, 'State'),
                    getCell(row, data.headerMap, 'Zip')
                ].filter(Boolean).join(', ');
                if (query) {
                    try {
                        const location = await geocode(query);
                        if (location && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng))) {
                            setCell(row, data.headerMap, 'Latitude', Number(location.lat));
                            setCell(row, data.headerMap, 'Longitude', Number(location.lng));
                        }
                    } catch (_error) {
                        // The row remains valid for review even if the external geocoder is unavailable.
                    }
                }
            }
            const append = await gateway.appendValues(`${MAIN_SHEET}!A:${columnName(data.headers.length - 1)}`, [row], { raw: true });
            const updatedRange = append && append.updates ? clean(append.updates.updatedRange) : '';
            const rowMatch = updatedRange.match(/![A-Z]+(\d+):/i);
            const rowNumber = rowMatch ? Number(rowMatch[1]) : data.rows.length + 2;
            await gateway.formatVenueRow(rowNumber, clean(getCell(row, data.headerMap, 'Status')), data.headers.length);
            const result = {
                ok: true,
                action: 'createVenue',
                requestId,
                rowNumber,
                venue: rowObject(row, data.headerMap),
                rawFields: rawFieldsFromRow(row, data.headerMap),
                hasCoordinates: Boolean(clean(getCell(row, data.headerMap, 'Latitude')) && clean(getCell(row, data.headerMap, 'Longitude')))
            };
            if (idempotency && requestId) await idempotency.complete(requestId, result);
            await notifyNewPlace(result.venue);
            const createdFollowUp = clean(getCell(row, data.headerMap, 'Next Follow Up'));
            if (createdFollowUp) await notifyFollowUp(result.venue, createdFollowUp);
            return result;
        } catch (error) {
            if (idempotency && requestId) await idempotency.fail(requestId, error.message);
            throw error;
        }
    }

    async function setPlayed(payload) {
        const data = await loadMainData();
        const rowNumber = findRowById(data, payload.id);
        if (rowNumber < 0) return { ok: false, code: 'NOT_FOUND', message: 'Venue was not found.' };
        const statusIndex = data.headerMap.get('Status');
        if (statusIndex === undefined) return { ok: false, code: 'NO_STATUS_COLUMN', message: 'Status column is missing.' };
        const status = payload.played ? 'Played in the Past' : 'Needs Review';
        if (data.rows[rowNumber - 2][statusIndex] === status) {
            return { ok: true, action: 'setPlayed', rowNumber, played: Boolean(payload.played), status, changedHeaders: [] };
        }
        await gateway.updateValues(`${MAIN_SHEET}!${columnName(statusIndex)}${rowNumber}`, [[status]]);
        await gateway.formatVenueRow(rowNumber, status, data.headers.length);
        return { ok: true, action: 'setPlayed', rowNumber, played: Boolean(payload.played), status, changedHeaders: ['Status'] };
    }

    async function deleteTestVenue(payload) {
        const id = clean(payload.id);
        if (!id.startsWith('jddm-e2e-')) return { ok: false, code: 'TEST_VENUE_REQUIRED', message: 'Only guarded JDDM end-to-end test rows can be deleted.' };
        const data = await loadMainData();
        const rowNumber = findRowById(data, id);
        if (rowNumber < 0) return { ok: false, code: 'NOT_FOUND', message: 'Test venue was not found.' };
        const row = data.rows[rowNumber - 2];
        if (!clean(getCell(row, data.headerMap, 'Notes')).startsWith('[JDDM E2E TEST]')) {
            return { ok: false, code: 'TEST_MARKER_REQUIRED', message: 'The row is missing the protected end-to-end test marker.' };
        }
        await gateway.deleteRow(MAIN_SHEET, rowNumber);
        return { ok: true, action: 'deleteTestVenue', id, rowNumber };
    }

    async function ensureReminderSheet() {
        await gateway.ensureSheet(REMINDER_SHEET, REMINDER_HEADERS);
        const values = await gateway.getValues(`${REMINDER_SHEET}!A:F`);
        if (!values.length) await gateway.updateValues(`${REMINDER_SHEET}!A1:F1`, [REMINDER_HEADERS]);
        return values.length ? values : [REMINDER_HEADERS];
    }

    async function queueReminder(payload) {
        const reminderId = clean(payload.reminderId);
        const requestId = clean(payload.requestId);
        if (!REMINDER_IDS.has(reminderId)) return { ok: false, code: 'INVALID_REMINDER', message: 'That reminder is not allowed.' };
        if (!requestId || requestId.length > 160) return { ok: false, code: 'INVALID_REQUEST_ID', message: 'A stable reminder request ID is required.' };
        const values = await ensureReminderSheet();
        const rows = values.slice(1);
        const duplicateRequest = rows.find(row => clean(row[0]) === requestId);
        if (duplicateRequest) {
            return { ok: true, action: 'queueReminder', queued: false, duplicate: true, requestId, status: clean(duplicateRequest[3]) };
        }
        const pending = rows.slice().reverse().find(row => clean(row[2]) === reminderId && clean(row[3]) === 'pending');
        if (pending) {
            return { ok: true, action: 'queueReminder', queued: false, duplicate: true, requestId: clean(pending[0]), status: 'pending' };
        }
        await gateway.appendValues(`${REMINDER_SHEET}!A:F`, [[requestId, now().toISOString(), reminderId, 'pending', '', '']]);
        return { ok: true, action: 'queueReminder', queued: true, requestId, status: 'pending' };
    }

    async function getPendingReminders(payload) {
        const limit = Math.max(1, Math.min(Number(payload.limit || 20), 50));
        const values = await ensureReminderSheet();
        const reminders = values.slice(1)
            .filter(row => clean(row[3]) === 'pending')
            .slice(0, limit)
            .map(row => ({ requestId: clean(row[0]), requestedAt: clean(row[1]), reminderId: clean(row[2]) }));
        return { ok: true, action: 'getPendingReminders', reminders };
    }

    async function completeReminder(payload) {
        const requestId = clean(payload.requestId);
        const status = clean(payload.status).toLowerCase();
        if (!requestId || !['sent', 'failed'].includes(status)) {
            return { ok: false, code: 'INVALID_REMINDER_COMPLETION', message: 'Request ID and sent/failed status are required.' };
        }
        const values = await ensureReminderSheet();
        const index = values.slice(1).findIndex(row => clean(row[0]) === requestId);
        if (index < 0) return { ok: false, code: 'REMINDER_NOT_FOUND', message: 'Queued reminder was not found.' };
        const rowNumber = index + 2;
        await gateway.updateValues(`${REMINDER_SHEET}!D${rowNumber}:F${rowNumber}`, [[
            status,
            status === 'sent' ? now().toISOString() : '',
            clean(payload.result).slice(0, 500)
        ]]);
        return { ok: true, action: 'completeReminder', requestId, status };
    }

    async function syncWebsiteGigEvents(payload) {
        const sourceChecked = payload.sourceChecked === true || clean(payload.sourceChecked).toLowerCase() === 'true';
        if (!sourceChecked || !Array.isArray(payload.events)) {
            return {
                ok: false,
                code: 'UNCONFIRMED_WEBSITE_GIG_SOURCE',
                message: 'A successfully checked official website event list is required.'
            };
        }

        await gateway.ensureSheet(WEBSITE_GIG_SHEET, WEBSITE_GIG_HEADERS);
        const snapshotValues = await gateway.getValues(`${WEBSITE_GIG_SHEET}!A:G`);
        const previousEvents = snapshotValues.slice(1).map((row, index) => ({
            id: clean(row[0]) || `website-previous-${index}`,
            date: isoDate(row[1]),
            title: clean(row[2]),
            venueName: clean(row[3]),
            location: clean(row[4]),
            sourceUrl: clean(row[5])
        })).filter(event => event.date && event.venueName);
        const events = payload.events.map((event, index) => ({
            id: clean(event && (event.id || event.sourceRecordId)) || `website-${index}`,
            date: isoDate(event && (event.date || event.eventDate)),
            title: clean(event && event.title),
            venueName: clean(event && event.venueName),
            location: clean(event && (event.location || event.description)),
            sourceUrl: clean(event && event.sourceUrl)
        })).filter(event => event.date && event.venueName);

        const data = await loadMainData();
        const rawRows = data.rows.map(row => rowObject(row, data.headerMap));
        const {keyFor, matchEvent} = require('./calendarVenueMatching');
        async function resolve(sourceEvents, enqueue) {
            if (calendarReview) return calendarReview.resolve(sourceEvents, {enqueue});
            return {mappings:Object.fromEntries(sourceEvents.map(e => [keyFor(e), matchEvent(rawRows,e).venue?.['Place ID'] || '']))};
        }
        // Resolve before any sheet mutation. A review outage never becomes permission to add a row.
        const currentResolution = await resolve(events, true);
        const stored = websiteState ? await websiteState.load() : null;
        const previousResolution = stored ? null : await resolve(previousEvents, false);
        function groupDates(sourceEvents, resolution) {
            const groups = new Map();
            for (const event of sourceEvents) {
                const id = resolution.mappings[keyFor(event)];
                if (!id) continue;
                if (!groups.has(id)) groups.set(id,new Set());
                groups.get(id).add(event.date);
            }
            return groups;
        }
        const previousByVenue = stored ? new Map(Object.entries(stored).map(([id,dates])=>[id,new Set(dates)])) : groupDates(previousEvents, previousResolution);
        const currentByVenue = groupDates(events, currentResolution);
        const updatedRows = [];
        let preservedNonWebsiteDates = 0;
        const syncedAt = now().toISOString();

        for (let index = 0; index < data.rows.length; index += 1) {
            const row = data.rows[index];
            const venueKey = clean(getCell(row, data.headerMap, 'Place ID'));
            if (!venueKey || rawRows.filter(r=>r['Place ID']===venueKey).length!==1) continue;
            const previousDates = previousByVenue.get(venueKey) || new Set();
            const currentDates = currentByVenue.get(venueKey) || new Set();
            if (!previousDates.size && !currentDates.size) continue;

            const existingDates = new Set(gigDates(getCell(row, data.headerMap, 'Future Gigs')));
            const retainedDates = [...existingDates].filter(date => !previousDates.has(date));
            preservedNonWebsiteDates += retainedDates.length;
            const nextDates = [...new Set([...retainedDates, ...currentDates])].sort();
            const previousList = [...existingDates].sort();
            if (JSON.stringify(nextDates) === JSON.stringify(previousList)) continue;

            setCell(row, data.headerMap, 'Future Gigs', nextDates.join('; '));
            setCell(row, data.headerMap, 'Next Booked', nextDates[0] || '');
            setCell(row, data.headerMap, 'Future Gig Count', nextDates.length);
            const pastCount = Number(getCell(row, data.headerMap, 'Past Gig Count')) || gigDates(getCell(row, data.headerMap, 'Past Gigs')).length;
            setCell(row, data.headerMap, 'Total Gig Count', pastCount + nextDates.length);
            setCell(row, data.headerMap, 'Last Synced', syncedAt);
            const rowNumber = index + 2;
            const start = data.headerMap.get('Future Gigs');
            const end = data.headerMap.get('Last Synced');
            await gateway.updateValues(`${MAIN_SHEET}!${columnName(start)}${rowNumber}:${columnName(end)}${rowNumber}`, [row.slice(start, end + 1)]);
            updatedRows.push(clean(getCell(row, data.headerMap, 'Place Name')));
        }

        const addedRows = []; // Calendar imports never create venues; only an explicit review decision can.
        const pendingVenues = [...new Set(events.filter(e=>!currentResolution.mappings[keyFor(e)]).map(e=>e.venueName))];

        const websiteValues = [WEBSITE_GIG_HEADERS].concat(events.map(event => [
            event.id,
            event.date,
            event.title,
            event.venueName,
            event.location,
            event.sourceUrl,
            syncedAt
        ]));
        await gateway.replaceSheetValues(WEBSITE_GIG_SHEET, websiteValues);
        if (websiteState) await websiteState.save(Object.fromEntries([...currentByVenue].map(([id,dates])=>[id,[...dates]])));
        return {
            ok: true,
            action: 'syncWebsiteGigEvents',
            websiteEventCount: events.length,
            mapSync: {
                updatedRows,
                addedRows,
                pendingVenues,
                preservedNonWebsiteDates,
                calendarCoverageComplete: false,
                replaceFutureGigs: false
            },
            syncedAt
        };
    }

    function validateTrackerSheet(name) {
        const sheetName = clean(name);
        if (!ARTIST_TRACKER_SHEETS.includes(sheetName)) {
            const error = new Error('That tracker sheet is not allowed.');
            error.code = 'INVALID_ARTIST_TRACKER_SHEET';
            throw error;
        }
        return sheetName;
    }

    async function getArtistTrackerTable(payload) {
        const sheetName = validateTrackerSheet(payload.sheetName);
        const values = await gateway.getSheetValues(sheetName);
        if (!values.length) return { ok: false, code: 'MISSING_ARTIST_TRACKER_SHEET', message: `Tracker sheet does not exist: ${sheetName}` };
        return {
            ok: true,
            action: 'getArtistTrackerTable',
            sheetName,
            rowCount: Math.max(values.length - 1, 0),
            columnCount: values[0].length,
            csv: valuesToCsv(values)
        };
    }

    async function syncArtistTrackerTable(payload) {
        const sheetName = validateTrackerSheet(payload.sheetName);
        const values = payload.values || parseCsv(payload.csv);
        if (!values.length || !values[0] || !values[0].length) {
            return { ok: false, code: 'EMPTY_ARTIST_TRACKER_TABLE', message: 'A complete tracker CSV is required.' };
        }
        await gateway.replaceSheetValues(sheetName, values);
        return {
            ok: true,
            action: 'syncArtistTrackerTable',
            sheetName,
            rowCount: Math.max(values.length - 1, 0),
            columnCount: values[0].length,
            importedAt: now().toISOString()
        };
    }

    async function syncArtistTrackerTables(payload) {
        const tables = payload.tables || {};
        const prepared = ARTIST_TRACKER_SHEETS.map(sheetName => {
            const values = parseCsv(tables[sheetName]);
            if (!values.length || !values[0] || !values[0].length) {
                const error = new Error(`A complete CSV payload is required for tracker sheet ${sheetName}.`);
                error.code = 'INCOMPLETE_ARTIST_TRACKER_IMPORT';
                throw error;
            }
            return { sheetName, values };
        });
        const rowCounts = {};
        for (const item of prepared) {
            await gateway.replaceSheetValues(item.sheetName, item.values);
            rowCounts[item.sheetName] = Math.max(item.values.length - 1, 0);
        }
        return {
            ok: true,
            action: 'syncArtistTrackerTables',
            sheets: ARTIST_TRACKER_SHEETS.slice(),
            rowCounts,
            importedAt: now().toISOString()
        };
    }

    async function syncArtistSourceAudit(payload) {
        const sheetName = clean(payload.sheetName || 'Artist_Source_Audit');
        const values = payload.values || parseCsv(payload.csv);
        if (!values.length || !values[0] || !values[0].length) {
            return { ok: false, code: 'EMPTY_ARTIST_SOURCE_AUDIT', message: 'Artist source audit CSV or values are required.' };
        }
        await gateway.replaceSheetValues(sheetName, values);
        return { ok: true, action: 'syncArtistSourceAudit', sheetName, rowCount: Math.max(values.length - 1, 0), columnCount: values[0].length };
    }

    async function route(payload = {}) {
        const action = clean(payload.action || 'csv');
        if (action === 'health') return health();
        if (action === 'schema') return schemaPayload();
        if (action === 'csv') return { ok: true, action: 'csv', csv: await csv() };
        if (action === 'getVenue') return getVenue(payload);
        if (action === 'saveVenue') return saveVenue(payload);
        if (action === 'createVenue') return createVenue(payload);
        if (action === 'deleteTestVenue') return deleteTestVenue(payload);
        if (action === 'setPlayed') return setPlayed(payload);
        if (action === 'queueReminder') return queueReminder(payload);
        if (action === 'getPendingReminders') return getPendingReminders(payload);
        if (action === 'completeReminder') return completeReminder(payload);
        if (action === 'syncWebsiteGigEvents') return syncWebsiteGigEvents(payload);
        if (action === 'getArtistTrackerTable') return getArtistTrackerTable(payload);
        if (action === 'syncArtistTrackerTable') return syncArtistTrackerTable(payload);
        if (action === 'syncArtistTrackerTables') return syncArtistTrackerTables(payload);
        if (action === 'syncArtistSourceAudit') return syncArtistSourceAudit(payload);
        return { ok: false, code: 'UNKNOWN_ACTION', message: `Unknown action: ${action}` };
    }

    return { route };
}

function createJddmSpreadsheetBridgeHandler({ service, allowedOrigins = [], activity = null }) {
    const allowed = new Set(allowedOrigins);
    return async function jddmSpreadsheetBridgeHandler(req, res) {
        const origin = clean(req.get ? req.get('origin') : req.headers && req.headers.origin);
        if (origin && allowed.has(origin)) res.set('Access-Control-Allow-Origin', origin);
        res.set('Vary', 'Origin');
        res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-JDDM-Automation-Key');
        res.set('Cache-Control', 'no-store');
        if (req.method === 'OPTIONS') return res.status(204).send('');
        if (origin && !allowed.has(origin)) return res.status(403).json({ ok: false, code: 'ORIGIN_NOT_ALLOWED', message: 'This web origin is not allowed.' });
        let payload = {};
        try {
            payload = req.method === 'GET' ? { ...(req.query || {}) } : (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}));
        } catch (_error) {
            return res.status(400).json({ ok: false, code: 'BAD_JSON', message: 'Request JSON could not be read.' });
        }
        try {
            const result = await service.route(payload);
            if (activity) {
                try {
                    await activity.record({ method: req.method, origin, payload, result });
                } catch (error) {
                    // A saved spreadsheet change must not appear to fail because its activity log is unavailable.
                    console.error('[jddmAppActivity] Saved edit could not be counted', { action: payload.action, requestId: payload.requestId, message: error.message });
                    result.activityWarning = 'Your change was saved, but the activity counter could not be updated.';
                }
            }
            if (result && result.action === 'csv' && result.ok) {
                res.type('text/csv');
                return res.status(200).send(result.csv);
            }
            return res.status(result && result.ok === false ? 400 : 200).json(result);
        } catch (error) {
            console.error('[jddmSpreadsheetBridge] request failed', {
                action: clean(payload.action),
                code: error && error.code,
                message: error && error.message
            });
            return res.status(500).json({
                ok: false,
                code: error && error.code ? error.code : 'BRIDGE_ERROR',
                message: error && error.message ? error.message : 'The spreadsheet bridge failed.'
            });
        }
    };
}

module.exports = {
    ARTIST_TRACKER_SHEETS,
    CANONICAL_HEADERS,
    MAIN_SHEET,
    REMINDER_HEADERS,
    REMINDER_SHEET,
    SCHEMA_VERSION,
    SPREADSHEET_ID,
    WEBSITE_GIG_HEADERS,
    WEBSITE_GIG_SHEET,
    columnName,
    createFirestoreIdempotencyStore,
    createGoogleSheetsGateway,
    createJddmSpreadsheetBridgeHandler,
    createJddmSpreadsheetBridgeService,
    makeHeaderMap,
    normalizeStatus,
    parseCsv,
    schemaPayload,
    valuesToCsv
};
