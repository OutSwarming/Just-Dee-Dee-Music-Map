/**
 * dataService.js — CSV Fetching, Parsing, Data Polling
 * Firebase/Auth responsibilities live in /services as of Phase 3.
 */
window.BARK = window.BARK || {};
window.BARK.services = window.BARK.services || {};

// ====== CSV PARSING ENGINE ======
let isRendering = false;
let pendingCSV = null;
let pendingCSVOptions = null;

const CSV_COLUMNS = {
    ID: ['id', 'site id', 'Site ID', 'venue id', 'venue_id', 'place id', 'Park ID'],
    NAME: ['venue name', 'name', 'location', 'Location', 'park name'],
    ADDRESS: ['address', 'street address', 'venue address'],
    CITY: ['city', 'town'],
    STATE: ['state', 'State'],
    ZIP: ['zip', 'zipcode', 'zip code', 'postal code'],
    LAT: ['latitude', 'lat'],
    LNG: ['longitude', 'lng', 'lon', 'long'],
    VENUE_TYPE: ['venue type', 'category', 'type', 'Type'],
    WEBSITE: ['website/social link', 'website', 'social link', 'link', 'Website'],
    NOTES: ['notes', 'Useful/Important/Other Info', 'description'],
    BOOKING_CONTACT: ['booking/contact info', 'booking contact', 'contact', 'email', 'phone'],
    CONTACT_NAME: ['contactName', 'contact name', 'Contact Name'],
    CONTACT_EMAIL: ['contactEmail', 'contact email', 'Email/Contact', 'email'],
    CONTACT_PHONE: ['contactPhone', 'contact phone', 'Phone Number', 'phone'],
    FACEBOOK_URL: ['facebookUrl', 'facebook url', 'facebook'],
    INSTAGRAM_URL: ['instagramUrl', 'instagram url', 'instagram'],
    BOOKING_URL: ['bookingUrl', 'booking url', 'booking link'],
    PRIVATE_NOTES: ['privateNotes', 'private notes'],
    LAST_CONTACTED_DATE: ['lastContactedDate', 'last contacted date', 'Contacted'],
    NEXT_FOLLOW_UP_DATE: ['nextFollowUpDate', 'next follow up date', 'next follow-up date'],
    CONTACT_STATUS: ['contactStatus', 'contact status', 'Status'],
    DRAFT_STATUS: ['draftStatus', 'draft status'],
    PRIORITY: ['priority', 'Rank'],
    BEST_FIT_SCORE: ['bestFitScore', 'best fit score'],
    WEBSITE_BOOKING_EVENTS: ['websiteBookingEvents', 'website booking events', 'website event history'],
    PREFERRED_DAYS: ['preferredDays', 'preferred days', 'Days/Months'],
    GIG_HISTORY: ['gigHistory', 'gig history', '#Times'],
    DO_NOT_CONTACT: ['doNotContact', 'do not contact', 'DNC'],
    EVENT_DATE: ['upcoming event date', 'event date', 'date'],
    EVENT_TIME: ['upcoming event time', 'event time', 'time'],
    PRIVATE_EVENT: ['private event', 'private event flag', 'private'],
    PLAYED: ['played', 'Played', 'visited', 'Visited']
};

const DATA_CACHE_KEY = 'jddmVenueCSV';
const DATA_CACHE_TIME_KEY = 'jddmVenueCSV_time';
const DATA_CACHE_SOURCE_KEY = 'jddmVenueCSV_source';
const VENUE_DATA_SYNC_EVENT = 'jddm:venue-data-sync';
const PACKAGED_VENUE_CSV_URL = 'assets/data/jddm-venues.csv';

function cleanCSVValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value.trim();
    return value;
}

function getCSVValue(row, columnName) {
    if (!row) return '';
    if (Object.prototype.hasOwnProperty.call(row, columnName)) return cleanCSVValue(row[columnName]);

    const normalizedColumnName = cleanCSVValue(columnName).toLowerCase();
    const matchingKey = Object.keys(row).find(key => cleanCSVValue(key).toLowerCase() === normalizedColumnName);
    return matchingKey ? cleanCSVValue(row[matchingKey]) : '';
}

