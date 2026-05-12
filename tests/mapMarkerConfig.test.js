const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadMapMarkerConfig() {
    const context = {
        console,
        Date,
        Map,
        Set,
        Promise,
        Math,
        Number,
        String,
        Boolean,
        Object,
        Array,
        JSON,
        RegExp
    };
    context.window = context;
    context.global = context;
    context.L = {
        divIcon(options) {
            return { options };
        },
        marker(latLng, options) {
            return { latLng, options };
        }
    };

    vm.createContext(context);
    ['modules/bookingSchema.js', 'MapMarkerConfig.js'].forEach(relativePath => {
        vm.runInContext(
            fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
            context,
            { filename: relativePath }
        );
    });

    return context.window;
}

test('marker pin styles follow CRM Status color rules', () => {
    const barkWindow = loadMapMarkerConfig();
    const config = barkWindow.MapMarkerConfig;

    const booked = config.getPinStyle({ contactStatus: 'Booked' });
    const played = config.getPinStyle({ contactStatus: 'Played in the Past' });
    const awaitingReply = config.getPinStyle({ contactStatus: 'Played in the Past - Awaiting Reply' });
    const openMic = config.getPinStyle({ contactStatus: 'Open Microphone' });
    const closed = config.getPinStyle({ contactStatus: 'Told No / Closed / No Music' });
    const notInterested = config.getPinStyle({ contactStatus: 'Not Interested / Do Not Contact' });
    const ordinary = config.getPinStyle({ contactStatus: 'Not Contacted Yet' });

    assert.equal(booked.ringColor, '#065f46');
    assert.equal(booked.borderClass, 'border-dark-green');
    assert.equal(booked.mapState, 'booked');
    assert.equal(played.ringColor, '#84cc16');
    assert.equal(played.borderClass, 'border-light-green');
    assert.equal(awaitingReply.ringColor, '#84cc16');
    assert.equal(openMic.ringColor, '#84cc16');
    assert.equal(openMic.mapState, 'played');
    assert.equal(closed.ringColor, '#991b1b');
    assert.equal(closed.borderClass, 'border-red');
    assert.equal(closed.mapState, 'closed');
    assert.equal(notInterested.ringColor, '#991b1b');
    assert.equal(ordinary.ringColor, '#111827');
    assert.equal(ordinary.borderClass, 'border-black');
    assert.equal(ordinary.isHighlighted, false);
});

test('agenda targets use the agenda marker state over status color', () => {
    const barkWindow = loadMapMarkerConfig();
    barkWindow.BARK.isAgendaTargetVenue = venue => venue && venue.id === 'agenda-venue';

    const style = barkWindow.MapMarkerConfig.getPinStyle({
        id: 'agenda-venue',
        contactStatus: 'Booked'
    });

    assert.equal(style.ringColor, '#1d4ed8');
    assert.equal(style.borderClass, 'border-blue');
    assert.equal(style.isAgendaTarget, true);
    assert.equal(style.stateClass.includes('agenda-marker'), true);
});

test('custom markers use the compact circular divIcon contract', () => {
    const barkWindow = loadMapMarkerConfig();

    const marker = barkWindow.MapMarkerConfig.createCustomMarker({
        id: 'played-venue',
        lat: 41.1,
        lng: -81.5,
        contactStatus: 'Played in the Past'
    }, false);

    const divIcon = marker.options.icon.options;
    assert.deepEqual(Array.from(divIcon.iconSize), [36, 36]);
    assert.deepEqual(Array.from(divIcon.iconAnchor), [18, 18]);
    assert.deepEqual(Array.from(divIcon.popupAnchor), [0, -18]);
    assert.match(divIcon.className, /\bcustom-bark-marker\b/);
    assert.match(divIcon.className, /\bborder-light-green\b/);
    assert.match(divIcon.html, /class="enamel-pin-wrapper"/);
    assert.match(divIcon.html, /<img src="assets\/images\/jddm-played\.jpg"/);
});
