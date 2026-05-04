# Just Dee Dee Website Bookings Import

## Current Source

- Public website: `https://www.justdeedeemusic.com/`
- Best public events page: `https://www.justdeedeemusic.com/calendar/`
- The site renders events through the Simple Google iCalendar Widget. The public calendar page currently exposes the usable booking text in the rendered HTML.

## Safe First Workflow

1. Pull the public calendar page and homepage event widget.
2. Parse event date, time, title, venue, location, and private/public placeholder flags.
3. Normalize each event into preview JSON.
4. Review the records before writing anything to the Google Sheet.
5. Later, merge approved bookings into matching venue rows or event fields.

Run:

```sh
npm run bookings:website:preview
```

For full records:

```sh
node scripts/pull-jddm-website-bookings.mjs --json
```

To save a review file:

```sh
node scripts/pull-jddm-website-bookings.mjs --out data/jddm-website-bookings-preview.json
```

## Past Booking History Staging

The public website does not expose a true all-time booking archive. To recover what is publicly available, the history stager reads:

- current public calendar page
- current homepage event widget
- public Web Archive snapshots of the calendar page and homepage

Run:

```sh
npm run bookings:website:history
```

Current staged outputs:

- `data/staged/jddm-website-booking-history.json`
- `data/staged/jddm-website-booking-history.csv`

The staged history currently contains 33 past events recovered from public sources, covering `2025-10-18` through `2026-04-26`. No Google Sheet merge has happened yet.

## Normalized Fields

- `eventId`
- `eventDate`
- `eventDay`
- `eventTime`
- `eventEndTime`
- `title`
- `venueName`
- `venueType`
- `location`
- `address`
- `city`
- `state`
- `zip`
- `isPrivateEvent`
- `isPublicPlaceholder`
- `sourceUrl`
- `notes`

## Next Step

The most reliable long-term source would be Dee Dee's actual Google Calendar `.ics` feed URL. If we can get that, we should swap the parser source from rendered website HTML to the calendar feed while keeping the same normalized output shape.

Until then, the rendered website parser plus public archive snapshots are safe for previewing bookings and avoid writing to the Sheet without review.
