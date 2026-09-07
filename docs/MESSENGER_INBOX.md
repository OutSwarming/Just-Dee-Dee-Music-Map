# JDDM Messenger inbox

Facebook Page `104617019336673` (Just Dee Dee Music) only. Meta app `3287693101437222` (Just Dee Dee Inbox). Discord forum `1546611475861475358`; quiet connection-problems channel `1546611479472504863`.

## Available

The official Conversations API supplied 35 conversations, of which 34 contain 249 available messages. Imported posts retain chronological incoming/outgoing messages, Eastern timestamps, source links, and attachment descriptions. Source attachments remain in Messenger. Empty conversation metadata is not rendered as an invented message. Historical posts start with Imported history; historical last messages do not imply new work today.

Firestore `jddmMessengerConversations` identifies each API conversation; `jddmMessengerMessages` records source IDs and per-chunk delivery progress. Imports and polls share receipts. `jddmm` controls support venue search/dropdown, status, labels, and the official spreadsheet follow-up date. This integration cannot create spreadsheet rows. The reply link opens Meta Business Suite; ordinary Discord messages do not send to Facebook.

`jddmMessengerPoll` checks every five minutes when `jddmMessengerConfig/main.enabled` is true. It verifies the Page token identity, reads conversations through the official API, processes changed conversations, refreshes linked official dates, and posts connection failures quietly once per distinct error. New inbound messages set blue; outgoing Page messages set yellow. Old manual statuses survive unchanged polling. Only the JDDM Page and linked Instagram account are authorized. Personal Messenger is not connected.

## Persistent connection and remaining Meta restrictions

The long-lived Page credential was exchanged and verified on September 7, 2026, stored in Secret Manager as `JDDM_MESSENGER_PAGE_TOKEN`, and deployed. Graph `debug_token` reports a valid PAGE token with no fixed token expiration (`expires_at: 0`), plus a separate data-access expiration. This is not an unconditional permanent credential: revocation, access changes, and Meta policy still apply. Never put credentials in repository files, logs, or Discord.

`jddmMessengerPoll` is enabled and has completed real API reads with the replacement token. `jddmMessengerWebhook` and its Firestore wakeup trigger are deployed. Meta verified the callback and registered the app subscription for `messages,message_echoes`; unsigned deployed requests return 401 and a signed wakeup returns 200 and invokes an authoritative sync. Overlapping syncs coalesce using the existing lock instead of posting a false connection error.

**The Page-level webhook subscription is still blocked.** Meta returns error 200, insufficient administrative permission. Business Suite confirms Carter Swarm has Partial access / Basic; Dee Dee Swarm and James Swarm have Full access. A Page administrator must complete that subscription or provide the required Page administrative access. Do not describe instant webhook delivery as working. Five-minute polling remains enabled independently. Meta also still shows App Review requirements for messaging people outside app/business roles; successful history reads do not establish unrestricted customer message delivery.

## Separate Instagram inbox

Discord forum `1546631721938854050` is **insta-inbox**, under Customer Communication. It is separate from Messenger and uses silent messages, the same six status tags, Gig prep, Song requests, venue search, and official spreadsheet dates. The connected Instagram professional account is **justdeedeemusic**, ID `17841459797433647`. The Page credential includes `instagram_basic` and `instagram_manage_messages`.

`jddmInstagramPoll` checks every five minutes. It verifies both the Page identity and the linked Instagram account before reading `/{PAGE_ID}/conversations?platform=instagram`. Firestore config, conversations, receipts, and locks use the `jddmInstagram` namespace. Long Instagram conversation IDs map to stable 32-character control IDs, keeping Discord controls within its limits. Incoming messages become blue; replies sent from the linked Instagram account become yellow in the same post. Reply opens Meta's Instagram inbox; ordinary Discord messages are not sent to Instagram.

The actual Instagram API returned zero conversations, and Meta Business Suite independently displayed “No messages to show.” No history was available to import. A real newly received Instagram DM still needs end-to-end verification; automated fixtures establish grouping, platform separation, controls, silence, and direction, not delivery of a real customer message. Instagram has no subscribed webhook; the scheduled poll is the active retrieval method.

## Validation

`node --test functions/tests/messenger-inbox.test.js functions/tests/discord-conversations.test.js functions/tests/google-voice.test.js`

Tests cover long messages, deterministic chunk receipts, retry recovery, Page isolation, incoming/outgoing state transitions, official-date stale context rejection, and webhook signature isolation. Live Discord venue dropdown/search and Facebook source-conversation navigation were also exercised. Instagram controls were tested in the native Discord app using an explicitly labeled temporary post: Link venue opened the dropdown, searching Filia returned 12 choices, and selecting Filia Cellars updated the test card from the official venue directory. The test post and source records were then deleted; no spreadsheet date was changed. Private import/audit files are under `work/messenger/` and must not be committed.
