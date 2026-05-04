import assert from 'node:assert/strict';
import test from 'node:test';
import {
    filterFutureBookings,
    filterPastBookings,
    mergeJddmWebsiteBookings,
    parseJddmWebsiteBookings
} from '../scripts/lib/jddmWebsiteBookingsParser.mjs';

const FIXTURE_HTML = `
<ul>
  <li class="list-group-item py-0 head">
    <span class="ical-date">05-02 (Saturday) 10:00am</span>
    <ul>
      <li class="list-group-item py-0">
        <b class="ical_summary">JustDeeDeeMusic Live @ Haymaker Farmers&rsquo; Market</b>
        <div class="ical_details" id="event-old">
          <span class="time">10:00am-</span><span class="time">12:00pm;</span>
          <span class="location">217 N Mantua St, Kent, OH 44240</span>
        </div>
      </li>
    </ul>
  </li>
  <li class="list-group-item py-0 head">
    <span class="ical-date">05-06 (Wednesday) 7:00pm</span>
    <ul>
      <li class="list-group-item py-0">
        <b class="ical_summary">JustDeeDeeMusic Live @ Brighten Brewing Company</b>
        <div class="ical_details" id="event-brighten">
          <span class="time">7:00pm-</span><span class="time">9:00pm;</span>
          <span class="location">1374 S Cleve-Mass Rd, Copley, OH 44321</span>
        </div>
      </li>
    </ul>
  </li>
  <li class="list-group-item py-0 head">
    <span class="ical-date">06-06 (Saturday) 2:00pm</span>
    <ul>
      <li class="list-group-item py-0">
        <b class="ical_summary">LIVE MUSIC with JustDeeDeeMusic at Markko Vineyard</b>
        <div class="ical_details" id="event-markko-a">
          <span class="time">2:00pm-</span><span class="time">5:00pm;</span>
          <span class="location">4500 S Ridge Rd W, Conneaut, OH, United States, Ohio 44030</span>
        </div>
      </li>
      <li class="list-group-item py-0">
        <b class="ical_summary">JustDeeDeeMusic Live @ Markko Vineyard and Winery</b>
        <div class="ical_details" id="event-markko-b">
          <span class="time">2:00pm-</span><span class="time">5:00pm;</span>
          <span class="location">4500 S Ridge Rd W, Conneaut, OH 44030</span>
        </div>
      </li>
    </ul>
  </li>
  <li class="list-group-item py-0 head">
    <span class="ical-date">07-31 (Friday) 6:00pm</span>
    <ul>
      <li class="list-group-item py-0">
        <b class="ical_summary">JDDM 2026 Scheduled Public Event</b>
        <div class="ical_details" id="event-placeholder">
          <span class="time">6:00pm-</span><span class="time">9:00pm;</span>
        </div>
      </li>
    </ul>
  </li>
  <br class="clear">
</ul>
`;

test('parseJddmWebsiteBookings normalizes website calendar events', () => {
    const bookings = parseJddmWebsiteBookings(FIXTURE_HTML, {
        now: '2026-05-04T12:00:00-04:00',
        year: 2026,
        sourceUrl: 'https://example.test/calendar/'
    });
    const brighten = bookings.find((booking) => booking.eventId === 'event-brighten');

    assert.equal(bookings.length, 4);
    assert.equal(brighten.eventDate, '2026-05-06');
    assert.equal(brighten.eventTime, '7:00pm');
    assert.equal(brighten.eventEndTime, '9:00pm');
    assert.equal(brighten.venueName, 'Brighten Brewing Company');
    assert.equal(brighten.venueType, 'Brewery');
    assert.equal(brighten.city, 'Copley');
    assert.equal(brighten.state, 'OH');
    assert.equal(brighten.zip, '44321');
});

test('filterFutureBookings removes events before today', () => {
    const bookings = parseJddmWebsiteBookings(FIXTURE_HTML, {
        now: '2026-05-04T12:00:00-04:00',
        year: 2026
    });
    const future = filterFutureBookings(bookings, {
        now: '2026-05-04T12:00:00-04:00'
    });

    assert.deepEqual(
        future.map((booking) => booking.eventId),
        ['event-brighten', 'event-markko-a', 'event-placeholder']
    );
});

