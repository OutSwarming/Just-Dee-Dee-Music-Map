# Just Dee Dee Spreadsheet Bridge Setup

Project ownership and migration status: [Firebase project ownership](FIREBASE_PROJECT_OWNERSHIP.md).

The production bridge is a Firebase HTTPS function. It replaces the inaccessible Apps Script project and does not require Carter or Dee Dee to click an Apps Script authorization button.

## Production connection

```js
window.JDDM_SPREADSHEET_API_URL = "https://us-central1-just-dee-dee-music-map.cloudfunctions.net/jddmSpreadsheetBridge";
window.JDDM_VENUE_CSV_URL = `${window.JDDM_SPREADSHEET_API_URL}?action=csv`;
```

The function runs as `jddm-integrations@just-dee-dee-music-map.iam.gserviceaccount.com`, which has editor access only to the Just Dee Dee master spreadsheet. The app, reminder worker, artist sync, and test runner all use this same endpoint for reads and writes.

The health response must report schema `2026-08-31-firebase-shared-bridge` and advertise venue writes, reminder queue, artist tracker read/write, guarded cleanup, and geocoding before a deployment is considered ready.

## Deploy or update

From the repository root:

```bash
npx firebase-tools deploy --only functions:jddmSpreadsheetBridge --project just-dee-dee-music-map
```

This command updates only the Just Dee Dee bridge in the JDDM project. See [Firebase project ownership](FIREBASE_PROJECT_OWNERSHIP.md) before any deployment.

## Production end-to-end test

```bash
node scripts/jddm-live-e2e.mjs --execute --exercise-artist-write
```

Add `--send-reminder` only when a real reminder text should be delivered. The test creates a marked temporary venue, edits and reads it back, validates the artist/event connections, optionally performs an artist-table read/write round trip, and removes the temporary venue in a guarded cleanup step.

## 4. Generated Map Columns

The clean storage bridge keeps map identity in the first eight canonical columns: `Place Name`, `Address`, `City`, `Zip`, `State`, `Place ID`, `Longitude`, and `Latitude`.

When the app creates a venue, the bridge generates `Place ID` and fills missing coordinates by geocoding the address. If geocoding cannot find the address, the row is still saved for review, but a pin will not appear until coordinates are supplied.

## 5. Booking CRM Columns

The bridge appends these booking columns when missing. It does not insert them into the middle of existing spreadsheet data:

- `contactStatus`
- `draftStatus`
- `lastContactedDate`
- `nextFollowUpDate`
- `doNotContact`
- `priority`
- `bestFitScore`
- `websiteBookingEvents`
- `calendarGigEvents`
- `calendarPastGigEvents`
- `calendarFutureGigEvents`
- `calendarLastGigDate`
- `calendarNextGigDate`
- `calendarPastGigCount`
- `calendarFutureGigCount`
- `calendarTotalGigsPlayed`
- `calendarLastSyncedAt`

`websiteBookingEvents` is a holding column for reviewed website calendar events before a real merge. The bridge includes a `stageWebsiteBookingEvents` action that defaults to dry-run mode and writes only that holding column when explicitly run with `dryRun: false`.

## Google Calendar Gig Sync

The bridge can now pull Dee Dee's Google Calendar events and keep a durable `CalendarGigs` sheet up to date.

Configured calendar IDs:

- `justdeedeemusic@gmail.com`
- `051b2fd8ffc9844eed9867801c9a348f546e282a484f7a33f47543273162a7ba@group.calendar.google.com`

Configured public ICS fallback:

- `https://calendar.google.com/calendar/ical/051b2fd8ffc9844eed9867801c9a348f546e282a484f7a33f47543273162a7ba%40group.calendar.google.com/public/basic.ics`

Note: the `justdeedeemusic@gmail.com` public ICS URL returned 404 during local verification, so the live bridge uses Apps Script `CalendarApp` for that main calendar. The spreadsheet/script owner must have access to that calendar.

Calendar access failures are treated as source outages, not as an empty
calendar. When the required calendar is unavailable, the bridge reports
`calendarCoverageComplete: false`, refuses a blanket replacement of future gig
dates, and preserves calendar-only dates. A successfully checked official
website feed can still add new dates and remove only dates that came from its
previous website snapshot.

