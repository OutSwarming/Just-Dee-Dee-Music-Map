/**
 * bookingSchema.js - booking CRM field normalization and read-only dashboard rules.
 */
(function () {
    window.BARK = window.BARK || {};

    const CONTACT_STATUS = Object.freeze({
        NOT_CONTACTED: 'Not Contacted',
        DRAFT_READY: 'Draft Ready',
        SENT: 'Sent',
        FOLLOW_UP_NEEDED: 'Follow-Up Needed',
        INTERESTED: 'Interested',
        BOOKED: 'Booked',
        NO_RESPONSE: 'No Response',
        NOT_A_FIT: 'Not a Fit',
        DO_NOT_CONTACT: 'Do Not Contact'
    });

    const DRAFT_STATUS = Object.freeze({
        NO_DRAFT: 'No Draft',
        DRAFT_READY: 'Draft Ready',
        COPIED: 'Copied',
        OPENED_IN_GMAIL: 'Opened in Gmail',
        SENT: 'Sent',
        NEEDS_REVIEW: 'Needs Review'
    });

    const CONTACT_STATUS_VALUES = Object.freeze(Object.values(CONTACT_STATUS));
    const DRAFT_STATUS_VALUES = Object.freeze(Object.values(DRAFT_STATUS));

    function clean(value) {
        return String(value === undefined || value === null ? '' : value).trim();
    }

    function normalizeLoose(value) {
        return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function normalizeBoolean(value) {
        const raw = normalizeLoose(value);
        return ['1', 'true', 'yes', 'y', 'do not contact', 'dnc'].includes(raw);
    }

    function normalizeStatus(value, fallback) {
        const raw = normalizeLoose(value);
        if (!raw) return fallback;
        const match = CONTACT_STATUS_VALUES.find(status => normalizeLoose(status) === raw);
        return match || fallback;
    }

    function normalizeDraftStatus(value) {
        const raw = normalizeLoose(value);
        if (!raw) return DRAFT_STATUS.NO_DRAFT;
        return DRAFT_STATUS_VALUES.find(status => normalizeLoose(status) === raw) || DRAFT_STATUS.NO_DRAFT;
    }

    function extractEmail(value) {
        const match = clean(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        return match ? match[0] : '';
    }

    function extractPhone(value) {
        const match = clean(value).match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/);
        return match ? match[0].trim() : '';
    }

    function inferContactName(value) {
        const text = clean(value);
        if (!text) return '';
        const firstPart = text.split('|').map(clean).filter(Boolean)[0] || '';
        if (!firstPart || extractEmail(firstPart) || extractPhone(firstPart)) return '';
        if (normalizeLoose(firstPart).includes('website')) return '';
        return firstPart;
    }

    function parseLocalDate(value) {
        const text = clean(value);
        if (!text) return null;

        const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (iso) {
            const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
            return Number.isNaN(date.getTime()) ? null : date;
        }

        const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        if (slash) {
            const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
            const date = new Date(year, Number(slash[1]) - 1, Number(slash[2]));
            return Number.isNaN(date.getTime()) ? null : date;
        }

        const parsed = new Date(text);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function startOfToday() {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    function isDue(value) {
        const date = parseLocalDate(value);
        if (!date) return false;
        return date <= startOfToday();
    }

    function normalizeNumber(value, fallback = 0) {
        const numberValue = Number(clean(value));
        return Number.isFinite(numberValue) ? numberValue : fallback;
    }

    function normalizeVenue(venue = {}) {
        const bookingContact = clean(venue.bookingContact || venue.contact || venue.email || venue.phone);
        const explicitDnc = normalizeBoolean(venue.doNotContact);
        const rawStatus = clean(venue.contactStatus || venue.status);
        const fallbackStatus = venue.eventDate
            ? CONTACT_STATUS.BOOKED
            : CONTACT_STATUS.NOT_CONTACTED;
        const contactStatus = explicitDnc
            ? CONTACT_STATUS.DO_NOT_CONTACT
            : normalizeStatus(rawStatus, fallbackStatus);
        const doNotContact = explicitDnc || contactStatus === CONTACT_STATUS.DO_NOT_CONTACT;
        const contactEmail = clean(venue.contactEmail) || extractEmail(bookingContact);
        const contactPhone = clean(venue.contactPhone) || extractPhone(bookingContact);
        const contactName = clean(venue.contactName) || inferContactName(bookingContact);
        const bookingUrl = clean(venue.bookingUrl);
        const website = clean(venue.website);
        const nextFollowUpDate = clean(venue.nextFollowUpDate);

        return {
            contactName,
            contactEmail,
            contactPhone,
            facebookUrl: clean(venue.facebookUrl),
            instagramUrl: clean(venue.instagramUrl),
            bookingUrl,
            privateNotes: clean(venue.privateNotes),
            lastContactedDate: clean(venue.lastContactedDate),
            nextFollowUpDate,
            contactStatus,
            draftStatus: normalizeDraftStatus(venue.draftStatus),
            priority: normalizeNumber(venue.priority, 0),
            bestFitScore: normalizeNumber(venue.bestFitScore, 0),
            preferredDays: clean(venue.preferredDays),
            gigHistory: clean(venue.gigHistory),
            eventDate: clean(venue.eventDate),
            eventTime: clean(venue.eventTime),
            doNotContact,
            hasContactInfo: Boolean(contactEmail || bookingUrl || website || contactPhone),
            isFollowUpDue: !doNotContact && contactStatus !== CONTACT_STATUS.BOOKED && isDue(nextFollowUpDate),
            isNewProspect: !doNotContact && contactStatus === CONTACT_STATUS.NOT_CONTACTED && Boolean(contactEmail),
            isInterested: !doNotContact && contactStatus === CONTACT_STATUS.INTERESTED,
            isBooked: contactStatus === CONTACT_STATUS.BOOKED,
            isMissingInfo: !doNotContact && contactStatus !== CONTACT_STATUS.BOOKED && !contactEmail && !bookingUrl,
            isPrivateEvent: Boolean(venue.privateEvent || normalizeBoolean(venue.isPrivateEvent))
        };
    }

    function getDashboardGroups(venues = []) {
        const normalized = venues.map(venue => {
            const booking = venue.booking || normalizeVenue(venue);
            return { ...venue, booking };
        });

        const notDnc = normalized.filter(venue => !venue.booking.doNotContact);
        const followUps = notDnc.filter(venue => venue.booking.isFollowUpDue);
        const newProspects = notDnc.filter(venue => venue.booking.isNewProspect);
        const interested = notDnc.filter(venue => venue.booking.isInterested);
        const booked = normalized.filter(venue => venue.booking.isBooked);
        const missingInfo = notDnc.filter(venue => venue.booking.isMissingInfo);
        const doNotContact = normalized.filter(venue => venue.booking.doNotContact);
        const today = [
            ...followUps,
            ...interested.filter(venue => !followUps.includes(venue)),
            ...newProspects.filter(venue => !followUps.includes(venue)).slice(0, 20),
            ...missingInfo.filter(venue => !followUps.includes(venue)).slice(0, 10)
        ];

        return {
            today,
            followUps,
            newProspects,
            interested,
            booked,
            missingInfo,
            doNotContact,
            all: normalized
        };
    }

    window.BARK.bookingSchema = {
        CONTACT_STATUS,
        DRAFT_STATUS,
        normalizeVenue,
        getDashboardGroups,
        extractEmail,
        extractPhone,
        parseLocalDate,
        isDue
    };
})();
