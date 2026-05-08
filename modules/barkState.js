/**
 * barkState.js — Central State Store
 * Owns mutable runtime data state and the window.BARK namespace.
 * Persistent user settings are owned by state/settingsStore.js.
 * Loaded FIRST in the boot sequence.
 */
window.BARK = window.BARK || {};
window.BARK.bootOrder = window.BARK.bootOrder || {};
window.BARK.bootOrder.barkStateParsedAt = Date.now();

// ====== APP VERSION ======
let APP_VERSION = parseInt(localStorage.getItem('jddm_seen_version') || '12');
console.log(`Just Dee Dee Music Map v${APP_VERSION}: ready`);
window.BARK.APP_VERSION = APP_VERSION;
window.BARK.setAppVersion = function (v) { APP_VERSION = v; window.BARK.APP_VERSION = v; };

window.BARK.showTripToast = function showTripToast(message, options = {}) {
    const text = String(message || '').trim();
    if (!text) return;

    const doc = window.document;
    if (!doc || !doc.body) {
        console.info('[JDDM Notice]', text);
        return;
    }

    let toast = doc.getElementById('jddm-app-notice');
    if (!toast) {
        toast = doc.createElement('div');
        toast.id = 'jddm-app-notice';
        toast.className = 'trip-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        doc.body.appendChild(toast);
    }

    toast.textContent = text;
    toast.classList.add('show');

    clearTimeout(window.BARK._appNoticeTimer);
    const duration = Number.isFinite(Number(options.duration)) ? Number(options.duration) : 3200;
    window.BARK._appNoticeTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
};

// ====== SAFETY & COST CONTROLS ======
let globalRequestCounter = 0;
window.SESSION_MAX_REQUESTS = 2000;
window._SESSION_REQUEST_COUNT = 0;
window._cloudSettingsLoaded = false;

function incrementRequestCount() {
    globalRequestCounter++;
    window._SESSION_REQUEST_COUNT = globalRequestCounter;
    if (globalRequestCounter > window.SESSION_MAX_REQUESTS) {
        console.error(`CRITICAL: Session request limit reached (${globalRequestCounter}/${window.SESSION_MAX_REQUESTS}). Background sync disabled.`);
        throw new Error("Safety Shutdown: API limit reached for this session.");
    }
}
window.BARK.incrementRequestCount = incrementRequestCount;

// ====== CORE DATA STATE ======
let _searchResultCache = { query: '', matchedIds: null };
let activePinMarker = null;

function clearActivePin() {
    if (activePinMarker && activePinMarker._icon) {
        activePinMarker._icon.classList.remove('active-pin');
    }
    activePinMarker = null;
}

let activeSwagFilters = new Set();
let activeSearchQuery = '';
let activeTypeFilter = 'all';

let visitedFilterState = localStorage.getItem('barkVisitedFilter') || 'all';

// ====== TRIP PLANNER STATE ======
const DAY_COLORS = ['#1976D2', '#2E7D32', '#E65100', '#6A1B9A', '#C62828'];
let tripDays = [{ color: DAY_COLORS[0], stops: [], notes: "" }];
let activeDayIdx = 0;
window.tripStartNode = null;
window.tripEndNode = null;

// ====== UTILITY FUNCTIONS ======
if (
    typeof window.BARK.generatePinId !== 'function' ||
    typeof window.BARK.haversineDistance !== 'function' ||
    typeof window.BARK.sanitizeWalkPoints !== 'function'
) {
    throw new Error('geoUtils.js must load before barkState.js');
}

// ====== GAMIFICATION ENGINE INSTANCE ======
window.gamificationEngine = new GamificationEngine();
window.currentWalkPoints = window.currentWalkPoints || 0;
window._lastSyncedScore = window._lastSyncedScore || 0;

// ====== EXPOSE STATE TO BARK NAMESPACE ======
// Using property accessors so modules always get live references
Object.defineProperties(window.BARK, {
    _searchResultCache: { get() { return _searchResultCache; }, set(v) { _searchResultCache = v; } },
    activePinMarker:    { get() { return activePinMarker; },    set(v) { activePinMarker = v; } },
    activeSwagFilters:  { get() { return activeSwagFilters; },  set(v) { activeSwagFilters = v; } },
    activeSearchQuery:  { get() { return activeSearchQuery; },  set(v) { activeSearchQuery = v; } },
    activeTypeFilter:   { get() { return activeTypeFilter; },   set(v) { activeTypeFilter = v; } },
    visitedFilterState: { get() { return visitedFilterState; }, set(v) { visitedFilterState = v; } },
    tripDays:           { get() { return tripDays; },           set(v) { tripDays = v; } },
    activeDayIdx:       { get() { return activeDayIdx; },       set(v) { activeDayIdx = v; } },
});

window.BARK.DAY_COLORS = DAY_COLORS;
window.BARK.clearActivePin = clearActivePin;
window.BARK.__barkStateReady = true;
