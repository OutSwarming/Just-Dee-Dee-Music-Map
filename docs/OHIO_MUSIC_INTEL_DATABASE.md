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
