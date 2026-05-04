import assert from 'node:assert/strict';
import test from 'node:test';
import {
    filterFutureBookings,
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
