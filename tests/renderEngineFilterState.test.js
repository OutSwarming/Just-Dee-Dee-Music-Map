const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadRenderEngine() {
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
        RegExp,
        document: {
            getElementById() {
                return null;
            },
            querySelector() {
                return null;
            }
        }
    };
    context.window = {
        BARK: {
            normalizeText(value) {
                return String(value || '').toLowerCase().trim();
            }
        },
        requestAnimationFrame(callback) {
            return callback();
        }
    };
    context.global = context;

    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(ROOT, 'modules/renderEngine.js'), 'utf8'),
        context,
        { filename: 'modules/renderEngine.js' }
    );

    return context.window.BARK;
}

test('render engine accepts saved and label-style venue filter names', () => {
    const bark = loadRenderEngine();

    assert.equal(bark.normalizeVenueFilterState('Closed / Not Interested'), 'closed');
    assert.equal(bark.normalizeVenueFilterState('On Agenda Places'), 'agenda');
    assert.equal(bark.normalizeVenueFilterState('Booked Places'), 'booked');
    assert.equal(bark.normalizeVenueFilterState('Played Places'), 'played');
    assert.equal(bark.normalizeVenueFilterState('visited'), 'played');
    assert.equal(bark.normalizeVenueFilterState('unvisited'), 'all');
});

test('status filters only hide nonmatching map states', () => {
    const bark = loadRenderEngine();

    assert.equal(bark.matchesVenueStatusFilter('Closed / Not Interested', 'closed', false), true);
    assert.equal(bark.matchesVenueStatusFilter('Closed / Not Interested', 'played', false), false);
    assert.equal(bark.matchesVenueStatusFilter('Played Places', 'played', false), true);
    assert.equal(bark.matchesVenueStatusFilter('Booked Places', 'booked', false), true);
    assert.equal(bark.matchesVenueStatusFilter('On Agenda Places', 'default', true), true);
    assert.equal(bark.matchesVenueStatusFilter('On Agenda Places', 'booked', false), false);
    assert.equal(bark.matchesVenueStatusFilter('All Places', 'default', false), true);
});

test('status filters stay permissive while status-rich sheet data is still loading', () => {
    const bark = loadRenderEngine();
    bark._venueMapStatusDataReady = false;

    assert.equal(bark.matchesVenueStatusFilter('Played Places', 'default', false), true);
    assert.equal(bark.matchesVenueStatusFilter('Booked Places', 'default', false), true);
    assert.equal(bark.matchesVenueStatusFilter('Closed / Not Interested', 'default', false), true);
    assert.equal(bark.matchesVenueStatusFilter('On Agenda Places', 'default', false), false);
});
