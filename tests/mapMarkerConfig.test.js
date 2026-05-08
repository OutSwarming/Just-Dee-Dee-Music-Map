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
    const ordinary = config.getPinStyle({ contactStatus: 'Not Contacted Yet' });

    assert.equal(booked.ringColor, '#14532d');
    assert.equal(booked.mapState, 'booked');
    assert.equal(played.ringColor, '#86efac');
    assert.equal(awaitingReply.ringColor, '#86efac');
    assert.equal(openMic.ringColor, '#86efac');
    assert.equal(openMic.mapState, 'played');
    assert.equal(ordinary.ringColor, '#111827');
    assert.equal(ordinary.isHighlighted, false);
});

test('agenda targets use the agenda marker state over status color', () => {
    const barkWindow = loadMapMarkerConfig();
    barkWindow.BARK.isAgendaTargetVenue = venue => venue && venue.id === 'agenda-venue';

    const style = barkWindow.MapMarkerConfig.getPinStyle({
        id: 'agenda-venue',
        contactStatus: 'Booked'
    });

    assert.equal(style.ringColor, '#2563eb');
    assert.equal(style.isAgendaTarget, true);
    assert.equal(style.stateClass.includes('agenda-marker'), true);
});