function getFirstPresentCSVValue(row, columnNames) {
    for (const columnName of columnNames) {
        if (row && Object.prototype.hasOwnProperty.call(row, columnName)) {
            return { found: true, value: cleanCSVValue(row[columnName]) };
        }
        const normalizedColumnName = cleanCSVValue(columnName).toLowerCase();
        const matchingKey = row && Object.keys(row).find(key => cleanCSVValue(key).toLowerCase() === normalizedColumnName);
        if (matchingKey) return { found: true, value: cleanCSVValue(row[matchingKey]) };
    }
    return { found: false, value: '' };
}

function getCSVValueFromAny(row, columnNames) {
    const match = getFirstPresentCSVValue(row, columnNames);
    return match.found ? match.value : '';
}

function normalizeVenueType(value) {
    return window.BARK.getParkCategory(value || 'Other Venue');
}

function normalizePrivateEvent(value) {
    const raw = String(cleanCSVValue(value)).toLowerCase();
    if (!raw) return false;
    return ['true', 'yes', 'y', '1', 'private'].includes(raw);
}

function normalizePlayed(value) {
    const raw = String(cleanCSVValue(value)).toLowerCase();
    if (!raw) return false;
    return ['true', 'yes', 'y', '1', 'played', 'visited'].includes(raw);
}

