# JDDM app activity tracker

Live channel: [Monitoring → app-activity](https://discord.com/channels/1543777084265070623/1546582476741410836).

Tracking began September 7, 2026 at 2:05 PM Eastern. Earlier edits are not reconstructed. The app currently has a shared editor: **Dee Dee and Carter's manual app edits both count**. This is an activity aid, not authenticated individual audit attribution. Origin identifies the normal app request path; it is not an authentication boundary.

## Rules

- One successfully saved venue change counts as one edit, regardless of how many fields changed. New places and played-status changes count too.
- Failed writes, empty saves, replayed new-place requests, automatic calendar syncs, and direct Sheets edits do not count. Authenticated human saves from the daily Discord venue worklist count too; other automated Discord updates do not.
- Each real app edit resets the inactivity streak immediately.
- At **10 PM America/New_York**, zero edits produces “No changes for 1 day,” then 2, 3, and so on. Three through ten edits produces congratulations with the count. Eleven or more produces “You are rocking today!!” One or two edits resets the streak without an extra message.
- At **7:55 AM Eastern**, three or more consecutive inactive days produces “No new edits, what is going on?” Late-night and morning edits cancel the warning. It continues on subsequent inactive mornings until an edit is saved.
- The daily count uses Eastern calendar dates, including daylight-saving changes. The 10 PM recap covers edits saved by then; later saves still count for that date and cancel the morning warning.
- Messages suppress push notifications and mentions, preserving the quiet Monitoring defaults. No SMS is sent by this feature.
- No spreadsheet columns are added or repurposed.

## Runtime

Firebase project: `barkrangermap-auth` (the canonical spreadsheet bridge).

- `jddmSpreadsheetBridge`: records successful manual app saves after persistence.
- `jddmAppActivityNightly`: enabled Cloud Scheduler schedule `0 22 * * *`, Eastern.
- `jddmAppActivityMorning`: enabled Cloud Scheduler schedule `55 7 * * *`, Eastern.
- `jddmAppActivity/config`: enable switch, channel, tracking start and scope.
- `jddmAppActivity/state`: most recent manual edit date/time.
- `jddmAppActivityDays`: daily counts.
- `jddmAppActivityEvents`: request-ID deduplication, action, venue ID, changed field names and save time; no contact values.
- `jddmAppActivityReports`: delivery claims and Discord message receipts.

Firestore transactions serialize counts and request deduplication. Scheduled functions retry failures, use deterministic Discord nonces, and recover a delivered message from its footer if receipt persistence failed. Stale deliveries from another Eastern date are discarded. Spreadsheet success is preserved if the counter is unavailable; that exceptional case logs an error and returns `activityWarning` rather than encouraging a duplicate spreadsheet save.

## Verification, September 7, 2026

- Unit tests cover praise thresholds, three-day streaks, midnight/DST, late saves, concurrent saves, repeated IDs, no-op/failed/automatic writes, quiet delivery, failed Discord delivery, lost receipts and stale scheduled events.
- Live production bridge test created a marked temporary venue, saved multiple fields including a follow-up date, and changed played status: exactly **three** activity events. A repeated create, no-op save, automated save, repeated played status and failed save did not add events. Saved values were read back. The temporary venue, test notifications and count contributions were removed.
- Isolated Firestore state and simulated dates drove real Discord delivery of the three-day report, next-morning warning and three-edit congratulations. Quiet flags and duplicate suppression were checked. Test messages and state were removed.
- Both deployed Cloud Scheduler jobs were verified enabled with Eastern time. The morning job was invoked through Cloud Scheduler to check its deployed execution path.

Local detailed evidence is under `work/app-activity/` (not committed).
