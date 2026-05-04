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
        'contactStatus',
        'draftStatus',
        'lastContactedDate',
        'nextFollowUpDate',
        'doNotContact',
        'Yearly Booking',
        'Notes',
        'Longitude',
        'Latitude',
        'Site ID'
    ];

    const GENERATED_BOOKING_FIELD_ORDER = [
        'contactStatus',
        'draftStatus',
        'lastContactedDate',
        'nextFollowUpDate',
        'doNotContact'
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

    function getSchemaOptions(type) {
        const schema = window.BARK.bookingSchema;
        if (!schema) return [];
        if (type === 'contactStatus') return schema.CONTACT_STATUS_VALUES || Object.values(schema.CONTACT_STATUS || {});
        if (type === 'draftStatus') return schema.DRAFT_STATUS_VALUES || Object.values(schema.DRAFT_STATUS || {});
        return [];
    }

    function getNormalizedHeader(header) {
        return clean(header).toLowerCase().replace(/[^a-z0-9]+/g, '');
    }

    function findHeaderByNormalized(fields, normalizedHeader) {
        return Object.keys(fields).find(header => getNormalizedHeader(header) === normalizedHeader);
    }

    function getRenderableHeaders(rawFields) {
        const fields = rawFields && typeof rawFields === 'object' ? rawFields : {};
        const seen = new Set();
        const known = [];

        SOURCE_FIELD_ORDER.forEach(header => {
            const normalized = getNormalizedHeader(header);
            if (seen.has(normalized)) return;
            const fieldHeader = Object.prototype.hasOwnProperty.call(fields, header)
                ? header
                : findHeaderByNormalized(fields, normalized);
            if (!fieldHeader) return;
            known.push(fieldHeader);
            seen.add(normalized);
        });

        GENERATED_BOOKING_FIELD_ORDER.forEach(header => {
            const normalized = getNormalizedHeader(header);
            if (seen.has(normalized)) return;
            const fieldHeader = findHeaderByNormalized(fields, normalized) || header;
            known.push(fieldHeader);
            seen.add(normalized);
        });

        const extras = Object.keys(fields)
            .filter(header => !seen.has(getNormalizedHeader(header)))
            .sort((a, b) => a.localeCompare(b));

        return [...known, ...extras];
    }

    function toDateInputValue(value) {
        const text = clean(value);
        if (!text) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

        const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        if (slash) {
            const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
            const month = slash[1].padStart(2, '0');
            const day = slash[2].padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        return '';
    }

    function getFieldType(header) {
        const normalized = getNormalizedHeader(header);
        if (normalized === 'contactstatus' || normalized === 'status') return 'contactStatus';
        if (normalized === 'draftstatus') return 'draftStatus';
        if (normalized === 'donotcontact' || normalized === 'dnc') return 'checkbox';
        if (normalized === 'lastcontacteddate' || normalized === 'nextfollowupdate') return 'date';
        if (normalized === 'notes' || normalized === 'privatenotes') return 'textarea';
        return 'text';
    }

    function renderSelectField(id, header, value, options) {
        const current = clean(value);
        const normalizedCurrent = current.toLowerCase();
        const mergedOptions = options.slice();
        if (current && !mergedOptions.some(option => clean(option).toLowerCase() === normalizedCurrent)) {
            mergedOptions.unshift(current);
        }

        return `
            <select id="${id}" data-source-header="${escapeHtml(header)}">
                <option value="">Not set</option>
                ${mergedOptions.map(option => {
                    const selected = clean(option).toLowerCase() === normalizedCurrent ? ' selected' : '';
                    return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`;
                }).join('')}
            </select>
        `;
    }

    function renderInputForHeader(id, header, value) {
        const fieldType = getFieldType(header);

        if (fieldType === 'contactStatus' || fieldType === 'draftStatus') {
            return renderSelectField(id, header, value, getSchemaOptions(fieldType));
        }

        if (fieldType === 'checkbox') {
            const checked = normalizeBoolean(value) ? ' checked' : '';
            return `<label class="venue-edit-checkbox-control"><input id="${id}" data-source-header="${escapeHtml(header)}" type="checkbox"${checked}> <span>Do not contact this venue</span></label>`;
        }

        if (fieldType === 'date') {
            const dateValue = toDateInputValue(value);
            if (dateValue || !clean(value)) {
                return `<input id="${id}" data-source-header="${escapeHtml(header)}" type="date" value="${escapeHtml(dateValue)}">`;
            }
        }

        if (fieldType === 'textarea' || clean(value).length > 80) {
            return `<textarea id="${id}" data-source-header="${escapeHtml(header)}" rows="3">${escapeHtml(value)}</textarea>`;
        }

        return `<input id="${id}" data-source-header="${escapeHtml(header)}" type="text" value="${escapeHtml(value)}">`;
    }

    function renderRawFields(rawFields) {
        const container = qs('venue-edit-source-fields');
        if (!container) return;

        activeRawFields = rawFields && typeof rawFields === 'object' ? rawFields : {};
        const headers = getRenderableHeaders(activeRawFields);

        if (headers.length === 0) {
            container.innerHTML = '<p class="venue-edit-help">Source spreadsheet row will appear here once the bridge is connected.</p>';
            return;
        }

        container.innerHTML = headers.map(header => {
            const id = `venue-edit-source-${header.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
            const value = activeRawFields[header] === undefined || activeRawFields[header] === null ? '' : activeRawFields[header];
            const fieldType = getFieldType(header);
            const tall = fieldType === 'textarea' || clean(value).length > 80;
            const checkbox = fieldType === 'checkbox';
            const input = renderInputForHeader(id, header, value);
            return `<div class="venue-edit-field${tall ? ' venue-edit-field--wide' : ''}${checkbox ? ' venue-edit-checkbox' : ''}"><label for="${id}">${escapeHtml(header)}</label>${input}</div>`;
        }).join('');
    }

    function collectRawFields() {
        const modal = qs('venue-edit-modal');
        if (!modal) return {};
        return Array.from(modal.querySelectorAll('[data-source-header]')).reduce((fields, input) => {
            fields[input.dataset.sourceHeader] = input.type === 'checkbox'
                ? (input.checked ? 'Yes' : '')
                : input.value;
            return fields;
        }, {});
    }

    function getRawFieldValue(rawFields, headers) {
        for (const header of headers) {
            if (Object.prototype.hasOwnProperty.call(rawFields, header)) {
                return { found: true, value: rawFields[header] };
            }

            const normalized = header.toLowerCase();
            const match = Object.keys(rawFields).find(key => key.toLowerCase() === normalized);
            if (match) return { found: true, value: rawFields[match] };
        }
        return { found: false, value: '' };
    }

    function getRawField(rawFields, headers) {
        const match = getRawFieldValue(rawFields, headers);
        return match.found && clean(match.value) ? clean(match.value) : '';
    }

    function getOptionalRawField(rawFields, headers, fallback = '') {
        const match = getRawFieldValue(rawFields, headers);
        return match.found ? clean(match.value) : clean(fallback);
    }

    function getOptionalRawBoolean(rawFields, headers, fallback = false) {
        const match = getRawFieldValue(rawFields, headers);
        return match.found ? normalizeBoolean(match.value) : Boolean(fallback);
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
        return ['true', 'yes', 'y', '1', 'private', 'do not contact', 'dnc'].includes(raw);
    }

    function normalizePlayed(value) {
        const raw = clean(value).toLowerCase();
        return ['true', 'yes', 'y', '1', 'played', 'visited'].includes(raw);
    }

    function buildVenueFromRawFields(rawFields, venue = activeVenue || {}) {
        const parsedPlace = parsePlace(getRawField(rawFields, ['Place']));
        const name = getRawField(rawFields, ['venue name', 'name', 'Location']) || parsedPlace.name || venue.name;
        const contactBits = [
            getRawField(rawFields, ['Contact Name']),
            getRawField(rawFields, ['Email/Contact']),
            getRawField(rawFields, ['Phone Number']),
            getRawField(rawFields, ['Contact Type'])
        ].filter(Boolean);

        return {
            id: getRawField(rawFields, ['Site ID', 'id']) || venue.id,
            name,
            address: getRawField(rawFields, ['address']) || parsedPlace.address || venue.address,
            city: getRawField(rawFields, ['city']) || parsedPlace.city || venue.city,
            state: getRawField(rawFields, ['state']) || parsedPlace.state || venue.state || 'OH',
            zip: getRawField(rawFields, ['zip', 'zipcode', 'zip code']) || parsedPlace.zip || venue.zip,
            lat: getRawField(rawFields, ['Latitude', 'lat']) || venue.lat,
            lng: getRawField(rawFields, ['Longitude', 'lng', 'long']) || venue.lng,
            venueType: getRawField(rawFields, ['venue type', 'type']) || venue.venueType || venue.category || 'Other Venue',
            website: getRawField(rawFields, ['Website', 'website/social link']) || venue.website,
            bookingContact: getRawField(rawFields, ['booking/contact info']) || contactBits.join(' | ') || venue.bookingContact,
            eventDate: getRawField(rawFields, ['upcoming event date']) || venue.eventDate,
            eventTime: getRawField(rawFields, ['upcoming event time']) || venue.eventTime,
            privateEvent: getOptionalRawBoolean(rawFields, ['private event'], venue.privateEvent),
            notes: getRawField(rawFields, ['Notes', 'notes']) || venue.notes,
            played: getOptionalRawBoolean(rawFields, ['Played', 'played'], venue.played),
            contactStatus: getOptionalRawField(rawFields, ['contactStatus', 'contact status', 'Status'], venue.contactStatus),
            draftStatus: getOptionalRawField(rawFields, ['draftStatus', 'draft status'], venue.draftStatus),
            lastContactedDate: getOptionalRawField(rawFields, ['lastContactedDate', 'last contacted date', 'Contacted'], venue.lastContactedDate),
            nextFollowUpDate: getOptionalRawField(rawFields, ['nextFollowUpDate', 'next follow up date', 'next follow-up date'], venue.nextFollowUpDate),
            doNotContact: getOptionalRawBoolean(rawFields, ['doNotContact', 'Do Not Contact', 'DNC'], venue.doNotContact)
        };
    }

    function applyLocalVenueUpdate(id, fields) {
        const parkRepo = window.BARK.repos && window.BARK.repos.ParkRepo;
        if (!parkRepo || typeof parkRepo.getAll !== 'function' || typeof parkRepo.replaceAll !== 'function') return;

        const points = parkRepo.getAll();
        const nextPoints = points.map(point => {
            if (!point || point.id !== id) return point;
            const venueType = fields.venueType || point.venueType || point.category || 'Other Venue';
            const nextPoint = {
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
                contactStatus: fields.contactStatus,
                draftStatus: fields.draftStatus,
                lastContactedDate: fields.lastContactedDate,
                nextFollowUpDate: fields.nextFollowUpDate,
                doNotContact: Boolean(fields.doNotContact),
                info: [fields.notes, fields.bookingContact ? `Booking/contact: ${fields.bookingContact}` : ''].filter(Boolean).join('\n')
            };
            nextPoint.booking = window.BARK.bookingSchema && typeof window.BARK.bookingSchema.normalizeVenue === 'function'
                ? window.BARK.bookingSchema.normalizeVenue(nextPoint)
                : { ...(point.booking || {}) };
            return nextPoint;
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
                window.BARK.parseCSVString(result.csv, { cacheTime: Date.now(), source: 'Spreadsheet Save' });
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
    window.BARK.venueEditModal = {
        buildVenueFromRawFields,
        getRenderableHeaders,
        toDateInputValue
    };
})();
