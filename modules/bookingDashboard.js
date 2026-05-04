/**
 * bookingDashboard.js - read-only booking planner dashboard.
 */
(function () {
    window.BARK = window.BARK || {};

    const TABS = [
        { id: 'today', label: 'Today' },
        { id: 'followUps', label: 'Follow-Ups' },
        { id: 'newProspects', label: 'New Prospects' },
        { id: 'interested', label: 'Interested' },
        { id: 'booked', label: 'Booked' },
        { id: 'missingInfo', label: 'Missing Info' },
        { id: 'doNotContact', label: 'Do Not Contact' }
    ];

    let activeTab = 'today';
    let unsubscribeRepo = null;

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

    function getDashboardData() {
        const repo = getRepo();
        const schema = getSchema();
        const venues = repo && typeof repo.getAll === 'function' ? repo.getAll() : [];
        return schema && typeof schema.getDashboardGroups === 'function'
            ? schema.getDashboardGroups(venues)
            : { today: [], followUps: [], newProspects: [], interested: [], booked: [], missingInfo: [], doNotContact: [], all: venues };
    }

    function qs(id) {
        return document.getElementById(id);
    }

    function getVenueLocation(venue) {
        return [venue.address, venue.city, venue.state, venue.zip].filter(Boolean).join(', ') || 'Northeast Ohio';
    }

    function getActionReason(venue, tabId) {
        const booking = venue.booking || {};
        if (tabId === 'followUps' || booking.isFollowUpDue) return `Follow-up due${booking.nextFollowUpDate ? `: ${booking.nextFollowUpDate}` : ''}`;
        if (tabId === 'newProspects') return booking.contactEmail ? 'Ready for first outreach' : 'Needs contact info';
        if (tabId === 'interested') return 'Interested lead';
        if (tabId === 'booked') return booking.eventDate ? `Booked: ${booking.eventDate}` : 'Booked';
        if (tabId === 'missingInfo') return 'Missing email or booking link';
        if (tabId === 'doNotContact') return 'Do not contact';
        if (booking.isInterested) return 'Interested lead';
        if (booking.isNewProspect) return 'New prospect';
        if (booking.isMissingInfo) return 'Research contact info';
        return booking.contactStatus || 'Ready to review';
    }

    function getRenderedEmail(venue) {
        const templates = getTemplateService();
        if (templates && typeof templates.renderTemplate === 'function') {
            return templates.renderTemplate(undefined, venue);
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
        if (actionType === actions.ACTION_TYPES.MARK_SENT) return booking.contactStatus === 'Sent' || booking.isBooked;
        if (actionType === actions.ACTION_TYPES.MARK_INTERESTED) return booking.isInterested || booking.isBooked;
        if (actionType === actions.ACTION_TYPES.MARK_BOOKED) return booking.isBooked;
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

    function copyEmailDraft(venue) {
        return writeClipboardText(getRenderedEmail(venue).fullText);
    }

    function focusVenueOnMap(venue) {
        const mapTab = document.querySelector('.nav-item[data-target="map-view"]');
        if (mapTab) mapTab.click();

        setTimeout(() => {
            const lat = Number(venue.lat);
            const lng = Number(venue.lng);
            if (window.map && Number.isFinite(lat) && Number.isFinite(lng)) {
                window.map.setView([lat, lng], Math.max(window.map.getZoom(), 13), { animate: true });
            }
            if (venue.marker && typeof venue.marker.fire === 'function') {
                venue.marker.fire('click');
            }
        }, 120);
    }

    function renderStats(data) {
        const stats = qs('booking-planner-stats');
        if (!stats) return;

        stats.innerHTML = [
            ['Today', data.today.length],
            ['Follow-Ups', data.followUps.length],
            ['Prospects', data.newProspects.length],
            ['Missing Info', data.missingInfo.length]
        ].map(([label, value]) => `
            <div class="booking-stat">
                <strong>${value}</strong>
                <span>${escapeHtml(label)}</span>
            </div>
        `).join('');
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
        const mailtoHref = getMailtoHref(venue);
        const renderedEmail = getRenderedEmail(venue);
        const website = getExternalUrl(booking.bookingUrl || venue.website || '');
        const statusClass = booking.doNotContact ? ' danger' : booking.isBooked ? ' success' : booking.isInterested ? ' warm' : '';

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
                    <span>${booking.contactEmail ? escapeHtml(booking.contactEmail) : 'Missing contact info'}</span>
                    <span>${escapeHtml(renderedEmail.label)} template</span>
                </div>
                <div class="booking-card-actions">
                    <button type="button" data-booking-action="map" data-venue-id="${escapeHtml(venue.id)}">View Map</button>
                    <button type="button" data-booking-action="copy" data-venue-id="${escapeHtml(venue.id)}">Copy Info</button>
                    <button type="button" data-booking-action="copy-email" data-venue-id="${escapeHtml(venue.id)}">Copy Email</button>
                    ${website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener">Website</a>` : '<button type="button" disabled>Website</button>'}
                    ${mailtoHref ? `<a href="${escapeHtml(mailtoHref)}">Email Draft</a>` : '<button type="button" disabled>Email Draft</button>'}
                    ${renderStatusActions(venue)}
                </div>
                ${renderFollowUpControl(venue)}
                <p class="booking-card-save-status" aria-live="polite"></p>
            </article>
        `;
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
                if (button.dataset.bookingAction === 'status') {
                    await saveVenueStatus(card, button, venue);
                    return;
                }
                if (button.dataset.bookingAction === 'set-follow-up') {
                    await saveFollowUpDate(card, button, venue);
                    return;
                }
                if (button.dataset.bookingAction === 'copy' || button.dataset.bookingAction === 'copy-email') {
                    const previousText = button.textContent;
                    button.disabled = true;
                    try {
                        if (button.dataset.bookingAction === 'copy-email') {
                            await copyEmailDraft(venue);
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

    function renderList(data) {
        const list = qs('booking-planner-list');
        const empty = qs('booking-planner-empty');
        const tabLabel = TABS.find(tab => tab.id === activeTab)?.label || 'Today';
        if (!list || !empty) return;

        const venues = data[activeTab] || [];
        if (!venues.length) {
            list.innerHTML = '';
            empty.hidden = false;
            empty.textContent = `No venues in ${tabLabel} right now.`;
            return;
        }

        empty.hidden = true;
        list.innerHTML = venues.slice(0, 80).map(venue => renderVenueCard(venue, activeTab)).join('');
        bindCardActions(list, data);
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
        renderStats(data);
        renderTabs(data);
        renderList(data);
        updateBadge(data);
    }

    function init() {
        render();
        const repo = getRepo();
        if (repo && typeof repo.subscribe === 'function' && !unsubscribeRepo) {
            unsubscribeRepo = repo.subscribe(() => render());
        }
    }

    window.BARK.bookingDashboard = {
        init,
        render,
        getDashboardData
    };

    document.addEventListener('DOMContentLoaded', init);
})();
