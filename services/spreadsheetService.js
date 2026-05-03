/**
 * spreadsheetService.js - Browser client for the Just Dee Dee Google Sheets bridge.
 *
 * GitHub Pages cannot safely use Google service-account credentials directly.
 * This service talks to a small Google Apps Script web app owned by the sheet.
 */
(function () {
    window.BARK = window.BARK || {};
    window.BARK.services = window.BARK.services || {};

    const DEFAULT_TIMEOUT_MS = 15000;

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
        return Boolean(url && /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/i.test(url));
    }

    function getConfigStatus() {
        return {
            configured: isConfigured(),
            apiUrl: getApiUrl()
        };
    }

    async function request(action, payload = {}) {
        if (!isConfigured()) {
            const error = new Error('Spreadsheet bridge is not configured yet.');
            error.code = 'SPREADSHEET_BRIDGE_NOT_CONFIGURED';
            throw error;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

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
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async function getVenue(venueId) {
        return request('getVenue', { id: venueId });
    }

    async function saveVenue({ id, venue, rawFields }) {
        return request('saveVenue', { id, venue, rawFields });
    }

    window.BARK.services.spreadsheet = {
        isConfigured,
        getConfigStatus,
        getVenue,
        saveVenue
    };
})();
