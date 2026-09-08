# JDDM privacy requests — operator procedure

Owner: Just Dee Dee Music; Carter/Dee Dee administer the integration. Public request address: `justdeedeemusic@gmail.com`. Public instructions: https://just-dee-dee-inbox.web.app/data-deletion.html . This is a human-operated request process, not an automatic account-deletion endpoint.

## Intake and scope

1. Record an opaque request number, received date, requested action, and platform. Keep the actual request in the business inbox; do not post sensitive identifiers in public channels or source control.
2. Verify the requester’s connection to the information through the original conversation/account or another reasonable method. Do not request their password, access token, or unnecessary ID documents.
3. Identify the matching sender and all conversations. Confirm the exact scope and any genuine legal/business-record retention exception; never use an unspecified “business reason” to bypass an applicable deletion obligation. A correction may be sufficient if that is what the requester wants.
4. Acknowledge and handle promptly; record the applicable deadline. Do not invent a universal legal time limit or promise immediate deletion from provider backups.

## Stop the integration from recreating data

Before removing Facebook/Instagram copies, call `socialPrivacy.restrict(db, platform, senderId)` using the existing authorized admin runtime. Valid platforms are `messenger` and `instagram`. The stored restriction key is SHA-256 of platform, JDDM account ID, and sender ID. The record stores only the restriction flag and updated time; it contains no raw sender ID or message body.

The restriction is checked before initial import, unchanged polling, and Discord replies. This applies to all source conversations for that sender on the selected platform. Read errors fail closed. A restriction is not itself deletion: finish the steps below.

For a deletion operation, temporarily pause the affected platform’s config `enabled` flag and wait for active poll/conversation locks and pending sends to finish before erasing records. Do not delete during an active source sync or while an external send is uncertain. Preserve the original enabled state and restore it when complete; keep the sender restriction. No customer’s original Gmail/Meta data should be deleted by an integration-copy cleanup unless that separate scope has been verified.

## Locate and remove copies under JDDM’s control

Prepare a private inventory and inspect before destructive changes. Preserve unrelated venues, people, spreadsheet columns, and booking records.

- The sender’s `jddmMessengerConversations` or `jddmInstagramConversations` records, including previews and `linkEvidence` text.
- Entire associated Discord forum posts (including human replies, imported messages, and attachments uploaded into Discord), after confirming they contain no unrelated customer thread.
- Source-message receipts in the corresponding `*Messages` collection, identified by conversation ID; do not rely only on preview text searches.
- Related `jddmSocialSends` and `jddmSocialSendContent` records matching platform and recipient/conversation; settle any uncertain send before removal.
- `jddmVenueIdentities` entries for the platform-scoped sender; inspect shared identities carefully rather than deleting another source’s unrelated assignments.
- Related `jddmLinkingReviews` records, their Discord review cards, and any copied draft contact information. Revoke/remove draft links by removing the review record.
- Contact fields/notes intentionally copied into Google Sheets: identify the correct contact group and edit only that group through the established app/bridge. Never drop the venue row or add/remove spreadsheet columns just to remove one contact.
- Related summaries, notifications, local summary caches, private imports/audit files, and operator working copies. Inspect controlled directories and delivery destinations; do not export extra data or print secrets while searching. Consider the original business inbox/calendar separately if within the verified request.

Record the inventory and completion evidence without retaining the deleted message bodies. Retain only the minimal request-completion or suppression information necessary to honor the request and applicable obligations. Provider-controlled copies/backups are governed by the provider and cannot be guaranteed erased by deleting JDDM’s active record.

## Verify and close

1. Re-read all targeted active stores; confirm the removed content and links are absent and unrelated data remains intact.
2. Run the affected platform’s normal poll. Confirm the restricted sender is skipped, no Discord post is recreated, and other conversations still sync.
3. Confirm a stale Discord reply attempt for a restricted sender cannot send.
4. Restore any temporarily paused platform config. Keep the restriction unless the person later makes a verified request that permits reconnecting/reimporting; do not clear it merely to make a test pass.
5. Reply to the verified requester with completion, exceptions, and scope. Do not claim their Meta/Google/Discord account or all provider backups were deleted.

## Validation status

Automated tests cover initial-import suppression, unchanged-poll suppression, platform isolation, minimal restriction records, and blocked sends for both platforms. These tests do not establish that a complete real customer deletion has occurred. No customer data was purged when creating the policy. A full deletion rehearsal should use isolated test data with copies in each applicable store before representing the entire manual process as rehearsed in an App Review submission.
