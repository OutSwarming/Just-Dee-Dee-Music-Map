/**
 * venueEditModal.js - Marker-card spreadsheet editing UI.
 */
(function () {
    window.BARK = window.BARK || {};

    const CRM_EDIT_FIELD_ORDER = [
        'Status',
        'Last Contacted',
        'Contact Name',
        'Email/Contact',
        'Phone Number',
        'Contact Type',
        'Next Follow Up',
        'Notes'
    ];
    const CREATE_FIELD_ORDER = [
        'Place Name',
        'Address',
        'City',
        'State',
        'Zip',
        'Venue Type',
        'Website',
        'Status',
        'Contact Name',
        'Email/Contact',
        'Phone Number',
        'Contact Type',
        'Next Follow Up',
        'Latitude',
        'Longitude',
        'Notes'
    ];

    let activeVenue = null;
    let activeRawFields = {};
    let isCreatingVenue = false;
    let sourceReady = false;
    let savedSnapshot = '';
    let savePromise = null;
    let closePromise = null;
    let editorSession = 0;
    let createRequestId = '';
    let draftConflict = false;

    function formSnapshot() {
        try { return JSON.stringify(collectRawFields()); }
        catch (_) {
            const modal = qs('venue-edit-modal');
            return JSON.stringify(Array.from(modal.querySelectorAll('input,textarea,select')).map(i=>[i.id,i.value,i.checked]));
        }
    }
    function captureSavedState() { savedSnapshot = formSnapshot(); }


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
        const fields = qs('venue-edit-source-fields');
        if (fields) fields.inert = Boolean(isBusy);
    }

    function setEditorMode(isCreating) {
        const eyebrow = qs('venue-edit-modal') && qs('venue-edit-modal').querySelector('.venue-edit-eyebrow');
        const title = qs('venue-edit-title');
        const help = qs('venue-edit-modal') && qs('venue-edit-modal').querySelector('.venue-edit-help');
        const refreshBtn = qs('venue-edit-refresh');
        const saveBtn = qs('venue-edit-save');
        if (eyebrow) eyebrow.textContent = isCreating ? 'New Map Place' : 'Pin CRM Editor';
        if (title) title.textContent = isCreating ? 'Add a Place to the Map' : 'Update Venue Status';
        if (help) help.textContent = isCreating
            ? 'Add the place details once. The spreadsheet bridge will create the row, generate its map ID, and geocode the address.'
            : 'Edit the venue status, follow-up, contact details, and notes, then save back to the Just Dee Dee Music spreadsheet.';
        if (refreshBtn) refreshBtn.hidden = Boolean(isCreating);
        if (saveBtn) saveBtn.textContent = isCreating ? 'Add Place to Map' : 'Save to Spreadsheet';
    }

    function openModal() {
        const modal = qs('venue-edit-modal');
        if (!modal) return;
        modal.hidden = false;
        document.body.classList.add('venue-edit-open');
        const firstInput = modal.querySelector('input, textarea, select, button');
        if (firstInput) firstInput.focus({ preventScroll: true });
    }

    function hideModal() {
        const modal = qs('venue-edit-modal');
        if (!modal) return;
        modal.hidden = true;
        document.body.classList.remove('venue-edit-open');
        editorSession++;
        sourceReady = false;
        activeVenue = null;
        activeRawFields = {};
        isCreatingVenue = false;
        setEditorMode(false);
    }

    let confirmationPending = null;
    function confirmAction(title, message, choices) {
        if (confirmationPending) return confirmationPending;
        confirmationPending = new Promise(resolve => {
            const dialog = document.createElement('dialog');
            dialog.className = 'venue-confirm-dialog';
            dialog.setAttribute('aria-label',title);
            dialog.innerHTML = `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><div>${choices.map(([value,label])=>`<button type="button" data-choice="${value}">${escapeHtml(label)}</button>`).join('')}</div>`;
            const finish = choice => { dialog.close(); dialog.remove(); resolve(choice); };
            dialog.addEventListener('click', event => { const button=event.target.closest('[data-choice]'); if (button) finish(button.dataset.choice); });
            dialog.addEventListener('cancel', event => { event.preventDefault(); finish('keep'); });
            document.body.appendChild(dialog); dialog.showModal();
        }).finally(()=>{confirmationPending=null;});
        return confirmationPending;
    }
    function closeModal() {
        if (closePromise) return closePromise;
        closePromise = (async () => {
            const modal = qs('venue-edit-modal');
            if (!modal || modal.hidden) return true;
            let failed = false;
            if (savePromise) failed = !(await savePromise);
            while (sourceReady && (failed || formSnapshot() !== savedSnapshot)) {
                const choice = await confirmAction(failed ? 'Changes are not saved' : 'Save changes before closing?',
                    failed ? 'Saving did not finish. Your changes are still here. Retry, keep editing, or discard them.' : 'You have unsaved changes. Save them before closing, keep editing, or discard them.',
                    [['save',failed ? 'Retry save' : 'Save and close'],['keep','Keep editing'],['discard','Discard changes']]);
                if (choice === 'keep') return false;
                if (choice === 'discard') break;
                if (await saveVenueEdit()) break;
                failed = true;
            }
            hideModal();
            return true;
        })().finally(() => { closePromise = null; });
        return closePromise;
    }

    function getSchemaOptions(type) {
        const schema = window.BARK.bookingSchema;
        if (!schema) return [];
        if (type === 'contactStatus' || type === 'status') return schema.CONTACT_STATUS_VALUES || Object.values(schema.CONTACT_STATUS || {});
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

        CRM_EDIT_FIELD_ORDER.forEach(header => {
            const normalized = getNormalizedHeader(header);
            if (seen.has(normalized)) return;
            const fieldHeader = Object.prototype.hasOwnProperty.call(fields, header)
                ? header
                : findHeaderByNormalized(fields, normalized);
            if (!fieldHeader) return;
            known.push(fieldHeader);
            seen.add(normalized);
        });

        return known;
    }

    function buildInitialRawFields(venue = {}) {
        const booking = venue.booking || {};
        return {
            'Booking Contact': venue.contactRecord || '',
            ...(venue.contactDetails ? { 'Contact Details': venue.contactDetails } : {}),
            Status: clean(booking.contactStatus || venue.contactStatus || venue.status),
            'Last Contacted': clean(booking.lastContactedDate || venue.lastContactedDate),
            'Contact Name': clean(booking.contactName || venue.contactName),
            'Email/Contact': clean(booking.contactEmail || venue.contactEmail || venue.email),
            'Phone Number': clean(booking.contactPhone || venue.contactPhone || venue.phone),
            'Contact Type': clean(booking.contactType || venue.contactType),
            'Next Follow Up': clean(booking.nextFollowUpDate || venue.nextFollowUpDate),
            Notes: clean(venue.notes || venue.info)
        };
    }

    function getMapCenterFields() {
        const map = window.map || (window.BARK && window.BARK.map);
        if (!map || typeof map.getCenter !== 'function') return { Latitude: '', Longitude: '' };
        const center = map.getCenter();
        return {
            Latitude: center && Number.isFinite(Number(center.lat)) ? Number(center.lat).toFixed(6) : '',
            Longitude: center && Number.isFinite(Number(center.lng)) ? Number(center.lng).toFixed(6) : ''
        };
    }

    function buildNewVenueRawFields() {
        return {
            'Place Name': '',
            Address: '',
            City: '',
            State: 'OH',
            Zip: '',
            'Venue Type': 'Other Venue',
            Website: '',
            Status: 'Needs Review',
            'Contact Name': '',
            'Email/Contact': '',
            'Phone Number': '',
            'Contact Type': '',
            'Next Follow Up': '',
            ...getMapCenterFields(),
            Notes: ''
        };
    }

    function toDateInputValue(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    let candidate = text;
    const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slash) candidate = `${slash[3].length === 2 ? '20' : ''}${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
        // Parse only timestamps with an explicit timezone, avoiding server-local dates.
        if (!/(?:GMT|[zZ]$|[+-]\d{2}:?\d{2}$)/.test(text)) return '';
        const date = new Date(text);
        if (!Number.isFinite(date.getTime())) return '';
        candidate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    }
    const date = new Date(candidate + 'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === candidate ? candidate : '';
}

    function getFieldType(header) {
        const normalized = getNormalizedHeader(header);
        if (normalized === 'contactstatus' || normalized === 'status') return 'contactStatus';
        if (normalized === 'draftstatus') return 'draftStatus';
        if (normalized === 'donotcontact' || normalized === 'dnc') return 'checkbox';
        if (normalized === 'lastcontacted' || normalized === 'lastcontacteddate' || normalized === 'nextfollowup' || normalized === 'nextfollowupdate' || normalized === 'lastplayed' || normalized === 'nextbooked') return 'date';
        if (normalized === 'notes' || normalized === 'privatenotes' || normalized === 'pastgigs' || normalized === 'futuregigs') return 'textarea';
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
            return `<input id="${id}" data-source-header="${escapeHtml(header)}" type="date" value="${escapeHtml(dateValue)}" aria-label="${escapeHtml(header)} (Eastern)">`;
        }

        if (fieldType === 'textarea' || clean(value).length > 80) {
            return `<textarea id="${id}" data-source-header="${escapeHtml(header)}" rows="3">${escapeHtml(value)}</textarea>`;
        }

        return `<input id="${id}" data-source-header="${escapeHtml(header)}" type="text" value="${escapeHtml(value)}">`;
    }

    const contactCodec = window.JDDMContacts;
    function readContacts(fields) { return contactCodec.tidy(contactCodec.read(fields)); }
    function contactRow(key, item, index, personIndex) {
        if (key === 'phones') item = {...item,value:contactCodec.formatPhone(item.value)};
        const kind = key === 'emails' ? 'Email' : key === 'phones' ? 'Phone' : 'Other contact';
        const id = `venue-contact-${personIndex}-${key}-${index}`;
        return `<div class="venue-contact-row" data-contact-row data-method-index="${index}">
            ${key === 'others' ? `<input class="venue-contact-kind" data-contact-kind aria-label="Contact type" placeholder="Type (Facebook, website…)" value="${escapeHtml(item.type || '')}">` : `<span class="venue-contact-number">${index+1}</span>`}
            <input id="${id}" type="${key === 'emails' ? 'email' : key === 'phones' ? 'tel' : 'text'}" data-contact-value data-original-value="${escapeHtml(item.value)}" value="${escapeHtml(item.value)}" aria-label="${kind} ${index+1}" placeholder="${key === 'emails' || key === 'phones' ? 'Not known yet — optional' : 'Not known yet — link, username, or instructions'}">

            ${index === 0 ? `<button type="button" class="venue-contact-add" data-contact-add="${key}">Add</button>` : '<button type="button" class="venue-contact-remove" data-contact-remove aria-label="Remove this method">×</button>'}
        </div>`;
    }
    function personCard(person, index) {
        return `<section class="venue-person-card" data-person-index="${index}">
            <div class="venue-person-heading"><strong>Contact ${index+1}</strong><button type="button" data-person-remove class="venue-contact-remove">Remove contact</button></div>
            <label>Name / person or venue (optional)<input data-person-name type="text" aria-label="Contact name" placeholder="Name not known yet — add when known" value="${escapeHtml(person.name)}"></label>
            <label>Preferred method / contact type<input data-person-preferred type="text" aria-label="Preferred contact method" placeholder="Email, text, call, stop in, or anything else" value="${escapeHtml(person.preferredMethod)}"></label>
            <details class="venue-person-notes"><summary class="venue-contact-bubble">${person.notes ? 'Contact notes •' : 'Contact notes'}</summary><textarea data-person-notes aria-label="Contact notes" rows="3">${escapeHtml(person.notes)}</textarea></details>
            ${['emails','phones','others'].map(key=>`<div class="venue-contact-group" data-contact-group="${key}"><label>${key === 'emails' ? 'Email addresses' : key === 'phones' ? 'Phone numbers' : 'Other ways to contact'}</label><div data-contact-rows>${(person[key].length ? person[key] : [{value:'',note:''}]).map((item,i)=>contactRow(key,item,i,index)).join('')}</div></div>`).join('')}
        </section>`;
    }
    function renderPeople(data) {
        return `<div class="venue-edit-field--wide venue-people"><p class="venue-edit-help">Fill in what you know. Names, emails, and phone numbers can be left blank. Notes stay with each contact.</p><div data-people>${(data.contacts.length ? data.contacts : [contactCodec.empty()]).map(personCard).join('')}</div><button type="button" class="venue-contact-add" data-person-add>Add contact</button>${data.legacyBookingContact ? `<label>Previous booking notes<textarea data-legacy-booking rows="3">${escapeHtml(data.legacyBookingContact)}</textarea></label>` : ''}</div>`;
    }
    function collectContacts(modal) {
        const contacts = Array.from(modal.querySelectorAll('[data-person-index]')).map(card=>{
            const person={name:clean(card.querySelector('[data-person-name]').value),preferredMethod:clean(card.querySelector('[data-person-preferred]').value),notes:clean(card.querySelector('[data-person-notes]').value)};
            card.querySelectorAll('[data-contact-group]').forEach(group=>{
                person[group.dataset.contactGroup]=Array.from(group.querySelectorAll('[data-contact-row]')).map(row=>({value:group.dataset.contactGroup === 'phones' ? contactCodec.formatPhone(row.querySelector('[data-contact-value]').value) : clean(row.querySelector('[data-contact-value]').value),note:'',...(group.dataset.contactGroup === 'others' ? {type:clean(row.querySelector('[data-contact-kind]').value)} : {})})).filter(i=>i.value || i.note || i.type);
            });
            return person;
        });
        return {version:2,contacts,legacyBookingContact:modal.querySelector('[data-legacy-booking]')?.value || ''};
    }

    function renderRawFields(rawFields) {
        const container = qs('venue-edit-source-fields');
        if (!container) return;

        activeRawFields = rawFields && typeof rawFields === 'object' ? rawFields : {};
        const headers = isCreatingVenue
            ? CREATE_FIELD_ORDER.filter(header => Object.prototype.hasOwnProperty.call(activeRawFields, header))
            : getRenderableHeaders(activeRawFields);

        if (headers.length === 0) {
            container.innerHTML = '<p class="venue-edit-help">CRM fields will appear here once the bridge loads this venue.</p>';
            return;
        }

        const contacts = readContacts(activeRawFields);
        container.innerHTML = headers.map(header => {
            if (header === 'Contact Name') return renderPeople(contacts);
            if (['Email/Contact','Phone Number','Contact Type'].includes(header)) return '';
            const id = `venue-edit-source-${header.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
            const value = getOptionalRawField(activeRawFields, [header], '');
            const fieldType = getFieldType(header);
            const tall = fieldType === 'textarea' || clean(value).length > 80;
            const checkbox = fieldType === 'checkbox';
            const input = renderInputForHeader(id, header, value);
            return `<div class="venue-edit-field${tall ? ' venue-edit-field--wide' : ''}${checkbox ? ' venue-edit-checkbox' : ''}"><label for="${id}">${escapeHtml(header === 'Notes' ? 'Venue notes' : header)}${fieldType === 'date' ? ' (Eastern)' : ''}</label>${input}</div>`;
        }).join('');
    }

    function collectRawFields() {
        const modal = qs('venue-edit-modal');
        if (!modal) return {};
        const fields = Array.from(modal.querySelectorAll('[data-source-header]')).reduce((fields, input) => {
            fields[input.dataset.sourceHeader] = input.type === 'checkbox'
                ? (input.checked ? 'Yes' : '')
                : input.value;
            return fields;
        }, {});
        const details = collectContacts(modal);
        fields['Booking Contact'] = contactCodec.encode(details);
        Object.assign(fields, contactCodec.summary(contactCodec.normalize(details)));
        return fields;
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

    function isPlayedStatus(value) {
        const raw = clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        return raw === 'booked' || raw === 'played in the past' || raw === 'played in the past awaiting reply';
    }

    function isClosedStatus(value) {
        const raw = clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        return [
            'told no closed no music',
            'closed and not booking',
            'no live music',
            'venue said no to jddm',
            'not interested do not contact',
            'bad fit too far',
            'closed no longer operating',
            'duplicate merge needed'
        ].includes(raw);
    }

    function buildVenueFromRawFields(rawFields, venue = activeVenue || {}) {
        const parsedPlace = parsePlace(getRawField(rawFields, ['Place']));
        const statusMatch = getRawFieldValue(rawFields, ['Status', 'contactStatus', 'contact status']);
        const status = statusMatch.found ? clean(statusMatch.value) : clean(venue.contactStatus);
        const name = getRawField(rawFields, ['Place Name', 'venue name', 'name', 'Location']) || parsedPlace.name || venue.name;
        const contactBits = [
            getRawField(rawFields, ['Contact Name']),
            getRawField(rawFields, ['Email/Contact']),
            getRawField(rawFields, ['Phone Number']),
            getRawField(rawFields, ['Contact Type'])
        ].filter(Boolean);

        return {
            id: getRawField(rawFields, ['Place ID', 'Site ID', 'id']) || venue.id,
            name,
            address: getRawField(rawFields, ['Address', 'address']) || parsedPlace.address || venue.address,
            city: getRawField(rawFields, ['City', 'city']) || parsedPlace.city || venue.city,
            state: getRawField(rawFields, ['State', 'state']) || parsedPlace.state || venue.state || 'OH',
            zip: getRawField(rawFields, ['Zip', 'zip', 'zipcode', 'zip code']) || parsedPlace.zip || venue.zip,
            lat: getRawField(rawFields, ['Latitude', 'lat']) || venue.lat,
            lng: getRawField(rawFields, ['Longitude', 'lng', 'long']) || venue.lng,
            venueType: getRawField(rawFields, ['Venue Type', 'venue type', 'type']) || venue.venueType || venue.category || 'Other Venue',
            website: getRawField(rawFields, ['Website', 'website/social link']) || venue.website,
            contactRecord: getOptionalRawField(rawFields, ['Booking Contact'], venue.contactRecord),
            bookingContact: contactCodec.display(getRawField(rawFields, ['Booking Contact', 'booking/contact info'])) || contactBits.join(' | ') || '',
            contactName: getOptionalRawField(rawFields, ['Contact Name'], venue.contactName),
            contactEmail: getOptionalRawField(rawFields, ['Email/Contact'], venue.contactEmail),
            contactPhone: getOptionalRawField(rawFields, ['Phone Number'], venue.contactPhone),
            contactDetails: getOptionalRawField(rawFields, ['Contact Details'], venue.contactDetails),
            contactType: getOptionalRawField(rawFields, ['Contact Type'], venue.contactType),
            eventDate: getRawField(rawFields, ['Next Booked', 'upcoming event date']) || venue.eventDate,
            eventTime: getRawField(rawFields, ['upcoming event time']) || venue.eventTime,
            privateEvent: getOptionalRawBoolean(rawFields, ['private event'], venue.privateEvent),
            notes: getOptionalRawField(rawFields, ['Notes', 'notes'], venue.notes),
            played: isPlayedStatus(status) || getOptionalRawBoolean(rawFields, ['Played', 'played'], venue.played),
            contactStatus: status,
            draftStatus: getOptionalRawField(rawFields, ['draftStatus', 'draft status'], venue.draftStatus),
            lastContactedDate: getOptionalRawField(rawFields, ['Last Contacted', 'lastContactedDate', 'last contacted date', 'Contacted'], venue.lastContactedDate),
            nextFollowUpDate: getOptionalRawField(rawFields, ['Next Follow Up', 'nextFollowUpDate', 'next follow up date', 'next follow-up date'], venue.nextFollowUpDate),
            priority: getOptionalRawField(rawFields, ['Priority', 'priority', 'Rank'], venue.priority),
            bestFitScore: getOptionalRawField(rawFields, ['bestFitScore', 'Best Fit Score', 'best fit score'], venue.bestFitScore),
            websiteBookingEvents: getOptionalRawField(rawFields, ['websiteBookingEvents', 'website booking events'], venue.websiteBookingEvents),
            calendarGigEvents: getOptionalRawField(rawFields, ['calendarGigEvents', 'calendar gig events'], venue.calendarGigEvents),
            calendarPastGigEvents: getOptionalRawField(rawFields, ['Past Gigs', 'calendarPastGigEvents', 'calendar past gig events'], venue.calendarPastGigEvents),
            calendarFutureGigEvents: getOptionalRawField(rawFields, ['Future Gigs', 'calendarFutureGigEvents', 'calendar future gig events'], venue.calendarFutureGigEvents),
            calendarLastGigDate: getOptionalRawField(rawFields, ['Last Played', 'calendarLastGigDate', 'calendar last gig date'], venue.calendarLastGigDate),
            calendarNextGigDate: getOptionalRawField(rawFields, ['Next Booked', 'calendarNextGigDate', 'calendar next gig date'], venue.calendarNextGigDate),
            calendarPastGigCount: getOptionalRawField(rawFields, ['Past Gig Count', 'calendarPastGigCount', 'calendar past gig count'], venue.calendarPastGigCount),
            calendarFutureGigCount: getOptionalRawField(rawFields, ['Future Gig Count', 'calendarFutureGigCount', 'calendar future gig count'], venue.calendarFutureGigCount),
            calendarTotalGigsPlayed: getOptionalRawField(rawFields, ['Total Gig Count', 'calendarTotalGigsPlayed', 'calendar total gigs played'], venue.calendarTotalGigsPlayed),
            calendarLastSyncedAt: getOptionalRawField(rawFields, ['Last Synced', 'calendarLastSyncedAt', 'calendar last synced at'], venue.calendarLastSyncedAt),
            doNotContact: isClosedStatus(status) || getOptionalRawBoolean(rawFields, ['doNotContact', 'Do Not Contact', 'DNC'], statusMatch.found ? false : venue.doNotContact)
        };
    }

    function buildLocalVenuePoint(point = {}, fields = {}) {
        const venueType = fields.venueType || point.venueType || point.category || 'Other Venue';
        const nextPoint = {
            ...point,
            id: fields.id || point.id,
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
            contactRecord: fields.contactRecord,
            bookingContact: fields.bookingContact,
            contactName: fields.contactName,
            contactEmail: fields.contactEmail,
            contactPhone: fields.contactPhone,
            contactType: fields.contactType,
            contactDetails: fields.contactDetails,
            eventDate: fields.eventDate,
            eventTime: fields.eventTime,
            privateEvent: Boolean(fields.privateEvent),
            contactStatus: fields.contactStatus,
            draftStatus: fields.draftStatus,
            lastContactedDate: fields.lastContactedDate,
            nextFollowUpDate: fields.nextFollowUpDate,
            priority: fields.priority,
            bestFitScore: fields.bestFitScore,
            websiteBookingEvents: fields.websiteBookingEvents,
            calendarGigEvents: fields.calendarGigEvents,
            calendarPastGigEvents: fields.calendarPastGigEvents,
            calendarFutureGigEvents: fields.calendarFutureGigEvents,
            calendarLastGigDate: fields.calendarLastGigDate,
            calendarNextGigDate: fields.calendarNextGigDate,
            calendarPastGigCount: fields.calendarPastGigCount,
            calendarFutureGigCount: fields.calendarFutureGigCount,
            calendarTotalGigsPlayed: fields.calendarTotalGigsPlayed,
            calendarLastSyncedAt: fields.calendarLastSyncedAt,
            doNotContact: Boolean(fields.doNotContact),
            info: [fields.notes, fields.bookingContact ? `Booking/contact: ${fields.bookingContact}` : ''].filter(Boolean).join('\n')
        };
        nextPoint.booking = window.BARK.bookingSchema && typeof window.BARK.bookingSchema.normalizeVenue === 'function'
            ? window.BARK.bookingSchema.normalizeVenue(nextPoint)
            : { ...(point.booking || {}) };
        return nextPoint;
    }

    function upsertLocalVenue(fields) {
        const parkRepo = window.BARK.repos && window.BARK.repos.ParkRepo;
        if (!fields || !fields.id || !parkRepo || typeof parkRepo.getAll !== 'function' || typeof parkRepo.replaceAll !== 'function') return;

        const points = parkRepo.getAll();
        const existingIndex = points.findIndex(point => point && point.id === fields.id);
        const nextPoint = buildLocalVenuePoint(existingIndex >= 0 ? points[existingIndex] : {}, fields);
        const nextPoints = existingIndex >= 0
            ? points.map((point, index) => index === existingIndex ? nextPoint : point)
            : [...points, nextPoint];

        parkRepo.replaceAll(nextPoints, { debug: true });
        if (typeof window.syncState === 'function') window.syncState();
    }

    function refreshSpreadsheetMapInBackground() {
        if (!window.JDDM_VENUE_CSV_URL || typeof window.BARK.refreshSpreadsheetMap !== 'function') return;
        Promise.resolve(window.BARK.refreshSpreadsheetMap()).catch(error => {
            console.warn('[venueEditModal] background map refresh failed after a successful write:', error);
        });
    }

    async function loadSourceRow() {
        if (isCreatingVenue) return;
        const session = editorSession;
        const venue = activeVenue;
        const service = getSpreadsheetService();
        if (!service || !service.isConfigured()) {
            sourceReady = false;
            renderRawFields(buildInitialRawFields(activeVenue));
            setStatus('Spreadsheet save is not connected yet. Deploy the Firebase spreadsheet bridge and paste its URL into config/firebaseConfig.example.js.', 'warning');
            return;
        }

        sourceReady = false;
        setBusy(true);
        setStatus('Loading source spreadsheet row...', 'neutral');
        const slowTimer = setTimeout(() => {
            if (session !== editorSession) return;
            setStatus('Still checking Google Sheets. A cold cloud connection can take a little while.', 'neutral');
        }, 1800);
        const longTimer = setTimeout(() => {
            if (session !== editorSession) return;
            setStatus('Still loading the spreadsheet row. You can wait here; the map will keep using the current data until Sheets responds.', 'neutral');
        }, 6000);
        try {
            const result = await service.getVenue(venue.id);
            if (session !== editorSession) return;
            if (result && result.rawFields) {
                // Discord links supply only an ID; hydrate the identity before CRM-only saves.
                activeVenue = buildVenueFromRawFields(result.rawFields, activeVenue);
                renderRawFields({
                    ...buildInitialRawFields(activeVenue),
                    ...result.rawFields
                });
            } else {
                renderRawFields(buildInitialRawFields(activeVenue));
            }
            sourceReady = true;
            draftConflict = false;
            captureSavedState();
            setStatus('CRM fields loaded from the spreadsheet.', 'success');
        } catch (error) {
            if (session !== editorSession) return;
            console.error('[venueEditModal] failed to load source row:', error);
            renderRawFields(buildInitialRawFields(activeVenue));
            setStatus(error.message || 'Could not load source spreadsheet row.', 'error');
        } finally {
            if (session === editorSession) {
                setBusy(!sourceReady);
                if (qs('venue-edit-refresh')) qs('venue-edit-refresh').disabled = false;
            }
            clearTimeout(slowTimer);
            clearTimeout(longTimer);
        }
    }

    function saveVenueEdit() {
        if (savePromise) return savePromise;
        savePromise = performSave().finally(() => { savePromise = null; });
        return savePromise;
    }

    async function performSave() {
        const service = getSpreadsheetService();
        if (!activeVenue) return;
        if (!service || !service.isConfigured()) {
            setStatus('Spreadsheet bridge is not configured yet. Deploy the Firebase spreadsheet bridge first.', 'warning');
            return;
        }

        if (!sourceReady) { setStatus('Reload the spreadsheet row before saving.', 'error'); return; }
        const modal = qs('venue-edit-modal');
        const invalid = Array.from(modal.querySelectorAll('input')).find(input => !input.checkValidity() && !(input.hasAttribute('data-contact-value') && input.value === input.dataset.originalValue));
        if (invalid) { setStatus('Please finish the highlighted field. Your changes are still here.', 'error'); invalid.reportValidity(); return false; }
        let rawFields;
        try { rawFields = collectRawFields(); }
        catch (error) { setStatus(error.message, 'error'); return; }
        const submittedSnapshot = formSnapshot();
        const fields = buildVenueFromRawFields(rawFields);
        if (!clean(fields.name)) {
            setStatus('Place Name is required.', 'error');
            return;
        }

        setBusy(true);
        setStatus('Saving to spreadsheet...', 'neutral');

        const wasCreating = isCreatingVenue;
        try {
            let result = wasCreating
                ? await service.createVenue({ rawFields, requestId: createRequestId })
                : await service.saveVenue({ id: activeVenue.id, rawFields, expectedRawFields: activeRawFields });
            if (wasCreating && result?.venue?.['Place ID']) {
                activeVenue = {...activeVenue, id:result.venue['Place ID']};
                isCreatingVenue = false;
                setEditorMode(false);
                // A retry can replay a create that succeeded before its response was lost.
                // Apply any edits made since that attempt to the same venue.
                if (result.replayed && Object.entries(rawFields).some(([h,v])=>v !== result.rawFields?.[h])) {
                    result = await service.saveVenue({id:activeVenue.id,rawFields});
                }
            }

            if (window.JDDM_VENUE_CSV_URL && result && result.csv && typeof window.BARK.parseCSVString === 'function') {
                window.BARK.parseCSVString(result.csv, { cacheTime: Date.now(), source: 'Spreadsheet Save' });
            } else {
                const resultFields = buildVenueFromRawFields(
                    (result && result.rawFields) || rawFields,
                    {
                        ...fields,
                        id: (result && result.venue && result.venue['Place ID']) || fields.id || (activeVenue && activeVenue.id)
                    }
                );
                if (!wasCreating || (result && result.hasCoordinates !== false)) upsertLocalVenue(resultFields);
                activeVenue = resultFields;
                refreshSpreadsheetMapInBackground();
            }

            if (wasCreating && result && result.venue) {
                activeVenue = buildVenueFromRawFields(result.rawFields || result.venue, fields);
            }

            const coordinateNote = wasCreating && result && result.hasCoordinates === false
                ? ' The row was added, but it needs a complete address or coordinates before a pin can appear.'
                : '';
            const syncMessage = window.JDDM_VENUE_CSV_URL
                ? `${wasCreating ? 'Place added' : 'Saved'} to spreadsheet. The map is refreshing in the background.${coordinateNote}`
                : 'Saved to spreadsheet. This pin is updated locally; full sheet sync can be enabled after the live sheet has coordinates.';
            setStatus(syncMessage, 'success');

            // Signal the map (e.g. Ohio place search) that a place is now official,
            // so its blue candidate pin can be cleared.
            if (wasCreating) {
                try {
                    document.dispatchEvent(new CustomEvent('jddm:venue-created', { detail: { name: clean(fields.name) } }));
                } catch (dispatchError) { /* ignore */ }
                isCreatingVenue = false;
                setEditorMode(false);
            }
            activeRawFields = {...activeRawFields,...(result?.rawFields || rawFields)};
            draftConflict = false;
            savedSnapshot = submittedSnapshot;
            return true;
        } catch (error) {
            draftConflict = error.code === 'VENUE_CONFLICT';
            console.error('[venueEditModal] save failed:', error);
            setStatus('Not saved yet. ' + (error.message || 'Check your connection and try again.') + ' Your changes are still here; press Save or X to retry.', 'error');
            return false;
        } finally {
            setBusy(false);
        }
    }

    function bindModalEvents() {
        if (bindModalEvents.bound) return;
        bindModalEvents.bound = true;

        const modal = qs('venue-edit-modal');
        if (!modal) return;

        modal.addEventListener('focusout', event => {
            if (event.target.matches('[data-contact-group="phones"] [data-contact-value]')) event.target.value = contactCodec.formatPhone(event.target.value);
        });
        modal.addEventListener('click', async event => {
            const target = event.target;
            if (savePromise && !target.closest('[data-close-venue-edit]')) return;
            if (target.matches('[data-person-add]')) {
                const people=modal.querySelector('[data-people]');
                const next=Math.max(-1,...Array.from(people.children).map(p=>Number(p.dataset.personIndex)))+1;
                people.insertAdjacentHTML('beforeend',personCard(contactCodec.empty(),next));
                people.lastElementChild.querySelector('input').focus();
            }
            if (target.matches('[data-person-remove]')) {
                const card = target.closest('[data-person-index]');
                const name = clean(card.querySelector('[data-person-name]').value) || 'this contact';
                if (await confirmAction('Remove contact?', `Are you sure you want to remove ${name} and their contact details and notes?`, [['keep','Keep contact'],['remove','Remove contact']]) === 'remove') card.remove();
            }
            if (target.matches('[data-contact-add]')) {
                const group = target.closest('[data-contact-group]');
                const rows = group.querySelector('[data-contact-rows]');
                rows.insertAdjacentHTML('beforeend', contactRow(group.dataset.contactGroup, { value: '', note: '' }, Math.max(-1,...Array.from(rows.children).map(r=>Number(r.dataset.methodIndex)))+1, group.closest('[data-person-index]').dataset.personIndex));
                rows.lastElementChild.querySelector('input').focus();
            }
            if (target.matches('[data-contact-remove]')) {
                if (await confirmAction('Remove contact method?', 'Are you sure you want to remove this phone number, email, or other contact method?', [['keep','Keep it'],['remove','Remove method']]) === 'remove') target.closest('[data-contact-row]').remove();

            }
            if (target.matches('[data-note-done]')) {
                const notes = target.closest('details');
                notes.querySelector('summary').textContent = clean(notes.querySelector('textarea').value) ? 'Notes •' : 'Notes';
                notes.open = false;
            }
            if (target.matches('input[type="date"]') && target.showPicker) {
                try { event.preventDefault(); target.showPicker(); } catch (_) { /* Keyboard date entry remains available. */ }
            }

            if (target.closest('[data-close-venue-edit="true"]')) {
                closeModal();
            }
        });

        const saveBtn = qs('venue-edit-save');
        if (saveBtn) saveBtn.addEventListener('click', saveVenueEdit);

        const refreshBtn = qs('venue-edit-refresh');
        if (refreshBtn) refreshBtn.addEventListener('click', async () => {
            if (draftConflict) {
                if (await confirmAction('Reload the latest saved version?', 'This will discard your unsaved draft and load the changes saved in the other window.', [['keep','Keep editing'],['discard','Reload latest']]) !== 'discard') return;
            } else if (sourceReady && formSnapshot() !== savedSnapshot && !(await saveVenueEdit())) return;
            await loadSourceRow();
        });

        if (typeof window.addEventListener === 'function') window.addEventListener('beforeunload', event => {
            if (!modal.hidden && (savePromise || (sourceReady && formSnapshot() !== savedSnapshot))) {
                event.preventDefault();
                event.returnValue = '';
            }
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && modal && !modal.hidden && !confirmationPending) {
                const note = event.target.closest && event.target.closest('details[open]');
                if (note) { note.open = false; return; }
                event.preventDefault();
                closeModal();
            }
        });
    }

    async function openVenueEditor(venue) {
        if (!venue || !venue.id) {
            alert('This venue cannot be edited because it has no spreadsheet id.');
            return;
        }

        if (qs('venue-edit-modal') && !qs('venue-edit-modal').hidden && !(await closeModal())) return;
        editorSession++;
        draftConflict = false;
        sourceReady = false;
        isCreatingVenue = false;
        setEditorMode(false);
        activeVenue = { ...venue };
        renderRawFields(buildInitialRawFields(activeVenue));
        captureSavedState();
        setBusy(true);
        bindModalEvents();
        setStatus('', 'neutral');
        openModal();
        await loadSourceRow();
    }

    async function openNewVenueEditor(prefill) {
        if (qs('venue-edit-modal') && !qs('venue-edit-modal').hidden && !(await closeModal())) return;
        editorSession++;
        draftConflict = false;
        createRequestId = `contact-create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const service = getSpreadsheetService();
        if (!service || !service.isConfigured()) {
            alert('The spreadsheet bridge must be connected before adding a place.');
            return;
        }
        // Only accept a plain object of prefill fields (button click handlers pass
        // an Event, which we must ignore).
        const isDomEvent = typeof Event !== 'undefined' && prefill instanceof Event;
        const prefillFields = prefill && typeof prefill === 'object' && !isDomEvent
            ? prefill
            : {};
        isCreatingVenue = true;
        sourceReady = true;
        setBusy(false);
        activeVenue = {};
        setEditorMode(true);
        renderRawFields({ ...buildNewVenueRawFields(), ...prefillFields });
        bindModalEvents();
        captureSavedState();
        const prefilled = Object.keys(prefillFields).length > 0;
        setStatus(prefilled
            ? 'Pre-filled from Google Places. Review the details, then add the place to the map.'
            : 'Enter the place name and address. Latitude and longitude are optional; the bridge will geocode the address.', 'neutral');
        openModal();
    }

    function bindAddVenueButtons() {
        document.querySelectorAll('[data-add-venue="true"]').forEach(button => {
            if (button.dataset.boundAddVenue === 'true') return;
            button.dataset.boundAddVenue = 'true';
            button.addEventListener('click', () => openNewVenueEditor());
        });
    }

    window.BARK.openVenueEditor = openVenueEditor;
    window.BARK.openNewVenueEditor = openNewVenueEditor;
    window.BARK.closeVenueEditor = closeModal;
    window.BARK.venueEditModal = {
        buildVenueFromRawFields,
        buildInitialRawFields,
        getRenderableHeaders,
        collectRawFields,
        buildNewVenueRawFields,
        toDateInputValue,
        readContacts,
        renderInputForHeader,
        buildLocalVenuePoint
    };

    document.addEventListener('DOMContentLoaded', bindAddVenueButtons);
    document.addEventListener('DOMContentLoaded', () => {
        const id = new URLSearchParams(window.location.search).get('editVenue');
        if (id && id.length <= 300) openVenueEditor({id});
    });
})();
