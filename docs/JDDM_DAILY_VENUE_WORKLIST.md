# Daily venue information worklist

Channel: [daily-venue-worklist](https://discord.com/channels/1543777084265070623/1546593555617685514).

This combines the actionable morning worklist with small batches of contact-data repair. It edits existing venue rows only, within the original 28 spreadsheet columns.

## Daily workflow

At 7:50 AM Eastern, the system retains unfinished posts and fills available slots up to four. If three of yesterday's four venues were finished, one carries over and three new venues arrive. Completing a post does not immediately replace it during the same day.

Candidates lack a contact name, email, phone, or have Needs Review status. Closed/rejected venues, ambiguous or missing IDs, malformed contact records, and marked test rows are excluded. Unseen venues are shuffled without replacement. Completed venues are revisited only when no unseen candidates remain, the venue still needs information, and at least 30 days have passed.

Each venue gets one reusable forum post:

- **Open venue** opens its existing app editor.
- **Edit contacts** selects an existing person or adds a contact. Name, email, and phone may independently be blank. Phone-only and email-only people stay separate. US phone numbers are formatted. Notes are stored once per contact. A second menu edits websites, other contact methods, and the preferred method.
- **Contacted** asks for confirmation, writes today's Eastern Last Contacted date, and sets Waiting on Reply only from a lead/review status. Existing Booked, Played, Open Microphone and rejected statuses are preserved. No email or text is sent by this button.
- **Reschedule** saves the official spreadsheet Next Follow Up date, sets the post orange, and pauses it until that date. Due rescheduled posts have priority for the available morning slots. App-side date changes remain authoritative.
- **Done** asks for confirmation, appends a dated review note in the existing Notes column, and turns the post green and archives it. Missing information can remain blank. Booking status and follow-up dates are preserved. Reopen is available when there is capacity.
- The **status dropdown** changes the official spreadsheet status after confirmation.
- **Refresh from spreadsheet** and **Edit venue notes** are also available.

Open and completed posts refresh from the spreadsheet every five minutes, so app edits remain usable. Discord forms use a snapshot and optimistic conflict checks; stale forms cannot overwrite newer app contact edits. Long records exceeding Discord form limits must be edited in the app; they are never truncated for storage.

The 8 AM daily follow-up digest links the open worklist posts. The forum messages remain quiet, with no automatic mentions. Existing daily follow-up alerts keep their established routing.

## Storage and safety

- Runtime and Discord interaction routing: Firebase `just-dee-dee-music-map`.
- Canonical write service: `jddmSpreadsheetBridge` in `barkrangermap-auth`.
- `jddmVenueWorklist/config` contains forum/tag configuration; `/daily` stores the daily reservation.
- `jddmVenueWorklistTasks` stores one task per hashed stable venue ID, state, source ID, post ID, and review dates.
- `jddmVenueWorklistSessions` stores private user-bound form snapshots, expiration, and failed drafts.
- `jddmWorklistActions` deduplicates signed Discord interactions.
- All worklist writes use `saveVenue`; the gateway exposes no create, append, or delete action.
- Contact groups reuse the existing `Booking Contact` format and its existing primary contact columns. Venue notes are preserved when a review is recorded.
- A common per-venue write lock serializes app and Discord writes at the canonical bridge. Expected-field checks catch stale drafts.
- Worklist writes are signed with `JDDM_WORKLIST_EDIT_KEY`. Only verified signatures can credit those saves to the manual activity counter. Automatic syncs still do not count.
- Discord's original interaction signature, guild, post, user and expiring session are validated before edits.
- Completed posts are archived, not deleted. Post delivery records and source links allow recovery after an interrupted creation.

## Validation

Automated tests cover partial contacts, US phone formatting, old note preservation, two-way date refresh, stale forms, exact four-slot carryover, cycling, repeated daily runs, invalid IDs, removed rows, signed interactions, privacy-bound sessions, malformed values, oversized fields, and Done behavior without extra columns or rows.

Live evidence, including the temporary spreadsheet fixture and real Discord control tests, is kept in `work/venue-worklist/` and is not committed.
