/**
 * MapMarkerConfig.js
 * Exposes a generator function for creating Leaflet divIcons.
 */

class MapMarkerConfig {
    static getPinStyle(parkData, isVisited = false) {
        const venueType = parkData.venueType || parkData.category || parkData.parkCategory || 'Other Venue';
        const categoryColor = window.BARK && typeof window.BARK.getColor === 'function'
            ? window.BARK.getColor(venueType)
            : '#b45309';

        if (isVisited) {
            return {
                iconUrl: 'assets/images/jddm-icon.svg',
                ringColor: '#16a34a',
                pinColor: '#16a34a',
                pinShadowColor: 'rgba(22, 163, 74, 0.4)',
                categoryClass: 'cat-venue'
            };
        }

        return {
            iconUrl: 'assets/images/jddm-icon.svg',
            ringColor: categoryColor,
            pinColor: categoryColor,
            pinShadowColor: `${categoryColor}66`,
            categoryClass: 'cat-venue'
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

        const stateClass = isVisited ? 'visited-marker visited-pin' : 'unvisited-marker';
        const catClass = style.categoryClass;

        const markerHtml = `<div class="enamel-pin-wrapper"><img src="${style.iconUrl}" alt="Venue Pin" loading="lazy" /></div>`;

        // Initialize Leaflet divIcon
        const divIcon = L.divIcon({
            className: `custom-bark-marker ${stateClass} ${catClass}`,
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
