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

    function getSubject(venue) {
        return `Live acoustic music booking inquiry - Just Dee Dee Music`;
    }

    function getEmailBody(venue) {
        const booking = venue.booking || {};
        const contactName = booking.contactName || 'there';
        const venueName = venue.name || 'your venue';
        const venueType = venue.venueType || venue.category || 'venue';
        const city = venue.city || 'Northeast Ohio';

        return [
            `Hi ${contactName},`,
            '',
            `I am reaching out on behalf of Just Dee Dee Music. Dee Dee performs acoustic rock, pop, country, and folk covers across Northeast Ohio, with a flexible setlist that works well for breweries, wineries, restaurants, festivals, coffee shops, pubs, and private events.`,
            '',
            `I saw ${venueName} is a ${venueType} in ${city} and thought Dee Dee could be a strong fit for an upcoming date.`,
            '',
            'Would you be the right person to ask about booking availability?',
            '',
            'Thank you,',
            'Dee Dee',
            'Just Dee Dee Music',
            '440-628-1508',
            'JustDeeDeeMusic@gmail.com',
            'https://www.justdeedeemusic.com/'
        ].join('\n');
    }

    function getMailtoHref(venue) {
        const booking = venue.booking || {};
        if (!booking.contactEmail) return '';
        const params = new URLSearchParams({
            subject: getSubject(venue),
            body: getEmailBody(venue)
        });
        return `mailto:${encodeURIComponent(booking.contactEmail)}?${params.toString()}`;
    }

    function getExternalUrl(value) {
        const url = clean(value);
        if (!url) return '';
        if (/^https?:\/\//i.test(url)) return url;
        if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(url)) return `https://${url}`;
        return '';
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
                </div>
                <div class="booking-card-actions">
                    <button type="button" data-booking-action="map" data-venue-id="${escapeHtml(venue.id)}">View Map</button>
                    <button type="button" data-booking-action="copy" data-venue-id="${escapeHtml(venue.id)}">Copy Info</button>
                    ${website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener">Website</a>` : '<button type="button" disabled>Website</button>'}
                    ${mailtoHref ? `<a href="${escapeHtml(mailtoHref)}">Email Draft</a>` : '<button type="button" disabled>Email Draft</button>'}
                </div>
            </article>
        `;
    }

    function bindCardActions(container, data) {
        const byId = new Map((data.all || []).map(venue => [venue.id, venue]));
        container.querySelectorAll('[data-booking-action]').forEach(button => {
            button.addEventListener('click', async () => {
                const venue = byId.get(button.dataset.venueId);
                if (!venue) return;
                if (button.dataset.bookingAction === 'map') {
                    focusVenueOnMap(venue);
                    return;
                }
                if (button.dataset.bookingAction === 'copy') {
                    const previousText = button.textContent;
                    button.disabled = true;
                    try {
                        await copyVenueInfo(venue);
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
