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
    ID: ['id', 'venue id', 'venue_id', 'place id', 'Park ID'],
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
    EVENT_DATE: ['upcoming event date', 'event date', 'date'],
    EVENT_TIME: ['upcoming event time', 'event time', 'time'],
    PRIVATE_EVENT: ['private event', 'private event flag', 'private']
};

const DATA_CACHE_KEY = 'jddmVenueCSV';
const DATA_CACHE_TIME_KEY = 'jddmVenueCSV_time';

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
    const raw = cleanCSVValue(value).toLowerCase();
    if (!raw) return false;
    return ['true', 'yes', 'y', '1', 'private'].includes(raw);
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
        eventDate,
        eventTime,
        privateEvent,
        info: [notes, bookingContact ? `Booking/contact: ${bookingContact}` : ''].filter(Boolean).join('\n')
    };

    item.id = getVenueId(item, rowIndex);
    item.parkId = item.id;
    item.cost = '';
    item.pics = website;
    item.video = '';
    item.swagType = venueType;
    item.parkCategory = venueType;
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
                eventDate: item.eventDate,
                eventTime: item.eventTime,
                privateEvent: item.privateEvent,
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
    if (!options.cacheTime) return;
    localStorage.setItem(DATA_CACHE_KEY, csvString);
    localStorage.setItem(DATA_CACHE_TIME_KEY, String(options.cacheTime));
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

function pollForUpdates() {
    if (!navigator.onLine || pollInFlight) return Promise.resolve(false);

    try { window.BARK.incrementRequestCount(); }
    catch (e) { return Promise.reject(e); }

    pollInFlight = true;
    lastDataPollStartedAt = Date.now();

    const csvUrl = window.BARK.config && window.BARK.config.VENUE_CSV_URL
        ? window.BARK.config.VENUE_CSV_URL
        : 'assets/data/jddm-venues.csv';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const cacheBustSeparator = csvUrl.includes('?') ? '&' : '?';
    return fetch(`${csvUrl}${cacheBustSeparator}t=${Date.now()}&r=${Math.random()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' },
        signal: controller.signal
    })
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

async function runDataPollCycle() {
    if (window.ultraLowEnabled) {
        console.log("Ultra Low Mode: Background polling disabled.");
        return false;
    }

    try {
        await pollForUpdates();
        dataPollErrorCount = 0;
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
            console.warn('Data poll timed out after 6s; backing off...');
        } else {
            console.error("Data poll failed, backing off...", err);
        }
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

function loadData() {
    const cachedCsv = localStorage.getItem(DATA_CACHE_KEY);
    const cachedTime = localStorage.getItem(DATA_CACHE_TIME_KEY);

    if (cachedCsv) {
        lastDataHash = quickHash(cachedCsv);
        if (cachedTime) {
            rememberDataHash(lastDataHash, parseInt(cachedTime, 10));
        } else {
            rememberDataHash(lastDataHash, Date.now());
        }
        parseCSVString(cachedCsv);
    }

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

    runDataPollCycle();
}

window.BARK.loadData = loadData;
window.BARK.safeDataPoll = safeDataPoll;
window.BARK.clearMarkerLayersSafely = clearMarkerLayersSafely;

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