For live Apps Script updates:

1. Open the existing bound calendar project and back up its current source.
2. Patch only the necessary functions in the live source. Do not paste the repository's whole `Code.gs` over the live project; the live script contains additional modules.
3. Publish a new version of the existing deployment and verify every owner's sync trigger uses it. The September 8 separation is version 40.
4. Verify `CalendarReview.gs` calls the JDDM endpoint and matching events retain their existing Place IDs.
5. Unknown venues must remain pending in Discord calendar review until a person chooses New row, Link, or Ignore. The former spreadsheet duplicate-review promotion instructions are retired; see [calendar venue review](JDDM_CALENDAR_VENUE_REVIEW.md).
6. Check the trigger list for duplicate owners before adding any trigger. As of September 8 there are two existing calendar-sync triggers using version 40; the sync interval remains five minutes, and a separate five-minute change monitor uses Head. The migration did not change these intervals to hourly.

The calendar sync is idempotent. It keys the durable gig table by `calendarEventId`/`gigId`, so running it again updates existing calendar gig rows instead of duplicating them.

Private events and placeholder website events are preserved in `CalendarGigs` even when they cannot safely match a venue row.

Local staging/review command:

```bash
npm run bookings:calendar:stage -- --write
```

This reads the exported `.ics` files from `~/Downloads/Google Calendar Export.ical`, then writes:

- `data/staged/jddm-calendar-gigs.json`
- `data/staged/jddm-calendar-gigs.csv`

## Artist Source Audit Tab

The bridge can also create/update an `Artist_Source_Audit` tab from the repo's sheet-ready CSV. This tab is for tracking every artist's known website, Facebook page, and missing-source flags without changing the live venue rows.

After pasting the latest `Code.gs` and deploying a new web app version, run:

```bash
npm run music:artist-source-audit:write
```

That command reads:

```bash
data/artist_sources/artist_source_audit_sheet_ready.csv
```

and writes it to the `Artist_Source_Audit` tab with the `missing_website_url` and `missing_facebook_url` columns marked with `X` where research is still needed.

## Coordinate Import

For the initial migration from the checked-in map CSV, run a 5-row test from this repo after the new Apps Script deployment is live:

```bash
npm run sheet:import-coordinates -- --limit=5
```

If that looks good in the sheet, run the full import:

```bash
npm run sheet:import-coordinates
```

## Optional Edit Token

For a one-person prototype, the bridge can run without a token. If you want a light guard:

1. Set `EDIT_TOKEN` in `Code.gs`.
2. Set the same token in `config/firebaseConfig.example.js`:

```js
window.JDDM_SPREADSHEET_EDIT_TOKEN = "your-token";
```

Do not treat this as real security if the site is public. It is browser-visible.

## Expected Sheet Columns

The bridge works with the current source sheet headers:

- `Place`
- `Rank`
- `Contacted`
- `Want`
- `#Times`
- `Contact Type`
- `Card`
- `Played`
- `Music`
- `Days/Months`
- `Contact Name`
- `Email/Contact`
- `Phone Number`
- `Website`
- `Status`
- `Yearly Booking`
- `Notes`
- `Longitude`
- `Latitude`
- `Site ID`

The map also supports normalized columns if they are added later:

- `venue name`
- `address`
- `city`
- `state`
- `zip`
- `venue type`
- `website/social link`
- `booking/contact info`
- `upcoming event date`
- `upcoming event time`
- `private event`
- `contactStatus`
- `draftStatus`
- `lastContactedDate`
- `nextFollowUpDate`
- `doNotContact`
- `priority`
- `bestFitScore`
- `websiteBookingEvents`

## Test

After connecting the URL:

1. Open the map.
2. Click a pin.
3. Click `Update Spreadsheet`.
4. Edit a harmless field, such as `Status`.
5. Click `Save to Spreadsheet`.
6. Confirm the Google Sheet row updates.
7. Confirm the map refreshes from the sheet.
8. Add the same test venue twice with the same request retry and confirm only one row exists.
9. Repeat 20 harmless status edits and confirm none report `fetch aborted`.

Venue creation no longer runs spreadsheet setup. If the bridge returns `SCHEMA_NOT_READY`, run the one-time clean storage setup from Apps Script, verify the health card, and then retry the add.
