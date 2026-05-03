/**
 * MapMarkerConfig.js
 * Exposes a generator function for creating Leaflet divIcons.
 */

class MapMarkerConfig {
    static getPinStyle(parkData, isVisited = false) {
        if (isVisited) {
            return {
                iconUrl: 'assets/images/jddm-played.jpg',
                ringColor: '#2563eb',
                pinColor: '#2563eb',
                pinShadowColor: 'rgba(37, 99, 235, 0.45)',
                categoryClass: 'cat-venue'
            };
        }

        return {
            iconUrl: 'assets/images/jddm-not-played.jpg',
            ringColor: '#111827',
            pinColor: '#111827',
            pinShadowColor: 'rgba(17, 24, 39, 0.45)',
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
