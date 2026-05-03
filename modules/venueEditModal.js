/**
 * venueEditModal.js - Marker-card spreadsheet editing UI.
 */
(function () {
    window.BARK = window.BARK || {};

    const BASE_FIELDS = [
        { key: 'name', label: 'Venue name', required: true },
        { key: 'address', label: 'Address' },
        { key: 'city', label: 'City' },
        { key: 'state', label: 'State' },
        { key: 'zip', label: 'ZIP' },
        { key: 'lat', label: 'Latitude', type: 'number', step: 'any', required: true },
        { key: 'lng', label: 'Longitude', type: 'number', step: 'any', required: true },
        { key: 'venueType', label: 'Venue type', type: 'select' },
        { key: 'website', label: 'Website/social link' },
        { key: 'bookingContact', label: 'Booking/contact info', type: 'textarea' },
        { key: 'eventDate', label: 'Upcoming event date' },
        { key: 'eventTime', label: 'Upcoming event time' },
        { key: 'privateEvent', label: 'Private event', type: 'checkbox' },
        { key: 'notes', label: 'Notes', type: 'textarea' }
    ];

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

    function getVenueCategories() {
        return window.BARK.VENUE_CATEGORIES || [
            'Brewery',
            'Winery',
            'Restaurant',
            'Festival',
            'Coffee Shop',
            'Pub/Bar',
            'Art Gallery',
            'Farm/Farmers Market',
            'Private Event',
            'Other Venue'
        ];
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

    function getInputId(fieldKey) {
        return `venue-edit-${fieldKey}`;
    }

    function renderBaseFields() {
        const container = qs('venue-edit-fields');
        if (!container) return;

        container.innerHTML = BASE_FIELDS.map(field => {
            const id = getInputId(field.key);
            const label = `<label for="${id}">${escapeHtml(field.label)}</label>`;

            if (field.type === 'textarea') {
                return `<div class="venue-edit-field venue-edit-field--wide">${label}<textarea id="${id}" rows="3"></textarea></div>`;
            }

            if (field.type === 'select') {
                const options = getVenueCategories()
                    .map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
                    .join('');
                return `<div class="venue-edit-field">${label}<select id="${id}">${options}</select></div>`;
            }

            if (field.type === 'checkbox') {
                return `
                    <div class="venue-edit-field venue-edit-checkbox">
                        <input id="${id}" type="checkbox">
                        <label for="${id}">${escapeHtml(field.label)}</label>
                    </div>
                `;
            }

            const type = field.type || 'text';
            const step = field.step ? ` step="${escapeHtml(field.step)}"` : '';
            const required = field.required ? ' required' : '';
            return `<div class="venue-edit-field">${label}<input id="${id}" type="${type}"${step}${required}></div>`;
        }).join('');
    }

    function fillBaseFields(venue) {
        BASE_FIELDS.forEach(field => {
            const input = qs(getInputId(field.key));
            if (!input) return;

            if (field.key === 'venueType') {
                input.value = venue.venueType || venue.category || venue.swagType || 'Other Venue';
                return;
            }

            if (field.key === 'privateEvent') {
                input.checked = Boolean(venue.privateEvent);
                return;
            }

            input.value = venue[field.key] === undefined || venue[field.key] === null ? '' : venue[field.key];
        });
    }

    function collectBaseFields() {
        return BASE_FIELDS.reduce((fields, field) => {
            const input = qs(getInputId(field.key));
            if (!input) return fields;
            fields[field.key] = field.type === 'checkbox' ? input.checked : input.value;
            return fields;
        }, {});
    }

    function mergeSourceVenue(sourceVenue) {
        if (!sourceVenue || typeof sourceVenue !== 'object') return { ...activeVenue };
        const merged = { ...activeVenue, ...sourceVenue };

        // The live sheet may be missing coordinates while the checked-in map CSV has them.
        // Preserve the clicked pin coordinates so Save can backfill Latitude/Longitude.
        if (!clean(sourceVenue.lat)) merged.lat = activeVenue.lat;
        if (!clean(sourceVenue.lng)) merged.lng = activeVenue.lng;

        return merged;
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
        try {
            const result = await service.getVenue(activeVenue.id);
            if (result && result.rawFields) renderRawFields(result.rawFields);
            if (result && result.venue) {
                fillBaseFields(mergeSourceVenue(result.venue));
            }
            setStatus('Source spreadsheet row loaded.', 'success');
        } catch (error) {
            console.error('[venueEditModal] failed to load source row:', error);
            renderRawFields({});
            setStatus(error.message || 'Could not load source spreadsheet row.', 'error');
        }
    }

    async function saveVenueEdit() {
        const service = getSpreadsheetService();
        if (!activeVenue) return;
        if (!service || !service.isConfigured()) {
            setStatus('Spreadsheet bridge is not configured yet. Deploy the Apps Script bridge first.', 'warning');
            return;
        }

        const fields = collectBaseFields();
        if (!clean(fields.name) || !clean(fields.lat) || !clean(fields.lng)) {
            setStatus('Venue name, latitude, and longitude are required.', 'error');
            return;
        }

        setBusy(true);
        setStatus('Saving to spreadsheet...', 'neutral');

        try {
            const result = await service.saveVenue({
                id: activeVenue.id,
                venue: fields,
                rawFields: collectRawFields()
            });

            if (window.JDDM_VENUE_CSV_URL && result && result.csv && typeof window.BARK.parseCSVString === 'function') {
                window.BARK.parseCSVString(result.csv, { cacheTime: Date.now() });
            } else {
                applyLocalVenueUpdate(activeVenue.id, fields);
            }

            if (window.JDDM_VENUE_CSV_URL && typeof window.BARK.loadData === 'function') {
                setTimeout(() => window.BARK.loadData(), 800);
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
        renderBaseFields();
        fillBaseFields(activeVenue);
        renderRawFields({});
        bindModalEvents();
        setStatus('', 'neutral');
        openModal();
        await loadSourceRow();
    }

    window.BARK.openVenueEditor = openVenueEditor;
    window.BARK.closeVenueEditor = closeModal;
})();
