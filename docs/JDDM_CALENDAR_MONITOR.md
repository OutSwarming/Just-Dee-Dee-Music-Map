# Calendar change notifications

Monitoring → `calendar-changes` (1546426968784769074) reports additions, edits and removals from the calendars used by the spreadsheet sync. Times are rendered in America/New_York (EST/EDT as appropriate).

The bound spreadsheet Apps Script runs `runJddmCalendarChangeMonitor` on a **Head** time trigger every hour, owned by justdeedeemusic@gmail.com. The separate spreadsheet sync is also hourly; a failed duplicate owned by Carter was removed on September 8. The new module is `google-apps-script/jddm-spreadsheet-bridge/CalendarMonitor.gs`; do not replace the deployed Code.gs with the repository copy.

The monitor reads both JDDM calendars from January 2010 through two years ahead, matching the existing spreadsheet sync window. It compares titles, start/end times, all-day status, locations, description hashes and colors. A recurring series is grouped into one change notification. Events newly entering the rolling future window do not generate false additions. Moving an event outside this window is reported as removal from sync, since CalendarApp cannot distinguish that from deletion in this bounded read.

A signed snapshot goes to `jddmCalendarChanges` in Firebase project `just-dee-dee-music-map`. It uses the existing Discord bot, and a dedicated `JDDM_CALENDAR_MONITOR_KEY` secret which also exists in private Apps Script properties. No secrets are in source files. ASCII JSON wire encoding preserves Unicode calendar titles while ensuring UrlFetch and the receiver sign exactly the same bytes.

Firestore `jddmCalendarMonitor/state` stores a compressed baseline, durable pending notifications, a concurrency lock and health timestamps. The first check creates a baseline silently. Unchanged checks post nothing. If either calendar cannot be read, no partial snapshot is submitted and no cancellations are inferred. Failed notification delivery is retried before accepting the next snapshot. Completed queue entries are checkpointed; Discord nonces also reduce duplicates during an ambiguous retry. An old request cannot overwrite a newer baseline.

No spreadsheet cells, columns, calendar bookings or venue contacts are changed by normal monitoring. No new OAuth grant was required; the existing CalendarApp authorization is used. The Calendar REST API probe was removed, and no advanced Calendar service was enabled.

## Validation

- `node --test tests/calendarMonitor.test.cjs`: initialization, unchanged state, additions, changes, cancellations, recurring events, DST/all-day formatting, rolling boundaries, partial reads, durable retries, stale snapshots, signature verification, Unicode transport and idempotent hourly trigger installation.
- `npm test --prefix functions`: existing backend regression suite.
- Live lifecycle test uses an explicitly labeled HOLD test event without guests, exercises creation/time-and-title edit/deletion and an unchanged check, then removes the event. HOLD prevents the temporary event being imported as a venue by the existing sync.

The endpoint alone does not schedule checks; the Apps Script Head trigger is required. Saving the module updates that trigger automatically. Do not change the spreadsheet deployment just to update calendar monitoring.

Live validation on September 7, 2026: 211 events baselined; one add notification, zero on an unchanged poll, one time/title change notification, and one removal notification. Discord content verified the change from 2 PM to 4 PM EDT. The test event was deleted and the baseline returned to 211 events. The saved trigger was inspected and showed Head, Minutes timer, Every 5 minutes. Ten calendar tests and 122 existing backend tests passed.

September 8 efficiency follow-up: both live schedules are hourly. Venue resolution now reuses unchanged mappings, with a six-hour reconciliation limit and immediate invalidation after manual decisions. Digest calendar freshness is 90 minutes. The September 7 five-minute validation above is historical.
