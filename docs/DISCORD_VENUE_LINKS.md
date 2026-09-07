# Discord email venue links

Each Gmail conversation has a Link venue / Change linked venue button. Search existing spreadsheet places by name, city, contact name or email, then choose the correct venue from a private dropdown. Searches show up to 24 venues plus Leave unlinked; refine the search for more results. Search choices expire after ten minutes and belong to the person and conversation that requested them.

Discord cannot create venues. New places are added through the map app. Links use the existing Place ID and are stored in Firestore; no spreadsheet columns are added. Duplicate Place IDs are excluded from selection and automatic linking until corrected in the app.

Automatic linking requires exactly one venue matching an exact saved email address in the conversation's From, To, Cc or Reply-To headers. The mailbox's own address, message body, subject and email-domain similarity do not establish links. Multiple matching venues remain unlinked. Manual changes and explicit unlinks persist across subsequent messages.

For a linked conversation, Set follow-up date edits only that venue's existing Next Follow Up cell. The normal bridge confirmation, daily reminders and local AI metrics use this official date. Incoming/sent messages update the waiting status while retaining the date. App date changes refresh linked cards during the five-minute email poll. Stale date submissions are rejected and require reopening the form. Manual relinking and date changes are serialized per conversation, while the spreadsheet bridge checks the previously read cell value.

Unlinked legacy email reminders remain supported. If an automatic match conflicts with a legacy reminder, it remains unlinked for review. A manual link adopts the spreadsheet date and keeps the previous differing email date visibly available for review; it does not overwrite the spreadsheet automatically. Set the official date if the prior reminder is still needed. Linked conversations are excluded from separate email reminder counts and their Discord links are included alongside the venue in the digest.

Validation: functions/tests/venue-links.test.js covers matching ambiguity, fragmented contacts, manual overrides/unlinks, stale forms, user-bound dropdowns, date write/readback, waiting status preservation and reminder counts. Existing conversation, notification and local AI suites cover their integration. Live backfill updates summary cards without posting email bodies again or changing Gmail or the spreadsheet.
