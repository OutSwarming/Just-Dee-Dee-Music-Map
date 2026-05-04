/**
 * bookingDashboard.js - read-only booking planner dashboard.
 */
(function () {
    window.BARK = window.BARK || {};

    const TABS = [
        { id: 'today', label: 'Today' },
        { id: 'followUps', label: 'Follow-Ups' },
        { id: 'newProspects', label: 'New Prospects' },
        { id: 'priorityLeads', label: 'Priority' },
        { id: 'interested', label: 'Interested' },
        { id: 'booked', label: 'Booked' },
        { id: 'upcomingGigs', label: 'Upcoming Gigs' },
        { id: 'websiteUpcoming', label: 'Website Future' },
        { id: 'websitePast', label: 'Website Past' },
        { id: 'postGigFollowUps', label: 'Post-Gig Follow-Up' },
        { id: 'missingInfo', label: 'Missing Info' },
        { id: 'notAFit', label: 'Not a Fit' },
        { id: 'doNotContact', label: 'Do Not Contact' }
    ];

    const EXPECTED_SPREADSHEET_SCHEMA_VERSION = '2026-05-04-website-events-staging';
    const REQUIRED_BOOKING_HEADERS = [
        'contactStatus',
        'draftStatus',
        'lastContactedDate',
        'nextFollowUpDate',
        'doNotContact',
        'priority',
        'bestFitScore',
        'websiteBookingEvents'
    ];

    let activeTab = 'today';
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

    function getActionService() {
        return window.BARK.bookingActions;
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
            : { today: [], followUps: [], newProspects: [], priorityLeads: [], interested: [], booked: [], upcomingGigs: [], postGigFollowUps: [], missingInfo: [], notAFit: [], doNotContact: [], all: venues };
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
            }
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

    function getEventLocation(event) {
        return event.location || [event.address, event.city, event.state, event.zip].filter(Boolean).join(', ') || 'Location not published yet';
    }

    function isWebsiteEventTab(tabId) {
        return tabId === 'websiteUpcoming' || tabId === 'websitePast';
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
                detail: `Connected to ${health.sheetName || 'the sheet'}, but the bridge version is ${health.schemaVersion || 'unknown'}. Deploy the safe booking-column script before live edits.`,
                actionLabel: 'Recheck',
                actionDisabled: false
            };
        }

        if (missingHeaders.length) {
            return {
                tone: 'warning',
                label: 'Booking columns missing',
                detail: `Missing: ${missingHeaders.join(', ')}. Reopen the Apps Script bridge after deployment and run setup.`,
                actionLabel: 'Recheck',
                actionDisabled: false
            };
        }

        return {
            tone: 'success',
            label: 'Sheet bridge ready',
            detail: `${health.sheetName || 'Google Sheet'} is using the safe booking-column bridge.`,
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
        if (tabId === 'interested') return 'Interested lead';
        if (tabId === 'booked') return booking.eventDate ? `Booked: ${booking.eventDate}` : 'Booked';
        if (tabId === 'upcomingGigs') return booking.eventDate ? `Upcoming gig: ${booking.eventDate}` : 'Upcoming gig';
        if (tabId === 'postGigFollowUps') return booking.eventDate ? `Post-gig follow-up: ${booking.eventDate}` : 'Post-gig follow-up';
        if (tabId === 'missingInfo') return 'Missing email or booking link';
        if (tabId === 'notAFit') return 'Not a fit for booking';
        if (tabId === 'doNotContact') return 'Do not contact';
        if (booking.isPostGigFollowUpDue) return 'Post-gig follow-up due';
        if (booking.isUpcomingGig) return booking.eventDate ? `Upcoming gig: ${booking.eventDate}` : 'Upcoming gig';
        if (booking.isNotAFit) return 'Not a fit for booking';
        if (booking.isInterested) return 'Interested lead';
        if (booking.isPriorityLead) return `Priority ${booking.priority || 0} / Fit ${booking.bestFitScore || 0}`;
        if (booking.isNewProspect) return 'New prospect';
        if (booking.isMissingInfo) return 'Research contact info';
        return booking.contactStatus || 'Ready to review';
    }

    function getRenderedEmail(venue, templateType) {
        const templates = getTemplateService();
        if (templates && typeof templates.renderTemplate === 'function') {
            return templates.renderTemplate(templateType, venue);
        }

        const subject = 'Live acoustic music booking inquiry - Just Dee Dee Music';
        const body = [
            'Hi there,',
            '',
            'I am reaching out on behalf of Just Dee Dee Music about live acoustic music booking availability.',
            '',
            'Thank you,',
            'Dee Dee',
            'Just Dee Dee Music',
            '440-628-1508',
            'JustDeeDeeMusic@gmail.com',
            'https://www.justdeedeemusic.com/'
        ].join('\n');
        return {
            type: 'firstOutreach',
            label: 'First Outreach',
            subject,
            body,
            fullText: [`Subject: ${subject}`, '', body].join('\n')
        };
    }

    function getMailtoHref(venue) {
        const templates = getTemplateService();
        if (templates && typeof templates.getMailtoHref === 'function') {
            return templates.getMailtoHref(venue);
        }
        return '';
    }

    function getSelectedTemplateType(card) {
        const select = card && card.querySelector('[data-booking-template-select]');
        return select ? clean(select.value) : '';
    }

    function getExternalUrl(value) {
        const url = clean(value);
        if (!url) return '';
        if (/^https?:\/\//i.test(url)) return url;
        if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(url)) return `https://${url}`;
        return '';
    }

    function isStatusActionDisabled(venue, actionType) {
        const actions = getActionService();
        const booking = venue.booking || {};
        if (!actions || !actions.ACTION_TYPES) return true;
        if (booking.doNotContact) return true;
        if (actionType === actions.ACTION_TYPES.MARK_DRAFT_READY) return booking.contactStatus === 'Draft Ready' || booking.isBooked || booking.isNotAFit;
        if (actionType === actions.ACTION_TYPES.MARK_SENT) return booking.contactStatus === 'Sent' || booking.isBooked;
        if (actionType === actions.ACTION_TYPES.MARK_INTERESTED) return booking.isInterested || booking.isBooked;
        if (actionType === actions.ACTION_TYPES.MARK_BOOKED) return booking.isBooked;
        if (actionType === actions.ACTION_TYPES.MARK_NOT_A_FIT) return booking.isNotAFit || booking.isBooked;
        if (actionType === actions.ACTION_TYPES.MARK_DO_NOT_CONTACT) return Boolean(booking.doNotContact);
        return false;
    }

    function renderStatusActions(venue) {
        const actions = getActionService();
        if (!actions || !Array.isArray(actions.ACTION_DEFINITIONS)) return '';

        return actions.ACTION_DEFINITIONS.map(action => {
            const disabled = isStatusActionDisabled(venue, action.type) ? ' disabled' : '';
            const danger = action.danger ? ' booking-danger-action' : '';
            return `<button type="button" class="booking-status-action${danger}" data-booking-action="status" data-booking-status-action="${escapeHtml(action.type)}" data-venue-id="${escapeHtml(venue.id)}"${disabled}>${escapeHtml(action.label)}</button>`;
        }).join('');
    }

    function getFollowUpInputValue(venue) {
        const value = clean(venue.booking && venue.booking.nextFollowUpDate);
        return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
    }

    function renderFollowUpControl(venue) {
        const booking = venue.booking || {};
        const disabled = booking.doNotContact ? ' disabled' : '';
        const inputValue = getFollowUpInputValue(venue);
        return `
            <div class="booking-followup-control">
                <label>
                    <span>Next Follow-Up</span>
                    <input type="date" data-booking-followup-date data-venue-id="${escapeHtml(venue.id)}" value="${escapeHtml(inputValue)}"${disabled}>
                </label>
                <button type="button" data-booking-action="set-follow-up" data-venue-id="${escapeHtml(venue.id)}"${disabled}>Set Date</button>
            </div>
        `;
    }

    function getScoreInputValue(value) {
        const numberValue = Number(clean(value));
        if (!Number.isFinite(numberValue)) return 0;
        return Math.max(0, Math.min(10, Math.round(numberValue)));
    }

    function renderPriorityScoreControl(venue) {
        const booking = venue.booking || {};
        const disabled = booking.doNotContact ? ' disabled' : '';
        return `
            <div class="booking-score-control">
                <label>
                    <span>Priority</span>
                    <input type="number" min="0" max="10" step="1" inputmode="numeric" data-booking-priority-score data-venue-id="${escapeHtml(venue.id)}" value="${escapeHtml(getScoreInputValue(booking.priority))}"${disabled}>
                </label>
                <label>
                    <span>Best Fit</span>
                    <input type="number" min="0" max="10" step="1" inputmode="numeric" data-booking-best-fit-score data-venue-id="${escapeHtml(venue.id)}" value="${escapeHtml(getScoreInputValue(booking.bestFitScore))}"${disabled}>
                </label>
                <button type="button" data-booking-action="set-score" data-venue-id="${escapeHtml(venue.id)}"${disabled}>Save Score</button>
            </div>
        `;
    }

    function renderTemplateControl(venue) {
        const templates = getTemplateService();
        if (!templates || typeof templates.getTemplateOptions !== 'function') return '';

        const suggestedType = templates.getSuggestedTemplateType(venue);
        const options = templates.getTemplateOptions();
        return `
            <div class="booking-template-control">
                <label>
                    <span>Email Template</span>
                    <select data-booking-template-select data-venue-id="${escapeHtml(venue.id)}">
                        ${options.map(option => `<option value="${escapeHtml(option.type)}"${option.type === suggestedType ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
                    </select>
                </label>
            </div>
        `;
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

    function copyVenueInfo(venue) {
        const booking = venue.booking || {};
        const text = [
            venue.name || 'Unknown Venue',
            getVenueLocation(venue),
            `Status: ${booking.contactStatus || 'Not Contacted'}`,
            booking.contactName ? `Contact: ${booking.contactName}` : '',
            booking.contactEmail ? `Email: ${booking.contactEmail}` : '',
            booking.contactPhone ? `Phone: ${booking.contactPhone}` : '',
            venue.website ? `Website: ${venue.website}` : '',
            booking.bookingUrl ? `Booking: ${booking.bookingUrl}` : ''
        ].filter(Boolean).join('\n');

        return writeClipboardText(text);
    }

    function copyEmailDraft(venue, templateType, copyTarget = 'fullText') {
        const rendered = getRenderedEmail(venue, templateType);
        return writeClipboardText(rendered[copyTarget] || rendered.fullText);
    }

    function openEmailDraft(venue, templateType) {
        const templates = getTemplateService();
        const href = templates && typeof templates.getMailtoHref === 'function'
            ? templates.getMailtoHref(venue, templateType)
            : '';
        if (!href) return false;
        window.location.href = href;
        return true;
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

        stats.innerHTML = [
            ['Today', data.today.length],
            ['Follow-Ups', data.followUps.length],
            ['Prospects', data.newProspects.length],
            ['Priority', data.priorityLeads.length],
            ['Web Future', data.websiteUpcoming.length],
            ['Web Past', data.websitePast.length]
        ].map(([label, value]) => `
            <div class="booking-stat">
                <strong>${value}</strong>
                <span>${escapeHtml(label)}</span>
            </div>
        `).join('');
    }

    function getAgendaTargetTab(item) {
        if (!item) return 'today';
        if (item.type === 'postGigFollowUp') return 'postGigFollowUps';
        if (item.type === 'upcomingGig') return 'upcomingGigs';
        if (item.type === 'priorityLead') return 'priorityLeads';
        if (item.type === 'newProspect') return 'newProspects';
        if (item.type === 'missingInfo') return 'missingInfo';
        if (item.type === 'interested' || item.type === 'interestedDue') return 'interested';
        if (item.type === 'followUpDue') return 'followUps';
        return 'today';
    }

    function renderAgenda(data) {
        const agenda = qs('booking-daily-agenda');
        if (!agenda) return;

        const items = Array.isArray(data.dailyAgenda) ? data.dailyAgenda : [];
        if (!items.length) {
            agenda.innerHTML = `
                <div class="booking-agenda-header">
                    <div>
                        <p class="booking-kicker">Daily Agenda</p>
                        <h3>All clear right now</h3>
                    </div>
                </div>
                <p class="booking-agenda-empty">No urgent booking actions are due. Check New Prospects or Missing Info when you are ready to keep building the list.</p>
            `;
            return;
        }

        agenda.innerHTML = `
            <div class="booking-agenda-header">
                <div>
                    <p class="booking-kicker">Daily Agenda</p>
                    <h3>Top booking moves</h3>
                </div>
                <span>${items.length}</span>
            </div>
            <div class="booking-agenda-list">
                ${items.map((item, index) => `
                    <article class="booking-agenda-item">
                        <strong>${index + 1}</strong>
                        <div>
                            <h4>${escapeHtml(item.venueName)}</h4>
                            <p>${escapeHtml(item.reason)}</p>
                            <span>${escapeHtml(item.suggestedAction)}</span>
                        </div>
                        <button type="button" data-agenda-action="open-list" data-venue-id="${escapeHtml(item.venueId)}" data-target-tab="${escapeHtml(getAgendaTargetTab(item))}">Open</button>
                    </article>
                `).join('')}
            </div>
        `;

        agenda.querySelectorAll('[data-agenda-action="open-list"]').forEach(button => {
            button.addEventListener('click', () => {
                activeTab = button.dataset.targetTab || 'today';
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
    }

    function bindSearchControls() {
        if (bindSearchControls.bound) return;
        const input = qs('booking-planner-search-input');
        const clear = qs('booking-planner-search-clear');
        if (!input) return;

        bindSearchControls.bound = true;
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

        tabs.innerHTML = TABS.map(tab => {
            const count = data[tab.id] ? data[tab.id].length : 0;
            const active = tab.id === activeTab ? ' active' : '';
            return `<button type="button" class="booking-tab${active}" data-booking-tab="${tab.id}">${escapeHtml(tab.label)} <span>${count}</span></button>`;
        }).join('');

        tabs.querySelectorAll('[data-booking-tab]').forEach(button => {
            button.addEventListener('click', () => {
                activeTab = button.dataset.bookingTab;
                render();
            });
        });
    }

    function renderVenueCard(venue, tabId) {
        const booking = venue.booking || {};
        const renderedEmail = getRenderedEmail(venue);
        const website = getExternalUrl(booking.bookingUrl || venue.website || '');
        const statusClass = booking.doNotContact ? ' danger' : booking.isBooked ? ' success' : booking.isInterested ? ' warm' : '';
        const hasEmailDraft = Boolean(getMailtoHref(venue));
        const eventLabel = [booking.eventDate || venue.eventDate, booking.eventTime || venue.eventTime].filter(Boolean).join(' ');
        const priorityLabel = `Priority ${getScoreInputValue(booking.priority)}`;
        const fitLabel = `Fit ${getScoreInputValue(booking.bestFitScore)}`;

        return `
            <article class="booking-card" data-booking-venue-id="${escapeHtml(venue.id)}">
                <div class="booking-card-main">
                    <div>
                        <p class="booking-card-eyebrow">${escapeHtml(getActionReason(venue, tabId))}</p>
                        <h3>${escapeHtml(venue.name || 'Unknown Venue')}</h3>
                    </div>
                    <span class="booking-status${statusClass}">${escapeHtml(booking.contactStatus || 'Not Contacted')}</span>
                </div>
                <p class="booking-card-location">${escapeHtml(getVenueLocation(venue))}</p>
                <div class="booking-card-meta">
                    <span>${escapeHtml(venue.venueType || venue.category || 'Other Venue')}</span>
                    ${eventLabel ? `<span>Gig: ${escapeHtml(eventLabel)}</span>` : ''}
                    <span>${escapeHtml(priorityLabel)}</span>
                    <span>${escapeHtml(fitLabel)}</span>
                    <span>${booking.contactEmail ? escapeHtml(booking.contactEmail) : 'Missing contact info'}</span>
                    <span>${escapeHtml(renderedEmail.label)} template</span>
                </div>
                ${renderTemplateControl(venue)}
                <div class="booking-card-actions">
                    <button type="button" data-booking-action="map" data-venue-id="${escapeHtml(venue.id)}">View Map</button>
                    <button type="button" data-booking-action="edit" data-venue-id="${escapeHtml(venue.id)}">Edit</button>
                    <button type="button" data-booking-action="copy" data-venue-id="${escapeHtml(venue.id)}">Copy Info</button>
                    <button type="button" data-booking-action="copy-template" data-copy-target="subject" data-venue-id="${escapeHtml(venue.id)}">Copy Subject</button>
                    <button type="button" data-booking-action="copy-template" data-copy-target="body" data-venue-id="${escapeHtml(venue.id)}">Copy Body</button>
                    <button type="button" data-booking-action="copy-template" data-copy-target="fullText" data-venue-id="${escapeHtml(venue.id)}">Copy Email</button>
                    ${website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener">Website</a>` : '<button type="button" disabled>Website</button>'}
                    <button type="button" data-booking-action="open-email-draft" data-venue-id="${escapeHtml(venue.id)}"${hasEmailDraft ? '' : ' disabled'}>Email Draft</button>
                    ${renderStatusActions(venue)}
                </div>
                ${renderPriorityScoreControl(venue)}
                ${renderFollowUpControl(venue)}
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

    function setCardButtonsBusy(card, isBusy) {
        if (!card) return;
        card.querySelectorAll('button').forEach(button => {
            if (isBusy) {
                button.dataset.wasDisabled = button.disabled ? '1' : '0';
                button.disabled = true;
            } else if (button.dataset.wasDisabled !== '1') {
                button.disabled = false;
            }
        });
        card.querySelectorAll('input').forEach(input => {
            if (isBusy) {
                input.dataset.wasDisabled = input.disabled ? '1' : '0';
                input.disabled = true;
            } else if (input.dataset.wasDisabled !== '1') {
                input.disabled = false;
            }
        });
        card.querySelectorAll('select').forEach(select => {
            if (isBusy) {
                select.dataset.wasDisabled = select.disabled ? '1' : '0';
                select.disabled = true;
            } else if (select.dataset.wasDisabled !== '1') {
                select.disabled = false;
            }
        });
    }

    async function saveVenueStatus(card, button, venue) {
        const actions = getActionService();
        if (!actions || typeof actions.saveStatus !== 'function') return;

        const statusAction = button.dataset.bookingStatusAction;
        if (
            actions.ACTION_TYPES &&
            statusAction === actions.ACTION_TYPES.MARK_DO_NOT_CONTACT &&
            typeof window.confirm === 'function' &&
            !window.confirm(`Mark ${venue.name || 'this venue'} as Do Not Contact?`)
        ) {
            return;
        }

        const previousText = button.textContent;
        setCardButtonsBusy(card, true);
        setCardSaveStatus(card, 'Saving status...', 'neutral');
        button.textContent = 'Saving';

        try {
            await actions.saveStatus(venue, statusAction);
            button.textContent = 'Saved';
            setCardSaveStatus(card, 'Saved to spreadsheet.', 'success');
            setTimeout(() => render(), 350);
        } catch (error) {
            console.error('[bookingDashboard] status save failed:', error);
            button.textContent = previousText;
            setCardSaveStatus(card, error.message || 'Could not save status.', 'error');
        } finally {
            setCardButtonsBusy(card, false);
        }
    }

    async function saveFollowUpDate(card, button, venue) {
        const actions = getActionService();
        if (!actions || typeof actions.saveFollowUpDate !== 'function') return;

        const input = card && card.querySelector('[data-booking-followup-date]');
        const nextDate = input ? input.value : '';
        const previousText = button.textContent;

        setCardButtonsBusy(card, true);
        setCardSaveStatus(card, 'Saving follow-up date...', 'neutral');
        button.textContent = 'Saving';

        try {
            await actions.saveFollowUpDate(venue, nextDate);
            button.textContent = 'Saved';
            setCardSaveStatus(card, 'Follow-up date saved.', 'success');
            setTimeout(() => render(), 350);
        } catch (error) {
            console.error('[bookingDashboard] follow-up save failed:', error);
            button.textContent = previousText;
            setCardSaveStatus(card, error.message || 'Could not save follow-up date.', 'error');
        } finally {
            setCardButtonsBusy(card, false);
        }
    }

    async function savePriorityScore(card, button, venue) {
        const actions = getActionService();
        if (!actions || typeof actions.savePriorityScore !== 'function') return;

        const priorityInput = card && card.querySelector('[data-booking-priority-score]');
        const bestFitInput = card && card.querySelector('[data-booking-best-fit-score]');
        const previousText = button.textContent;

        setCardButtonsBusy(card, true);
        setCardSaveStatus(card, 'Saving priority score...', 'neutral');
        button.textContent = 'Saving';

        try {
            await actions.savePriorityScore(venue, priorityInput ? priorityInput.value : 0, bestFitInput ? bestFitInput.value : 0);
            button.textContent = 'Saved';
            setCardSaveStatus(card, 'Priority score saved.', 'success');
            setTimeout(() => render(), 350);
        } catch (error) {
            console.error('[bookingDashboard] priority score save failed:', error);
            button.textContent = previousText;
            setCardSaveStatus(card, error.message || 'Could not save priority score.', 'error');
        } finally {
            setCardButtonsBusy(card, false);
        }
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
                if (button.dataset.bookingAction === 'status') {
                    await saveVenueStatus(card, button, venue);
                    return;
                }
                if (button.dataset.bookingAction === 'set-follow-up') {
                    await saveFollowUpDate(card, button, venue);
                    return;
                }
                if (button.dataset.bookingAction === 'set-score') {
                    await savePriorityScore(card, button, venue);
                    return;
                }
                if (button.dataset.bookingAction === 'open-email-draft') {
                    if (!openEmailDraft(venue, getSelectedTemplateType(card))) {
                        setCardSaveStatus(card, 'Missing contact email for this venue.', 'error');
                    }
                    return;
                }
                if (button.dataset.bookingAction === 'copy' || button.dataset.bookingAction === 'copy-template') {
                    const previousText = button.textContent;
                    button.disabled = true;
                    try {
                        if (button.dataset.bookingAction === 'copy-template') {
                            await copyEmailDraft(venue, getSelectedTemplateType(card), button.dataset.copyTarget);
                        } else {
                            await copyVenueInfo(venue);
                        }
                        button.textContent = 'Copied';
                    } catch (error) {
                        console.error('[bookingDashboard] copy failed:', error);
                        button.textContent = 'Copy failed';
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
        const tabLabel = TABS.find(tab => tab.id === activeTab)?.label || 'Today';
        if (!list || !empty) return;

        const schema = getSchema();
        const query = clean(searchQuery);
        const activeIsWebsiteEventTab = isWebsiteEventTab(activeTab);
        const sourceVenues = query ? (data.all || []) : (activeIsWebsiteEventTab ? [] : (data[activeTab] || []));
        const venues = query && schema && typeof schema.filterVenues === 'function'
            ? schema.filterVenues(sourceVenues, query)
            : sourceVenues;
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
            : renderVenueCard(row, activeTab)
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
        render();
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
        filterWebsiteEvents,
        findMatchingVenueForEvent
    };

    document.addEventListener('DOMContentLoaded', init);
})();