function slugifyId(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function getVenueId(item, rowIndex) {
    const explicitId = cleanCSVValue(item && item.id);
    if (explicitId) return String(explicitId);

    const parts = [item.name, item.city, item.state, item.zip].filter(Boolean).join(' ');
    const slug = slugifyId(parts);
    return slug || `venue-row-${rowIndex + 2}`;
}

function normalizeCSVRow(rawItem, rowIndex = 0) {
    const row = rawItem && typeof rawItem === 'object' ? rawItem : {};
    const venueType = normalizeVenueType(getCSVValueFromAny(row, CSV_COLUMNS.VENUE_TYPE));
    const notes = getCSVValueFromAny(row, CSV_COLUMNS.NOTES);
    const website = getCSVValueFromAny(row, CSV_COLUMNS.WEBSITE);
    const bookingContact = getCSVValueFromAny(row, CSV_COLUMNS.BOOKING_CONTACT);
    const eventDate = getCSVValueFromAny(row, CSV_COLUMNS.EVENT_DATE);
    const eventTime = getCSVValueFromAny(row, CSV_COLUMNS.EVENT_TIME);
    const privateEvent = normalizePrivateEvent(getCSVValueFromAny(row, CSV_COLUMNS.PRIVATE_EVENT));
    const played = normalizePlayed(getCSVValueFromAny(row, CSV_COLUMNS.PLAYED));
    const bookingSeed = {
        contactName: getCSVValueFromAny(row, CSV_COLUMNS.CONTACT_NAME),
        contactEmail: getCSVValueFromAny(row, CSV_COLUMNS.CONTACT_EMAIL),
        contactPhone: getCSVValueFromAny(row, CSV_COLUMNS.CONTACT_PHONE),
        facebookUrl: getCSVValueFromAny(row, CSV_COLUMNS.FACEBOOK_URL),
        instagramUrl: getCSVValueFromAny(row, CSV_COLUMNS.INSTAGRAM_URL),
        bookingUrl: getCSVValueFromAny(row, CSV_COLUMNS.BOOKING_URL),
        privateNotes: getCSVValueFromAny(row, CSV_COLUMNS.PRIVATE_NOTES),
        lastContactedDate: getCSVValueFromAny(row, CSV_COLUMNS.LAST_CONTACTED_DATE),
        nextFollowUpDate: getCSVValueFromAny(row, CSV_COLUMNS.NEXT_FOLLOW_UP_DATE),
        contactStatus: getCSVValueFromAny(row, CSV_COLUMNS.CONTACT_STATUS),
        draftStatus: getCSVValueFromAny(row, CSV_COLUMNS.DRAFT_STATUS),
        priority: getCSVValueFromAny(row, CSV_COLUMNS.PRIORITY),
        bestFitScore: getCSVValueFromAny(row, CSV_COLUMNS.BEST_FIT_SCORE),
        websiteBookingEvents: getCSVValueFromAny(row, CSV_COLUMNS.WEBSITE_BOOKING_EVENTS),
        preferredDays: getCSVValueFromAny(row, CSV_COLUMNS.PREFERRED_DAYS),
        gigHistory: getCSVValueFromAny(row, CSV_COLUMNS.GIG_HISTORY),
        doNotContact: getCSVValueFromAny(row, CSV_COLUMNS.DO_NOT_CONTACT)
    };

    const item = {
        id: getCSVValueFromAny(row, CSV_COLUMNS.ID),
        name: getCSVValueFromAny(row, CSV_COLUMNS.NAME),
        address: getCSVValueFromAny(row, CSV_COLUMNS.ADDRESS),
        city: getCSVValueFromAny(row, CSV_COLUMNS.CITY),
        state: getCSVValueFromAny(row, CSV_COLUMNS.STATE) || 'OH',
        zip: getCSVValueFromAny(row, CSV_COLUMNS.ZIP),
        lat: getCSVValueFromAny(row, CSV_COLUMNS.LAT),
        lng: getCSVValueFromAny(row, CSV_COLUMNS.LNG),
        venueType,
        category: venueType,
        website,
        notes,
        bookingContact,
        ...bookingSeed,
        eventDate,
        eventTime,
        privateEvent,
        played,
        visited: played,
        info: [notes, bookingContact ? `Booking/contact: ${bookingContact}` : ''].filter(Boolean).join('\n')
    };

    item.id = getVenueId(item, rowIndex);
    item.parkId = item.id;
    item.cost = '';
    item.pics = website;
    item.video = '';
    item.swagType = venueType;
    item.parkCategory = venueType;
    item.booking = window.BARK.bookingSchema && typeof window.BARK.bookingSchema.normalizeVenue === 'function'
        ? window.BARK.bookingSchema.normalizeVenue(item)
        : {};
    return item;
}

function isLegacyParkId(id) {
    return /^-?\d+\.\d{2}_-?\d+\.\d{2}$/.test(cleanCSVValue(id));
}

function isCanonicalParkId(id) {
    const value = cleanCSVValue(id);
    return Boolean(value && value.toLowerCase() !== 'unknown' && !isLegacyParkId(value));
}

function processParsedResults(results) {
    const newAllPoints = [];
    const seenVenueIds = new Set();
    let missingCoordinateCount = 0;
    let duplicateVenueIdCount = 0;

    results.data.forEach((rawItem, rowIndex) => {
        try {
            const item = normalizeCSVRow(rawItem, rowIndex);
            const name = item.name;
            const address = item.address;
            const city = item.city;
            const state = item.state;
            const category = item.category;
            const info = item.info;
            const website = item.website;
            const pics = item.pics;
            const video = item.video;
            let lat = item.lat;
            let lng = item.lng;

            if (!lat || !lng) {
                missingCoordinateCount++;
                return;
            }

            const id = item.id;
            if (!id || !isCanonicalParkId(id)) {
                missingCoordinateCount++;
                return;
            }
            if (seenVenueIds.has(id)) {
                duplicateVenueIdCount++;
                console.warn('[dataService] Skipped duplicate venue id row. Production data must have one row per venue id.', {
                    rowNumber: rowIndex + 2,
                    id,
                    name
                });
                return;
            }
            seenVenueIds.add(id);

            const venueType = item.venueType || category || 'Other Venue';
            const parkData = {
                id,
                name,
                address,
                city,
                state,
                zip: item.zip,
                cost: '',
                swagType: venueType,
                venueType,
                category: venueType,
                info,
                notes: item.notes,
                website,
                pics,
                video,
                bookingContact: item.bookingContact,
                contactName: item.booking.contactName || item.contactName,
                contactEmail: item.booking.contactEmail || item.contactEmail,
                contactPhone: item.booking.contactPhone || item.contactPhone,
                facebookUrl: item.booking.facebookUrl || item.facebookUrl,
                instagramUrl: item.booking.instagramUrl || item.instagramUrl,
                bookingUrl: item.booking.bookingUrl || item.bookingUrl,
                privateNotes: item.booking.privateNotes || item.privateNotes,
                lastContactedDate: item.booking.lastContactedDate || item.lastContactedDate,
                nextFollowUpDate: item.booking.nextFollowUpDate || item.nextFollowUpDate,
                contactStatus: item.booking.contactStatus || item.contactStatus,
                draftStatus: item.booking.draftStatus || item.draftStatus,
                priority: item.booking.priority,
                bestFitScore: item.booking.bestFitScore,
                websiteBookingEvents: item.booking.websiteBookingEvents || item.websiteBookingEvents,
                preferredDays: item.booking.preferredDays || item.preferredDays,
                gigHistory: item.booking.gigHistory || item.gigHistory,
                doNotContact: Boolean(item.booking.doNotContact),
                booking: item.booking,
                eventDate: item.eventDate,
                eventTime: item.eventTime,
                privateEvent: item.privateEvent,
                played: item.played,
                visited: item.played,
                lat,
                lng,
                parkCategory: venueType
            };

            // v25: Pre-Normalized Name
            parkData._cachedNormalizedName = window.BARK.normalizeText(name);

            newAllPoints.push(parkData);
        } catch (error) {
            console.error('[dataService] Failed to process CSV row; skipping row.', {
                rowNumber: rowIndex + 2,
                rawItem,
                error
            });
        }
    });

    if (missingCoordinateCount > 0) {
        console.warn(`[dataService] Skipped ${missingCoordinateCount} row(s) without usable venue coordinates or ids. Geocode missing lat/lng before publishing.`);
    }
    if (duplicateVenueIdCount > 0) {
        console.warn(`[dataService] Skipped ${duplicateVenueIdCount} duplicate venue id row(s). Check the sheet before publishing.`);
    }

    const parkRepo = window.BARK.repos && window.BARK.repos.ParkRepo;
    if (!parkRepo || typeof parkRepo.replaceAll !== 'function') {
        throw new Error('ParkRepo is required before dataService can publish park data.');
    }

    const replaceResult = parkRepo.replaceAll(newAllPoints, { debug: window.BARK.debugDataRefresh === true });
    if (!replaceResult.accepted) return false;

    // Hydrate canonical counts for gamification
    if (window.gamificationEngine && newAllPoints.length > 0) {
        window.gamificationEngine.updateCanonicalCountsFromPoints(newAllPoints);
    }

    const firebaseService = window.BARK.services && window.BARK.services.firebase;
    if (firebaseService && typeof firebaseService.normalizeLocalVisitedPlacesToCanonical === 'function') {
        firebaseService.normalizeLocalVisitedPlacesToCanonical({ writeBack: true })
            .catch(error => console.error('[dataService] visited-place canonicalization failed:', error));
    }

    window.syncState();
    return true;
}

function commitCSVCache(csvString, options = {}) {
    if (!options.cacheTime) return false;
    localStorage.setItem(DATA_CACHE_KEY, csvString);
    localStorage.setItem(DATA_CACHE_TIME_KEY, String(options.cacheTime));
    if (options.source) localStorage.setItem(DATA_CACHE_SOURCE_KEY, String(options.source));
    return true;
}

function getVenueDataSyncStatus() {
    const cachedCsv = localStorage.getItem(DATA_CACHE_KEY);
    const cachedTime = Number(localStorage.getItem(DATA_CACHE_TIME_KEY) || 0);
    const cachedSource = localStorage.getItem(DATA_CACHE_SOURCE_KEY);
    const cacheTime = Number.isFinite(cachedTime) && cachedTime > 0 ? cachedTime : null;
    return {
        hasCachedData: Boolean(cachedCsv),
        cacheTime,
        source: cachedSource || (window.JDDM_SPREADSHEET_API_URL ? 'Google Sheet' : 'Local CSV')
    };
}

function notifyVenueDataSync(detail = {}) {
    const status = {
        ...getVenueDataSyncStatus(),
        ...detail
    };

    if (typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
        window.dispatchEvent(new window.CustomEvent(VENUE_DATA_SYNC_EVENT, { detail: status }));
    }

    return status;
}

function parseCSVString(csvString, options = {}) {
    if (isRendering) {
        pendingCSV = csvString;
        pendingCSVOptions = options;
        return;
    }
    isRendering = true;
    Papa.parse(csvString, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: 'greedy',
        transformHeader: header => cleanCSVValue(header),
        transform: value => cleanCSVValue(value),
        complete: function (results) {
            if (results.errors && results.errors.length) {
                console.warn('[dataService] CSV parse completed with recoverable row issues:', results.errors);
            }
            const accepted = processParsedResults(results);
            if (accepted) {
                commitCSVCache(csvString, options);
                if (options.cacheTime) {
                    notifyVenueDataSync({
                        accepted: true,
                        source: options.source || getVenueDataSyncStatus().source
                    });
                }
                if (typeof options.onAccepted === 'function') options.onAccepted();
            } else if (typeof options.onRejected === 'function') {
                options.onRejected();
            }
            isRendering = false;
            if (pendingCSV) {
                const next = pendingCSV;
                const nextOptions = pendingCSVOptions || {};
                pendingCSV = null;
                pendingCSVOptions = null;
                parseCSVString(next, nextOptions);
            }
        },
        error: function (err) {
            console.error('Error parsing CSV data:', err);
            isRendering = false;
        }
    });
}

