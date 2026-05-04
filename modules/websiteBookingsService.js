/**
 * websiteBookingsService.js - staged Just Dee Dee website event feed.
 */
(function () {
    window.BARK = window.BARK || {};

    const WEBSITE_BOOKINGS_SYNC_EVENT = 'jddm:website-bookings-sync';
    const DEFAULT_FUTURE_URL = 'data/staged/jddm-website-bookings-future.json?v=1';
    const DEFAULT_HISTORY_URL = 'data/staged/jddm-website-booking-history.json?v=1';

    const state = {
        loading: false,
        loadedAt: null,
        error: null,
        events: []
    };

    function clean(value) {
        return String(value === undefined || value === null ? '' : value).trim();
    }

    function parseIsoDate(value) {
        const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }

    function getEventSortValue(event) {
        const date = parseIsoDate(event.eventDate);
        if (!date) return Number.MAX_SAFE_INTEGER;
        return date.getTime() + getTimeSortOffset(event.eventTime);
    }

    function getTimeSortOffset(value) {
        const match = clean(value).toLowerCase().match(/^(\d{1,2}):(\d{2})(am|pm)$/);
        if (!match) return 0;
        let hour = Number(match[1]);
        const minute = Number(match[2]);
        if (match[3] === 'pm' && hour !== 12) hour += 12;
        if (match[3] === 'am' && hour === 12) hour = 0;
        return ((hour * 60) + minute) * 60 * 1000;
    }

    function makeFallbackEventId(event, index, sourceType) {
        return [
            sourceType,
            event.eventDate,
            event.eventTime,
            event.venueName || event.title,
            index
        ]
            .filter(Boolean)
            .join('|')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function normalizeWebsiteBookingEvent(event = {}, index = 0, sourceType = 'website') {
        const id = clean(event.eventId) || makeFallbackEventId(event, index, sourceType);
        const sourceUrls = Array.isArray(event.sourceUrls)
            ? event.sourceUrls
            : [event.sourceUrl].filter(Boolean);
        const sourceCapturedAts = Array.isArray(event.sourceCapturedAts)
            ? event.sourceCapturedAts
            : [event.sourceCapturedAt || event.pulledAt].filter(Boolean);

        return {
            ...event,
            id,
            eventId: id,
            kind: 'websiteEvent',
            sourceType,
            title: clean(event.title),
            venueName: clean(event.venueName || event.title || 'Website Event'),
            venueType: clean(event.venueType || 'Other Venue'),
            eventDate: clean(event.eventDate),
            eventDay: clean(event.eventDay),
            eventTime: clean(event.eventTime),
            eventEndTime: clean(event.eventEndTime),
            location: clean(event.location),
            address: clean(event.address),
            city: clean(event.city),
            state: clean(event.state),
            zip: clean(event.zip),
            notes: clean(event.notes),
            isPrivateEvent: Boolean(event.isPrivateEvent),
            isPublicPlaceholder: Boolean(event.isPublicPlaceholder),
            sourceUrl: clean(event.sourceUrl || sourceUrls[0]),
            sourceUrls,
            sourceCapturedAts,
            sortValue: getEventSortValue(event)
        };
    }

    function normalizeWebsiteBookingPayload(payload = {}, sourceType = 'website') {
        const bookings = Array.isArray(payload.bookings) ? payload.bookings : [];
        const capturedAt = clean(payload.pulledAt || payload.generatedAt);
        return bookings.map((booking, index) => normalizeWebsiteBookingEvent({
            ...booking,
            sourceCapturedAt: booking.sourceCapturedAt || capturedAt
        }, index, sourceType));
    }

    function uniqueEvents(events) {
        const seen = new Map();
        events.forEach(event => {
            const key = [
                event.eventDate,
                event.eventTime,
                event.location || event.venueName || event.title
            ].join('|').toLowerCase();
            if (!seen.has(key)) {
                seen.set(key, event);
                return;
            }

            const existing = seen.get(key);
            existing.sourceUrls = [...new Set([...(existing.sourceUrls || []), ...(event.sourceUrls || [])])];
            existing.sourceCapturedAts = [...new Set([...(existing.sourceCapturedAts || []), ...(event.sourceCapturedAts || [])])];
            if (!existing.location && event.location) existing.location = event.location;
            if (existing.isPublicPlaceholder && !event.isPublicPlaceholder) {
                existing.title = event.title;
                existing.venueName = event.venueName;
                existing.venueType = event.venueType;
                existing.isPublicPlaceholder = false;
            }
        });
        return [...seen.values()];
    }

    function getWebsiteBookingGroups(events = state.events, options = {}) {
        const now = options.now ? new Date(options.now) : new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const all = uniqueEvents(Array.isArray(events) ? events : []);
        const upcoming = all
            .filter(event => {
                const date = parseIsoDate(event.eventDate);
                return date && date >= today;
            })
            .sort((a, b) => a.sortValue - b.sortValue);
        const past = all
            .filter(event => {
                const date = parseIsoDate(event.eventDate);
                return date && date < today;
            })
            .sort((a, b) => b.sortValue - a.sortValue);

        return {
            all,
            upcoming,
            past,
            loading: state.loading,
            loadedAt: state.loadedAt,
            error: state.error
        };
    }

    async function fetchPayload(url) {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
        return response.json();
    }

    async function loadWebsiteBookings(force = false) {
        if (!force && state.loadedAt && !state.loading) return getWebsiteBookingGroups();

        state.loading = true;
        state.error = null;
        dispatchSyncEvent();

        try {
            const [futurePayload, historyPayload] = await Promise.all([
                fetchPayload(window.JDDM_WEBSITE_BOOKINGS_FUTURE_URL || DEFAULT_FUTURE_URL),
                fetchPayload(window.JDDM_WEBSITE_BOOKINGS_HISTORY_URL || DEFAULT_HISTORY_URL)
            ]);
            state.events = [
                ...normalizeWebsiteBookingPayload(futurePayload, 'future'),
                ...normalizeWebsiteBookingPayload(historyPayload, 'history')
            ];
            state.loadedAt = new Date();
            state.error = null;
        } catch (error) {
            console.error('[websiteBookingsService] load failed:', error);
            state.error = error;
        } finally {
            state.loading = false;
            dispatchSyncEvent();
        }

        return getWebsiteBookingGroups();
    }

    function dispatchSyncEvent() {
        if (typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent(WEBSITE_BOOKINGS_SYNC_EVENT, {
                detail: getWebsiteBookingGroups()
            }));
        }
    }

    window.BARK.WEBSITE_BOOKINGS_SYNC_EVENT = WEBSITE_BOOKINGS_SYNC_EVENT;
    window.BARK.websiteBookings = {
        loadWebsiteBookings,
        getWebsiteBookingGroups,
        normalizeWebsiteBookingPayload,
        normalizeWebsiteBookingEvent,
        getState: () => ({ ...state })
    };
})();
