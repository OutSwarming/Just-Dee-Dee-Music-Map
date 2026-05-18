# Ohio Music Intel Database

This workbook is the scalable storage layer for Northeast Ohio venue, artist,
and gig intelligence.

## Recommended Shape

Do not create one tab per musician or one tab per venue. That gets messy as
soon as a venue hosts music three nights a week or a returning artist plays
twenty rooms.

Use the source tables instead:

- `Venues`: one row per place, seeded from Sheet1 of the master venue sheet.
- `Artists`: one row per musician, band, DJ, host, tribute act, or unknown act.
- `Events`: one row per gig/show occurrence.
- `Event_Artists`: one row per artist on an event bill.
- `Venue_Artist_History`: generated view showing who has played where, how many
  times, first seen, and last seen.
- `Raw_Scrape_Log`: raw source observations from scrapers before cleanup.
- `Review_Queue`: human decisions needed for venue matches, duplicate events,
  and artist type classification.

## Why This Scales

A venue with live music three nights a week simply creates three `Events` rows.
A four-band bill creates one `Events` row and four `Event_Artists` rows. A
returning artist does not need another tab; their history appears by filtering
`Event_Artists` or using the generated `Venue_Artist_History` sheet.

This supports both questions Carter will actually ask:

- "Where has Furious George played?"
- "Who keeps playing at this venue?"

Both are filters or pivots, not permanent tabs.

## IDs And Deduping

Use stable IDs instead of names wherever possible:

- `venue_id`: existing master `Place ID`.
- `artist_id`: generated from canonical artist name.
- `event_id`: generated from event date, time, venue, and title.

Deduping priority:

1. Exact source URL.
2. Exact source event ID.
3. Normalized `event_date + start_time + venue_id + title`.
4. Manual review when a match is fuzzy.

## Artist Types

Start conservative. If the scraper is unsure, keep `artist_type` as `unknown`
and send the row to `Review_Queue`.

Allowed values:

- `solo`
- `duo`
- `band`
- `DJ`
- `open_mic_host`
- `tribute`
- `other`
- `unknown`

## Build Command

```bash
npm run music:intel:workbook
```

The generated workbook is written to:

```text
outputs/ohio_music_intel/JustDeeDeeMusic_Ohio_Music_Intel_Database.xlsx
```

It can be imported into Google Drive as a native Google Sheets spreadsheet.

## Install Into The Cloud Master Sheet

The app's live venue feed remains `Sheet1` in the master spreadsheet. The music
intel database is installed beside it as separate tabs:

- `Music_Intel_README`
- `Venues` / `Venues_DB`
- `Artists` / `Artists_DB`
- `Events` / `Events_DB`
- `Event_Artists` / `Event_Artists_DB`
- `Venue_Artist_History` / `Venue_Artist_History_DB`
- `Review_Queue` / `Review_Queue_DB`
- `Raw_Scrape_Log` / `Raw_Scrape_Log_DB`
- `Lookups` / `Lookups_DB`

Generate the standalone Apps Script seeder:

```bash
npm run music:intel:apps-script
```

Then push/run the generated project with clasp. The seeder opens the master
spreadsheet by ID and updates only the database tabs, leaving `Sheet1` intact
for the app's local/cloud sync.

The live app bridge should prefer `Sheet1` before any database-style `Venues`
tab so importing these tables cannot accidentally change the app feed.

## Daily Artist Website Sync

Artist website calendars are synced into the live Google Sheet with:

```bash
npm run music:artist-sync:write
```

Install the once-daily macOS job with:

```bash
npm run music:artist-sync:install
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.justdeedeemusic.artist-gig-tracker-sync.plist
```

The job runs every day at 8:30 AM and updates these tracker tabs from the
artists listed in `Artists.website`:

- `Venues`
- `Artists`
- `Events`
- `Event_Artists`
- `Venue_Artist_History`
- `Review_Queue`

Current supported sources:

- Bandzoogle/Zoogle artist calendars, including `furiousgeorgehartwig.com`.
- Just Dee Dee Music website calendar via the existing website booking parser.

Data safety rules:

- Past events are never deleted or overwritten as canceled.
- Existing future events stay in the sheet unless their supported source was
  checked successfully.
- If a future event disappears from a checked artist site, it becomes
  `canceled_or_removed`.
- If a similar artist/title/venue appears on a different future date, the old
  row becomes `rescheduled_or_date_changed` and the new date is kept as a new
  event.
- Unknown venues are added to `Venues` with `Needs Review` and mirrored in
  `Review_Queue` instead of being silently guessed.

To add more artists later, add one row to `Artists` with a stable `artist_id`,
`canonical_name`, `artist_type`, and `website`. The next daily sync will check
any supported public calendar automatically.