window.BARK.parseCSVString = parseCSVString;

// ====== DATA POLLING ======
function quickHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + ch;
        hash |= 0;
    }
    return hash;
}

let lastDataHash = null;
let pollInFlight = false;
let seenHashes = new Map();
const MAX_SEEN_DATA_HASHES = 64;
const DATA_POLL_INTERVAL_MS = 5 * 60 * 1000;
const DATA_POLL_RETRY_INTERVAL_MS = 10 * 60 * 1000;
const DATA_REFOCUS_MIN_INTERVAL_MS = 60 * 1000;
let dataPollTimer = null;
let dataPollLoopStarted = false;
let dataPollStopped = false;
let lastDataPollStartedAt = 0;
let dataSyncStatusTimers = [];
let dataSyncStatusInterval = null;

function clearDataSyncStatusTimers() {
    dataSyncStatusTimers.forEach(timerId => clearTimeout(timerId));
    dataSyncStatusTimers = [];
    if (dataSyncStatusInterval) {
        clearInterval(dataSyncStatusInterval);
        dataSyncStatusInterval = null;
    }
}

function getDataSyncStatusEl() {
    let el = document.getElementById('spreadsheet-sync-status');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'spreadsheet-sync-status';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = [
        'position:fixed',
        'left:50%',
        'bottom:96px',
        'transform:translateX(-50%)',
        'z-index:10050',
        'max-width:min(420px,calc(100vw - 32px))',
        'background:rgba(15,23,42,0.94)',
        'color:white',
        'border:1px solid rgba(255,255,255,0.16)',
        'border-radius:14px',
        'box-shadow:0 16px 40px rgba(15,23,42,0.28)',
        'padding:12px 16px',
        'font-size:13px',
        'font-weight:800',
        'line-height:1.35',
        'text-align:center',
        'display:none'
    ].join(';');
    document.body.appendChild(el);
    return el;
}

