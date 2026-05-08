const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadPolicy(overrides = {}) {
    const context = {
        console,
        Number,
        String,
        Boolean,
        Object,
        window: {
            BARK: {
                visitedFilterState: overrides.visitedFilterState || 'all'
            },
            map: {
                getZoom() {
                    return 8;
                }
            },
            clusteringEnabled: false,
            premiumClusteringEnabled: false,
            forcePlainMarkers: false,
            stopResizing: false,
            viewportCulling: false,
            lowGfxEnabled: Boolean(overrides.lowGfxEnabled),
            ultraLowEnabled: false,
            simplifyPinsWhileMoving: false,
            limitZoomOut: overrides.limitZoomOut !== undefined ? overrides.limitZoomOut : true
        }
    };
    context.global = context;

    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(ROOT, 'modules/markerLayerPolicy.js'), 'utf8'),
        context,
        { filename: 'modules/markerLayerPolicy.js' }
    );

    return context.window.BARK;
}

test('limit zoom out only applies while all pins are visible', () => {
    const allPins = loadPolicy({ visitedFilterState: 'all', limitZoomOut: true });
    const filteredPins = loadPolicy({ visitedFilterState: 'booked', limitZoomOut: true });
    const lowGraphicsFiltered = loadPolicy({ visitedFilterState: 'closed', limitZoomOut: true, lowGfxEnabled: true });

    assert.equal(allPins.getMarkerLayerPolicy(8).limitZoomOut, true);
    assert.equal(allPins.getMarkerLayerPolicy(8).minZoom, 10);
    assert.equal(filteredPins.getMarkerLayerPolicy(8).limitZoomOut, false);
    assert.equal(filteredPins.getMarkerLayerPolicy(8).minZoom, null);
    assert.equal(lowGraphicsFiltered.getMarkerLayerPolicy(8).limitZoomOut, false);
    assert.equal(lowGraphicsFiltered.getMarkerLayerPolicy(8).minZoom, null);
});

test('venue filter labels normalize before marker policy decisions', () => {
    const policy = loadPolicy({ visitedFilterState: 'Closed / Not Interested', limitZoomOut: true });

    assert.equal(policy.normalizeVenueFilterState('Closed / Not Interested'), 'closed');
    assert.equal(policy.normalizeVenueFilterState('On Agenda Places'), 'agenda');
    assert.equal(policy.normalizeVenueFilterState('Black Pins'), 'black');
    assert.equal(policy.normalizeVenueFilterState('Colored Pins'), 'colored');
    assert.equal(policy.normalizeVenueFilterState('Booked Places'), 'booked');
    assert.equal(policy.normalizeVenueFilterState('Played Places'), 'played');
    assert.equal(policy.getMarkerLayerPolicy(8).limitZoomOut, false);
});