test('parser folds duplicate website events that share date, time, and place', () => {
    const bookings = parseJddmWebsiteBookings(FIXTURE_HTML, {
        now: '2026-05-04T12:00:00-04:00',
        year: 2026
    });
    const markko = bookings.find((booking) => booking.eventId === 'event-markko-a');

    assert.equal(markko.venueName, 'Markko Vineyard');
    assert.deepEqual(markko.duplicateTitles, ['JustDeeDeeMusic Live @ Markko Vineyard and Winery']);
    assert.equal(markko.city, 'Conneaut');
    assert.equal(markko.state, 'OH');
    assert.equal(markko.zip, '44030');
});

test('parser treats five-digit street numbers differently from trailing ZIP codes', () => {
    const html = `
      <li class="list-group-item py-0 head">
        <span class="ical-date">07-17 (Friday) 6:00pm</span>
        <ul><li class="list-group-item py-0">
          <b class="ical_summary">JustDeeDeeMusic Live @ Bummin&rsquo; Beaver Brewery</b>
          <div class="ical_details" id="bummin">
            <span class="time">6:00pm-</span><span class="time">9:00pm;</span>
            <span class="location">11610 E Washington St, Chagrin Falls, OH 44023</span>
          </div>
        </li></ul>
      </li>
    `;
    const bookings = parseJddmWebsiteBookings(html, {
        now: '2026-05-04T12:00:00-04:00',
        year: 2026
    });

    assert.equal(bookings[0].address, '11610 E Washington St');
    assert.equal(bookings[0].city, 'Chagrin Falls');
    assert.equal(bookings[0].state, 'OH');
    assert.equal(bookings[0].zip, '44023');
});

test('parser handles Ohio country labels without turning state into city', () => {
    const html = `
      <li class="list-group-item py-0 head">
        <span class="ical-date">08-01 (Saturday) 9:00am</span>
        <ul><li class="list-group-item py-0">
          <b class="ical_summary">JustDeeDeeMusic Live @ Seville Farm Market</b>
          <div class="ical_details" id="seville">
            <span class="time">9:00am-</span><span class="time">12:00pm;</span>
            <span class="location">73 W Main St, Seville, OH, United States, Ohio</span>
          </div>
        </li></ul>
      </li>
    `;
    const bookings = parseJddmWebsiteBookings(html, {
        now: '2026-05-04T12:00:00-04:00',
        year: 2026
    });

    assert.equal(bookings[0].address, '73 W Main St');
    assert.equal(bookings[0].city, 'Seville');
    assert.equal(bookings[0].state, 'OH');
    assert.equal(bookings[0].zip, '');
});

test('parser marks placeholders and private/public event flags safely', () => {
    const bookings = parseJddmWebsiteBookings(FIXTURE_HTML, {
        now: '2026-05-04T12:00:00-04:00',
        year: 2026
    });
    const placeholder = bookings.find((booking) => booking.eventId === 'event-placeholder');

    assert.equal(placeholder.venueName, 'Scheduled Public Event');
    assert.equal(placeholder.isPublicPlaceholder, true);
    assert.equal(placeholder.venueType, 'Other Venue');
    assert.match(placeholder.notes, /venue\/location may still need confirmation/);
});

test('parser infers next-year events from archived year-end snapshots', () => {
    const html = `
      <li class="list-group-item py-0 head">
        <span class="ical-date">12-22 (Monday) 12:00am</span>
        <ul><li class="list-group-item py-0">
          <b class="ical_summary">JDDM Holiday Tour</b>
          <div class="ical_details" id="holiday"></div>
        </li></ul>
      </li>
      <li class="list-group-item py-0 head">
        <span class="ical-date">01-16 (Friday) 6:00pm</span>
        <ul><li class="list-group-item py-0">
          <b class="ical_summary">JustDeeDeeMusic Live @ Hallidays Winery</b>
          <div class="ical_details" id="hallidays">
            <span class="time">6:00pm-</span><span class="time">9:00pm;</span>
            <span class="location">2400 NE River Rd, Lake Milton, OH 44429</span>
          </div>
        </li></ul>
      </li>
    `;
    const bookings = parseJddmWebsiteBookings(html, {
        snapshotDate: '2025-12-07T02:42:47Z',
        now: '2026-05-04T12:00:00-04:00'
    });

    assert.equal(bookings[0].eventDate, '2025-12-22');
    assert.equal(bookings[1].eventDate, '2026-01-16');
});