function setDataSyncStatus(message, tone = 'neutral') {
    const el = getDataSyncStatusEl();
    el.textContent = message;
    el.dataset.tone = tone;
    el.style.display = message ? 'block' : 'none';
    if (tone === 'success') el.style.background = 'rgba(22,101,52,0.94)';
    else if (tone === 'error') el.style.background = 'rgba(127,29,29,0.94)';
    else el.style.background = 'rgba(15,23,42,0.94)';
}

function startManualDataSyncStatus() {
    clearDataSyncStatusTimers();
    const startedAt = Date.now();
    let becameVisible = false;

    dataSyncStatusTimers.push(setTimeout(() => {
        becameVisible = true;
        setDataSyncStatus('Checking spreadsheet updates...', 'neutral');
    }, 900));

    dataSyncStatusTimers.push(setTimeout(() => {
        becameVisible = true;
        setDataSyncStatus('Updating map from Google Sheets. New rows may take a little while because Longitude, Latitude, and Site ID need to finish filling.', 'neutral');
        dataSyncStatusInterval = setInterval(() => {
            const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
            setDataSyncStatus(`Still checking spreadsheet updates... ${seconds}s. You can keep using the map while Google finishes the new row.`, 'neutral');
        }, 5000);
    }, 4200));

    return function finishManualDataSyncStatus({ ok = true } = {}) {
        clearDataSyncStatusTimers();
        if (!becameVisible) return;

        if (ok) {
            setDataSyncStatus('Map update check complete. If a brand-new row is still missing, wait for columns R, S, and T to fill, then check again.', 'success');
            dataSyncStatusTimers.push(setTimeout(() => setDataSyncStatus('', 'success'), 4200));
        } else {
            setDataSyncStatus('Spreadsheet update is still taking too long. The map is using cached data and will retry in the background.', 'error');
            dataSyncStatusTimers.push(setTimeout(() => setDataSyncStatus('', 'error'), 6200));
        }
    };
}

