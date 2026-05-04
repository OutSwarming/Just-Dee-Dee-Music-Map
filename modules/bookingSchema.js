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

    function normalizeSearch(value) {
        return normalizeLoose(value);
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

    function compareVenuePriority(a, b) {
        const scoreA = (a.booking.priority * 10) + a.booking.bestFitScore;
        const scoreB = (b.booking.priority * 10) + b.booking.bestFitScore;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return clean(a.name).localeCompare(clean(b.name));
    }

    function compareFollowUpDate(a, b) {
        const dateA = parseLocalDate(a.booking.nextFollowUpDate);
        const dateB = parseLocalDate(b.booking.nextFollowUpDate);
        const timeA = dateA ? dateA.getTime() : Number.MAX_SAFE_INTEGER;
        const timeB = dateB ? dateB.getTime() : Number.MAX_SAFE_INTEGER;
        if (timeA !== timeB) return timeA - timeB;
        return compareVenuePriority(a, b);
    }

    function makeAgendaItem(venue, reason, suggestedAction, type) {
        return {
            venue,
            type,
            venueId: venue.id,
            venueName: venue.name || 'Unknown Venue',
            reason,
            suggestedAction,
            status: venue.booking.contactStatus,
            nextFollowUpDate: venue.booking.nextFollowUpDate,
            contactEmail: venue.booking.contactEmail
        };
    }

    function getVenueSearchText(venue = {}) {
        const booking = venue.booking || normalizeVenue(venue);
        return normalizeSearch([
            venue.name,
            venue.address,
            venue.city,
            venue.state,
            venue.zip,
            venue.venueType,
            venue.category,
            venue.notes,
            venue.website,
            booking.contactName,
            booking.contactEmail,
            booking.contactPhone,
            booking.bookingUrl,
            booking.contactStatus,
            booking.draftStatus,
            booking.nextFollowUpDate
        ].filter(Boolean).join(' '));
    }

    function filterVenues(venues = [], query = '') {
        const normalizedQuery = normalizeSearch(query);
        if (!normalizedQuery) return venues;
        const terms = normalizedQuery.split(/\s+/).filter(Boolean);
        return venues.filter(venue => {
            const haystack = getVenueSearchText(venue);
            return terms.every(term => haystack.includes(term));
        });
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
        const groups = {
            today,
            followUps,
            newProspects,
            interested,
            booked,
            missingInfo,
            doNotContact,
            all: normalized
        };

        groups.dailyAgenda = buildDailyAgendaFromGroups(groups);
        return groups;
    }

    function buildDailyAgendaFromGroups(groups = {}, limit = 6) {
        const agenda = [];
        const seen = new Set();

        function add(venues, reason, suggestedAction, type) {
            (venues || []).forEach(venue => {
                if (!venue || !venue.id || seen.has(venue.id) || agenda.length >= limit) return;
                seen.add(venue.id);
                agenda.push(makeAgendaItem(venue, reason(venue), suggestedAction(venue), type));
            });
        }

        const followUps = [...(groups.followUps || [])].sort(compareFollowUpDate);
        const interestedDue = followUps.filter(venue => venue.booking.isInterested);
        const overdueFollowUps = followUps.filter(venue => !venue.booking.isInterested);
        const interested = [...(groups.interested || [])]
            .filter(venue => !seen.has(venue.id))
            .sort(compareFollowUpDate);
        const newProspects = [...(groups.newProspects || [])].sort(compareVenuePriority);
        const missingInfo = [...(groups.missingInfo || [])].sort(compareVenuePriority);

        add(
            interestedDue,
            venue => `Interested lead follow-up due${venue.booking.nextFollowUpDate ? `: ${venue.booking.nextFollowUpDate}` : ''}`,
            () => 'Send interested follow-up or mark booked',
            'interestedDue'
        );
        add(
            overdueFollowUps,
            venue => `Follow-up due${venue.booking.nextFollowUpDate ? `: ${venue.booking.nextFollowUpDate}` : ''}`,
            () => 'Send follow-up email',
            'followUpDue'
        );
        add(
            interested,
            () => 'Interested lead needs a next step',
            () => 'Set follow-up date or mark booked',
            'interested'
        );
        add(
            newProspects,
            () => 'New venue ready for first outreach',
            () => 'Copy first outreach email',
            'newProspect'
        );
        add(
            missingInfo,
            () => 'Missing email or booking link',
            () => 'Research contact info',
            'missingInfo'
        );

        return agenda;
    }

    function getDailyAgenda(venues = [], limit = 6) {
        return buildDailyAgendaFromGroups(getDashboardGroups(venues), limit);
    }

    window.BARK.bookingSchema = {
        CONTACT_STATUS,
        DRAFT_STATUS,
        normalizeVenue,
        getDashboardGroups,
        getDailyAgenda,
        filterVenues,
        extractEmail,
        extractPhone,
        parseLocalDate,
        isDue
    };
})();
