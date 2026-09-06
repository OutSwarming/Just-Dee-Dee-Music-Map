/**
 * placeSearch.js - Search real places across Ohio with the Google Places API
 * (New) and drop them straight into the booking spreadsheet.
 *
 * Each result in the dropdown has an "Add to spreadsheet" button. Pressing it
 * pans the map to the place, drops a pin, and opens the Add-a-Place editor with
 * everything Google gave us (name, address, city, state, zip, phone, website,
 * venue type, lat/lng) pre-filled.
 */
(function () {
    window.BARK = window.BARK || {};

    const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
    // Bounding box that covers Ohio (with a little bleed at the corners; we also
    // post-filter results down to Ohio addresses below).
    const OHIO_RECT = {
        low: { latitude: 38.40, longitude: -84.82 },
        high: { latitude: 42.06, longitude: -80.51 }
    };
    const FIELD_MASK = [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.nationalPhoneNumber',
        'places.websiteUri',
        'places.addressComponents',
        'places.primaryTypeDisplayName',
        'places.types'
    ].join(',');

    let lastResults = [];
    let debounceTimer = null;
    let requestSeq = 0;
    let tempMarker = null;

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

    function getKey() {
        return clean(window.JDDM_GOOGLE_PLACES_KEY);
    }

    function qs(id) {
        return document.getElementById(id);
    }

    function setStatus(message, tone = 'neutral') {
        const status = qs('place-search-status');
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function injectStyles() {
        if (qs('place-search-styles')) return;
        const style = document.createElement('style');
        style.id = 'place-search-styles';
        style.textContent = `
            .place-search { margin: 8px 0 2px; text-align:left; }
            .place-search > label { display:block; font-size:12px; font-weight:700; margin-bottom:4px; color:#374151; }
            .place-search-input-row { display:flex; gap:6px; }
            .place-search-input-row input { flex:1; }
            .place-search-results { margin-top:8px; display:flex; flex-direction:column; gap:6px; max-height:300px; overflow:auto; }
            .place-search-result { border:1px solid rgba(0,0,0,.12); border-radius:10px; padding:8px 10px; background:rgba(0,0,0,.03); }
            .place-search-result h4 { margin:0 0 2px; font-size:13px; color:#111827; }
            .place-search-result p { margin:0 0 6px; font-size:11px; color:#4b5563; }
            .place-search-result .place-search-meta { font-size:11px; color:#6b7280; margin:0 0 6px; }
            .place-search-add { font-size:12px; font-weight:700; padding:6px 12px; border-radius:8px; cursor:pointer; border:1px solid #16a34a; background:#22c55e; color:#052e16; }
            .place-search-add:hover { background:#16a34a; color:#fff; }
            #place-search-status { font-size:11px; margin:4px 0 0; min-height:14px; color:#4b5563; }
            #place-search-status[data-tone="error"] { color:#b91c1c; }
            #place-search-status[data-tone="success"] { color:#15803d; }
            .temp-pin-popup { min-width:180px; }
            .temp-pin-popup .temp-pin-name { display:block; font-size:13px; color:#111827; margin-bottom:2px; }
            .temp-pin-popup .temp-pin-note { display:block; font-size:11px; color:#6b7280; margin-bottom:8px; }
            .temp-pin-actions { display:flex; flex-direction:column; gap:6px; }
            .temp-pin-actions button { font-size:12px; font-weight:700; padding:6px 10px; border-radius:8px; cursor:pointer; border:1px solid transparent; }
            .temp-pin-add { border-color:#16a34a; background:#22c55e; color:#052e16; }
            .temp-pin-add:hover { background:#16a34a; color:#fff; }
            .temp-pin-remove { border-color:#d1d5db; background:#fff; color:#b91c1c; }
            .temp-pin-remove:hover { background:#fee2e2; }
        `;
        document.head.appendChild(style);
    }

    function componentValue(components, type, useShort) {
        const match = (components || []).find(comp => Array.isArray(comp.types) && comp.types.includes(type));
        if (!match) return '';
        return clean(useShort ? (match.shortText || match.longText) : (match.longText || match.shortText));
    }

    function addressFromPlace(place) {
        const components = place.addressComponents || [];
        const streetNumber = componentValue(components, 'street_number');
        const route = componentValue(components, 'route');
        const address = [streetNumber, route].filter(Boolean).join(' ');
        const city = componentValue(components, 'locality')
            || componentValue(components, 'postal_town')
            || componentValue(components, 'sublocality')
            || componentValue(components, 'administrative_area_level_2');
        const state = componentValue(components, 'administrative_area_level_1', true) || 'OH';
        const zip = componentValue(components, 'postal_code');
        return { address, city, state, zip };
    }

    const VENUE_TYPE_MAP = {
        winery: 'Winery',
        brewery: 'Brewery',
        bar: 'Bar',
        pub: 'Bar',
        night_club: 'Bar/Nightclub',
        restaurant: 'Restaurant',
        cafe: 'Cafe',
        coffee_shop: 'Cafe',
        meal_takeaway: 'Restaurant',
        food: 'Restaurant',
        tourist_attraction: 'Event Venue',
        performing_arts_theater: 'Event Venue',
        banquet_hall: 'Event Venue',
        park: 'Outdoor Venue'
    };

    function venueTypeFromPlace(place) {
        const types = place.types || [];
        for (const type of types) {
            if (VENUE_TYPE_MAP[type]) return VENUE_TYPE_MAP[type];
        }
        const primary = clean(place.primaryTypeDisplayName && place.primaryTypeDisplayName.text);
        return primary || 'Other Venue';
    }

    function isOhioPlace(place) {
        const { state } = addressFromPlace(place);
        if (state === 'OH') return true;
        return /,\s*OH\b/i.test(clean(place.formattedAddress));
    }

    async function runSearch(query) {
        const key = getKey();
        if (!key) {
            setStatus('Place search is not configured (missing Google Places key).', 'error');
            return;
        }
        const seq = ++requestSeq;
        setStatus('Searching Ohio places...', 'neutral');
        try {
            const response = await fetch(PLACES_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': key,
                    'X-Goog-FieldMask': FIELD_MASK
                },
                body: JSON.stringify({
                    textQuery: query,
                    regionCode: 'US',
                    maxResultCount: 10,
                    locationRestriction: { rectangle: OHIO_RECT }
                })
            });
            if (seq !== requestSeq) return; // a newer search superseded this one
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                let detail = '';
                try { detail = clean(JSON.parse(text).error && JSON.parse(text).error.message); } catch (e) { detail = ''; }
                setStatus(`Place search failed (HTTP ${response.status}${detail ? ': ' + detail : ''}).`, 'error');
                return;
            }
            const data = await response.json();
            const places = (data.places || []).filter(isOhioPlace);
            lastResults = places;
            renderResults(places);
            setStatus(places.length ? `${places.length} Ohio place${places.length === 1 ? '' : 's'} found.` : 'No Ohio places matched that search.', places.length ? 'success' : 'neutral');
        } catch (error) {
            if (seq !== requestSeq) return;
            setStatus(`Place search error: ${error && error.message ? error.message : error}`, 'error');
        }
    }

    function renderResults(places) {
        const container = qs('place-search-results');
        if (!container) return;
        if (!places.length) {
            container.hidden = true;
            container.innerHTML = '';
            return;
        }
        container.hidden = false;
        container.innerHTML = places.map((place, index) => {
            const name = escapeHtml(place.displayName && place.displayName.text);
            const address = escapeHtml(place.formattedAddress);
            const type = escapeHtml(venueTypeFromPlace(place));
            return `
                <div class="place-search-result">
                    <h4>${name || 'Unnamed place'}</h4>
                    <p>${address}</p>
                    <p class="place-search-meta">${type}</p>
                    <button type="button" class="place-search-add" data-place-index="${index}">+ Add to spreadsheet</button>
                </div>
            `;
        }).join('');
    }

    function clearTempPin() {
        const map = window.map || (window.BARK && window.BARK.map);
        if (tempMarker && map) {
            try { map.removeLayer(tempMarker); } catch (e) { /* ignore */ }
        }
        tempMarker = null;
    }

    function openAddFormForPlace(place) {
        if (typeof window.BARK.openNewVenueEditor === 'function') {
            window.BARK.openNewVenueEditor(buildPrefill(place));
        } else {
            setStatus('The Add-a-Place editor is not ready yet. Refresh and try again.', 'error');
        }
    }

    function dropTempPin(place) {
        const map = window.map || (window.BARK && window.BARK.map);
        if (!map || typeof map.setView !== 'function' || typeof window.L === 'undefined') return;
        const L = window.L;
        const loc = place.location || {};
        const lat = Number(loc.latitude);
        const lng = Number(loc.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const label = clean(place.displayName && place.displayName.text) || 'New place';

        clearTempPin();
        map.setView([lat, lng], 15);
        tempMarker = L.marker([lat, lng], { title: label }).addTo(map);

        // The blue pin is a candidate, not yet on the sheet. Clicking it offers
        // to add it (opens the prefilled form -> official JDDM pin) or remove it.
        const popupEl = document.createElement('div');
        popupEl.className = 'temp-pin-popup';
        popupEl.innerHTML = `
            <strong class="temp-pin-name">${escapeHtml(label)}</strong>
            <span class="temp-pin-note">Not on the map yet</span>
            <div class="temp-pin-actions">
                <button type="button" class="temp-pin-add">+ Add to spreadsheet</button>
                <button type="button" class="temp-pin-remove">Remove pin</button>
            </div>`;
        popupEl.querySelector('.temp-pin-add').addEventListener('click', () => openAddFormForPlace(place));
        popupEl.querySelector('.temp-pin-remove').addEventListener('click', () => clearTempPin());
        tempMarker.bindPopup(popupEl);
    }

    function buildPrefill(place) {
        const loc = place.location || {};
        const lat = Number(loc.latitude);
        const lng = Number(loc.longitude);
        const parts = addressFromPlace(place);
        return {
            'Place Name': clean(place.displayName && place.displayName.text),
            Address: parts.address,
            City: parts.city,
            State: parts.state || 'OH',
            Zip: parts.zip,
            'Venue Type': venueTypeFromPlace(place),
            Website: clean(place.websiteUri),
            Status: 'Not Contacted Yet',
            'Phone Number': clean(place.nationalPhoneNumber),
            'Next Follow Up': '',
            Latitude: Number.isFinite(lat) ? lat.toFixed(6) : '',
            Longitude: Number.isFinite(lng) ? lng.toFixed(6) : '',
            Notes: place.id ? `Google Place ID: ${clean(place.id)}` : ''
        };
    }

    function handleAddClick(index) {
        const place = lastResults[index];
        if (!place) return;
        dropTempPin(place);
        openAddFormForPlace(place);
    }

    function init() {
        const input = qs('place-search-input');
        if (!input || init.bound) return;
        init.bound = true;
        injectStyles();

        // When a place is officially added to the sheet (its JDDM pin appears),
        // remove the blue candidate pin.
        document.addEventListener('jddm:venue-created', clearTempPin);

        const clearBtn = qs('place-search-clear');
        const results = qs('place-search-results');

        input.addEventListener('input', () => {
            const query = clean(input.value);
            if (clearBtn) clearBtn.hidden = !query;
            clearTimeout(debounceTimer);
            if (query.length < 3) {
                requestSeq++;
                if (results) { results.hidden = true; results.innerHTML = ''; }
                setStatus(query ? 'Keep typing to search Ohio places...' : '', 'neutral');
                return;
            }
            debounceTimer = setTimeout(() => runSearch(query), 350);
        });

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                input.value = '';
                clearBtn.hidden = true;
                requestSeq++;
                lastResults = [];
                if (results) { results.hidden = true; results.innerHTML = ''; }
                setStatus('', 'neutral');
                input.focus();
            });
        }

        if (results) {
            results.addEventListener('click', event => {
                const button = event.target && event.target.closest ? event.target.closest('[data-place-index]') : null;
                if (!button) return;
                handleAddClick(Number(button.dataset.placeIndex));
            });
        }
    }

    window.BARK.placeSearch = { init, runSearch, buildPrefill, addressFromPlace, venueTypeFromPlace, isOhioPlace, clearTempPin };

    document.addEventListener('DOMContentLoaded', init);
})();