function pruneSeenHashes() {
    while (seenHashes.size > MAX_SEEN_DATA_HASHES) {
        const oldestHash = seenHashes.keys().next().value;
        if (oldestHash === lastDataHash && seenHashes.size > 1) {
            const currentHashTime = seenHashes.get(oldestHash);
            seenHashes.delete(oldestHash);
            seenHashes.set(oldestHash, currentHashTime);
            continue;
        }

        seenHashes.delete(oldestHash);
    }
}

function rememberDataHash(hash, revisionTime) {
    if (hash === null || hash === undefined) return;
    if (seenHashes.has(hash)) seenHashes.delete(hash);
    seenHashes.set(hash, revisionTime);
    pruneSeenHashes();
}

function getVenueCsvUrl(options = {}) {
    if (options.packagedFallback) return PACKAGED_VENUE_CSV_URL;

    const configuredCsvUrl = window.BARK.config && window.BARK.config.VENUE_CSV_URL
        ? window.BARK.config.VENUE_CSV_URL
        : PACKAGED_VENUE_CSV_URL;

    if (options.userInitiated && window.JDDM_SPREADSHEET_API_URL) {
        const apiUrl = String(window.JDDM_SPREADSHEET_API_URL);
        const separator = apiUrl.includes('?') ? '&' : '?';
        const autofillLimit = Math.max(1, Math.min(Number(options.autofillLimit || 25), 100));
        return `${apiUrl}${separator}action=csv&autofill=1&autofillLimit=${autofillLimit}`;
    }

    return configuredCsvUrl;
}

function loadPackagedVenueDataFallback(options = {}) {
    const fallbackUrl = getVenueCsvUrl({ packagedFallback: true });
    const requestUrl = `${fallbackUrl}${fallbackUrl.includes('?') ? '&' : '?'}fallback=${Date.now()}`;

    return fetch(requestUrl, { cache: 'no-store' })
        .then(res => {
            if (!res.ok) throw new Error('Packaged venue CSV unavailable');
            return res.text();
        })
        .then(csvString => {
            if (!csvString || csvString.trim().length < 10) return false;
            const fallbackHash = quickHash(csvString);
            rememberDataHash(fallbackHash, Date.now());
            parseCSVString(csvString, {
                cacheTime: Date.now(),
                source: options.source || 'Packaged CSV fallback',
                onAccepted: () => { lastDataHash = fallbackHash; }
            });
            return true;
        })
        .catch(error => {
            console.warn('[dataService] packaged venue CSV fallback failed:', error);
            return false;
        });
}

