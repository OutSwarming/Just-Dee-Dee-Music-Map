const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadWebsiteBookingsService() {
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
        fetch() {
            throw new Error('fetch should not be called by pure service tests');
        },
        document: {
            addEventListener() {}
        }
    };
    context.window = context;
    context.global = context;

    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(ROOT, 'modules/websiteBookingsService.js'), 'utf8'),
        context,
        { filename: 'modules/websiteBookingsService.js' }
    );

    return context.window.BARK.websiteBookings;
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

test('website booking service normalizes staged future and history payloads', () => {
    const service = loadWebsiteBookingsService();
    const events = service.normalizeWebsiteBookingPayload({
        generatedAt: '2026-05-04T08:00:00.000Z',
        bookings: [
            {
                eventId: 'future-1',
                eventDate: '2026-05-06',
                eventTime: '7:00pm',
                title: 'JustDeeDeeMusic Live @ Brighten Brewing Company',
                venueName: 'Brighten Brewing Company',
                location: '1374 S Cleve-Mass Rd, Copley, OH 44321',
                sourceUrl: 'https://www.justdeedeemusic.com/calendar/'
            }
        ]
    }, 'future');

    assert.equal(events[0].kind, 'websiteEvent');
    assert.equal(events[0].id, 'future-1');
    assert.equal(events[0].sourceType, 'future');
    assert.deepEqual(plain(events[0].sourceCapturedAts), ['2026-05-04T08:00:00.000Z']);
});

test('website booking groups split future and past events relative to today', () => {
    const service = loadWebsiteBookingsService();
    const future = service.normalizeWebsiteBookingEvent({
        eventId: 'future',
        eventDate: '2026-05-06',
        eventTime: '7:00pm',
        venueName: 'Brighten Brewing Company'
    });
    const past = service.normalizeWebsiteBookingEvent({
        eventId: 'past',
        eventDate: '2026-04-24',
        eventTime: '6:00pm',
        venueName: 'Bait House Brewery'
    });
    const groups = service.getWebsiteBookingGroups([future, past], {
        now: '2026-05-04T12:00:00-04:00'
    });

    assert.deepEqual(plain(groups.upcoming.map(event => event.id)), ['future']);
    assert.deepEqual(plain(groups.past.map(event => event.id)), ['past']);
});
