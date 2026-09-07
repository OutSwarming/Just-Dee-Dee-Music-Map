# Google Voice intake

Customer Communication has three separate forums:

- `google-voice-texts`: incoming text notifications, one conversation per US phone number.
- `google-voice-calls`: missed-call notices, one conversation per known phone number.
- `google-voice-voicemails`: available voicemail transcripts, one conversation per known phone number.

Unknown callers are kept separate rather than assumed to be the same person. All records come from Google Voice notification emails delivered to justdeedeemusic@gmail.com. This is not a full Google Voice call-history API or a two-way SMS bridge. Outgoing texts, answered calls, and items that were never forwarded to Gmail are not covered. Source links open the notification; voicemail audio stays in Google Voice. No calling or SMS sending is exposed in Discord, and status/tag changes do not alter Gmail or Google Voice.

## Behavior

`jddmGoogleVoicePoll` runs every five minutes in America/New_York. Initial import covers available notifications from the past 30 days; subsequent scans overlap by five minutes. A checkpoint retains pending IDs and pagination across invocations. Message receipts and per-part progress prevent ordinary repeat imports and partial retry duplicates. Discord nonce enforcement helps recover a recent uncertain send. Per-conversation locks serialize import, labels, status, and venue linking. A long outage between a successful Discord send and receipt persistence can outlast Discord's nonce window and needs manual duplicate review.

The existing email poll excludes recognized Voice notifications so new arrivals are not posted to both inboxes. Historical email copies are retained. Only `@txt.voice.google.com` text notifications or `voice-noreply@google.com` missed-call/voicemail subjects qualify; body phone numbers never establish sender identity. Text sender phone and subject are checked for agreement.

The six status colors and Gig prep/Song requests/topic labels match the email workflow. A new incoming record returns its conversation to Waiting on DEE DEE; replaying an already imported record preserves manual status. Google Sheets remains authoritative for follow-up dates. Unique saved phone matches link automatically; ambiguous numbers remain unlinked. Link venue and Search venues reuse the existing spelling-tolerant chooser. New venues can only be created in the map app or through the separate explicit calendar-review confirmation.

All new Voice posts suppress push notifications and mentions. Channels inherit Customer Communication's access. The bot has Manage Channels, Manage Threads and Posts, and Read Message History, in addition to its existing message permissions; Administrator was not granted.

## Storage and deployment

Project: `just-dee-dee-music-map`.

- `jddmVoiceConfig/main`: enabled flag and per-kind forum/tag IDs.
- `jddmVoiceConfig/checkpoint`: scan cursor and pending Gmail message IDs.
- `jddmVoiceConversations`: phone/kind metadata, Discord thread, labels, venue link.
- `jddmVoiceMessages`: delivery receipts keyed by Gmail message ID.
- `jddmVoiceLocks`: expiring poll and per-conversation locks.
- `discordEmailInteractions`: routes signed `jddmv:` controls to Voice's read-only-source service, preserving `jddm2:` email controls.

The existing Gmail OAuth and Discord bot secrets are reused. No spreadsheet columns, app subscriptions, or external SMS providers are added. Existing Firebase service usage still applies.

Validation: `npm --prefix functions test`. Private rollout snapshots and live checks are under `work/google-voice/` and are not committed.

## Live rollout — September 7, 2026

Forum IDs: texts `1546578540550557856`, calls `1546578541208928369`, voicemails `1546578543717253191`, all under Customer Communication.

Imported 46 recent text notifications into 10 phone conversations, the two most recent available older missed-call notices into two conversations, and the available voicemail transcript into one conversation: 49 source notifications and 49 Discord record messages total. Verified all receipt message IDs exist, records are in the correct forum, messages suppress notifications and mentions, and an overlapping poll posts no duplicates. Sample Gmail labels stayed unchanged.

The actual native Discord app was used to apply Song requests to the conversation containing song titles; the signed interaction completed and the saved labels were verified. No Gmail or Voice send was performed. The enabled five-minute Eastern schedule was invoked, and Cloud Functions logged a successful run with no pending items or duplicate posts at 17:57:32 UTC.

The live backfill exposed a Discord rename rate limit. Card refresh now changes thread names/tags only when needed and avoids identical starter-card edits. Tests cover this case; all 178 backend tests passed. Functions deployed: `discordEmailInteractions`, `jddmConversationPoll`, `jddmGoogleVoicePoll`.
