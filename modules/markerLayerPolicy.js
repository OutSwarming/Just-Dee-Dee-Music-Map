/**
 * markerLayerPolicy.js - Single source of truth for marker layer/performance mode.
 */
const BARK_GLOBAL = window;
BARK_GLOBAL.BARK = BARK_GLOBAL.BARK || {};
const DETAILED_BUBBLE_BREAKOUT_ZOOM = 12;
const LIMIT_ZOOM_OUT_MIN_ZOOM = 10;
const PERFORMANCE_MIN_ZOOM = 5;

function normalizeVenueFilterState(filter) {
    const raw = String(filter || 'all').trim();
    const value = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!value || value === 'all' || value === 'unvisited' || value.includes('all place')) return 'all';
    if (value === 'played' || value === 'visited' || value.includes('played place')) return 'played';
    if (value === 'booked' || value.includes('booked place') || value.includes('future gig')) return 'booked';
    if (value === 'agenda' || value.includes('agenda') || value.includes('target')) return 'agenda';
    if (
        value === 'closed' ||
        value.includes('not interested') ||
        value.includes('not intrested') ||
        value.includes('not a fit') ||
        value.includes('closed') ||
        value.includes('do not contact')
    ) {
        return 'closed';
    }
    return ['all', 'played', 'booked', 'closed', 'agenda'].includes(value) ? value : 'all';
}

function getRenderContext(zoom) {
    const mapRef = BARK_GLOBAL.map;
    const currentZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : (mapRef ? mapRef.getZoom() : 0);
    const venueFilterState = normalizeVenueFilterState(BARK_GLOBAL.BARK.visitedFilterState);

    return Object.freeze({
        zoom: currentZoom,
        clusteringEnabled: Boolean(BARK_GLOBAL.clusteringEnabled),
        premiumClusteringEnabled: Boolean(BARK_GLOBAL.premiumClusteringEnabled),
        forcePlainMarkers: Boolean(BARK_GLOBAL.forcePlainMarkers),
        stopResizing: Boolean(BARK_GLOBAL.stopResizing),
        viewportCulling: Boolean(BARK_GLOBAL.viewportCulling),
        lowGfxEnabled: Boolean(BARK_GLOBAL.lowGfxEnabled),
        ultraLowEnabled: Boolean(BARK_GLOBAL.ultraLowEnabled),
        simplifyPinsWhileMoving: Boolean(BARK_GLOBAL.simplifyPinsWhileMoving),
        venueFilterState,
        limitZoomOut: Boolean(BARK_GLOBAL.limitZoomOut) && venueFilterState === 'all'
    });
}

function getMarkerLayerPolicy(zoom) {
    const context = getRenderContext(zoom);
    const performanceReduced = context.lowGfxEnabled || context.ultraLowEnabled;
    const premiumExplodesAtZoom = context.premiumClusteringEnabled && context.zoom >= DETAILED_BUBBLE_BREAKOUT_ZOOM;
    const canCluster = context.clusteringEnabled && !context.forcePlainMarkers && !premiumExplodesAtZoom;
    const shouldLimitZoomOut = context.venueFilterState === 'all' && (context.limitZoomOut || performanceReduced);
    const minZoom = shouldLimitZoomOut
        ? (context.limitZoomOut ? LIMIT_ZOOM_OUT_MIN_ZOOM : PERFORMANCE_MIN_ZOOM)
        : null;

    return {
        layerType: canCluster ? 'cluster' : 'plain',
        freezeDuringZoom: context.stopResizing,
        cullPlainMarkers: context.viewportCulling || context.forcePlainMarkers || performanceReduced,
        useReducedVisualsDuringMotion: context.simplifyPinsWhileMoving || context.stopResizing || performanceReduced,
        limitZoomOut: shouldLimitZoomOut,
        minZoom
    };
}

BARK_GLOBAL.BARK.getRenderContext = getRenderContext;
BARK_GLOBAL.BARK.getMarkerLayerPolicy = getMarkerLayerPolicy;
BARK_GLOBAL.BARK.normalizeVenueFilterState = normalizeVenueFilterState;
BARK_GLOBAL.BARK.DETAILED_BUBBLE_BREAKOUT_ZOOM = DETAILED_BUBBLE_BREAKOUT_ZOOM;
BARK_GLOBAL.BARK.LIMIT_ZOOM_OUT_MIN_ZOOM = LIMIT_ZOOM_OUT_MIN_ZOOM;
