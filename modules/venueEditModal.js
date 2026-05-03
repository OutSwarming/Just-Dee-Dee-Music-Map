/**
 * venueEditModal.js - Marker-card spreadsheet editing UI.
 */
(function () {
    window.BARK = window.BARK || {};

    const SOURCE_FIELD_ORDER = [
        'Place',
        'Rank',
        'Contacted',
        'Want',
        '#Times',
        'Contact Type',
        'Card',
        'Played',
        'Music',
        'Days/Months',
        'Contact Name',
        'Email/Contact',
        'Phone Number',
        'Website',
        'Status',
        'Yearly Booking',
        'Notes',
        'Longitude',
        'Latitude',
        'Site ID'
    ];

    let activeVenue = null;
    let activeRawFields = {};

    function qs(id) {
        return document.getElementById(id);
    }

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

    function getSpreadsheetService() {
        return window.BARK.services && window.BARK.services.spreadsheet;
    }

    function setStatus(message, tone = 'neutral') {
        const status = qs('venue-edit-status');
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function setBusy(isBusy) {
        const saveBtn = qs('venue-edit-save');
        const refreshBtn = qs('venue-edit-refresh');
        if (saveBtn) saveBtn.disabled = Boolean(isBusy);
        if (refreshBtn) refreshBtn.disabled = Boolean(isBusy);
    }

    function openModal() {
        const modal = qs('venue-edit-modal');
        if (!modal) return;
        modal.hidden = false;
        document.body.classList.add('venue-edit-open');
        const firstInput = modal.querySelector('input, textarea, select, button');
        if (firstInput) firstInput.focus({ preventScroll: true });
    }

    function closeModal() {
        const modal = qs('venue-edit-modal');
        if (!modal) return;
        modal.hidden = true;
        document.body.classList.remove('venue-edit-open');
        activeVenue = null;
        activeRawFields = {};
    }

    function renderRawFields(rawFields) {
        const container = qs('venue-edit-source-fields');
        if (!container) return;

        activeRawFields = rawFields && typeof rawFields === 'object' ? rawFields : {};
        const known = SOURCE_FIELD_ORDER.filter(header => Object.prototype.hasOwnProperty.call(activeRawFields, header));
        const extras = Object.keys(activeRawFields)
            .filter(header => !known.includes(header))
            .sort((a, b) => a.localeCompare(b));
        const headers = [...known, ...extras];

        if (headers.length === 0) {
            container.innerHTML = '<p class="venue-edit-help">Source spreadsheet row will appear here once the bridge is connected.</p>';
            return;
        }

        container.innerHTML = headers.map(header => {
            const id = `venue-edit-source-${header.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
            const value = activeRawFields[header] === undefined || activeRawFields[header] === null ? '' : activeRawFields[header];
            const tall = clean(value).length > 80 || ['Notes', 'Status'].includes(header);
            const input = tall
                ? `<textarea id="${id}" data-source-header="${escapeHtml(header)}" rows="3">${escapeHtml(value)}</textarea>`
                : `<input id="${id}" data-source-header="${escapeHtml(header)}" type="text" value="${escapeHtml(value)}">`;
            return `<div class="venue-edit-field${tall ? ' venue-edit-field--wide' : ''}"><label for="${id}">${escapeHtml(header)}</label>${input}</div>`;
        }).join('');
    }

    function collectRawFields() {
        const modal = qs('venue-edit-modal');
        if (!modal) return {};
        return Array.from(modal.querySelectorAll('[data-source-header]')).reduce((fields, input) => {
            fields[input.dataset.sourceHeader] = input.value;
            return fields;
        }, {});
    }

    function getRawField(rawFields, headers) {
        for (const header of headers) {
            if (Object.prototype.hasOwnProperty.call(rawFields, header) && clean(rawFields[header])) {
                return clean(rawFields[header]);
            }

            const normalized = header.toLowerCase();
            const match = Object.keys(rawFields).find(key => key.toLowerCase() === normalized && clean(rawFields[key]));
            if (match) return clean(rawFields[match]);
        }
        return '';
    }

    function parsePlace(value) {
        const raw = clean(value).replace(/\s+/g, ' ');
        if (!raw) return {};

        const parts = raw.split(',').map(part => clean(part)).filter(Boolean);
        const parsed = {
            name: parts[0] || raw,
            address: '',
            city: '',
            state: 'OH',
            zip: ''
        };

        if (parts.length >= 3) {
            const stateZip = parts[parts.length - 1].match(/\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/i);
            parsed.city = parts[parts.length - 2] || '';
            parsed.address = parts.slice(1, -2).join(', ');
            if (stateZip) {
                parsed.state = stateZip[1].toUpperCase();
                parsed.zip = stateZip[2];
            }
        }

        return parsed;
    }

    function normalizeBoolean(value) {
        const raw = clean(value).toLowerCase();
        return ['true', 'yes', 'y', '1', 'private'].includes(raw);
    }

    function normalizePlayed(value) {
        const raw = clean(value).toLowerCase();
        return ['true', 'yes', 'y', '1', 'played', 'visited'].includes(raw);
    }

    function buildVenueFromRawFields(rawFields) {
        const parsedPlace = parsePlace(getRawField(rawFields, ['Place']));
        const name = getRawField(rawFields, ['venue name', 'name', 'Location']) || parsedPlace.name || activeVenue.name;
        const contactBits = [
            getRawField(rawFields, ['Contact Name']),
            getRawField(rawFields, ['Email/Contact']),
            getRawField(rawFields, ['Phone Number']),
            getRawField(rawFields, ['Contact Type'])
        ].filter(Boolean);

        return {
            id: getRawField(rawFields, ['Site ID', 'id']) || activeVenue.id,
            name,
            address: getRawField(rawFields, ['address']) || parsedPlace.address || activeVenue.address,
            city: getRawField(rawFields, ['city']) || parsedPlace.city || activeVenue.city,
            state: getRawField(rawFields, ['state']) || parsedPlace.state || activeVenue.state || 'OH',
            zip: getRawField(rawFields, ['zip', 'zipcode', 'zip code']) || parsedPlace.zip || activeVenue.zip,
            lat: getRawField(rawFields, ['Latitude', 'lat']) || activeVenue.lat,
            lng: getRawField(rawFields, ['Longitude', 'lng', 'long']) || activeVenue.lng,
            venueType: getRawField(rawFields, ['venue type', 'type']) || activeVenue.venueType || activeVenue.category || 'Other Venue',
            website: getRawField(rawFields, ['Website', 'website/social link']) || activeVenue.website,
            bookingContact: getRawField(rawFields, ['booking/contact info']) || contactBits.join(' | ') || activeVenue.bookingContact,
            eventDate: getRawField(rawFields, ['upcoming event date']) || activeVenue.eventDate,
            eventTime: getRawField(rawFields, ['upcoming event time']) || activeVenue.eventTime,
            privateEvent: normalizeBoolean(getRawField(rawFields, ['private event'])) || Boolean(activeVenue.privateEvent),
            notes: getRawField(rawFields, ['Notes', 'notes']) || activeVenue.notes,
            played: normalizePlayed(getRawField(rawFields, ['Played', 'played'])) || Boolean(activeVenue.played)
        };
    }

    function applyLocalVenueUpdate(id, fields) {
        const parkRepo = window.BARK.repos && window.BARK.repos.ParkRepo;
        if (!parkRepo || typeof parkRepo.getAll !== 'function' || typeof parkRepo.replaceAll !== 'function') return;

        const points = parkRepo.getAll();
        const nextPoints = points.map(point => {
            if (!point || point.id !== id) return point;
            const venueType = fields.venueType || point.venueType || point.category || 'Other Venue';
            return {
                ...point,
                name: fields.name || point.name,
                address: fields.address,
                city: fields.city,
                state: fields.state || 'OH',
                zip: fields.zip,
                lat: fields.lat,
                lng: fields.lng,
                venueType,
                category: venueType,
                swagType: venueType,
                parkCategory: venueType,
                website: fields.website,
                pics: fields.website,
                notes: fields.notes,
                bookingContact: fields.bookingContact,
                eventDate: fields.eventDate,
                eventTime: fields.eventTime,
                privateEvent: Boolean(fields.privateEvent),
                info: [fields.notes, fields.bookingContact ? `Booking/contact: ${fields.bookingContact}` : ''].filter(Boolean).join('\n')
            };
        });

        parkRepo.replaceAll(nextPoints, { debug: true });
        if (typeof window.syncState === 'function') window.syncState();
    }

    async function loadSourceRow() {
        const service = getSpreadsheetService();
        if (!service || !service.isConfigured()) {
            renderRawFields({});
            setStatus('Spreadsheet save is not connected yet. Deploy the Apps Script bridge and paste its URL into config/firebaseConfig.example.js.', 'warning');
            return;
        }

        setStatus('Loading source spreadsheet row...', 'neutral');
        const slowTimer = setTimeout(() => {
            setStatus('Still checking Google Sheets. New rows and cold Apps Script starts can take a little while.', 'neutral');
        }, 1800);
        const longTimer = setTimeout(() => {
            setStatus('Still loading the spreadsheet row. You can wait here; the map will keep using the current data until Sheets responds.', 'neutral');
        }, 6000);
        try {
            const result = await service.getVenue(activeVenue.id);
            if (result && result.rawFields) renderRawFields(result.rawFields);
            setStatus('Source spreadsheet row loaded.', 'success');
        } catch (error) {
            console.error('[venueEditModal] failed to load source row:', error);
            renderRawFields({});
            setStatus(error.message || 'Could not load source spreadsheet row.', 'error');
        } finally {
            clearTimeout(slowTimer);
            clearTimeout(longTimer);
        }
    }

    async function saveVenueEdit() {
        const service = getSpreadsheetService();
        if (!activeVenue) return;
        if (!service || !service.isConfigured()) {
            setStatus('Spreadsheet bridge is not configured yet. Deploy the Apps Script bridge first.', 'warning');
            return;
        }

        const rawFields = collectRawFields();
        const fields = buildVenueFromRawFields(rawFields);
        if (!clean(fields.name) || !clean(fields.lat) || !clean(fields.lng)) {
            setStatus('Venue name, latitude, and longitude are required. Fill them in the spreadsheet fields before saving.', 'error');
            return;
        }

        setBusy(true);
        setStatus('Saving to spreadsheet...', 'neutral');

        try {
            const result = await service.saveVenue({
                id: activeVenue.id,
                venue: fields,
                rawFields
            });

            if (window.JDDM_VENUE_CSV_URL && result && result.csv && typeof window.BARK.parseCSVString === 'function') {
                window.BARK.parseCSVString(result.csv, { cacheTime: Date.now() });
            } else {
                applyLocalVenueUpdate(activeVenue.id, fields);
            }

            if (window.JDDM_VENUE_CSV_URL && typeof window.BARK.loadData === 'function') {
                setTimeout(() => window.BARK.loadData({ userInitiated: true, autofillLimit: 25 }), 800);
            }

            const syncMessage = window.JDDM_VENUE_CSV_URL
                ? 'Saved to spreadsheet. The map is refreshing from the latest sheet data.'
                : 'Saved to spreadsheet. This pin is updated locally; full sheet sync can be enabled after the live sheet has coordinates.';
            setStatus(syncMessage, 'success');
        } catch (error) {
            console.error('[venueEditModal] save failed:', error);
            setStatus(error.message || 'Save failed. Check the Apps Script deployment and try again.', 'error');
        } finally {
            setBusy(false);
        }
    }

    function bindModalEvents() {
        if (bindModalEvents.bound) return;
        bindModalEvents.bound = true;

        const modal = qs('venue-edit-modal');
        if (!modal) return;

        modal.addEventListener('click', event => {
            if (event.target && event.target.dataset && event.target.dataset.closeVenueEdit === 'true') {
                closeModal();
            }
        });

        const saveBtn = qs('venue-edit-save');
        if (saveBtn) saveBtn.addEventListener('click', saveVenueEdit);

        const refreshBtn = qs('venue-edit-refresh');
        if (refreshBtn) refreshBtn.addEventListener('click', loadSourceRow);

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && modal && !modal.hidden) closeModal();
        });
    }

    async function openVenueEditor(venue) {
        if (!venue || !venue.id) {
            alert('This venue cannot be edited because it has no spreadsheet id.');
            return;
        }

        activeVenue = { ...venue };
        renderRawFields({});
        bindModalEvents();
        setStatus('', 'neutral');
        openModal();
        await loadSourceRow();
    }

    window.BARK.openVenueEditor = openVenueEditor;
    window.BARK.closeVenueEditor = closeModal;
})();
