/**
 * MapMarkerConfig.js
 * Exposes a generator function for creating Leaflet divIcons.
 */

class MapMarkerConfig {
    static clean(value) {
        return String(value === undefined || value === null ? '' : value).trim();
    }

    static normalizeLoose(value) {
        return MapMarkerConfig.clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    static getContactStatus(parkData = {}) {
        return MapMarkerConfig.clean(
            parkData.contactStatus ||
            parkData.status ||
            (parkData.booking && parkData.booking.contactStatus)
        );
    }

    static getVenueMapState(parkData = {}, isVisited = false) {
        const schema = typeof window !== 'undefined' && window.BARK && window.BARK.bookingSchema;
        if (schema && typeof schema.getVenueMapState === 'function') {
            return schema.getVenueMapState(parkData);
        }

        const status = MapMarkerConfig.normalizeLoose(MapMarkerConfig.getContactStatus(parkData));
        if (status === 'booked') return 'booked';
        if (
            status === 'played in the past' ||
            status === 'played in the past awaiting reply' ||
            status === 'open microphone' ||
            status === 'open mic'
        ) {
            return 'played';
        }

        return isVisited && !status ? 'played' : 'default';
    }

    static isAgendaTarget(parkData = {}) {
        if (
            typeof window !== 'undefined' &&
            window.BARK &&
            typeof window.BARK.isAgendaTargetVenue === 'function'
        ) {
            return window.BARK.isAgendaTargetVenue(parkData);
        }

        return Boolean(parkData && parkData.isAgendaTarget);
    }

    static getMarkerState(parkData, isVisited = false, options = {}) {
        const mapState = options.mapState || MapMarkerConfig.getVenueMapState(parkData, isVisited);
        const isAgendaTarget = Object.prototype.hasOwnProperty.call(options, 'isAgendaTarget')
            ? Boolean(options.isAgendaTarget)
            : MapMarkerConfig.isAgendaTarget(parkData);
        const isHighlighted = isAgendaTarget || mapState === 'booked' || mapState === 'played';

        return {
            mapState,
            isAgendaTarget,
            isHighlighted
        };
    }

    static getPinStyle(parkData, isVisited = false, options = {}) {
        const state = MapMarkerConfig.getMarkerState(parkData, isVisited, options);

        if (state.isAgendaTarget) {
            return {
                iconUrl: 'assets/images/jddm-not-played.jpg',
                ringColor: '#2563eb',
                pinColor: '#2563eb',
                pinShadowColor: 'rgba(37, 99, 235, 0.45)',
                categoryClass: 'cat-venue',
                stateClass: 'venue-map-state-agenda agenda-marker',
                isHighlighted: true,
                mapState: state.mapState,
                isAgendaTarget: true
            };
        }

        if (state.mapState === 'booked') {
            return {
                iconUrl: 'assets/images/jddm-played.jpg',
                ringColor: '#14532d',
                pinColor: '#14532d',
                pinShadowColor: 'rgba(20, 83, 45, 0.5)',
                categoryClass: 'cat-venue',
                stateClass: 'venue-map-state-booked booked-marker',
                isHighlighted: true,
                mapState: state.mapState,
                isAgendaTarget: false
            };
        }

        if (state.mapState === 'played') {
            return {
                iconUrl: 'assets/images/jddm-played.jpg',
                ringColor: '#86efac',
                pinColor: '#15803d',
                pinShadowColor: 'rgba(34, 197, 94, 0.38)',
                categoryClass: 'cat-venue',
                stateClass: 'venue-map-state-played played-marker',
                isHighlighted: true,
                mapState: state.mapState,
                isAgendaTarget: false
            };
        }

        return {
            iconUrl: 'assets/images/jddm-not-played.jpg',
            ringColor: '#111827',
            pinColor: '#111827',
            pinShadowColor: 'rgba(17, 24, 39, 0.45)',
            categoryClass: 'cat-venue',
            stateClass: 'venue-map-state-default',
            isHighlighted: false,
            mapState: 'default',
            isAgendaTarget: false
        };
    }

    /**
     * Generates a Leaflet L.marker with appropriate HTML structure and classes for CSS binding.
     * @param {Object} parkData - Data payload for the venue (needs lat and lng)
     * @param {Boolean} isVisited - True if the user has marked this venue visited
     * @returns {L.marker} The constructed Leaflet marker instance
     */
    static createCustomMarker(parkData, isVisited) {
        const style = MapMarkerConfig.getPinStyle(parkData, isVisited);

        const stateClass = style.isHighlighted ? 'visited-marker visited-pin' : 'unvisited-marker';
        const catClass = style.categoryClass;

        const markerHtml = `<div class="enamel-pin-wrapper"><img src="${style.iconUrl}" alt="Venue Pin" loading="lazy" /></div>`;

        // Initialize Leaflet divIcon
        const divIcon = L.divIcon({
            className: `custom-bark-marker ${stateClass} ${catClass} ${style.stateClass}`,
            html: markerHtml,
            iconSize: [36, 36], // Increased slightly to account for the padding ring
            iconAnchor: [18, 18], // Center it smoothly
            popupAnchor: [0, -18]
        });

        // Initialize and return the L.marker
        const marker = L.marker([parkData.lat, parkData.lng], { icon: divIcon });

        // Keep the venue payload bound for UI handlers downstream.
        marker._parkData = parkData;

        return marker;
    }
}

// Export for usage
if (typeof window !== 'undefined') {
    window.MapMarkerConfig = MapMarkerConfig;
}
