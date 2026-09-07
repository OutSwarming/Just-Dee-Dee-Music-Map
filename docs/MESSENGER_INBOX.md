# JDDM Messenger inbox

Facebook Page `104617019336673` (Just Dee Dee Music) only. Meta app `3287693101437222` (Just Dee Dee Inbox). Discord forum `1546611475861475358`; quiet connection-problems channel `1546611479472504863`.

## Available

The official Conversations API supplied 35 conversations, of which 34 contain 249 available messages. Imported posts retain chronological incoming/outgoing messages, Eastern timestamps, source links, and attachment descriptions. Source attachments remain in Messenger. Empty conversation metadata is not rendered as an invented message. Historical posts start with Imported history; historical last messages do not imply new work today.

Firestore `jddmMessengerConversations` identifies each API conversation; `jddmMessengerMessages` records source IDs and per-chunk delivery progress. Imports and polls share receipts. `jddmm` controls support venue search/dropdown, status, labels, and the official spreadsheet follow-up date. This integration cannot create spreadsheet rows. The reply link opens Meta Business Suite; ordinary Discord messages do not send to Facebook.

`jddmMessengerPoll` checks every five minutes when `jddmMessengerConfig/main.enabled` is true. It verifies the Page token identity, reads conversations through the official API, processes changed conversations, refreshes linked official dates, and posts connection failures quietly once per distinct error. New inbound messages set blue; outgoing Page messages set yellow. Old manual statuses survive unchanged polling. Only the JDDM Page is authorized; no personal Messenger or Instagram import is enabled.

## Pending connection verification

The import credential expires September 7, 2026 at 6 PM Eastern. Keep polling disabled until the long-lived token exchange is completed and the replacement Page credential is stored as `JDDM_MESSENGER_PAGE_TOKEN` in Secret Manager and deployed. Meta currently requires Carter's password reauthentication to reveal the app secret. Never put passwords or tokens in repository files, logs, or Discord.

After the user completes Meta's password dialog: exchange the user token using the app secret, obtain the Page access token using the explicit Page ID (the user `me/accounts` list returned empty despite valid access), inspect its expiry using `debug_token`, save it in Secret Manager, redeploy the poll, and verify a new inbound/outbound conversation update. Do not infer that all public-customer messaging is approved merely because history reads succeeded: Meta still displays the App Review requirement for messaging live users.

`messengerWebhook.js` contains a tested signature-verification handler for subsequent webhook configuration; it is not yet exported/deployed or subscribed in Meta. It acknowledges only signed Page payloads and stores a wakeup marker, leaving authoritative message retrieval to the API poll. Persistent sync and webhook delivery must not be described as live until configured and verified.

## Validation

`node --test functions/tests/messenger-inbox.test.js functions/tests/discord-conversations.test.js functions/tests/google-voice.test.js`

Tests cover long messages, deterministic chunk receipts, retry recovery, Page isolation, incoming/outgoing state transitions, official-date stale context rejection, and webhook signature isolation. Live Discord venue dropdown/search and Facebook source-conversation navigation were also exercised. Private import/audit files are under `work/messenger/` and must not be committed.
