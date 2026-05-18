# Just Dee Dee Spreadsheet Bridge Setup

This app is hosted on GitHub Pages, so it cannot write to Google Sheets by itself. The bridge is a tiny Google Apps Script web app that runs inside the spreadsheet and updates rows for the map.

## 1. Install the Bridge

1. Open the original working Just Dee Dee Music spreadsheet.
2. Click `Extensions` > `Apps Script`.
3. Delete any starter code in `Code.gs`.
4. Paste the contents of:

   `google-apps-script/jddm-spreadsheet-bridge/Code.gs`

5. Click `Save`.

## 2. Deploy the Web App

1. Click `Deploy` > `New deployment`.
2. Click the gear icon and choose `Web app`.
3. Set:
   - Description: `Just Dee Dee Music Map bridge`
   - Execute as: `Me`
   - Who has access: `Anyone with the link`
4. Click `Deploy`.
5. Authorize the requested Google Sheets permissions.
6. Copy the Web app URL. It should end with `/exec`.

## 3. Connect the Map

The app is currently wired back to the original working bridge:

```js
window.JDDM_SPREADSHEET_API_URL = "https://script.google.com/macros/s/AKfycbyeskUlFOAAfBKjhVtHpDHfjKn_SOfzaN0CIorRvyRirS_hTzTjjwf5w5gB2qs9yiw8/exec";
window.JDDM_VENUE_CSV_URL = `${window.JDDM_SPREADSHEET_API_URL}?action=csv&autofill=0`;
```

If you deploy a replacement bridge later, paste the new `/exec` URL into `config/firebaseConfig.example.js`:

```js
window.JDDM_SPREADSHEET_API_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec";
window.JDDM_VENUE_CSV_URL = `${window.JDDM_SPREADSHEET_API_URL}?action=csv&autofill=0`;
```

The current `Code.gs` uses the active bound spreadsheet. Open the Apps Script editor from the spreadsheet itself with `Extensions` > `Apps Script`, then paste/deploy the bridge there.

`JDDM_VENUE_CSV_URL` makes spreadsheet edits flow back into the map data feed. The app also refreshes immediately after a save when the bridge returns updated CSV.

Only turn on `JDDM_VENUE_CSV_URL` after the live sheet has generated coordinates in columns R/S/T. Until then, keep the checked-in CSV as the map fallback.

## 4. Generated Map Columns

The bridge owns these generated map columns:

- Column R: `Longitude`
- Column S: `Latitude`
- Column T: `Site ID`

When a row is edited or synced, the bridge fills `Site ID` from the venue/place text and fills missing coordinates by geocoding the row address. These columns are what the map uses as the stable spreadsheet source of truth.

After pasting the latest `Code.gs`, run this once in Apps Script:

1. Select `installJddmAutoFillTrigger` from the function dropdown.
2. Click `Run`.
3. Approve the Google permissions.
4. Reload the spreadsheet.

New or edited rows will then auto-fill columns R/S/T.

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

After pasting the latest `Code.gs` and deploying:

1. Open Apps Script from the original working spreadsheet.
2. Save the updated `Code.gs`.
3. Deploy a new version of the existing web app.
4. Run `doGet` once from the Apps Script editor, or run `installJddmCalendarSyncTrigger` from the JDDM Map menu.
5. Confirm the `CalendarGigs` sheet appears.
6. Confirm venue rows gain `calendarGigEvents`, `calendarPastGigEvents`, `calendarFutureGigEvents`, `calendarLastGigDate`, `calendarNextGigDate`, `calendarPastGigCount`, `calendarFutureGigCount`, and `calendarTotalGigsPlayed` where matches are confident.
7. Confirm the `CalendarDuplicateReview` sheet appears. Calendar-only public venues are staged there instead of being discarded.
8. In `CalendarDuplicateReview`, use column Q (`isDuplicate`) as the review dropdown:
   - `Yes` merges the calendar event into an existing venue when `duplicateVenueSiteId`, `duplicateVenueName`, or the auto-match can identify the duplicate.
   - `No` promotes the calendar event as a new venue row.
9. Confirm Apps Script has a `runJddmCalendarSyncTrigger` time trigger set to refresh every 5 minutes.

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
