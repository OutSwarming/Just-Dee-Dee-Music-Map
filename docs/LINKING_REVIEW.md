# Linking Review

The existing `calendar-review` channel is now `linking-review` under Monitoring. It holds one review card per unmatched Calendar/website record, Email conversation, Facebook Messenger conversation, Instagram conversation, or Google Voice conversation. Voice cards distinguish texts, calls, and voicemail. Already linked conversations do not create extra review cards; existing calendar review history stays available.

## Dee Dee's workflow

- **Search venues** opens a popup. Search by venue, city, contact, email, or phone; approximate spelling works. Submitting replaces the choices on that same card.
- The **venue dropdown stays on the card**. Selecting a venue saves the source link and turns the card green, with the official spreadsheet follow-up date. Search can change an existing link.
- **Ignore** makes the card gray without deleting source messages. **Review again** reopens it.
- **Add in app** opens the map's Add Place form with known details filled in. Unknown venue names stay blank. Review the details and press **Add Place to Map**. The next five-minute review check links the source to that saved row. Reopening a saved draft opens its existing venue editor.
- **Open source** opens the original conversation.

Search results and confirmations edit the original card; they do not send another response at the bottom. Discord allows 25 choices per dropdown, so search narrows the full venue directory. Search choices are shared on the card; stale submissions are rejected if somebody changes them first.

## Data and delivery

No spreadsheet columns were added. Source links retain the existing source services and official spreadsheet dates. Add Place retains normal validation, contact groups, geocoding, duplicate checking, and save notifications. A stable review ID and create request ID connect app-created rows back to the review and protect retries. The old Discord-only calendar row-creation action is disabled.

Draft links use an opaque per-review token, and public draft responses are uncached. Review cards suppress mentions and notification pushes. Polling runs every five minutes. Deleted legacy cards are recovered once. Discord rate-limited edits remain queued until the server's retry time, without creating duplicate cards.

## Verification — September 7, 2026

- 264 backend tests and 19 app/spreadsheet service tests passed.
- Live Chrome: popup search for `Filia Celars` found Filia Cellars; the dropdown and save confirmation remained on the original card. Re-selecting the already verified calendar link saved successfully.
- Live Chrome: Ignore and Review again changed one Google Voice review in place and restored it to pending.
- Live Chrome: Add in app opened the actual form with a formatted US phone number, Google Voice contact preference, and blank placeholders for unknown name/email. The form was closed without creating a fictitious venue.
- 92 review records were present at the final check, including a newly received email. A retired test card recovered during migration was removed.
- The official spreadsheet export remained byte-identical: 517 venue rows, 28 columns.
- New-place saving and automatic linking back were exercised by automated tests. A fabricated venue was not added to the production sheet. Instagram routing is covered by tests; there were no imported Instagram conversations available for a live review-card test.
