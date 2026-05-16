const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadAvailabilityModule() {
    const context = {
        console,
        Date,
        Map,
        Set,
        Number,
        String,
        Boolean,
        Object,
        Array,
        Intl
    };
    context.window = context;
    context.global = context;

    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(ROOT, 'modules/bookingAvailability.js'), 'utf8'),
        context,
        { filename: 'modules/bookingAvailability.js' }
    );

    return context.window.BARK.bookingAvailability;
}

test('weekend availability includes Friday night, Saturday, and Sunday', () => {
    const availability = loadAvailabilityModule();
    const result = availability.getAvailableDates({
        startDate: '2026-05-15',
        lookaheadDays: 3,
        limit: 5,
        mode: 'weekends'
    });

    assert.deepEqual(Array.from(result.dates, item => item.date), [
        '2026-05-15',
        '2026-05-16',
        '2026-05-17'
    ]);
});

test('weekday availability excludes booked, website, and blocked calendar dates', () => {
    const availability = loadAvailabilityModule();
    const result = availability.getAvailableDates({
        startDate: '2026-05-18',
        lookaheadDays: 7,
        limit: 8,
        mode: 'weekdays',
        venues: [
            {
                name: 'Booked Venue',
                booking: {
                    calendarFutureGigDates: ['2026-05-18'],
                    calendarFutureGigEvents: '2026-05-19 | BOOKED | Another Venue'
                }
            }
        ],
        websiteEvents: [
            {
                eventDate: '2026-05-20',
                venueName: 'Website Venue'
            }
        ],
        blockedEvents: [
            {
                eventDate: '2026-05-21',
                eventEndDate: '2026-05-22',
                summary: 'Vacation',
                isAllDay: true
            }
        ]
    });

    assert.deepEqual(Array.from(result.dates, item => item.date), [
        '2026-05-25'
    ]);
    assert.equal(result.busyCount, 4);
});
