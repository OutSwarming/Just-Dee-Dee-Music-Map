/**
 * bookingActions.js - booking status transitions and spreadsheet save helpers.
 */
(function () {
    window.BARK = window.BARK || {};

    const ACTION_TYPES = Object.freeze({
        MARK_DRAFT_READY: 'markDraftReady',
        MARK_SENT: 'markSent',
        MARK_INTERESTED: 'markInterested',
        MARK_BOOKED: 'markBooked',
        MARK_NOT_A_FIT: 'markNotAFit',
        MARK_DO_NOT_CONTACT: 'markDoNotContact',
        SET_CONTACT_STATUS: 'setContactStatus',
        SET_FOLLOW_UP_DATE: 'setFollowUpDate',
        SET_PRIORITY_SCORE: 'setPriorityScore'
    });

    const ACTION_DEFINITIONS = Object.freeze([
        { type: ACTION_TYPES.MARK_DRAFT_READY, label: 'Draft Ready' },
        { type: ACTION_TYPES.MARK_SENT, label: 'Contacted' },
        { type: ACTION_TYPES.MARK_INTERESTED, label: 'Response' },
        { type: ACTION_TYPES.MARK_BOOKED, label: 'Booked' },
        { type: ACTION_TYPES.MARK_NOT_A_FIT, label: 'Told No / Closed', danger: true },
        { type: ACTION_TYPES.MARK_DO_NOT_CONTACT, label: 'Closed / No Music', danger: true }
    ]);

    function clean(value) {
        return String(value === undefined || value === null ? '' : value).trim();
    }

    function getSchema() {
        return window.BARK.bookingSchema;
    }

    function getSpreadsheetService() {
        return window.BARK.services && window.BARK.services.spreadsheet;
    }

    function toLocalDate(value) {
        const date = value instanceof Date ? value : new Date(value || Date.now());
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    function formatLocalDate(value = new Date()) {
        const date = toLocalDate(value);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${date.getFullYear()}-${month}-${day}`;
    }

    function addDays(value, days) {
        const date = toLocalDate(value);
        date.setDate(date.getDate() + Number(days || 0));
        return date;
    }

    function normalizeDateInput(value) {
        const text = clean(value);
        if (!text) throw new Error('Follow-up date is required.');
        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

        const date = new Date(text);
        if (Number.isNaN(date.getTime())) {
            throw new Error('Follow-up date is not valid.');
        }
        return formatLocalDate(date);
    }

    function normalizeScoreInput(value, label) {
        const text = clean(value);
        if (!text) return 0;
        const score = Number(text);
        if (!Number.isFinite(score)) throw new Error(`${label} must be a number from 0 to 10.`);
        if (score < 0 || score > 10) throw new Error(`${label} must be between 0 and 10.`);
        return Math.round(score);
    }

    function buildStatusPatch(actionType, options = {}) {
        const schema = getSchema();
        if (!schema || !schema.CONTACT_STATUS || !schema.DRAFT_STATUS) {
            throw new Error('Booking schema is not loaded.');
        }

        const todayDate = toLocalDate(options.today || new Date());
        const today = formatLocalDate(todayDate);
        const statuses = schema.CONTACT_STATUS;
        const draftStatuses = schema.DRAFT_STATUS;

        if (actionType === ACTION_TYPES.MARK_DRAFT_READY) {
            return {
                contactStatus: statuses.DRAFT_READY,
                draftStatus: draftStatuses.DRAFT_READY,
                doNotContact: false
            };
        }

        if (actionType === ACTION_TYPES.MARK_SENT) {
            return {
                contactStatus: statuses.WAITING_REPLY,
                draftStatus: draftStatuses.SENT,
                lastContactedDate: today,
                nextFollowUpDate: formatLocalDate(addDays(todayDate, 7)),
                doNotContact: false
            };
        }

        if (actionType === ACTION_TYPES.MARK_INTERESTED) {
            return {
                contactStatus: statuses.RESPONDED_NEEDS_ACTION,
                nextFollowUpDate: formatLocalDate(addDays(todayDate, 2)),
                doNotContact: false
            };
        }

        if (actionType === ACTION_TYPES.MARK_BOOKED) {
            return {
                contactStatus: statuses.BOOKED,
                nextFollowUpDate: '',
                doNotContact: false
            };
        }

        if (actionType === ACTION_TYPES.MARK_NOT_A_FIT) {
            return {
                contactStatus: statuses.TOLD_NO_CLOSED_NO_MUSIC,
                nextFollowUpDate: '',
                doNotContact: true
            };
        }

        if (actionType === ACTION_TYPES.MARK_DO_NOT_CONTACT) {
            return {
                contactStatus: statuses.TOLD_NO_CLOSED_NO_MUSIC,
                nextFollowUpDate: '',
                doNotContact: true
            };
        }

        throw new Error(`Unknown booking action: ${actionType}`);
    }

    function buildFollowUpDatePatch(nextFollowUpDate) {
        return {
            nextFollowUpDate: normalizeDateInput(nextFollowUpDate)
        };
    }

    function normalizeContactStatusInput(value) {
        const text = clean(value);
        const schema = getSchema();
        const values = schema && Array.isArray(schema.CONTACT_STATUS_VALUES)
            ? schema.CONTACT_STATUS_VALUES
            : [];
        if (!text) throw new Error('Status is required.');
        const match = values.find(status => clean(status).toLowerCase() === text.toLowerCase());
        return match || text;
    }

    function buildContactStatusPatch(contactStatus) {
        const status = normalizeContactStatusInput(contactStatus);
        const schema = getSchema();
        const statuses = schema && schema.CONTACT_STATUS ? schema.CONTACT_STATUS : {};
        const draftStatuses = schema && schema.DRAFT_STATUS ? schema.DRAFT_STATUS : {};
        const patch = {
            contactStatus: status,
            doNotContact: status === statuses.TOLD_NO_CLOSED_NO_MUSIC
        };

        if (status === statuses.DRAFT_READY && draftStatuses.DRAFT_READY) {
            patch.draftStatus = draftStatuses.DRAFT_READY;
        }

        return patch;
    }

    function buildPriorityScorePatch(priority, bestFitScore) {
        return {
            priority: normalizeScoreInput(priority, 'Priority'),
            bestFitScore: normalizeScoreInput(bestFitScore, 'Best fit score')
        };
    }

    function buildRawFieldsPatch(patch = {}) {
        const rawFields = {};

        if (Object.prototype.hasOwnProperty.call(patch, 'contactStatus')) {
            rawFields.Status = clean(patch.contactStatus);
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'lastContactedDate')) {
            rawFields['Last Contacted'] = clean(patch.lastContactedDate);
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'nextFollowUpDate')) {
            rawFields['Next Follow Up'] = clean(patch.nextFollowUpDate);
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'priority')) {
            rawFields.Priority = clean(patch.priority);
        }

        return rawFields;
    }

    function mergeBookingPatch(venue = {}, patch = {}) {
        const schema = getSchema();
        const seed = {
            ...venue,
            ...(venue.booking || {}),
            ...patch
        };
        const booking = schema && typeof schema.normalizeVenue === 'function'
            ? schema.normalizeVenue(seed)
            : { ...(venue.booking || {}), ...patch };

        return {
            ...venue,
            contactStatus: booking.contactStatus || patch.contactStatus || venue.contactStatus,
            draftStatus: booking.draftStatus || patch.draftStatus || venue.draftStatus,
            lastContactedDate: booking.lastContactedDate,
            nextFollowUpDate: booking.nextFollowUpDate,
            priority: booking.priority,
            bestFitScore: booking.bestFitScore,
            doNotContact: Boolean(booking.doNotContact),
            booking
        };
    }

    function applyLocalStatus(venueId, patch) {
        const repo = window.BARK.repos && window.BARK.repos.ParkRepo;
        if (!repo || typeof repo.getAll !== 'function' || typeof repo.replaceAll !== 'function') return false;

        const points = repo.getAll();
        let changed = false;
        const nextPoints = points.map(point => {
            if (!point || point.id !== venueId) return point;
            changed = true;
            return mergeBookingPatch(point, patch);
        });

        if (!changed) return false;
        repo.replaceAll(nextPoints, { debug: true });
        if (typeof window.syncState === 'function') window.syncState();
        return true;
    }

    function buildStatusSavePayload(venue, actionType, options = {}) {
        const patch = buildStatusPatch(actionType, options);
        return {
            id: venue && venue.id,
            actionType,
            patch,
            rawFields: buildRawFieldsPatch(patch)
        };
    }

    function buildFollowUpDateSavePayload(venue, nextFollowUpDate) {
        const patch = buildFollowUpDatePatch(nextFollowUpDate);
        return {
            id: venue && venue.id,
            actionType: ACTION_TYPES.SET_FOLLOW_UP_DATE,
            patch,
            rawFields: buildRawFieldsPatch(patch)
        };
    }

    function buildContactStatusSavePayload(venue, contactStatus) {
        const patch = buildContactStatusPatch(contactStatus);
        return {
            id: venue && venue.id,
            actionType: ACTION_TYPES.SET_CONTACT_STATUS,
            patch,
            rawFields: buildRawFieldsPatch(patch)
        };
    }

    function buildPriorityScoreSavePayload(venue, priority, bestFitScore) {
        const patch = buildPriorityScorePatch(priority, bestFitScore);
        return {
            id: venue && venue.id,
            actionType: ACTION_TYPES.SET_PRIORITY_SCORE,
            patch,
            rawFields: buildRawFieldsPatch(patch)
        };
    }

    async function saveStatus(venue, actionType, options = {}) {
        if (!venue || !venue.id) throw new Error('Venue id is required before saving status.');

        const payload = buildStatusSavePayload(venue, actionType, options);
        const service = options.spreadsheetService || getSpreadsheetService();
        if (!service || typeof service.saveVenue !== 'function' || (typeof service.isConfigured === 'function' && !service.isConfigured())) {
            const error = new Error('Spreadsheet bridge is not configured yet.');
            error.code = 'SPREADSHEET_BRIDGE_NOT_CONFIGURED';
            throw error;
        }

        const result = await service.saveVenue({
            id: venue.id,
            rawFields: payload.rawFields
        });

        if (result && result.csv && typeof window.BARK.parseCSVString === 'function') {
            window.BARK.parseCSVString(result.csv, { cacheTime: Date.now(), source: 'Spreadsheet Save' });
        } else {
            applyLocalStatus(venue.id, payload.patch);
        }

        return {
            ...payload,
            result
        };
    }

    async function saveFollowUpDate(venue, nextFollowUpDate, options = {}) {
        if (!venue || !venue.id) throw new Error('Venue id is required before saving follow-up date.');

        const payload = buildFollowUpDateSavePayload(venue, nextFollowUpDate);
        const service = options.spreadsheetService || getSpreadsheetService();
        if (!service || typeof service.saveVenue !== 'function' || (typeof service.isConfigured === 'function' && !service.isConfigured())) {
            const error = new Error('Spreadsheet bridge is not configured yet.');
            error.code = 'SPREADSHEET_BRIDGE_NOT_CONFIGURED';
            throw error;
        }

        const result = await service.saveVenue({
            id: venue.id,
            rawFields: payload.rawFields
        });

        if (result && result.csv && typeof window.BARK.parseCSVString === 'function') {
            window.BARK.parseCSVString(result.csv, { cacheTime: Date.now(), source: 'Spreadsheet Save' });
        } else {
            applyLocalStatus(venue.id, payload.patch);
        }

        return {
            ...payload,
            result
        };
    }

    async function saveContactStatus(venue, contactStatus, options = {}) {
        if (!venue || !venue.id) throw new Error('Venue id is required before saving status.');

        const payload = buildContactStatusSavePayload(venue, contactStatus);
        const service = options.spreadsheetService || getSpreadsheetService();
        if (!service || typeof service.saveVenue !== 'function' || (typeof service.isConfigured === 'function' && !service.isConfigured())) {
            const error = new Error('Spreadsheet bridge is not configured yet.');
            error.code = 'SPREADSHEET_BRIDGE_NOT_CONFIGURED';
            throw error;
        }

        const result = await service.saveVenue({
            id: venue.id,
            rawFields: payload.rawFields
        });

        if (result && result.csv && typeof window.BARK.parseCSVString === 'function') {
            window.BARK.parseCSVString(result.csv, { cacheTime: Date.now(), source: 'Spreadsheet Save' });
        } else {
            applyLocalStatus(venue.id, payload.patch);
        }

        return {
            ...payload,
            result
        };
    }

    async function savePriorityScore(venue, priority, bestFitScore, options = {}) {
        if (!venue || !venue.id) throw new Error('Venue id is required before saving priority.');

        const payload = buildPriorityScoreSavePayload(venue, priority, bestFitScore);
        const service = options.spreadsheetService || getSpreadsheetService();
        if (!service || typeof service.saveVenue !== 'function' || (typeof service.isConfigured === 'function' && !service.isConfigured())) {
            const error = new Error('Spreadsheet bridge is not configured yet.');
            error.code = 'SPREADSHEET_BRIDGE_NOT_CONFIGURED';
            throw error;
        }

        const result = await service.saveVenue({
            id: venue.id,
            rawFields: payload.rawFields
        });

        if (result && result.csv && typeof window.BARK.parseCSVString === 'function') {
            window.BARK.parseCSVString(result.csv, { cacheTime: Date.now(), source: 'Spreadsheet Save' });
        } else {
            applyLocalStatus(venue.id, payload.patch);
        }

        return {
            ...payload,
            result
        };
    }

    window.BARK.bookingActions = {
        ACTION_TYPES,
        ACTION_DEFINITIONS,
        formatLocalDate,
        addDays,
        normalizeDateInput,
        normalizeScoreInput,
        buildStatusPatch,
        buildContactStatusPatch,
        buildFollowUpDatePatch,
        buildPriorityScorePatch,
        buildRawFieldsPatch,
        buildStatusSavePayload,
        buildContactStatusSavePayload,
        buildFollowUpDateSavePayload,
        buildPriorityScoreSavePayload,
        mergeBookingPatch,
        applyLocalStatus,
        saveStatus,
        saveContactStatus,
        saveFollowUpDate,
        savePriorityScore
    };
})();
