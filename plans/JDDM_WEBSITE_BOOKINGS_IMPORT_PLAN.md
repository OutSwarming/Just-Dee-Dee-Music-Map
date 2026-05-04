# Just Dee Dee Website Bookings Import

## Current Source

- Public website: `https://www.justdeedeemusic.com/`
- Best public events page: `https://www.justdeedeemusic.com/calendar/`
- The site renders events through the Simple Google iCalendar Widget. The public calendar page currently exposes the usable booking text in the rendered HTML.

## Safe First Workflow

1. Pull the public calendar page.
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

Until then, the rendered website parser is safe for previewing bookings and avoids writing to the Sheet without review.