test('history helpers merge duplicate source captures and filter past events', () => {
    const olderCapture = [{
        eventId: 'old',
        eventDate: '2025-10-01',
        eventTime: '7:00pm',
        title: 'JustDeeDeeMusic Live @ Brighten Brewing Company',
        venueName: 'Brighten Brewing Company',
        location: '1374 S Cleve-Mass Rd, Copley, OH 44321',
        address: '1374 S Cleve-Mass Rd',
        city: 'Copley',
        state: 'OH',
        zip: '44321',
        sourceUrl: 'https://web.archive.org/example-a',
        sourceCapturedAt: '2025-09-16T02:15:55.000Z'
    }];
    const newerCapture = [{
        ...olderCapture[0],
        eventId: 'new',
        sourceUrl: 'https://web.archive.org/example-b',
        sourceCapturedAt: '2025-11-12T12:28:35.000Z'
    }];

    const merged = mergeJddmWebsiteBookings([olderCapture, newerCapture]);
    const past = filterPastBookings(merged, { now: '2026-05-04T12:00:00-04:00' });

    assert.equal(merged.length, 1);
    assert.deepEqual(merged[0].sourceUrls, [
        'https://web.archive.org/example-a',
        'https://web.archive.org/example-b'
    ]);
    assert.equal(past.length, 1);
});

test('history merge folds placeholders and sparse same-time venue duplicates into richer rows', () => {
    const rich = {
        eventId: 'rich',
        eventDate: '2026-04-24',
        eventTime: '6:00pm',
        title: 'JustDeeDeeMusic Live @ Bait House Brewery',
        venueName: 'Bait House Brewery',
        location: '223 Meigs St, Sandusky, OH 44870',
        address: '223 Meigs St',
        city: 'Sandusky',
        state: 'OH',
        zip: '44870',
        sourceUrl: 'https://web.archive.org/rich',
        sourceCapturedAt: '2026-02-19T02:40:38.000Z'
    };
    const placeholder = {
        eventId: 'placeholder',
        eventDate: '2026-04-24',
        eventTime: '6:00pm',
        title: 'JDDM 2026 Scheduled Public Event',
        venueName: 'Scheduled Public Event',
        isPublicPlaceholder: true,
        sourceUrl: 'https://web.archive.org/placeholder',
        sourceCapturedAt: '2025-11-12T17:28:35.000Z'
    };
    const sparse = {
        eventId: 'sparse',
        eventDate: '2026-04-16',
        eventTime: '6:00pm',
        title: 'cc Saloon',
        venueName: 'cc Saloon',
        sourceUrl: 'https://web.archive.org/sparse',
        sourceCapturedAt: '2026-03-13T17:23:22.000Z'
    };
    const sparseRich = {
        eventId: 'sparse-rich',
        eventDate: '2026-04-16',
        eventTime: '6:00pm',
        title: 'JustDeeDeeMusic Live @ CC Saloon',
        venueName: 'CC Saloon',
        location: '893 Main St, Grafton, OH 44044',
        address: '893 Main St',
        city: 'Grafton',
        state: 'OH',
        zip: '44044',
        sourceUrl: 'https://web.archive.org/sparse-rich',
        sourceCapturedAt: '2026-02-19T02:40:38.000Z'
    };

    const merged = mergeJddmWebsiteBookings([[placeholder, rich, sparse, sparseRich]]);

    assert.equal(merged.length, 2);
    assert.equal(merged.find((booking) => booking.eventDate === '2026-04-24').venueName, 'Bait House Brewery');
    assert.equal(merged.find((booking) => booking.eventDate === '2026-04-16').location, '893 Main St, Grafton, OH 44044');
});
