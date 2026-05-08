/**
 * bookingSchema.js - booking CRM field normalization and read-only dashboard rules.
 */
(function () {
    window.BARK = window.BARK || {};

    const CONTACT_STATUS = Object.freeze({
        NOT_CONTACTED: 'Not Contacted Yet',
        NEED_CONTACT_INFO: 'Need Contact Info',
        DRAFT_READY: 'Draft Ready',
        SENT: 'Sent',
        FOLLOW_UP_NEEDED: 'Follow Up Needed',
        WAITING_REPLY: 'Contacted - Waiting on Reply',
        INTERESTED: 'Interested',
        BOOKED: 'Booked',
        PLAYED_IN_THE_PAST: 'Played in the Past',
        PLAYED_IN_THE_PAST_AWAITING_REPLY: 'Played in the Past - Awaiting Reply',
        OPEN_MICROPHONE: 'Open Microphone',
        NO_RESPONSE: 'No Response',
        NOT_A_FIT: 'Not a Fit',
        DO_NOT_CONTACT: 'Do Not Contact',
        CLOSED_AND_NOT_BOOKING: 'Closed and Not Booking',
        NO_LIVE_MUSIC: 'No Live Music',
        VENUE_SAID_NO: 'Venue Said No to JDDM',
        NOT_INTERESTED_DO_NOT_CONTACT: 'Not Interested / Do Not Contact',
        BAD_FIT_TOO_FAR: 'Bad Fit / Too Far',
        CLOSED_NO_LONGER_OPERATING: 'Closed / No Longer Operating',
        DUPLICATE_MERGE_NEEDED: 'Duplicate / Merge Needed',
        NEEDS_REVIEW: 'Needs Review'
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
        if (raw === 'not contacted') return CONTACT_STATUS.NOT_CONTACTED;
        if (raw === 'open mic') return CONTACT_STATUS.OPEN_MICROPHONE;
        if (raw === 'played in the past awaiting reply' || raw === 'played in past awaiting reply') return CONTACT_STATUS.PLAYED_IN_THE_PAST_AWAITING_REPLY;
        if (raw === 'played in past' || raw === 'played past') return CONTACT_STATUS.PLAYED_IN_THE_PAST;
        if (raw === 'do not contact' || raw === 'dnc') return CONTACT_STATUS.NOT_INTERESTED_DO_NOT_CONTACT;
        if (raw === 'crm status') return fallback;
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

    function isBeforeToday(value) {
        const date = parseLocalDate(value);
        if (!date) return false;
        return date < startOfToday();
    }

    function isTodayOrFuture(value) {
        const date = parseLocalDate(value);
        if (!date) return false;
        return date >= startOfToday();
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

    function normalizeScore(value, fallback = 0) {
        const numberValue = normalizeNumber(value, fallback);
        return Math.max(0, Math.min(10, Math.round(numberValue)));
    }

    function compareVenuePriority(a, b) {
        const scoreA = (a.booking.priority * 10) + a.booking.bestFitScore;
        const scoreB = (b.booking.priority * 10) + b.booking.bestFitScore;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return clean(a.name).localeCompare(clean(b.name));
    }

    function getCoordinate(value) {
        const number = Number(clean(value));
        return Number.isFinite(number) ? number : null;
    }

    function getDistanceMiles(venue = {}, center = {}) {
        const lat = getCoordinate(venue.lat);
        const lng = getCoordinate(venue.lng);
        const centerLat = getCoordinate(center.lat ?? center.latitude ?? 41.35);
        const centerLng = getCoordinate(center.lng ?? center.longitude ?? -81.65);
        if (lat === null || lng === null || centerLat === null || centerLng === null) return Number.MAX_SAFE_INTEGER;

        const toRadians = value => value * Math.PI / 180;
        const earthMiles = 3958.8;
        const dLat = toRadians(centerLat - lat);
        const dLng = toRadians(centerLng - lng);
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(toRadians(lat)) * Math.cos(toRadians(centerLat)) * Math.sin(dLng / 2) ** 2;
        return earthMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function compareNewProspect(a, b, options = {}) {
        const distanceA = getDistanceMiles(a, options.center);
        const distanceB = getDistanceMiles(b, options.center);
        if (distanceA !== distanceB) return distanceA - distanceB;
        return compareVenuePriority(a, b);
    }

    function getRequiredContactMethod(contactType) {
        const words = normalizeLoose(contactType).split(/\s+/).filter(Boolean);
        if (words.some(word => word === 'email' || word === 'mail')) return 'email';
        if (words.some(word => ['phone', 'call', 'text', 'sms'].includes(word))) return 'phone';
        return '';
    }

    function getContactReviewReasons(venue = {}, booking = {}) {
        const reasons = [];
        const contactName = clean(booking.contactName || venue.contactName);
        const contactType = clean(booking.contactType || venue.contactType);
        const contactEmail = clean(booking.contactEmail || venue.contactEmail);
        const contactPhone = clean(booking.contactPhone || venue.contactPhone);
        const bookingUrl = clean(booking.bookingUrl || venue.bookingUrl);
        const website = clean(venue.website);
        const requiredMethod = getRequiredContactMethod(contactType);

        if (!contactName) reasons.push('Missing contact name');
        if (requiredMethod === 'email' && !extractEmail(contactEmail)) reasons.push('Contact type asks for email, but Email/Contact is missing');
        if (requiredMethod === 'phone' && !extractPhone(contactPhone)) reasons.push('Contact type asks for phone, but Phone Number is missing');
        if (!requiredMethod && !contactEmail && !contactPhone && !bookingUrl && !website) reasons.push('Missing usable contact path');
        return reasons;
    }

    function compareFollowUpDate(a, b) {
        const dateA = parseLocalDate(a.booking.nextFollowUpDate);
        const dateB = parseLocalDate(b.booking.nextFollowUpDate);
        const timeA = dateA ? dateA.getTime() : Number.MAX_SAFE_INTEGER;
        const timeB = dateB ? dateB.getTime() : Number.MAX_SAFE_INTEGER;
        if (timeA !== timeB) return timeA - timeB;
        return compareVenuePriority(a, b);
    }

    function compareEventDate(a, b) {
        const dateA = parseLocalDate(a.booking.eventDate);
        const dateB = parseLocalDate(b.booking.eventDate);
        const timeA = dateA ? dateA.getTime() : Number.MAX_SAFE_INTEGER;
        const timeB = dateB ? dateB.getTime() : Number.MAX_SAFE_INTEGER;
        if (timeA !== timeB) return timeA - timeB;
        return clean(a.name).localeCompare(clean(b.name));
    }

    function makeAgendaItem(venue, reason, suggestedAction, type, extra = {}) {
        return {
            venue,
            type,
            venueId: venue.id,
            venueName: venue.name || 'Unknown Venue',
            reason,
            suggestedAction,
            status: venue.booking.contactStatus,
            nextFollowUpDate: venue.booking.nextFollowUpDate,
            contactEmail: venue.booking.contactEmail,
            eventDate: venue.booking.eventDate,
            eventTime: venue.booking.eventTime,
            ...extra
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
            booking.contactType,
            booking.contactStatus,
            booking.draftStatus,
            booking.priority,
            booking.bestFitScore,
            booking.nextFollowUpDate,
            booking.eventDate,
            booking.eventTime
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
            ? CONTACT_STATUS.CLOSED_AND_NOT_BOOKING
            : normalizeStatus(rawStatus, fallbackStatus);
        const doNotContact = explicitDnc || contactStatus === CONTACT_STATUS.DO_NOT_CONTACT;
        const isClosedStatus = [
            CONTACT_STATUS.BOOKED,
            CONTACT_STATUS.PLAYED_IN_THE_PAST,
            CONTACT_STATUS.PLAYED_IN_THE_PAST_AWAITING_REPLY,
            CONTACT_STATUS.DO_NOT_CONTACT,
            CONTACT_STATUS.NOT_A_FIT,
            CONTACT_STATUS.CLOSED_AND_NOT_BOOKING,
            CONTACT_STATUS.NO_LIVE_MUSIC,
            CONTACT_STATUS.VENUE_SAID_NO,
            CONTACT_STATUS.NOT_INTERESTED_DO_NOT_CONTACT,
            CONTACT_STATUS.BAD_FIT_TOO_FAR,
            CONTACT_STATUS.CLOSED_NO_LONGER_OPERATING,
            CONTACT_STATUS.DUPLICATE_MERGE_NEEDED
        ].includes(contactStatus);
        const contactEmail = clean(venue.contactEmail) || extractEmail(bookingContact);
        const contactPhone = clean(venue.contactPhone) || extractPhone(bookingContact);
        const contactName = clean(venue.contactName) || inferContactName(bookingContact);
        const contactType = clean(venue.contactType);
        const bookingUrl = clean(venue.bookingUrl);
        const website = clean(venue.website);
        const nextFollowUpDate = clean(venue.nextFollowUpDate);
        const eventDate = clean(venue.eventDate);
        const priority = normalizeScore(venue.priority, 0);
        const bestFitScore = normalizeScore(venue.bestFitScore, 0);
        const isBooked = contactStatus === CONTACT_STATUS.BOOKED;
        const isPlayedPast = contactStatus === CONTACT_STATUS.PLAYED_IN_THE_PAST || contactStatus === CONTACT_STATUS.PLAYED_IN_THE_PAST_AWAITING_REPLY;
        const isPlayedPastAwaitingReply = contactStatus === CONTACT_STATUS.PLAYED_IN_THE_PAST_AWAITING_REPLY;
        const isOpenMicrophone = contactStatus === CONTACT_STATUS.OPEN_MICROPHONE;
        const isUpcomingGig = isBooked && isTodayOrFuture(eventDate);
        const isPostGigFollowUpDue = isBooked && isBeforeToday(eventDate) && (!nextFollowUpDate || isDue(nextFollowUpDate));
        const contactDraft = { contactName, contactEmail, contactPhone, contactType, bookingUrl };
        const contactReviewReasons = getContactReviewReasons(venue, contactDraft);
        const requiredContactMethod = getRequiredContactMethod(contactType);
        const hasRequiredContactInfo = requiredContactMethod === 'email'
            ? Boolean(extractEmail(contactEmail))
            : requiredContactMethod === 'phone'
                ? Boolean(extractPhone(contactPhone))
                : Boolean(contactEmail || bookingUrl || website || contactPhone);
        const isNeedsReview = contactStatus === CONTACT_STATUS.NEEDS_REVIEW;

        return {
            contactName,
            contactEmail,
            contactPhone,
            contactType,
            facebookUrl: clean(venue.facebookUrl),
            instagramUrl: clean(venue.instagramUrl),
            bookingUrl,
            privateNotes: clean(venue.privateNotes),
            lastContactedDate: clean(venue.lastContactedDate),
            nextFollowUpDate,
            contactStatus,
            draftStatus: normalizeDraftStatus(venue.draftStatus),
            priority,
            bestFitScore,
            websiteBookingEvents: clean(venue.websiteBookingEvents),
            calendarGigEvents: clean(venue.calendarGigEvents),
            calendarPastGigEvents: clean(venue.calendarPastGigEvents),
            calendarFutureGigEvents: clean(venue.calendarFutureGigEvents),
            calendarLastGigDate: clean(venue.calendarLastGigDate),
            calendarNextGigDate: clean(venue.calendarNextGigDate),
            calendarPastGigCount: normalizeNumber(venue.calendarPastGigCount, 0),
            calendarFutureGigCount: normalizeNumber(venue.calendarFutureGigCount, 0),
            calendarTotalGigsPlayed: normalizeNumber(venue.calendarTotalGigsPlayed, 0),
            calendarLastSyncedAt: clean(venue.calendarLastSyncedAt),
            preferredDays: clean(venue.preferredDays),
            gigHistory: clean(venue.gigHistory),
            contactAttempts: normalizeNumber(venue.contactAttempts, 0),
            eventDate,
            eventTime: clean(venue.eventTime),
            doNotContact,
            hasContactInfo: Boolean(contactEmail || bookingUrl || website || contactPhone),
            requiredContactMethod,
            hasRequiredContactInfo,
            contactReviewReasons,
            isNeedsReview,
            isFollowUpDue: !doNotContact && !isClosedStatus && isDue(nextFollowUpDate),
            isNewProspect: !doNotContact && contactStatus === CONTACT_STATUS.NOT_CONTACTED && hasRequiredContactInfo,
            isInterested: !doNotContact && contactStatus === CONTACT_STATUS.INTERESTED,
            isBooked,
            isPlayedPast,
            isPlayedPastAwaitingReply,
            isOpenMicrophone,
            isPlayedForMap: isBooked || isPlayedPast,
            isUpcomingGig,
            isPostGigFollowUpDue,
            isPriorityLead: !doNotContact && !isClosedStatus && (priority >= 7 || bestFitScore >= 8),
            isNotAFit: [
                CONTACT_STATUS.NOT_A_FIT,
                CONTACT_STATUS.CLOSED_AND_NOT_BOOKING,
                CONTACT_STATUS.NO_LIVE_MUSIC,
                CONTACT_STATUS.VENUE_SAID_NO,
                CONTACT_STATUS.NOT_INTERESTED_DO_NOT_CONTACT,
                CONTACT_STATUS.BAD_FIT_TOO_FAR,
                CONTACT_STATUS.CLOSED_NO_LONGER_OPERATING,
                CONTACT_STATUS.DUPLICATE_MERGE_NEEDED
            ].includes(contactStatus),
            isMissingInfo: !doNotContact && !isClosedStatus && (isNeedsReview || (contactStatus === CONTACT_STATUS.NOT_CONTACTED && !hasRequiredContactInfo)),
            isPrivateEvent: Boolean(venue.privateEvent || normalizeBoolean(venue.isPrivateEvent))
        };
    }

    function normalizeGmailSignal(signal = {}) {
        return {
            venueId: clean(signal.venueId || signal.id),
            from: clean(signal.from),
            subject: clean(signal.subject),
            receivedAt: clean(signal.receivedAt),
            snippet: clean(signal.snippet),
            contactEmail: clean(signal.contactEmail || signal.email)
        };
    }

    function indexGmailSignals(signals = []) {
        const byVenueId = new Map();
        const byEmail = new Map();

        signals.map(normalizeGmailSignal).forEach(signal => {
            if (!signal.venueId && !signal.contactEmail && !signal.from) return;
            if (signal.venueId && !byVenueId.has(signal.venueId)) byVenueId.set(signal.venueId, signal);
            const email = normalizeLoose(signal.contactEmail || extractEmail(signal.from));
            if (email && !byEmail.has(email)) byEmail.set(email, signal);
        });

        return { byVenueId, byEmail };
    }

    function getGmailSignalForVenue(venue, index) {
        if (!venue || !index) return null;
        if (venue.id && index.byVenueId.has(venue.id)) return index.byVenueId.get(venue.id);
        const email = normalizeLoose(venue.booking && venue.booking.contactEmail);
        return email ? index.byEmail.get(email) || null : null;
    }

    function isWaitingForReply(venue) {
        const status = venue.booking && venue.booking.contactStatus;
        return [
            CONTACT_STATUS.SENT,
            CONTACT_STATUS.FOLLOW_UP_NEEDED,
            CONTACT_STATUS.WAITING_REPLY,
            CONTACT_STATUS.NO_RESPONSE
        ].includes(status) && !clean(venue.booking.nextFollowUpDate);
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
        const planner = normalized
            .filter(venue => venue.booking.isOpenMicrophone || venue.booking.isPlayedPast)
            .sort((a, b) => clean(a.name).localeCompare(clean(b.name)));
        const upcomingGigs = booked.filter(venue => venue.booking.isUpcomingGig).sort(compareEventDate);
        const postGigFollowUps = booked.filter(venue => venue.booking.isPostGigFollowUpDue).sort(compareEventDate);
        const priorityLeads = notDnc.filter(venue => venue.booking.isPriorityLead).sort(compareVenuePriority);
        const notAFit = normalized.filter(venue => venue.booking.isNotAFit);
        const missingInfo = notDnc.filter(venue => venue.booking.isMissingInfo);
        const doNotContact = normalized.filter(venue => venue.booking.doNotContact);
        const today = [
            ...postGigFollowUps,
            ...followUps,
            ...interested.filter(venue => !followUps.includes(venue)),
            ...priorityLeads.filter(venue => !followUps.includes(venue) && !interested.includes(venue)).slice(0, 10),
            ...newProspects.filter(venue => !followUps.includes(venue)).slice(0, 20),
            ...missingInfo.filter(venue => !followUps.includes(venue)).slice(0, 10)
        ];
        const groups = {
            today,
            followUps,
            newProspects,
            interested,
            booked,
            planner,
            upcomingGigs,
            postGigFollowUps,
            priorityLeads,
            notAFit,
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
        const postGigFollowUps = [...(groups.postGigFollowUps || [])].sort(compareEventDate);
        const upcomingGigs = [...(groups.upcomingGigs || [])].sort(compareEventDate);
        const priorityLeads = [...(groups.priorityLeads || [])].sort(compareVenuePriority);
        const newProspects = [...(groups.newProspects || [])].sort(compareVenuePriority);
        const missingInfo = [...(groups.missingInfo || [])].sort(compareVenuePriority);

        add(
            postGigFollowUps,
            venue => `Booked gig needs thank-you${venue.booking.eventDate ? `: ${venue.booking.eventDate}` : ''}`,
            () => 'Send thank-you, then set rebooking follow-up',
            'postGigFollowUp'
        );
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
            upcomingGigs,
            venue => `Upcoming booked gig${venue.booking.eventDate ? `: ${venue.booking.eventDate}` : ''}`,
            () => 'Confirm details and prepare set',
            'upcomingGig'
        );
        add(
            priorityLeads,
            venue => `High-fit booking lead: priority ${venue.booking.priority}, fit ${venue.booking.bestFitScore}`,
            () => 'Choose next outreach action',
            'priorityLead'
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
        CONTACT_STATUS_VALUES,
        DRAFT_STATUS,
        DRAFT_STATUS_VALUES,
        normalizeVenue,
        getDashboardGroups,
        getDailyAgenda,
        filterVenues,
        extractEmail,
        extractPhone,
        parseLocalDate,
        normalizeScore,
        isBeforeToday,
        isTodayOrFuture,
        isDue
    };
})();
