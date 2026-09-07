/**
 * spreadsheetService.js - Browser client for the Just Dee Dee Google Sheets bridge.
 *
 * GitHub Pages cannot safely use Google service-account credentials directly.
 * This service talks to a small Google Apps Script web app owned by the sheet.
 */
(function () {
    window.BARK = window.BARK || {};
    window.BARK.services = window.BARK.services || {};

    const READ_TIMEOUT_MS = 30000;
    const WRITE_TIMEOUT_MS = 60000;
    let requestSequence = 0;

    function clean(value) {
        return String(value === undefined || value === null ? '' : value).trim();
    }

    function getApiUrl() {
        return clean(window.JDDM_SPREADSHEET_API_URL);
    }

    function getEditToken() {
        return clean(window.JDDM_SPREADSHEET_EDIT_TOKEN);
    }

    function isConfigured() {
        const url = getApiUrl();
        return Boolean(url && (
            /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/i.test(url) ||
            /^https:\/\/[a-z0-9-]+-[a-z0-9-]+\.cloudfunctions\.net\/jddmSpreadsheetBridge\/?$/i.test(url)
        ));
    }

    function getConfigStatus() {
        return {
            configured: isConfigured(),
            apiUrl: getApiUrl()
        };
    }

    function createRequestId(action) {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return `${action}-${window.crypto.randomUUID()}`;
        }
        requestSequence += 1;
        return `${action}-${Date.now().toString(36)}-${requestSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function getTimeoutMs(action) {
        return action === 'createVenue' || action === 'saveVenue' || action === 'setPlayed' || action === 'queueReminder'
            ? WRITE_TIMEOUT_MS
            : READ_TIMEOUT_MS;
    }

    function buildTimeoutError(action, timeoutMs) {
        const seconds = Math.round(timeoutMs / 1000);
        const error = new Error(`Google Sheets did not answer within ${seconds} seconds. The write may still be finishing, so check the Sheet before retrying.`);
        error.code = 'SPREADSHEET_BRIDGE_TIMEOUT';
        error.action = action;
        error.retryable = true;
        return error;
    }

    async function request(action, payload = {}, options = {}) {
        if (!isConfigured()) {
            const error = new Error('Spreadsheet bridge is not configured yet.');
            error.code = 'SPREADSHEET_BRIDGE_NOT_CONFIGURED';
            throw error;
        }

        const controller = new AbortController();
        const timeoutMs = Number(options.timeoutMs || getTimeoutMs(action));
        let timedOut = false;
        const timeoutId = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);

        try {
            const response = await fetch(getApiUrl(), {
                method: 'POST',
                redirect: 'follow',
                cache: 'no-store',
                headers: {
                    'Content-Type': 'text/plain;charset=utf-8'
                },
                body: JSON.stringify({
                    action,
                    token: getEditToken(),
                    ...payload
                }),
                signal: controller.signal
            });

            const text = await response.text();
            let parsed = null;

            try {
                parsed = text ? JSON.parse(text) : null;
            } catch (parseError) {
                const error = new Error('Spreadsheet bridge returned an unreadable response.');
                error.code = 'SPREADSHEET_BRIDGE_BAD_RESPONSE';
                error.responseText = text;
                throw error;
            }

            if (!response.ok || !parsed || parsed.ok === false) {
                const error = new Error((parsed && parsed.message) || `Spreadsheet bridge failed with ${response.status}.`);
                error.code = (parsed && parsed.code) || 'SPREADSHEET_BRIDGE_ERROR';
                error.details = parsed;
                throw error;
            }

            return parsed;
        } catch (error) {
            if (timedOut || (error && error.name === 'AbortError')) {
                throw buildTimeoutError(action, timeoutMs);
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async function getVenue(venueId) {
        return request('getVenue', { id: venueId });
    }

    async function getHealth() {
        return request('health');
    }

    async function getSchema() {
        return request('schema');
    }

    async function saveVenue({ id, venue, rawFields, requestId, expectedRawFields }) {
        return request('saveVenue', {
            id,
            venue,
            rawFields,
            expectedRawFields,
            requestId: clean(requestId) || createRequestId('saveVenue')
        });
    }

    async function createVenue({ venue, rawFields, requestId }) {
        return request('createVenue', {
            venue,
            rawFields,
            requestId: clean(requestId) || createRequestId('createVenue')
        });
    }

    async function setPlayed(id, played) {
        return request('setPlayed', { id, played: Boolean(played) });
    }

    async function queueReminder(reminderId, requestId) {
        return request('queueReminder', {
            reminderId: clean(reminderId),
            requestId: clean(requestId) || createRequestId('queueReminder')
        });
    }

    window.BARK.services.spreadsheet = {
        isConfigured,
        getConfigStatus,
        getHealth,
        getSchema,
        getVenue,
        saveVenue,
        createVenue,
        setPlayed,
        queueReminder
    };
})();
