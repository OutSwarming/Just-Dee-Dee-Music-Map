/**
 * bookingDashboard.js - read-only booking planner dashboard.
 */
(function () {
    window.BARK = window.BARK || {};

    const LEGACY_TABS = [
        { id: 'today', label: 'Today' },
        { id: 'booked', label: 'Booked' },
        { id: 'planner', label: 'Planner' },
        { id: 'followUps', label: 'Follow-Ups' },
        { id: 'newProspects', label: 'New Prospects' },
        { id: 'missingInfo', label: 'Needs Review' },
        { id: 'doNotContact', label: 'Closed / No Music' }
    ];

    const STATE_TAB_ID = 'crmState';
    const FALLBACK_STATE_SUMMARY = Object.freeze([
        { status: 'Responded - Needs Action', label: 'Response!', tone: 'action' },
        { status: 'Follow Up Needed', label: 'Follow Up', tone: 'action' },
        { status: 'Needs Review', label: 'Needs Review', tone: 'review' },
        { status: 'Booked', label: 'Booked', tone: 'booked' },
        { status: 'Played in the Past - Awaiting Reply', label: 'Past Awaiting', tone: 'played' },
        { status: 'Not Contacted Yet', label: 'New Prospects', tone: 'outreach' },
        { status: 'Draft Ready', label: 'Draft Ready', tone: 'outreach' },
        { status: 'Contacted - Waiting on Reply', label: 'Waiting Reply', tone: 'outreach' },
        { status: 'Open Microphone', label: 'Open Mic', tone: 'openMic' },
        { status: 'Played in the Past', label: 'Played Past', tone: 'played' },
        { status: 'Told No / Closed / No Music', label: 'No / Closed', tone: 'closed' },
        { status: 'Not Set', label: 'Not Set', tone: 'review' }
    ]);

    const AGENDA_SECTIONS = Object.freeze([
        { id: 'catchUp', label: 'Catch Up' },
        { id: 'newPlaces', label: 'New Places' },
        { id: 'dataReview', label: 'Data Review' }
    ]);

    const EXPECTED_SPREADSHEET_SCHEMA_VERSION = '2026-05-08-simplified-crm-statuses';
    const REQUIRED_BOOKING_HEADERS = [
        'Place Name',
        'Address',
        'City',
        'Zip',
        'State',
        'Place ID',
        'Longitude',
        'Latitude',
        'Status',
        'Contact Name',
        'Email/Contact',
        'Phone Number',
        'Past Gigs',
        'Future Gigs',
        'Past Gig Count',
        'Future Gig Count',
        'Total Gig Count'
    ];

    let activeTab = STATE_TAB_ID;
    let activeStatusState = '';
    let activeAgendaSection = 'catchUp';
    let unsubscribeRepo = null;
    let searchQuery = '';
    let bridgeHealth = {
        checking: false,
        checkedAt: null,
        result: null,
        error: null
    };
    let dataRefreshState = {
        checking: false,
        checkedAt: null,
        error: null
    };
    let emailDraftVenue = null;
    let contactMenuVenue = null;
    let availabilityMode = 'weekends';
    let availabilityVenue = null;
    let calendarAvailabilityState = {
        loading: false,
        loaded: false,
        payload: null,
        error: null
    };

    function clean(value) {
        return String(value === undefined || value === null ? '' : value).trim();
    }

    function escapeHtml(value) {
        return clean(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getRepo() {
        return window.BARK.repos && window.BARK.repos.ParkRepo;
    }

    function getSchema() {
        return window.BARK.bookingSchema;
    }

    function getTemplateService() {
        return window.BARK.bookingEmailTemplates;
    }

    function getAvailabilityService() {
        return window.BARK.bookingAvailability;
    }

    function getSpreadsheetService() {
        return window.BARK.services && window.BARK.services.spreadsheet;
    }

    function getWebsiteBookingsService() {
        return window.BARK.websiteBookings;
    }

    function getDashboardData() {
        const repo = getRepo();
        const schema = getSchema();
        const venues = repo && typeof repo.getAll === 'function' ? repo.getAll() : [];
        const data = schema && typeof schema.getDashboardGroups === 'function'
            ? schema.getDashboardGroups(venues)
            : { today: [], followUps: [], newProspects: [], booked: [], planner: [], missingInfo: [], doNotContact: [], all: venues };
        const websiteService = getWebsiteBookingsService();
        const websiteGroups = websiteService && typeof websiteService.getWebsiteBookingGroups === 'function'
            ? websiteService.getWebsiteBookingGroups()
            : { all: [], upcoming: [], past: [], loading: false, loadedAt: null, error: null };

        return {
            ...data,
            websiteUpcoming: websiteGroups.upcoming || [],
            websitePast: websiteGroups.past || [],
            websiteAll: websiteGroups.all || [],
            websiteBookingsStatus: {
                loading: Boolean(websiteGroups.loading),
                loadedAt: websiteGroups.loadedAt || null,
                error: websiteGroups.error || null
            },
            calendarAvailability: calendarAvailabilityState.payload
        };
    }

    function qs(id) {
        return document.getElementById(id);
    }

    function escapeSelector(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(clean(value));
        return clean(value).replace(/["\\]/g, '\\$&');
    }

    function getVenueLocation(venue) {
        return [venue.address, venue.city, venue.state, venue.zip].filter(Boolean).join(', ') || 'Northeast Ohio';
    }

    function formatAgendaDate(value) {
        if (!value) return '';
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }
        const text = clean(value);
        if (!text) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(text) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(text)) return text;
        const parsed = new Date(text);
        if (!Number.isNaN(parsed.getTime()) && (text.includes('GMT') || text.includes('T') || /^[A-Z][a-z]{2}\s[A-Z][a-z]{2}\s\d{1,2}\s\d{4}/.test(text))) {
            return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }
        return text;
    }

    function getEventLocation(event) {
        return event.location || [event.address, event.city, event.state, event.zip].filter(Boolean).join(', ') || 'Location not published yet';
    }

    function isWebsiteEventTab(tabId) {
        return tabId === 'websiteUpcoming' || tabId === 'websitePast';
    }

    function getSchemaStatusOrder() {
        const schema = getSchema();
        const statuses = schema && schema.CONTACT_STATUS ? schema.CONTACT_STATUS : {};
        return [
            statuses.RESPONDED_NEEDS_ACTION,
            statuses.FOLLOW_UP_NEEDED,
            statuses.NEEDS_REVIEW,
            statuses.BOOKED,
            statuses.PLAYED_IN_THE_PAST_AWAITING_REPLY,
            statuses.NOT_CONTACTED,
            statuses.DRAFT_READY,
            statuses.WAITING_REPLY,
            statuses.OPEN_MICROPHONE,
            statuses.PLAYED_IN_THE_PAST,
            statuses.TOLD_NO_CLOSED_NO_MUSIC,
            statuses.NOT_SET
        ].filter(Boolean);
    }

    function getFallbackStateMeta(status) {
        return FALLBACK_STATE_SUMMARY.find(item => item.status === status) || { status, label: status, tone: 'neutral' };
    }

    function getStateTone(status, fallbackTone = 'neutral') {
        return getFallbackStateMeta(status).tone || fallbackTone || 'neutral';
    }

    function getStateDisplayLabel(status) {
        return getFallbackStateMeta(status).label || status || 'Current State';
    }

    function getStateSummaryItems(data = {}) {
        const statusOrder = getSchemaStatusOrder();
        const preferredOrder = statusOrder.length ? statusOrder : FALLBACK_STATE_SUMMARY.map(item => item.status);
        const byStatus = new Map();

        if (Array.isArray(data.stateSummary)) {
            data.stateSummary.forEach(item => {
                if (item && item.status) byStatus.set(item.status, item);
            });
        }

        return preferredOrder.map(status => {
            const source = byStatus.get(status) || {};
            const venues = Array.isArray(source.venues)
                ? source.venues
                : data.statusGroups && Array.isArray(data.statusGroups[status])
                    ? data.statusGroups[status]
                    : [];
            return {
                status,
                label: getStateDisplayLabel(status),
                fullLabel: source.label || status,
                count: Number.isFinite(Number(source.count)) ? Number(source.count) : venues.length,
                venues,
                tone: source.tone || getStateTone(status)
            };
        });
    }

    function getDefaultStatusState(data = {}) {
        const items = getStateSummaryItems(data);
        return (
            items.find(item => item.count > 0 && item.status === 'Responded - Needs Action') ||
            items.find(item => item.count > 0 && item.status === 'Follow Up Needed') ||
            items.find(item => item.count > 0 && item.status === 'Needs Review') ||
            items.find(item => item.count > 0 && item.status === 'Booked') ||
            items.find(item => item.count > 0 && item.tone !== 'closed' && item.status !== 'Not Set') ||
            items.find(item => item.count > 0) ||
            items[0] ||
            {}
        ).status || '';
    }

    function syncActiveStatusState(data = {}) {
        if (activeTab !== STATE_TAB_ID) return;
        const items = getStateSummaryItems(data);
        const statuses = new Set(items.map(item => item.status));
        if (!activeStatusState || !statuses.has(activeStatusState)) {
            activeStatusState = getDefaultStatusState(data);
        }
    }

    function getActiveStatusVenues(data = {}) {
        if (!activeStatusState) return [];
        if (data.statusGroups && Array.isArray(data.statusGroups[activeStatusState])) {
            return data.statusGroups[activeStatusState];
        }
        const item = getStateSummaryItems(data).find(candidate => candidate.status === activeStatusState);
        return item && Array.isArray(item.venues) ? item.venues : [];
    }

    function getAgendaSections(data = {}) {
        const byId = new Map();
        if (Array.isArray(data.dailyAgendaSections)) {
            data.dailyAgendaSections.forEach(section => {
                if (section && section.id) byId.set(section.id, section);
            });
        }

        return AGENDA_SECTIONS.map(definition => {
            const source = byId.get(definition.id) || {};
            return {
                id: definition.id,
                label: definition.label,
                items: Array.isArray(source.items) ? source.items : []
            };
        });
    }

    function getAgendaTotal(data = {}) {
        return getAgendaSections(data).reduce((sum, section) => sum + section.items.length, 0);
    }

    function syncActiveAgendaSection(data = {}) {
        const sections = getAgendaSections(data);
        const ids = new Set(sections.map(section => section.id));
        if (ids.has(activeAgendaSection)) return;
        activeAgendaSection = (sections.find(section => section.items.length) || sections[0] || {}).id || 'catchUp';
    }

    function getVenueForAgendaItem(item, data = {}) {
        if (item && item.venue) return item.venue;
        const id = item && item.venueId;
        return (data.all || []).find(venue => venue.id === id) || {};
    }

    function normalizeSearchText(value) {
        return clean(value).toLowerCase();
    }

    function getBridgeGeneratedHeaders(health = {}) {
        return (health.generatedColumns || health.columns || [])
            .map(column => clean(column && column.header))
            .filter(Boolean);
    }

    function getMissingBookingHeaders(health = {}) {
        const generatedHeaders = getBridgeGeneratedHeaders(health).map(header => header.toLowerCase());
        return REQUIRED_BOOKING_HEADERS.filter(header => !generatedHeaders.includes(header.toLowerCase()));
    }

    function getBridgeHealthSummary(configStatus = {}, state = bridgeHealth) {
        if (!configStatus.configured) {
            return {
                tone: 'warning',
                label: 'Sheet bridge not configured',
                detail: 'The planner can read loaded map data, but spreadsheet edits need the Apps Script web app URL.',
                actionLabel: 'Check Sheet',
                actionDisabled: true
            };
        }

        if (state && state.checking) {
            return {
                tone: 'neutral',
                label: 'Checking sheet bridge',
                detail: 'Verifying the Apps Script deployment before booking edits.',
                actionLabel: 'Checking',
                actionDisabled: true
            };
        }

        if (state && state.error) {
            return {
                tone: 'error',
                label: 'Sheet bridge needs attention',
                detail: state.error.message || 'Could not reach the spreadsheet bridge.',
                actionLabel: 'Retry',
                actionDisabled: false
            };
        }

        const health = state && state.result;
        if (!health) {
            return {
                tone: 'neutral',
                label: 'Sheet bridge configured',
                detail: 'Run a quick check before editing live booking data.',
                actionLabel: 'Check Sheet',
                actionDisabled: false
            };
        }

        const missingHeaders = getMissingBookingHeaders(health);
        if (health.schemaVersion !== EXPECTED_SPREADSHEET_SCHEMA_VERSION) {
            return {
                tone: 'warning',
                label: 'Apps Script redeploy needed',
                detail: `Connected to ${health.sheetName || 'the sheet'}, but the bridge version is ${health.schemaVersion || 'unknown'}. Deploy the clean storage bridge before live edits.`,
                actionLabel: 'Recheck',
                actionDisabled: false
            };
        }

        if (missingHeaders.length) {
            return {
                tone: 'warning',
                label: 'Booking columns missing',
                detail: `Missing: ${missingHeaders.join(', ')}. Reopen the Apps Script bridge after deployment and run purge/setup.`,
                actionLabel: 'Recheck',
                actionDisabled: false
            };
        }

        return {
            tone: 'success',
            label: 'Sheet bridge ready',
            detail: `${health.sheetName || 'Google Sheet'} is using the clean storage bridge.`,
            actionLabel: 'Recheck',
            actionDisabled: false
        };
    }

    function formatCheckedAt(value) {
        if (!value) return '';
        try {
            return new Intl.DateTimeFormat(undefined, {
                hour: 'numeric',
                minute: '2-digit'
            }).format(value);
        } catch (error) {
            return '';
        }
    }

    function getVenueDataSyncStatus() {
        return typeof window.BARK.getVenueDataSyncStatus === 'function'
            ? window.BARK.getVenueDataSyncStatus()
            : { hasCachedData: false, cacheTime: null, source: 'Venue data' };
    }

    function formatSyncTime(cacheTime) {
        const timestamp = Number(cacheTime || 0);
        if (!Number.isFinite(timestamp) || timestamp <= 0) return '';

        try {
            return new Intl.DateTimeFormat(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
            }).format(new Date(timestamp));
        } catch (error) {
            return '';
        }
    }

    function getDataFreshnessSummary(status = {}, state = dataRefreshState) {
        if (state && state.checking) {
            return {
                tone: 'neutral',
                label: 'Refreshing venue data',
                detail: 'Checking for the newest spreadsheet rows and accepted map data.',
                actionLabel: 'Refreshing',
                actionDisabled: true
            };
        }

        if (state && state.error) {
            return {
                tone: 'error',
                label: 'Refresh needs attention',
                detail: state.error.message || 'Could not refresh venue data.',
                actionLabel: 'Retry Refresh',
                actionDisabled: false
            };
        }

        if (!status.hasCachedData) {
            return {
                tone: 'warning',
                label: 'Venue data not loaded yet',
                detail: 'Load or refresh map data before relying on the planner counts.',
                actionLabel: 'Refresh Data',
                actionDisabled: false
            };
        }

        const syncTime = formatSyncTime(status.cacheTime);
        return {
            tone: 'success',
            label: syncTime ? `Venue data loaded ${syncTime}` : 'Venue data loaded',
            detail: `${status.source || 'Venue data'} is available for the booking planner.`,
            actionLabel: 'Refresh Data',
            actionDisabled: false
        };
    }

    function renderVenueDataSync() {
        const root = qs('booking-data-sync');
        if (!root) return;

        const summary = getDataFreshnessSummary(getVenueDataSyncStatus(), dataRefreshState);
        const checkedAt = formatCheckedAt(dataRefreshState.checkedAt);
        root.dataset.tone = summary.tone;
        root.innerHTML = `
            <div>
                <p class="booking-kicker">Venue Data</p>
                <strong>${escapeHtml(summary.label)}</strong>
                <span>${escapeHtml(summary.detail)}</span>
                ${checkedAt ? `<small>Refresh checked ${escapeHtml(checkedAt)}</small>` : ''}
            </div>
            <button id="booking-data-refresh" type="button"${summary.actionDisabled ? ' disabled' : ''}>${escapeHtml(summary.actionLabel)}</button>
        `;

        const button = qs('booking-data-refresh');
        if (button) button.addEventListener('click', () => refreshVenueData(true));
    }

    async function refreshVenueData(userInitiated = false) {
        if (typeof window.BARK.refreshSpreadsheetMap !== 'function') {
            dataRefreshState = {
                checking: false,
                checkedAt: new Date(),
                error: new Error('Data refresh is not available yet.')
            };
            renderVenueDataSync();
            return;
        }

        dataRefreshState = {
            ...dataRefreshState,
            checking: true,
            error: null
        };
        renderVenueDataSync();

        try {
            await window.BARK.refreshSpreadsheetMap();
            dataRefreshState = {
                checking: false,
                checkedAt: new Date(),
                error: null
            };
        } catch (error) {
            if (userInitiated) console.error('[bookingDashboard] venue data refresh failed:', error);
            dataRefreshState = {
                checking: false,
                checkedAt: new Date(),
                error
            };
        }

        renderVenueDataSync();
    }

    function renderSheetBridgeHealth() {
        const root = qs('booking-sheet-health');
        if (!root) return;

        const service = getSpreadsheetService();
        const configStatus = service && typeof service.getConfigStatus === 'function'
            ? service.getConfigStatus()
            : { configured: false, apiUrl: '' };
        const summary = getBridgeHealthSummary(configStatus, bridgeHealth);
        const checkedAt = formatCheckedAt(bridgeHealth.checkedAt);

        root.dataset.tone = summary.tone;
        root.innerHTML = `
            <div>
                <p class="booking-kicker">Sheet Sync</p>
                <strong>${escapeHtml(summary.label)}</strong>
                <span>${escapeHtml(summary.detail)}</span>
                ${checkedAt ? `<small>Last checked ${escapeHtml(checkedAt)}</small>` : ''}
            </div>
            <button id="booking-sheet-health-check" type="button"${summary.actionDisabled ? ' disabled' : ''}>${escapeHtml(summary.actionLabel)}</button>
        `;

        const button = qs('booking-sheet-health-check');
        if (button) button.addEventListener('click', () => checkSheetBridgeHealth(true));
    }

    async function checkSheetBridgeHealth(userInitiated = false) {
        const service = getSpreadsheetService();
        const configStatus = service && typeof service.getConfigStatus === 'function'
            ? service.getConfigStatus()
            : { configured: false };

        if (!configStatus.configured || !service || typeof service.getHealth !== 'function') {
            bridgeHealth = { checking: false, checkedAt: null, result: null, error: null };
            renderSheetBridgeHealth();
            return;
        }

        bridgeHealth = {
            ...bridgeHealth,
            checking: true,
            error: null
        };
        renderSheetBridgeHealth();

        try {
            const result = await service.getHealth();
            bridgeHealth = {
                checking: false,
                checkedAt: new Date(),
                result,
                error: null
            };
        } catch (error) {
            if (userInitiated) console.error('[bookingDashboard] sheet health check failed:', error);
            bridgeHealth = {
                checking: false,
                checkedAt: new Date(),
                result: null,
                error
            };
        }

        renderSheetBridgeHealth();
    }

    function getActionReason(venue, tabId) {
        const booking = venue.booking || {};
        if (tabId === 'followUps' || booking.isFollowUpDue) return `Follow-up due${booking.nextFollowUpDate ? `: ${booking.nextFollowUpDate}` : ''}`;
        if (tabId === 'newProspects') return booking.contactEmail ? 'Ready for first outreach' : 'Needs contact info';
        if (tabId === 'priorityLeads') return `Priority ${booking.priority || 0} / Fit ${booking.bestFitScore || 0}`;
        if (tabId === 'interested') return 'Response needs action';
        if (tabId === 'booked') return booking.eventDate ? `Booked: ${booking.eventDate}` : 'Booked';
        if (tabId === 'planner') return booking.isOpenMicrophone ? 'Open microphone venue' : 'Played in the past';
        if (tabId === 'upcomingGigs') return booking.eventDate ? `Upcoming gig: ${booking.eventDate}` : 'Upcoming gig';
        if (tabId === 'postGigFollowUps') return booking.eventDate ? `Post-gig follow-up: ${booking.eventDate}` : 'Post-gig follow-up';
        if (tabId === 'missingInfo') return 'Needs review';
        if (tabId === 'notAFit') return 'Told no / closed / no music';
        if (tabId === 'doNotContact') return 'Told no / closed / no music';
        if (booking.isPostGigFollowUpDue) return 'Post-gig follow-up due';
        if (booking.isUpcomingGig) return booking.eventDate ? `Upcoming gig: ${booking.eventDate}` : 'Upcoming gig';
        if (booking.isNotAFit) return 'Told no / closed / no music';
        if (booking.isRespondedNeedsAction || booking.isInterested) return 'Response needs action';
        if (booking.isPriorityLead) return `Priority ${booking.priority || 0} / Fit ${booking.bestFitScore || 0}`;
        if (booking.isNewProspect) return 'New prospect';
        if (booking.isMissingInfo) return 'Research contact info';
        return booking.contactStatus || 'Ready to review';
    }

    function getGmailComposeHref(venue, templateType) {
        const templates = getTemplateService();
        if (templates && typeof templates.getGmailComposeHref === 'function') {
            return templates.getGmailComposeHref(venue, templateType);
        }
        return '';
    }

    function getGmailAppComposeHref(venue, templateType) {
        const templates = getTemplateService();
        if (templates && typeof templates.getGmailAppComposeHref === 'function') {
            return templates.getGmailAppComposeHref(venue, templateType);
        }
        return '';
    }

    function getExternalUrl(value) {
        const url = clean(value);
        if (!url) return '';
        if (/^https?:\/\//i.test(url)) return url;
        if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(url)) return `https://${url}`;
        return '';
    }


    function isBookedTab(tabId) {
        const value = clean(tabId).toLowerCase();
        return value === 'booked';
    }

    function getVenueFutureGigDates(venue) {
        if (!venue) return [];
        const schema = window.BARK.bookingSchema;
        if (schema && typeof schema.getVenueGigStats === 'function') {
            const stats = schema.getVenueGigStats(venue);
            if (stats && Array.isArray(stats.futureDates) && stats.futureDates.length) {
                return stats.futureDates.slice();
            }
        }
        const booking = venue.booking || {};
        const fallback = clean(booking.calendarNextGigDate || booking.eventDate);
        return fallback ? [fallback] : [];
    }

    function getVenueNextGigDate(venue) {
        const dates = getVenueFutureGigDates(venue);
        return dates.length ? dates[0] : '';
    }

    function formatShortGigDate(value) {
        const text = clean(value);
        if (!text) return '';
        const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (isoMatch) {
            const date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
            if (!Number.isNaN(date.getTime())) {
                return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            }
        }
        const parsed = new Date(text);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        }
        return text;
    }

    function getVenueStatusBadge(venue) {
        const booking = venue.booking || {};
        const status = clean(booking.contactStatus || venue.contactStatus || '');
        if (!status) return { label: '', tone: 'neutral' };
        return { label: getStateDisplayLabel(status), tone: getStateTone(status, 'neutral') };
    }

    function getContactRows(venue) {
        const booking = venue.booking || {};
        const rows = [
            ['Contact', booking.contactName || venue.contactName || 'Not set'],
            ['Email', booking.contactEmail || venue.contactEmail || 'Missing contact info']
        ];
        const phone = booking.contactPhone || venue.contactPhone || '';
        if (phone) rows.push(['Phone', phone]);
        return rows;
    }

    function writeClipboardText(text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            return navigator.clipboard.writeText(text);
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return Promise.resolve();
    }

    function openEmailDraft(venue, templateType) {
        const appHref = getGmailAppComposeHref(venue, templateType);
        const webHref = getGmailComposeHref(venue, templateType);
        if (!appHref && !webHref) return false;

        if (appHref) {
            window.location.href = appHref;

            if (webHref) {
                window.setTimeout(() => {
                    if (document.hidden || document.visibilityState === 'hidden') return;

                    const opened = typeof window.open === 'function'
                        ? window.open(webHref, '_blank', 'noopener')
                        : null;
                    if (!opened) window.location.href = webHref;
                }, 900);
            }
            return true;
        }

        const opened = typeof window.open === 'function'
            ? window.open(webHref, '_blank', 'noopener')
            : null;
        if (!opened) window.location.href = webHref;
        return true;
    }

    function setEmailModalStatus(message, tone = 'neutral') {
        const status = qs('booking-email-status');
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function closeEmailTemplateModal() {
        const modal = qs('booking-email-modal');
        if (!modal) return;
        modal.hidden = true;
        document.body.classList.remove('venue-edit-open');
        emailDraftVenue = null;
        setEmailModalStatus('', 'neutral');
    }

    function openEmailTemplateModal(venue) {
        const modal = qs('booking-email-modal');
        const select = qs('booking-email-template-select');
        const summary = qs('booking-email-summary');
        if (!modal || !select || !summary) return false;

        const templates = getTemplateService();
        if (!templates || typeof templates.getTemplateOptions !== 'function') return false;

        const suggestedType = templates.getSuggestedTemplateType(venue);
        const options = templates.getTemplateOptions();
        emailDraftVenue = venue;
        summary.textContent = `${venue.name || 'This venue'}${venue.booking && venue.booking.contactEmail ? ` -> ${venue.booking.contactEmail}` : ''}`;
        select.innerHTML = options.map(option => `<option value="${escapeHtml(option.type)}"${option.type === suggestedType ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('');
        setEmailModalStatus('', 'neutral');
        modal.hidden = false;
        document.body.classList.add('venue-edit-open');
        select.focus({ preventScroll: true });
        return true;
    }

    function bindEmailModalEvents() {
        if (bindEmailModalEvents.bound) return;
        bindEmailModalEvents.bound = true;

        const modal = qs('booking-email-modal');
        if (!modal) return;

        modal.addEventListener('click', event => {
            if (event.target && event.target.dataset && event.target.dataset.closeBookingEmail === 'true') {
                closeEmailTemplateModal();
            }
        });

        const confirm = qs('booking-email-confirm');
        if (confirm) {
            confirm.addEventListener('click', () => {
                const select = qs('booking-email-template-select');
                if (!emailDraftVenue || !select) return;
                if (!openEmailDraft(emailDraftVenue, select.value)) {
                    setEmailModalStatus('Missing contact email for this venue.', 'error');
                    return;
                }
                closeEmailTemplateModal();
            });
        }

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && modal && !modal.hidden) closeEmailTemplateModal();
        });
    }

    function getContactChannels(venue) {
        const booking = venue.booking || {};
        const email = clean(booking.contactEmail || venue.contactEmail);
        const rawPhone = clean(booking.contactPhone || venue.contactPhone);
        const digits = rawPhone.replace(/[^\d+]/g, '');
        const facebookUrl = clean(booking.facebookUrl || venue.facebookUrl);
        let messengerHref = '';
        if (facebookUrl) {
            const handleMatch = facebookUrl.match(/facebook\.com\/(?:pg\/|pages\/[^/]+\/)?([^/?#]+)/i);
            messengerHref = handleMatch && handleMatch[1] ? `https://m.me/${handleMatch[1]}` : facebookUrl;
        }
        return {
            email,
            emailLabel: email || 'Missing email',
            phone: rawPhone,
            phoneDigits: digits,
            phoneLabel: rawPhone || 'Missing phone',
            messengerHref,
            messengerLabel: facebookUrl ? 'Facebook Messenger' : 'No Facebook page'
        };
    }

    function setContactMenuStatus(message, tone = 'neutral') {
        const status = qs('booking-contact-status');
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function closeContactMenu() {
        const modal = qs('booking-contact-modal');
        if (!modal) return;
        modal.hidden = true;
        document.body.classList.remove('venue-edit-open');
        contactMenuVenue = null;
        setContactMenuStatus('', 'neutral');
    }

    function setContactChannelButton(id, opts) {
        const btn = qs(id);
        if (!btn) return;
        const { label, href, action, disabled, sub } = opts;
        btn.dataset.contactAction = action || '';
        btn.dataset.contactHref = href || '';
        btn.disabled = Boolean(disabled);
        const labelEl = btn.querySelector('[data-channel-label]');
        const subEl = btn.querySelector('[data-channel-sub]');
        if (labelEl) labelEl.textContent = label;
        if (subEl) subEl.textContent = sub || '';
    }

    function openContactMenu(venue) {
        const modal = qs('booking-contact-modal');
        const summary = qs('booking-contact-summary');
        if (!modal || !summary) return false;

        contactMenuVenue = venue;
        const channels = getContactChannels(venue);
        summary.textContent = venue.name || 'This venue';

        setContactChannelButton('booking-contact-email', {
            action: 'email',
            label: 'Email',
            sub: channels.emailLabel,
            disabled: !channels.email && !Boolean(getGmailAppComposeHref(venue) || getGmailComposeHref(venue))
        });
        setContactChannelButton('booking-contact-call', {
            action: 'call',
            href: channels.phoneDigits ? `tel:${channels.phoneDigits}` : '',
            label: 'Call',
            sub: channels.phoneLabel,
            disabled: !channels.phoneDigits
        });
        setContactChannelButton('booking-contact-text', {
            action: 'text',
            href: channels.phoneDigits ? `sms:${channels.phoneDigits}` : '',
            label: 'Text',
            sub: channels.phoneLabel,
            disabled: !channels.phoneDigits
        });
        setContactChannelButton('booking-contact-messenger', {
            action: 'messenger',
            href: channels.messengerHref,
            label: 'Messenger',
            sub: channels.messengerLabel,
            disabled: !channels.messengerHref
        });

        setContactMenuStatus('', 'neutral');
        modal.hidden = false;
        document.body.classList.add('venue-edit-open');
        return true;
    }

    function handleContactChannelClick(action) {
        if (!contactMenuVenue) return;
        const venue = contactMenuVenue;
        const channels = getContactChannels(venue);

        if (action === 'email') {
            if (openEmailTemplateModal(venue)) {
                closeContactMenu();
            } else {
                setContactMenuStatus('Email templates are not available yet.', 'error');
            }
            return;
        }
        if (action === 'call') {
            if (!channels.phoneDigits) {
                setContactMenuStatus('No phone number on file for this venue.', 'error');
                return;
            }
            window.location.href = `tel:${channels.phoneDigits}`;
            closeContactMenu();
            return;
        }
        if (action === 'text') {
            if (!channels.phoneDigits) {
                setContactMenuStatus('No phone number on file for this venue.', 'error');
                return;
            }
            const body = 'Hi! This is Just Dee Dee Music - ';
            const sep = /iphone|ipad|ipod|macintosh/i.test(navigator.userAgent || '') ? '&' : '?';
            window.location.href = `sms:${channels.phoneDigits}${sep}body=${encodeURIComponent(body)}`;
            closeContactMenu();
            return;
        }
        if (action === 'messenger') {
            if (!channels.messengerHref) {
                setContactMenuStatus('No Facebook page on file for this venue.', 'error');
                return;
            }
            const opened = typeof window.open === 'function'
                ? window.open(channels.messengerHref, '_blank', 'noopener')
                : null;
            if (!opened) window.location.href = channels.messengerHref;
            closeContactMenu();
            return;
        }
    }

    function bindContactMenuEvents() {
        if (bindContactMenuEvents.bound) return;
        bindContactMenuEvents.bound = true;

        const modal = qs('booking-contact-modal');
        if (!modal) return;

        modal.addEventListener('click', event => {
            if (event.target && event.target.dataset && event.target.dataset.closeBookingContact === 'true') {
                closeContactMenu();
                return;
            }
            const channelBtn = event.target.closest && event.target.closest('[data-contact-action]');
            if (channelBtn && modal.contains(channelBtn) && !channelBtn.disabled) {
                handleContactChannelClick(channelBtn.dataset.contactAction);
            }
        });

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && modal && !modal.hidden) closeContactMenu();
        });
    }

    function loadCalendarAvailabilityData() {
        if (calendarAvailabilityState.loading || calendarAvailabilityState.loaded) {
            return Promise.resolve(calendarAvailabilityState.payload);
        }
        if (typeof fetch !== 'function') {
            calendarAvailabilityState = {
                loading: false,
                loaded: false,
                payload: null,
                error: new Error('Calendar fetch is not available.')
            };
            return Promise.resolve(null);
        }

        calendarAvailabilityState = {
            ...calendarAvailabilityState,
            loading: true,
            error: null
        };

        return fetch('data/staged/jddm-calendar-gigs.json?v=2', { cache: 'no-store' })
            .then(response => {
                if (!response.ok) throw new Error(`Calendar data unavailable (${response.status})`);
                return response.json();
            })
            .then(payload => {
                calendarAvailabilityState = {
                    loading: false,
                    loaded: true,
                    payload,
                    error: null
                };
                renderAvailabilityModalResults();
                return payload;
            })
            .catch(error => {
                console.warn('[bookingDashboard] calendar availability load failed:', error);
                calendarAvailabilityState = {
                    loading: false,
                    loaded: false,
                    payload: null,
                    error
                };
                renderAvailabilityModalResults();
                return null;
            });
    }

    function setAvailabilityStatus(message, tone = 'neutral') {
        const status = qs('booking-availability-status');
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function closeAvailabilityModal() {
        const modal = qs('booking-availability-modal');
        if (!modal) return;
        modal.hidden = true;
        document.body.classList.remove('venue-edit-open');
        availabilityVenue = null;
        setAvailabilityStatus('', 'neutral');
    }

    function getAvailabilityCalendarPayload() {
        const payload = calendarAvailabilityState.payload || {};
        return {
            gigs: Array.isArray(payload.gigs) ? payload.gigs : [],
            blockedEvents: Array.isArray(payload.blockedEvents) ? payload.blockedEvents : []
        };
    }

    function renderAvailabilityModalResults() {
        const modal = qs('booking-availability-modal');
        const list = qs('booking-availability-list');
        const summary = qs('booking-availability-summary');
        if (!modal || modal.hidden || !list) return;

        const service = getAvailabilityService();
        if (!service || typeof service.getAvailableDates !== 'function') {
            list.innerHTML = '';
            setAvailabilityStatus('Available date checks are not ready yet.', 'error');
            return;
        }

        const data = getDashboardData();
        const payload = getAvailabilityCalendarPayload();
        const result = service.getAvailableDates({
            venues: data.all || [],
            websiteEvents: data.websiteUpcoming || [],
            calendarEvents: payload.gigs,
            blockedEvents: payload.blockedEvents,
            mode: availabilityMode,
            lookaheadDays: 120,
            limit: 24
        });

        const modeButtons = Array.from(document.querySelectorAll('[data-availability-mode]'));
        modeButtons.forEach(button => {
            const active = button.dataset.availabilityMode === availabilityMode;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        if (summary) {
            const venueLabel = availabilityVenue && availabilityVenue.name ? ` for ${availabilityVenue.name}` : '';
            summary.textContent = `Looking at upcoming Just Dee Dee Music dates${venueLabel}. Weekends include Friday night, Saturday, and Sunday.`;
        }

        if (!result.dates.length) {
            list.innerHTML = '<p class="booking-availability-empty">No open dates found in the next 120 days for this filter.</p>';
        } else {
            list.innerHTML = `
                <div class="booking-availability-grid">
                    ${result.dates.map(item => `
                        <div class="booking-availability-date">
                            <strong>${escapeHtml(item.label)}</strong>
                            <span>${escapeHtml(item.date)}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        if (calendarAvailabilityState.loading) {
            setAvailabilityStatus('Checking staged calendar blocks...', 'neutral');
        } else if (calendarAvailabilityState.error) {
            setAvailabilityStatus('Using loaded venue and website dates only; staged calendar blocks could not load.', 'warning');
        } else {
            setAvailabilityStatus(`${result.modeLabel}: ${result.dates.length} open date${result.dates.length === 1 ? '' : 's'} found. ${result.busyCount} booked or blocked date${result.busyCount === 1 ? '' : 's'} skipped.`, 'success');
        }
    }

    function openAvailabilityModal(venue) {
        const modal = qs('booking-availability-modal');
        if (!modal) return false;
        availabilityVenue = venue || null;
        modal.hidden = false;
        document.body.classList.add('venue-edit-open');
        renderAvailabilityModalResults();
        loadCalendarAvailabilityData();
        const activeButton = qs(availabilityMode === 'weekdays' ? 'booking-availability-weekdays' : 'booking-availability-weekends');
        if (activeButton) activeButton.focus({ preventScroll: true });
        return true;
    }

    function bindAvailabilityModalEvents() {
        if (bindAvailabilityModalEvents.bound) return;
        bindAvailabilityModalEvents.bound = true;

        const modal = qs('booking-availability-modal');
        if (!modal) return;

        modal.addEventListener('click', event => {
            if (event.target && event.target.dataset && event.target.dataset.closeBookingAvailability === 'true') {
                closeAvailabilityModal();
                return;
            }
            const modeButton = event.target.closest && event.target.closest('[data-availability-mode]');
            if (modeButton && modal.contains(modeButton)) {
                availabilityMode = modeButton.dataset.availabilityMode === 'weekdays' ? 'weekdays' : 'weekends';
                renderAvailabilityModalResults();
            }
        });

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && modal && !modal.hidden) closeAvailabilityModal();
        });
    }

    function getVenueMarker(venue) {
        const manager = window.BARK.markerManager;
        if (manager && manager.markers && typeof manager.markers.get === 'function') {
            return manager.markers.get(venue.id) || venue.marker;
        }
        return venue.marker;
    }

    function waitForMapMove(map, callback) {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            if (typeof map.off === 'function') map.off('moveend', finish);
            setTimeout(callback, 80);
        };

        if (typeof map.once === 'function') map.once('moveend', finish);
        setTimeout(finish, window.lowGfxEnabled ? 120 : 900);
    }

    function syncMapMarkersNow() {
        if (typeof window.BARK.invalidateMarkerVisibility === 'function') {
            window.BARK.invalidateMarkerVisibility();
        }
        if (typeof window.syncState === 'function') {
            window.BARK._pendingMarkerSync = false;
            window.syncState();
        }
    }

    function selectMapMarker(marker) {
        if (!marker) return;

        if (typeof marker.fire === 'function') marker.fire('click');

        if (window.BARK.activePinMarker !== marker && typeof window.BARK.clearActivePin === 'function') {
            window.BARK.clearActivePin();
            window.BARK.activePinMarker = marker;
        }

        if (marker._icon) marker._icon.classList.add('active-pin');
    }

    function focusVenueOnMap(venue) {
        const mapTab = document.querySelector('.nav-item[data-target="map-view"]');
        if (mapTab) mapTab.click();

        setTimeout(() => {
            const lat = Number(venue.lat);
            const lng = Number(venue.lng);
            const map = window.map;
            if (!map || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

            if (typeof map.invalidateSize === 'function') map.invalidateSize();
            const targetZoom = Math.max(map.getZoom(), 16);
            map.setView([lat, lng], targetZoom, {
                animate: !window.lowGfxEnabled,
                duration: window.lowGfxEnabled ? 0 : 0.35
            });

            waitForMapMove(map, () => {
                syncMapMarkersNow();
                const marker = getVenueMarker(venue);
                if (!marker) return;

                const clusterLayer = window.BARK.markerClusterGroup;
                if (
                    clusterLayer &&
                    typeof clusterLayer.zoomToShowLayer === 'function' &&
                    (!marker._icon || marker._barkLayerType === 'cluster')
                ) {
                    clusterLayer.zoomToShowLayer(marker, () => setTimeout(() => selectMapMarker(marker), 80));
                    return;
                }

                selectMapMarker(marker);
            });
        }, 160);
    }

    function renderStats(data) {
        const stats = qs('booking-planner-stats');
        if (!stats) return;

        const stateItems = getStateSummaryItems(data);
        const getCount = status => (stateItems.find(item => item.status === status) || {}).count || 0;
        stats.innerHTML = [
            ['Priority Cards', getAgendaTotal(data)],
            ['Responses', getCount('Responded - Needs Action')],
            ['Follow-Ups', getCount('Follow Up Needed')],
            ['Needs Review', getCount('Needs Review')],
            ['Booked', getCount('Booked')],
            ['New Prospects', getCount('Not Contacted Yet')]
        ].map(([label, value]) => `
            <div class="booking-stat">
                <strong>${value}</strong>
                <span>${escapeHtml(label)}</span>
            </div>
        `).join('');
    }

    function getAgendaTargetTab(item) {
        if (!item) return 'today';
        if (item.status) return STATE_TAB_ID;
        if (item.type === 'postGigFollowUp') return 'postGigFollowUps';
        if (item.type === 'upcomingGig') return 'upcomingGigs';
        if (item.type === 'planner') return 'planner';
        if (item.type === 'priorityLead') return 'priorityLeads';
        if (item.type === 'newProspect') return 'newProspects';
        if (item.type === 'missingInfo') return 'missingInfo';
        if (item.type === 'interested' || item.type === 'interestedDue') return 'interested';
        if (item.type === 'followUpDue') return 'followUps';
        return 'today';
    }

    function getAgendaTargetState(item) {
        return item && item.status ? item.status : '';
    }

    function getAgendaDisplayReason(item) {
        if (!item) return '';
        if ((item.type === 'upcomingGig' || item.type === 'postGigFollowUp') && item.eventDate) {
            return `${item.type === 'postGigFollowUp' ? 'Booked gig needs thank-you' : 'Upcoming booked gig'}: ${formatAgendaDate(item.eventDate)}`;
        }
        if ((item.type === 'followUpDue' || item.type === 'interestedDue') && item.nextFollowUpDate) {
            return `${item.type === 'interestedDue' ? 'Response follow-up due' : 'Follow-up due'}: ${formatAgendaDate(item.nextFollowUpDate)}`;
        }
        return item.reason || '';
    }

    function getAgendaFactRows(item, data = {}) {
        const venue = getVenueForAgendaItem(item, data);
        const booking = venue.booking || {};
        const gigStats = window.BARK.bookingSchema && typeof window.BARK.bookingSchema.getVenueGigStats === 'function'
            ? window.BARK.bookingSchema.getVenueGigStats(venue)
            : null;
        const contactLine = [booking.contactName, booking.contactType].filter(Boolean).join(' | ');
        const emailOrPhone = booking.contactEmail || booking.contactPhone || '';
        const scoreLine = [booking.priority ? `Priority ${booking.priority}` : '', booking.bestFitScore ? `Fit ${booking.bestFitScore}` : ''].filter(Boolean).join(' | ');
        const rows = [];

        if (item.type === 'missingInfo') {
            const reviewReason = Array.isArray(booking.contactReviewReasons) && booking.contactReviewReasons.length
                ? booking.contactReviewReasons[0]
                : 'Contact details need cleanup';
            rows.push(['Review', reviewReason]);
            rows.push(['Contact', contactLine || 'Missing contact name']);
            rows.push(['Email', booking.contactEmail || 'Missing email']);
            rows.push(['Phone', booking.contactPhone || 'Missing phone']);
            return rows;
        }

        if (item.type === 'newProspect' || item.type === 'priorityLead') {
            rows.push(['Contact', contactLine || 'Contact ready']);
            rows.push(['Reach', emailOrPhone || booking.bookingUrl || venue.website || 'Missing contact path']);
            if (scoreLine) rows.push(['Score', scoreLine]);
            rows.push(['Status', booking.contactStatus || item.status || 'Not Contacted Yet']);
            return rows;
        }

        if (item.type === 'upcomingGig' || item.type === 'postGigFollowUp') {
            rows.push(['Gig', [formatAgendaDate(booking.eventDate), booking.eventTime].filter(Boolean).join(' ') || 'Date not set']);
            rows.push(['Contact', contactLine || booking.contactEmail || 'Booking contact not set']);
            rows.push(['Future', (gigStats && gigStats.futureDates && gigStats.futureDates.length ? gigStats.futureDates.join('; ') : '') || formatAgendaDate(booking.calendarNextGigDate) || 'No future list']);
            rows.push(['Past Gigs', String((gigStats && gigStats.pastCount) || booking.calendarPastGigCount || 0)]);
            return rows;
        }

        rows.push(['Next Step', item.suggestedAction || 'Review']);
        rows.push(['Follow-Up', formatAgendaDate(booking.nextFollowUpDate) || 'Due now']);
        rows.push(['Last Contact', formatAgendaDate(booking.lastContactedDate) || 'Not logged']);
        rows.push(['Contact', contactLine || emailOrPhone || 'Contact not set']);
        return rows;
    }

    function renderAgendaTaskCard(item, index, data) {
        const venue = getVenueForAgendaItem(item, data);
        const facts = getAgendaFactRows(item, data);
        return `
            <article class="booking-task-card" data-priority-type="${escapeHtml(item.type || 'default')}" data-state-tone="${escapeHtml(getStateTone(item.status, 'neutral'))}">
                <div class="booking-task-card-top">
                    <span>${index + 1}</span>
                    <strong>${escapeHtml(getStateDisplayLabel(item.status || 'Current State'))}</strong>
                </div>
                <h4>${escapeHtml(item.venueName || venue.name || 'Unknown Venue')}</h4>
                <p>${escapeHtml(getAgendaDisplayReason(item))}</p>
                <div class="booking-task-facts">
                    ${facts.map(([label, value]) => `
                        <div>
                            <span>${escapeHtml(label)}</span>
                            <strong>${escapeHtml(value || 'Not set')}</strong>
                        </div>
                    `).join('')}
                </div>
                <div class="booking-task-actions">
                    <button type="button" data-agenda-action="open-list" data-venue-id="${escapeHtml(item.venueId)}" data-target-tab="${escapeHtml(getAgendaTargetTab(item))}" data-target-state="${escapeHtml(getAgendaTargetState(item))}">Open</button>
                    <button type="button" data-agenda-action="map" data-venue-id="${escapeHtml(item.venueId)}"${venue.lat && venue.lng ? '' : ' disabled'}>Map</button>
                </div>
            </article>
        `;
    }

    function updateAgendaDeck(root) {
        const buttons = Array.from(root.querySelectorAll('[data-agenda-section]'));
        const activeIndex = Math.max(0, buttons.findIndex(button => button.dataset.agendaSection === activeAgendaSection));
        const panels = Array.from(root.querySelectorAll('[data-agenda-panel]'));
        const track = root.querySelector('[data-agenda-panels]');

        buttons.forEach((button, index) => {
            const isActive = index === activeIndex;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        panels.forEach((panel, index) => {
            panel.setAttribute('aria-hidden', index === activeIndex ? 'false' : 'true');
        });
        if (track) track.style.transform = `translateX(-${activeIndex * 100}%)`;
    }

    function renderAgenda(data) {
        const agenda = qs('booking-daily-agenda');
        if (!agenda) return;

        const sections = getAgendaSections(data);
        const totalItems = sections.reduce((sum, section) => sum + section.items.length, 0);
        const activeIndex = Math.max(0, sections.findIndex(section => section.id === activeAgendaSection));
        if (!totalItems) {
            agenda.innerHTML = `
                <div class="booking-agenda-header">
                    <div>
                        <p class="booking-kicker">Priority Cards</p>
                        <h3>All clear right now</h3>
                    </div>
                </div>
                <p class="booking-agenda-empty">No urgent booking actions are due.</p>
            `;
            return;
        }

        agenda.innerHTML = `
            <div class="booking-agenda-header">
                <div>
                    <p class="booking-kicker">Priority Cards</p>
                    <h3>Daily booking deck</h3>
                </div>
                <span>${totalItems}</span>
            </div>
            <div class="booking-agenda-switch" role="tablist" aria-label="Priority card lanes">
                ${sections.map((section, index) => `
                    <button type="button" class="${index === activeIndex ? 'active' : ''}" data-agenda-section="${escapeHtml(section.id)}" role="tab" aria-selected="${index === activeIndex ? 'true' : 'false'}">
                        ${escapeHtml(section.label)}
                        <span>${section.items.length}</span>
                    </button>
                `).join('')}
            </div>
            <div class="booking-task-viewport">
                <div class="booking-task-panels" data-agenda-panels style="transform: translateX(-${activeIndex * 100}%);">
                    ${sections.map((section, sectionIndex) => `
                        <section class="booking-task-panel" data-agenda-panel="${escapeHtml(section.id)}" aria-hidden="${sectionIndex === activeIndex ? 'false' : 'true'}">
                            ${section.items.length ? `
                                <div class="booking-task-strip">
                                    ${section.items.map((item, itemIndex) => renderAgendaTaskCard(item, itemIndex, data)).join('')}
                                </div>
                            ` : `<p class="booking-agenda-empty">No ${escapeHtml(section.label)} cards right now.</p>`}
                        </section>
                    `).join('')}
                </div>
            </div>
        `;

        agenda.querySelectorAll('[data-agenda-section]').forEach(button => {
            button.addEventListener('click', () => {
                activeAgendaSection = button.dataset.agendaSection || 'catchUp';
                updateAgendaDeck(agenda);
            });
        });

        agenda.querySelectorAll('[data-agenda-action="open-list"]').forEach(button => {
            button.addEventListener('click', () => {
                activeTab = button.dataset.targetTab || 'today';
                activeStatusState = activeTab === STATE_TAB_ID ? clean(button.dataset.targetState) : '';
                searchQuery = '';
                render();
                setTimeout(() => {
                    const card = document.querySelector(`[data-booking-venue-id="${escapeSelector(button.dataset.venueId)}"]`);
                    if (card) {
                        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        card.classList.add('booking-card-highlight');
                        setTimeout(() => card.classList.remove('booking-card-highlight'), 1600);
                    }
                }, 80);
            });
        });

        agenda.querySelectorAll('[data-agenda-action="map"]').forEach(button => {
            button.addEventListener('click', () => {
                const venue = (data.all || []).find(row => row.id === button.dataset.venueId);
                if (venue) focusVenueOnMap(venue);
            });
        });
    }

    function bindSearchControls() {
        if (bindSearchControls.bound) return;
        const input = qs('booking-planner-search-input');
        const clear = qs('booking-planner-search-clear');
        const availabilityButtons = [
            qs('home-availability-open'),
            qs('booking-availability-open')
        ].filter(Boolean);
        if (!input) return;

        bindSearchControls.bound = true;
        availabilityButtons.forEach(button => {
            button.addEventListener('click', () => openAvailabilityModal(null));
        });
        input.addEventListener('input', () => {
            searchQuery = input.value;
            render();
        });
        if (clear) {
            clear.addEventListener('click', () => {
                searchQuery = '';
                input.value = '';
                render();
                input.focus({ preventScroll: true });
            });
        }
    }

    function renderSearchControls() {
        const input = qs('booking-planner-search-input');
        const clear = qs('booking-planner-search-clear');
        if (input && input.value !== searchQuery) input.value = searchQuery;
        if (clear) clear.hidden = !clean(searchQuery);
    }

    function renderTabs(data) {
        const tabs = qs('booking-planner-tabs');
        if (!tabs) return;

        const items = getStateSummaryItems(data);
        tabs.innerHTML = items.map(item => {
            const active = activeTab === STATE_TAB_ID && item.status === activeStatusState ? ' active' : '';
            return `
                <button type="button" class="booking-tab booking-state-tab${active}" data-booking-state="${escapeHtml(item.status)}" data-state-tone="${escapeHtml(item.tone || 'neutral')}" title="${escapeHtml(item.fullLabel || item.status)}">
                    <strong>${escapeHtml(item.label || item.status)}</strong>
                    <span>${item.count}</span>
                </button>
            `;
        }).join('');

        tabs.querySelectorAll('[data-booking-state]').forEach(button => {
            button.addEventListener('click', () => {
                activeTab = STATE_TAB_ID;
                activeStatusState = button.dataset.bookingState || getDefaultStatusState(data);
                render();
            });
        });
    }

    function renderVenueCard(venue, tabId) {
        const booking = venue.booking || {};
        const contactRows = getContactRows(venue);
        const emailMissing = !clean(booking.contactEmail || venue.contactEmail);
        const badge = getVenueStatusBadge(venue);
        const badgeMarkup = badge.label
            ? `<span class="booking-card-status-badge" data-state-tone="${escapeHtml(badge.tone)}">${escapeHtml(badge.label)}</span>`
            : '';

        let gigChipMarkup = '';
        if (isBookedTab(tabId)) {
            const futureDates = getVenueFutureGigDates(venue);
            if (futureDates.length) {
                const nextLabel = formatShortGigDate(futureDates[0]);
                const moreCount = Math.max(0, futureDates.length - 1);
                const listMarkup = futureDates.map((date, index) => `
                    <li class="booking-gig-list-item${index === 0 ? ' is-next' : ''}">
                        <span class="booking-gig-list-bullet" aria-hidden="true">${index === 0 ? 'Next' : index + 1}</span>
                        <span>${escapeHtml(formatShortGigDate(date) || date)}</span>
                    </li>
                `).join('');
                gigChipMarkup = `
                    <div class="booking-gig-chip-wrap">
                        <button type="button" class="booking-gig-chip" data-booking-action="toggle-gig-list" data-venue-id="${escapeHtml(venue.id)}" aria-expanded="false" aria-controls="booking-gig-list-${escapeHtml(venue.id)}">
                            <span class="booking-gig-chip-icon" aria-hidden="true">&#128197;</span>
                            <span class="booking-gig-chip-label">Next gig <strong>${escapeHtml(nextLabel)}</strong></span>
                            ${moreCount > 0 ? `<span class="booking-gig-chip-count">+${moreCount}</span>` : ''}
                            <span class="booking-gig-chip-caret" aria-hidden="true">&#9662;</span>
                        </button>
                        <div id="booking-gig-list-${escapeHtml(venue.id)}" class="booking-gig-list" hidden>
                            <p class="booking-gig-list-heading">${futureDates.length} upcoming gig${futureDates.length === 1 ? '' : 's'}</p>
                            <ol class="booking-gig-list-items">${listMarkup}</ol>
                        </div>
                    </div>
                `;
            }
        }

        return `
            <article class="booking-card" data-booking-venue-id="${escapeHtml(venue.id)}" data-state-tone="${escapeHtml(badge.tone)}">
                <header class="booking-card-header">
                    <h3>${escapeHtml(venue.name || 'Unknown Venue')}</h3>
                    ${badgeMarkup}
                </header>
                <p class="booking-card-location">${escapeHtml(getVenueLocation(venue))}</p>
                ${gigChipMarkup}
                <div class="booking-card-info" aria-label="Venue contact summary">
                    ${contactRows.map(([label, value]) => `
                        <div class="booking-info-row">
                            <span>${escapeHtml(label)}</span>
                            <strong${label === 'Email' && emailMissing ? ' class="booking-missing-value"' : ''}>${escapeHtml(value)}</strong>
                        </div>
                    `).join('')}
                </div>
                <div class="booking-card-actions booking-card-actions--minimal">
                    <button type="button" class="booking-primary-action" data-booking-action="open-contact-menu" data-venue-id="${escapeHtml(venue.id)}">Contact</button>
                    <button type="button" data-booking-action="edit" data-venue-id="${escapeHtml(venue.id)}">Update Info</button>
                    <button type="button" data-booking-action="check-availability" data-venue-id="${escapeHtml(venue.id)}">Check Dates</button>
                </div>
                <p class="booking-card-save-status" aria-live="polite"></p>
            </article>
        `;
    }

    function formatWebsiteEventDate(event) {
        return [event.eventDate, event.eventTime].filter(Boolean).join(' ');
    }

    function getSourceCountLabel(event) {
        const sourceCount = (event.sourceUrls || []).length || (event.sourceUrl ? 1 : 0);
        return `${sourceCount || 1} source${sourceCount === 1 ? '' : 's'}`;
    }

    function eventSearchText(event) {
        return [
            event.eventDate,
            event.eventDay,
            event.eventTime,
            event.eventEndTime,
            event.title,
            event.venueName,
            event.venueType,
            event.location,
            event.address,
            event.city,
            event.state,
            event.zip,
            event.notes,
            event.isPrivateEvent ? 'private event' : '',
            event.isPublicPlaceholder ? 'scheduled public event placeholder' : ''
        ].map(normalizeSearchText).join(' ');
    }

    function filterWebsiteEvents(events, query) {
        const normalizedQuery = normalizeSearchText(query);
        if (!normalizedQuery) return events || [];
        return (events || []).filter(event => eventSearchText(event).includes(normalizedQuery));
    }

    function normalizeMatchText(value) {
        return clean(value)
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function findMatchingVenueForEvent(event, data) {
        if (!event || event.isPublicPlaceholder || event.isPrivateEvent) return null;
        const venues = data && Array.isArray(data.all) ? data.all : [];
        const eventVenue = normalizeMatchText(event.venueName);
        const eventAddress = normalizeMatchText(event.address || event.location);
        const eventCity = normalizeMatchText(event.city);
        if (!eventVenue && !eventAddress) return null;

        return venues.find(venue => {
            const venueName = normalizeMatchText(venue.name);
            const venueAddress = normalizeMatchText(venue.address);
            const venueCity = normalizeMatchText(venue.city);
            if (eventAddress && venueAddress && (eventAddress.includes(venueAddress) || venueAddress.includes(eventAddress))) return true;
            if (!eventVenue || !venueName) return false;
            const nameMatches = eventVenue === venueName || eventVenue.includes(venueName) || venueName.includes(eventVenue);
            if (!nameMatches) return false;
            return !eventCity || !venueCity || eventCity === venueCity;
        }) || null;
    }

    function renderWebsiteEventCard(event, tabId, data) {
        const matchedVenue = findMatchingVenueForEvent(event, data);
        const statusClass = event.isPrivateEvent ? ' warm' : event.isPublicPlaceholder ? '' : ' success';
        const sourceUrl = getExternalUrl(event.sourceUrl || (event.sourceUrls && event.sourceUrls[0]) || '');
        const timingLabel = tabId === 'websitePast' ? 'Past website event' : 'Future website event';
        const capturedLabel = (event.sourceCapturedAts || []).length
            ? `Captured ${escapeHtml(clean(event.sourceCapturedAts[event.sourceCapturedAts.length - 1]).slice(0, 10))}`
            : 'Website staged';

        return `
            <article class="booking-card website-event-card" data-website-event-id="${escapeHtml(event.id)}">
                <div class="booking-card-main">
                    <div>
                        <p class="booking-card-eyebrow">${escapeHtml(timingLabel)}</p>
                        <h3>${escapeHtml(event.venueName || event.title || 'Website Event')}</h3>
                    </div>
                    <span class="booking-status${statusClass}">${event.isPrivateEvent ? 'Private' : event.isPublicPlaceholder ? 'Placeholder' : 'Website'}</span>
                </div>
                <p class="booking-card-location">${escapeHtml(getEventLocation(event))}</p>
                <div class="booking-card-meta">
                    <span>${escapeHtml(formatWebsiteEventDate(event) || 'Date not set')}</span>
                    ${event.eventEndTime ? `<span>Ends ${escapeHtml(event.eventEndTime)}</span>` : ''}
                    <span>${escapeHtml(event.venueType || 'Other Venue')}</span>
                    <span>${escapeHtml(getSourceCountLabel(event))}</span>
                    <span>${capturedLabel}</span>
                    ${matchedVenue ? '<span>Matched to map venue</span>' : '<span>Not merged to venue yet</span>'}
                </div>
                ${event.title && event.title !== event.venueName ? `<p class="website-event-title">${escapeHtml(event.title)}</p>` : ''}
                ${event.notes ? `<p class="website-event-notes">${escapeHtml(event.notes)}</p>` : ''}
                <div class="booking-card-actions">
                    <button type="button" data-website-event-action="map" data-venue-id="${escapeHtml(matchedVenue ? matchedVenue.id : '')}"${matchedVenue ? '' : ' disabled'}>View Map</button>
                    <button type="button" data-website-event-action="copy" data-event-id="${escapeHtml(event.id)}">Copy Event</button>
                    ${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener">Source</a>` : '<button type="button" disabled>Source</button>'}
                </div>
                <p class="booking-card-save-status" aria-live="polite"></p>
            </article>
        `;
    }

    function copyWebsiteEventInfo(event) {
        const text = [
            event.venueName || event.title || 'Website Event',
            formatWebsiteEventDate(event),
            event.eventEndTime ? `Ends: ${event.eventEndTime}` : '',
            getEventLocation(event),
            event.venueType ? `Type: ${event.venueType}` : '',
            event.isPrivateEvent ? 'Private event' : '',
            event.isPublicPlaceholder ? 'Website placeholder - venue/location needs review' : '',
            event.sourceUrl ? `Source: ${event.sourceUrl}` : '',
            event.notes || ''
        ].filter(Boolean).join('\n');

        return writeClipboardText(text);
    }

    function setCardSaveStatus(card, message, tone = 'neutral') {
        const status = card && card.querySelector('.booking-card-save-status');
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function bindCardActions(container, data) {
        const byId = new Map((data.all || []).map(venue => [venue.id, venue]));
        container.querySelectorAll('[data-booking-action]').forEach(button => {
            button.addEventListener('click', async () => {
                const venue = byId.get(button.dataset.venueId);
                if (!venue) return;
                const card = button.closest('.booking-card');
                if (button.dataset.bookingAction === 'map') {
                    focusVenueOnMap(venue);
                    return;
                }
                if (button.dataset.bookingAction === 'edit') {
                    if (typeof window.BARK.openVenueEditor === 'function') {
                        window.BARK.openVenueEditor(venue);
                    } else {
                        setCardSaveStatus(card, 'Venue editor is not available yet.', 'error');
                    }
                    return;
                }
                if (button.dataset.bookingAction === 'choose-email-template') {
                    if (!openEmailTemplateModal(venue)) {
                        setCardSaveStatus(card, 'Email templates are not available yet.', 'error');
                    }
                    return;
                }
                if (button.dataset.bookingAction === 'open-contact-menu') {
                    if (!openContactMenu(venue)) {
                        setCardSaveStatus(card, 'Contact menu is not available yet.', 'error');
                    }
                    return;
                }
                if (button.dataset.bookingAction === 'check-availability') {
                    if (!openAvailabilityModal(venue)) {
                        setCardSaveStatus(card, 'Available dates are not available yet.', 'error');
                    }
                    return;
                }
                if (button.dataset.bookingAction === 'toggle-gig-list') {
                    const controlledId = button.getAttribute('aria-controls');
                    const list = controlledId ? document.getElementById(controlledId) : null;
                    if (!list) return;
                    const expanded = button.getAttribute('aria-expanded') === 'true';
                    const next = !expanded;
                    button.setAttribute('aria-expanded', next ? 'true' : 'false');
                    list.hidden = !next;
                    button.classList.toggle('is-open', next);
                    return;
                }
            });
        });
    }

    function bindWebsiteEventActions(container, data) {
        const eventsById = new Map((data.websiteAll || []).map(event => [event.id, event]));
        const venuesById = new Map((data.all || []).map(venue => [venue.id, venue]));

        container.querySelectorAll('[data-website-event-action]').forEach(button => {
            button.addEventListener('click', async () => {
                const card = button.closest('.website-event-card');
                if (button.dataset.websiteEventAction === 'map') {
                    const venue = venuesById.get(button.dataset.venueId);
                    if (venue) focusVenueOnMap(venue);
                    return;
                }

                if (button.dataset.websiteEventAction === 'copy') {
                    const event = eventsById.get(button.dataset.eventId);
                    if (!event) return;
                    const previousText = button.textContent;
                    button.disabled = true;
                    try {
                        await copyWebsiteEventInfo(event);
                        button.textContent = 'Copied';
                        setCardSaveStatus(card, 'Website event copied.', 'success');
                    } catch (error) {
                        console.error('[bookingDashboard] website event copy failed:', error);
                        button.textContent = 'Copy failed';
                        setCardSaveStatus(card, 'Could not copy website event.', 'error');
                    } finally {
                        setTimeout(() => {
                            button.textContent = previousText;
                            button.disabled = false;
                        }, 1400);
                    }
                }
            });
        });
    }

    function renderList(data) {
        const list = qs('booking-planner-list');
        const empty = qs('booking-planner-empty');
        const searchStatus = qs('booking-planner-search-status');
        if (!list || !empty) return;

        const schema = getSchema();
        const query = clean(searchQuery);
        const activeIsWebsiteEventTab = isWebsiteEventTab(activeTab);
        const activeIsStateTab = activeTab === STATE_TAB_ID;
        const tabLabel = activeIsStateTab
            ? activeStatusState || 'Current State'
            : LEGACY_TABS.find(tab => tab.id === activeTab)?.label || 'Today';
        const sourceVenues = query
            ? (data.all || [])
            : activeIsWebsiteEventTab
                ? []
                : activeIsStateTab
                    ? getActiveStatusVenues(data)
                    : (data[activeTab] || []);
        let venues = query && schema && typeof schema.filterVenues === 'function'
            ? schema.filterVenues(sourceVenues, query)
            : sourceVenues;

        const resolvedTabId = activeIsStateTab ? activeStatusState : activeTab;
        if (isBookedTab(resolvedTabId) && Array.isArray(venues)) {
            const FAR_FUTURE = '9999-99-99';
            venues = venues.slice().sort((a, b) => {
                const aNext = getVenueNextGigDate(a) || FAR_FUTURE;
                const bNext = getVenueNextGigDate(b) || FAR_FUTURE;
                if (aNext !== bNext) return aNext < bNext ? -1 : 1;
                return clean(a.name).localeCompare(clean(b.name));
            });
        }
        const sourceEvents = query ? (data.websiteAll || []) : (activeIsWebsiteEventTab ? (data[activeTab] || []) : []);
        const events = filterWebsiteEvents(sourceEvents, query);
        const rows = query
            ? [...venues, ...events]
            : activeIsWebsiteEventTab ? events : venues;

        if (searchStatus) {
            searchStatus.textContent = query
                ? `${rows.length} result${rows.length === 1 ? '' : 's'} across all planner sections and website events.`
                : '';
        }

        if (activeIsWebsiteEventTab && data.websiteBookingsStatus && data.websiteBookingsStatus.loading && !rows.length) {
            list.innerHTML = '';
            empty.hidden = false;
            empty.textContent = 'Loading staged website events...';
            return;
        }

        if (activeIsWebsiteEventTab && data.websiteBookingsStatus && data.websiteBookingsStatus.error && !rows.length) {
            list.innerHTML = '';
            empty.hidden = false;
            empty.textContent = 'Website events are not available yet. Run the staging scripts or check the static data files.';
            return;
        }

        if (!rows.length) {
            list.innerHTML = '';
            empty.hidden = false;
            empty.textContent = query
                ? 'No venues or website events match that search.'
                : `No ${activeIsWebsiteEventTab ? 'website events' : 'venues'} in ${tabLabel} right now.`;
            return;
        }

        empty.hidden = true;
        list.innerHTML = rows.slice(0, 120).map(row => row && row.kind === 'websiteEvent'
            ? renderWebsiteEventCard(row, activeTab, data)
            : renderVenueCard(row, activeIsStateTab ? activeStatusState : activeTab)
        ).join('');
        bindCardActions(list, data);
        bindWebsiteEventActions(list, data);
    }

    function updateBadge(data) {
        const badge = qs('booking-planner-badge');
        if (!badge) return;
        const count = (data.today || []).length;
        badge.style.display = count > 0 ? 'inline-flex' : 'none';
        badge.textContent = String(count);
    }

    function render() {
        const root = qs('booking-planner-dashboard');
        if (!root) return;
        const data = getDashboardData();
        syncActiveStatusState(data);
        syncActiveAgendaSection(data);
        renderSheetBridgeHealth();
        renderVenueDataSync();
        renderStats(data);
        renderAgenda(data);
        renderSearchControls();
        renderTabs(data);
        renderList(data);
        updateBadge(data);
    }

    function init() {
        bindSearchControls();
        bindEmailModalEvents();
        bindContactMenuEvents();
        bindAvailabilityModalEvents();
        render();
        loadCalendarAvailabilityData();
        checkSheetBridgeHealth(false);
        if (typeof window.addEventListener === 'function') window.addEventListener(window.BARK.VENUE_DATA_SYNC_EVENT || 'jddm:venue-data-sync', () => {
            dataRefreshState = {
                ...dataRefreshState,
                checking: false,
                checkedAt: new Date(),
                error: null
            };
            renderVenueDataSync();
        });
        if (typeof window.addEventListener === 'function') window.addEventListener(window.BARK.WEBSITE_BOOKINGS_SYNC_EVENT || 'jddm:website-bookings-sync', () => render());
        const websiteService = getWebsiteBookingsService();
        if (websiteService && typeof websiteService.loadWebsiteBookings === 'function') {
            websiteService.loadWebsiteBookings(false).then(() => render()).catch(() => render());
        }
        const repo = getRepo();
        if (repo && typeof repo.subscribe === 'function' && !unsubscribeRepo) {
            unsubscribeRepo = repo.subscribe(() => render());
        }
    }

    window.BARK.bookingDashboard = {
        init,
        render,
        getDashboardData,
        getBridgeHealthSummary,
        getMissingBookingHeaders,
        getDataFreshnessSummary,
        getStateSummaryItems,
        getDefaultStatusState,
        getAgendaSections,
        getAgendaTotal,
        filterWebsiteEvents,
        findMatchingVenueForEvent
    };

    document.addEventListener('DOMContentLoaded', init);
})();
