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
        if ([
            'told no closed no music',
            'do not contact',
            'not a fit',
            'closed and not booking',
            'no live music',
            'venue said no to jddm',
            'not interested do not contact',
            'bad fit too far',
            'closed no longer operating',
            'duplicate merge needed'
        ].includes(status)) {
            return 'closed';
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
        const isHighlighted = isAgendaTarget || mapState === 'booked' || mapState === 'played' || mapState === 'closed';

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
                ringColor: '#1d4ed8',
                pinColor: '#1d4ed8',
                pinShadowColor: 'rgba(29, 78, 216, 0.58)',
                borderClass: 'border-blue',
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
                ringColor: '#065f46',
                pinColor: '#064e3b',
                pinShadowColor: 'rgba(6, 95, 70, 0.68)',
                borderClass: 'border-dark-green',
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
                ringColor: '#84cc16',
                pinColor: '#15803d',
                pinShadowColor: 'rgba(101, 163, 13, 0.62)',
                borderClass: 'border-light-green',
                categoryClass: 'cat-venue',
                stateClass: 'venue-map-state-played played-marker',
                isHighlighted: true,
                mapState: state.mapState,
                isAgendaTarget: false
            };
        }

        if (state.mapState === 'closed') {
            return {
                iconUrl: 'assets/images/jddm-not-played.jpg',
                ringColor: '#991b1b',
                pinColor: '#7f1d1d',
                pinShadowColor: 'rgba(127, 29, 29, 0.66)',
                borderClass: 'border-red',
                categoryClass: 'cat-venue',
                stateClass: 'venue-map-state-closed closed-marker',
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
            borderClass: 'border-black',
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
            className: `custom-bark-marker ${stateClass} ${catClass} ${style.stateClass} ${style.borderClass}`,
            html: markerHtml,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
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
