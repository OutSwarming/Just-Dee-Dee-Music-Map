/**
 * bookingAvailability.js - date availability helpers for Just Dee Dee Music.
 */
(function () {
    window.BARK = window.BARK || {};

    const DEFAULT_LOOKAHEAD_DAYS = 120;
    const DEFAULT_LIMIT = 24;

    function clean(value) {
        return String(value === undefined || value === null ? '' : value).trim();
    }

    function parseLocalDate(value) {
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return new Date(value.getFullYear(), value.getMonth(), value.getDate());
        }

        const text = clean(value);
        const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

        const parsed = new Date(text);
        if (Number.isNaN(parsed.getTime())) return null;
        return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    }

    function formatIsoDate(date) {
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
        ].join('-');
    }

    function addDays(date, days) {
        const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        next.setDate(next.getDate() + days);
        return next;
    }

    function formatDisplayDate(isoDate) {
        const date = parseLocalDate(isoDate);
        if (!date) return isoDate;
        return date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });
    }

    function isModeDate(date, mode) {
        const day = date.getDay();
        if (mode === 'weekdays') return day >= 1 && day <= 4;
        return day === 5 || day === 6 || day === 0;
    }

    function addBusyDate(busyDates, dateValue, reason) {
        const date = parseLocalDate(dateValue);
        if (!date) return;
        const iso = formatIsoDate(date);
        if (!busyDates.has(iso)) busyDates.set(iso, new Set());
        if (reason) busyDates.get(iso).add(reason);
    }

    function addBusyRange(busyDates, startValue, endValue, reason, isAllDay) {
        const start = parseLocalDate(startValue);
        if (!start) return;
        let end = parseLocalDate(endValue) || start;
        if (isAllDay && end > start) end = addDays(end, -1);
        if (end < start) end = start;

        for (let date = start; date <= end; date = addDays(date, 1)) {
            addBusyDate(busyDates, date, reason);
        }
    }

    function addDatesFromText(busyDates, text, reason) {
        clean(text).replace(/\b(\d{4}-\d{1,2}-\d{1,2})\b/g, (match) => {
            addBusyDate(busyDates, match, reason);
            return match;
        });
    }

    function getVenueBusyReason(venue) {
        const name = clean(venue && venue.name) || 'Booked gig';
        return `Booked: ${name}`;
    }

    function collectBusyDates(options = {}) {
        const busyDates = new Map();
        const venues = Array.isArray(options.venues) ? options.venues : [];
        const websiteEvents = Array.isArray(options.websiteEvents) ? options.websiteEvents : [];
        const calendarEvents = Array.isArray(options.calendarEvents) ? options.calendarEvents : [];
        const blockedEvents = Array.isArray(options.blockedEvents) ? options.blockedEvents : [];

        venues.forEach((venue) => {
            const booking = venue.booking || {};
            const reason = getVenueBusyReason(venue);
            if (Array.isArray(booking.calendarFutureGigDates)) {
                booking.calendarFutureGigDates.forEach(date => addBusyDate(busyDates, date, reason));
            }
            addBusyDate(busyDates, booking.eventDate, reason);
            addBusyDate(busyDates, booking.calendarNextGigDate, reason);
            addDatesFromText(busyDates, booking.calendarFutureGigEvents || venue.calendarFutureGigEvents, reason);
        });

        websiteEvents.forEach((event) => {
            addBusyRange(
                busyDates,
                event.eventDate,
                event.eventEndDate,
                `Website: ${clean(event.venueName || event.title) || 'calendar event'}`,
                Boolean(event.isAllDay)
            );
        });

        calendarEvents.forEach((event) => {
            addBusyRange(
                busyDates,
                event.eventDate,
                event.eventEndDate,
                `Calendar: ${clean(event.venueName || event.summary) || 'booked event'}`,
                Boolean(event.isAllDay)
            );
        });

        blockedEvents.forEach((event) => {
            addBusyRange(
                busyDates,
                event.eventDate,
                event.eventEndDate,
                `Blocked: ${clean(event.summary || event.venueName) || 'calendar hold'}`,
                Boolean(event.isAllDay)
            );
        });

        return busyDates;
    }

    function getAvailableDates(options = {}) {
        const mode = options.mode === 'weekdays' ? 'weekdays' : 'weekends';
        const start = parseLocalDate(options.startDate) || new Date();
        const lookaheadDays = Math.max(1, Number(options.lookaheadDays || DEFAULT_LOOKAHEAD_DAYS));
        const limit = Math.max(1, Number(options.limit || DEFAULT_LIMIT));
        const busyDates = collectBusyDates(options);
        const dates = [];

        for (let offset = 0; offset <= lookaheadDays && dates.length < limit; offset += 1) {
            const date = addDays(start, offset);
            if (!isModeDate(date, mode)) continue;

            const iso = formatIsoDate(date);
            if (busyDates.has(iso)) continue;
            dates.push({
                date: iso,
                label: formatDisplayDate(iso),
                mode
            });
        }

        return {
            mode,
            modeLabel: mode === 'weekdays' ? 'Weekdays' : 'Weekends',
            windowStartDate: formatIsoDate(start),
            windowEndDate: formatIsoDate(addDays(start, lookaheadDays)),
            busyCount: busyDates.size,
            dates
        };
    }

    window.BARK.bookingAvailability = {
        collectBusyDates,
        getAvailableDates,
        formatDisplayDate
    };
})();
