/**
 * panelRenderer.js - Marker click panel rendering.
 * Phase 2 move-only extraction from dataService.js.
 *
 * Future card architecture notes:
 *   This renderer currently assumes a clicked marker is an official BARK park
 *   with canonical data in marker._parkData. Long term, the slide panel should
 *   become a reusable card host that can render multiple card modes without
 *   competing panels:
 *
 *     1. OfficialParkCard
 *        Canonical BARK data: name, state, category, swag links, official info,
 *        official websites, check-in controls, and "add to trip".
 *
 *     2. TripPlaceCard
 *        User itinerary data for non-official places such as towns, hotels,
 *        restaurants, trailheads, or geocoded stops. This card can show name,
 *        coordinates, directions, remove-from-trip, and later per-trip notes.
 *
 *     3. MyVisitCard / MemoryCard
 *        User-owned content: personal notes, dog/BARK photos, visit dates,
 *        private/public visibility, and future review-style fields. This card
 *        should be lazy-loaded after the panel opens. Do not load photos or
 *        rich editors for every marker during map rendering.
 *
 *   Important separation:
 *     Official data should remain read-only from ParkRepo/CSV.
 *     Personal data should live in a user-owned service/collection and be
 *     composed into the panel at render time. Avoid copying personal notes or
 *     photo refs into marker fingerprints, allPoints, or saved route stops; it
 *     would cause unnecessary marker churn and blur official/user ownership.
 *
 *   Suggested future API:
 *     window.BARK.openPlaceCard({
 *       kind: 'official' | 'tripPlace',
 *       placeId,
 *       customPlaceId,
 *       tripStopId,
 *       focus: 'details' | 'memory' | 'photos' | 'notes'
 *     })
 */
window.BARK = window.BARK || {};

function notifyPanelUser(message, options = {}) {
    if (window.BARK && typeof window.BARK.showTripToast === 'function') {
        window.BARK.showTripToast(message, options);
        return;
    }
    console.info('[JDDM Notice]', message);
}

function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function cleanPanelValue(value) {
    return String(value === undefined || value === null ? '' : value).trim();
}

function getVenueBookingValue(d, key) {
    if (!d) return '';
    const booking = d.booking || {};
    return cleanPanelValue(booking[key] || d[key]);
}

function getVenueStatus(d) {
    return getVenueBookingValue(d, 'contactStatus') || cleanPanelValue(d && d.status);
}

function getVenueNotes(d) {
    if (!d) return '';
    return cleanPanelValue(d.notes || (d.booking && d.booking.notes) || d.info);
}

function renderLinkedPanelValue(label, value) {
    const text = cleanPanelValue(value);
    if (!text) return 'Not set';

    if (label === 'Email/Contact' && /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) {
        const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)[0];
        return `<a href="mailto:${escapeHtml(email)}">${escapeHtml(text)}</a>`;
    }

    if (label === 'Phone Number') {
        const phone = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/);
        if (phone) return `<a href="tel:${escapeHtml(phone[0].replace(/[^+\d]/g, ''))}">${escapeHtml(text)}</a>`;
    }

    return escapeHtml(text).replace(/\n/g, '<br>');
}

function renderCrmDetailRows(d) {
    const fields = [
        ['Status', getVenueStatus(d)],
        ['Last Contacted', getVenueBookingValue(d, 'lastContactedDate')],
        ['Contact Name', getVenueBookingValue(d, 'contactName')],
        ['Email/Contact', getVenueBookingValue(d, 'contactEmail')],
        ['Phone Number', getVenueBookingValue(d, 'contactPhone')],
        ['Contact Type', getVenueBookingValue(d, 'contactType')],
        ['Next Follow Up', getVenueBookingValue(d, 'nextFollowUpDate')],
        ['Notes', getVenueNotes(d)]
    ];

    return fields.map(([label, value]) => {
        const isNotes = label === 'Notes';
        return `
            <div class="crm-card-field${isNotes ? ' crm-card-field--wide' : ''}">
                <span class="crm-card-label">${escapeHtml(label)}</span>
                <div class="crm-card-value">${renderLinkedPanelValue(label, value)}</div>
            </div>
        `;
    }).join('');
}