function pollForUpdates(options = {}) {
    if (!navigator.onLine || pollInFlight) return Promise.resolve(false);

    try { window.BARK.incrementRequestCount(); }
    catch (e) { return Promise.reject(e); }

    pollInFlight = true;
    lastDataPollStartedAt = Date.now();

    const csvUrl = getVenueCsvUrl(options);

    const controller = new AbortController();
    const timeoutMs = options.userInitiated ? 30000 : 6000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const cacheBustSeparator = csvUrl.includes('?') ? '&' : '?';
    const requestUrl = `${csvUrl}${cacheBustSeparator}t=${Date.now()}&r=${Math.random()}`;
    const fetchOptions = {
        cache: 'no-store',
        signal: controller.signal
    };

    // Google Apps Script web apps do not answer CORS preflight OPTIONS requests.
    // Keep cross-origin sheet polling as a simple GET; the cache-buster above is enough.
    if (!/^https?:\/\//i.test(csvUrl) || requestUrl.startsWith(window.location.origin)) {
        fetchOptions.headers = { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' };
    }

    return fetch(requestUrl, fetchOptions)
        .then(res => {
            if (!res.ok) throw new Error('Network response was not ok');
            return res.text().then(text => ({ newCsv: text, url: res.url }));
        })
        .then(({ newCsv, url }) => {
            if (!newCsv || newCsv.trim().length < 10) return false;
            const newHash = quickHash(newCsv);

            if (!seenHashes.has(newHash)) {
                let revisionTime = Date.now();
                const match = /\/([0-9]{13})\//.exec(url);
                if (match) revisionTime = parseInt(match[1], 10);
                rememberDataHash(newHash, revisionTime);
            }

            if (newHash !== lastDataHash) {
                const newHashTime = seenHashes.get(newHash);
                const currentHashTime = lastDataHash && seenHashes.has(lastDataHash) ? seenHashes.get(lastDataHash) : 0;

                if (lastDataHash !== null && newHashTime < currentHashTime) return false;

                parseCSVString(newCsv, {
                    cacheTime: newHashTime,
                    source: options.userInitiated ? 'Manual Refresh' : 'Background Refresh',
                    onAccepted: () => { lastDataHash = newHash; }
                });
            }
            return true;
        })
        .finally(() => {
            clearTimeout(timeoutId);
            pollInFlight = false;
        });
}

let dataPollErrorCount = 0;

function getPollInterval() {
    return dataPollErrorCount > 5 ? DATA_POLL_RETRY_INTERVAL_MS : DATA_POLL_INTERVAL_MS;
}

async function runDataPollCycle(options = {}) {
    if (window.ultraLowEnabled) {
        console.log("Ultra Low Mode: Background polling disabled.");
        return false;
    }

    const finishManualStatus = options.userInitiated ? startManualDataSyncStatus(options) : null;

    try {
        await pollForUpdates(options);
        dataPollErrorCount = 0;
        if (finishManualStatus) finishManualStatus({ ok: true });
        return true;
    } catch (err) {
        if (err.message && err.message.includes("Safety Shutdown")) {
            console.error("KILL SWITCH: Terminating Data Poll.");
            dataPollStopped = true;
            clearTimeout(dataPollTimer);
            dataPollTimer = null;
            return false;
        }
        dataPollErrorCount++;
        if (err.name === 'AbortError') {
            console.warn(`Data poll timed out after ${options.userInitiated ? 30 : 6}s; backing off...`);
        } else {
            console.error("Data poll failed, backing off...", err);
        }
        if (finishManualStatus) finishManualStatus({ ok: false });
        return false;
    }
}

function scheduleNextDataPoll(delay = getPollInterval()) {
    if (window.ultraLowEnabled || dataPollStopped) return;
    clearTimeout(dataPollTimer);
    dataPollTimer = setTimeout(runScheduledDataPoll, delay);
}

async function runScheduledDataPoll() {
    if (dataPollTimer) clearTimeout(dataPollTimer);
    dataPollTimer = null;
    await runDataPollCycle();
    scheduleNextDataPoll();
}

function bindDataPollVisibilityRefresh() {
    if (bindDataPollVisibilityRefresh.bound) return;
    bindDataPollVisibilityRefresh.bound = true;

    document.addEventListener('visibilitychange', () => {
        if (document.hidden || dataPollStopped || window.ultraLowEnabled) return;
        if (Date.now() - lastDataPollStartedAt < DATA_REFOCUS_MIN_INTERVAL_MS) return;
        runScheduledDataPoll();
    });
}

function safeDataPoll() {
    if (dataPollLoopStarted) return;
    dataPollLoopStarted = true;
    bindDataPollVisibilityRefresh();
    scheduleNextDataPoll();
}

function clearLayerSafely(layer, label) {
    if (!layer || typeof layer.clearLayers !== 'function') return false;

    try {
        layer.clearLayers();
        return true;
    } catch (error) {
        console.warn(`[dataService] failed to clear ${label}:`, error);
        return false;
    }
}

function clearMarkerLayersSafely() {
    const markerLayerCleared = clearLayerSafely(window.BARK.markerLayer, 'markerLayer');
    const clusterLayerCleared = clearLayerSafely(window.BARK.markerClusterGroup, 'markerClusterGroup');

    if ((markerLayerCleared || clusterLayerCleared) && window.BARK.markerManager && window.BARK.markerManager.markers instanceof Map) {
        window.BARK.markerManager.markers.clear();
    }

    if (markerLayerCleared || clusterLayerCleared) {
        window.BARK.activePinMarker = null;
    }
}

function loadData(options = {}) {
    const cachedCsv = localStorage.getItem(DATA_CACHE_KEY);
    const cachedTime = localStorage.getItem(DATA_CACHE_TIME_KEY);
    const shouldLoadPackagedFallback = !cachedCsv && !options.userInitiated && navigator.onLine;

    if (cachedCsv) {
        lastDataHash = quickHash(cachedCsv);
        const parsedCacheTime = cachedTime ? parseInt(cachedTime, 10) : Date.now();
        if (cachedTime) {
            rememberDataHash(lastDataHash, parsedCacheTime);
        } else {
            rememberDataHash(lastDataHash, parsedCacheTime);
        }
        parseCSVString(cachedCsv, {
            cacheTime: parsedCacheTime,
            source: 'Cache'
        });
    }

    const packagedFallbackPromise = shouldLoadPackagedFallback
        ? loadPackagedVenueDataFallback({ source: 'Packaged CSV fallback' })
        : Promise.resolve(false);

    safeDataPoll();

    if (!navigator.onLine) {
        const premiumService = window.BARK && window.BARK.services && window.BARK.services.premium;
        const isPremium = Boolean(
            premiumService &&
            typeof premiumService.isPremium === 'function' &&
            premiumService.isPremium()
        );
        if (!isPremium && !cachedCsv) {
            alert('Network disconnected. Cached venue data is unavailable on this device.');
            clearMarkerLayersSafely();
        }
        return;
    }

    return Promise.all([
        packagedFallbackPromise,
        runDataPollCycle(options)
    ]).then(([fallbackLoaded, liveLoaded]) => Boolean(liveLoaded || fallbackLoaded));
}

window.BARK.loadData = loadData;
window.BARK.refreshSpreadsheetMap = function refreshSpreadsheetMap() {
    return loadData({ userInitiated: true, autofillLimit: 25 });
};
window.BARK.VENUE_DATA_SYNC_EVENT = VENUE_DATA_SYNC_EVENT;
window.BARK.getVenueDataSyncStatus = getVenueDataSyncStatus;
window.BARK.safeDataPoll = safeDataPoll;
window.BARK.clearMarkerLayersSafely = clearMarkerLayersSafely;
window.BARK.isVenuePlayed = function (place) {
    return Boolean(place && normalizePlayed(place.played !== undefined ? place.played : place.visited));
};

// ====== VERSION CHECK ======
let pollErrorCount = 0;

async function safePoll() {
    if (document.hidden) {
        setTimeout(safePoll, 10000);
        return;
    }

    try {
        await checkForUpdates();
        pollErrorCount = 0;
    } catch (err) {
        if (err.message && err.message.includes("Safety Shutdown")) {
            console.error("KILL SWITCH: Terminating Version Poll.");
            return;
        }
        pollErrorCount++;
        console.error("Update check failed, backing off...", err);
    }

    const nextInterval = pollErrorCount > 5 ? 60000 : 30000;
    setTimeout(safePoll, nextInterval);
}

async function checkForUpdates() {
    if (!navigator.onLine || window.location.protocol === 'file:') return;

    window.BARK.incrementRequestCount();

    const res = await fetch('version.json?cache_bypass=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('version.json not found');

    const data = await res.json();
    const remoteVersion = parseInt(data.version);
    const seenVersion = parseInt(localStorage.getItem('jddm_seen_version') || '0');

    const versionLabel = document.getElementById('settings-app-version');
    if (versionLabel) versionLabel.textContent = remoteVersion;

    if (data.version && remoteVersion !== seenVersion) {
        const toast = document.getElementById('update-toast');
        if (toast) toast.classList.add('show');

        localStorage.setItem('jddm_seen_version', remoteVersion);
        window.BARK.setAppVersion(remoteVersion);
    }
}

window.BARK.safePoll = safePoll;