function renderMarkerClickPanel(context) {
    const marker = context.marker;
    const slidePanel = context.slidePanel;
    const titleEl = context.titleEl;
    const infoSection = context.infoSection;
    const infoEl = context.infoEl;
    const websitesContainer = context.websitesContainer;
    const picsEl = context.picsEl;
    const videoEl = context.videoEl;
    const refreshOnly = context.refreshOnly === true;

    if (!refreshOnly && window.BARK.activePinMarker && window.BARK.activePinMarker._icon) {
        window.BARK.activePinMarker._icon.classList.remove('active-pin');
    }
    if (marker._icon) {
        marker._icon.classList.add('active-pin');
    }
    window.BARK.activePinMarker = marker;

    const panelScrollContainer = document.querySelector('.panel-content');
    if (panelScrollContainer && !refreshOnly) panelScrollContainer.scrollTop = 0;

    if (!refreshOnly) document.getElementById('filter-panel').classList.add('collapsed');

    const d = marker._parkData;
    if (titleEl) titleEl.textContent = d.name || 'Unknown Venue';

    const metaContainer = document.getElementById('panel-meta-container');
    if (metaContainer) {
        const status = getVenueStatus(d) || 'Not set';
        const lastContacted = getVenueBookingValue(d, 'lastContactedDate') || 'Not set';
        const nextFollowUp = getVenueBookingValue(d, 'nextFollowUpDate') || 'Not set';
        metaContainer.innerHTML = `
            <div class="meta-pill">Status ${escapeHtml(status)}</div>
            <div class="meta-pill">Last Contacted ${escapeHtml(lastContacted)}</div>
            <div class="meta-pill">Next Follow Up ${escapeHtml(nextFollowUp)}</div>
        `;
    }

    const suggestEditBtn = document.getElementById('suggest-edit-btn');
    if (suggestEditBtn) {
        suggestEditBtn.onclick = (event) => {
            event.preventDefault();
            if (window.BARK && typeof window.BARK.openVenueEditor === 'function') {
                window.BARK.openVenueEditor(d);
                return;
            }
            notifyPanelUser('Spreadsheet editor is still loading. Try again in a moment.');
        };
    }

    if (infoSection) {
        infoSection.style.display = 'block';
        const label = infoSection.querySelector('.panel-label');
        if (label) label.textContent = 'Spreadsheet CRM Fields';
    }
    const infoContainer = document.getElementById('panel-info-container');
    const showMoreBtn = document.getElementById('show-more-info');
    if (infoContainer) infoContainer.classList.remove('report-collapsed');
    if (showMoreBtn) showMoreBtn.style.display = 'none';
    if (infoEl) infoEl.innerHTML = `<div class="crm-card-field-grid">${renderCrmDetailRows(d)}</div>`;

    const mediaLinks = document.getElementById('media-links');
    if (mediaLinks) mediaLinks.style.display = 'none';
    if (websitesContainer) { websitesContainer.style.display = 'none'; websitesContainer.innerHTML = ''; }
    if (picsEl) { picsEl.style.display = 'none'; picsEl.innerHTML = ''; }
    if (videoEl) { videoEl.style.display = 'none'; videoEl.removeAttribute('href'); }

    const stickyFooter = document.getElementById('panel-sticky-footer');
    if (stickyFooter) {
        stickyFooter.style.display = 'none';
        stickyFooter.innerHTML = '';
    }

    const visitedSection = document.getElementById('panel-visited-section');
    if (visitedSection) visitedSection.style.display = 'none';

    // --- SMART AUTO-PAN ---
    if (!refreshOnly && !window.stopAutoMovements) {
        const currentZoom = map.getZoom();
        const xOffset = window.innerWidth >= 768 ? -250 : 0;
        const yOffset = window.innerWidth < 768 ? 180 : 0;
        const targetPoint = map.project([d.lat, d.lng], currentZoom).add([xOffset, yOffset]);
        const targetLatLng = map.unproject(targetPoint, currentZoom);

        map.panTo(targetLatLng, {
            animate: !window.instantNav,
            duration: window.instantNav ? 0 : 0.5
        });
    }

    const mapIsActive = typeof window.BARK.isMapVisibleByDefaultViewState === 'function'
        ? window.BARK.isMapVisibleByDefaultViewState()
        : !document.querySelector('.ui-view.active');

    if (slidePanel) {
        if (mapIsActive) slidePanel.classList.add('open');
        else slidePanel.classList.remove('open');
    }
}

window.BARK.renderMarkerClickPanel = renderMarkerClickPanel;
