# JDDM Facebook and Instagram inboxes

Facebook Page `104617019336673` (Just Dee Dee Music), connected Instagram professional account `17841459797433647` (`justdeedeemusic`), and Meta app `3287693101437222` (Just Dee Dee Inbox). Discord forums: Messenger `1546611475861475358`, Instagram `1546631721938854050`. Connection errors go quietly to `1546611479472504863`.

## Conversations and replies

Each source conversation has one Discord forum post with chronological incoming/outgoing messages, Eastern timestamps, source links, attachment descriptions, status tags, venue linking, and the official spreadsheet follow-up date. Attachments remain in the original inbox. Long messages are split without discarding text. Source message IDs and per-chunk receipts prevent duplication across imports, polls, webhook wakes, and Discord sends.

**Reply in Discord** opens a form that explicitly says Submit sends as Just Dee Dee Music. Submitting sends to the verified participant of that Facebook/Instagram conversation. Ordinary Discord chat messages stay in Discord. **Open Messenger/Instagram** remains available. Incoming messages make the post blue (Waiting on DEE DEE); confirmed outgoing replies make it yellow (Waiting on venue). Messages are silent. Unchanged polling preserves manual statuses. Linking and follow-up controls use existing spreadsheet venues and cannot create rows.

`messengerReplies.js` verifies Discord signatures, server membership, source-thread/channel identity, the configured Page, the linked Instagram account, and the live recipient before sending. Only the latest incoming customer message opens the standard 24-hour response window; an outgoing reply does not extend it. Requests and content have transactional duplicate guards. Sends are never automatically retried after an uncertain result. Meta-confirmed message IDs are stored before the Discord copy is attempted; a failed Discord copy is reported as pending, not as a failed send. Error responses preserve the user's reply text.

The initial Facebook import contained 249 available messages in 34 nonempty conversations. Historical posts start as Imported history rather than new work. Empty metadata does not create invented messages. Instagram initially returned no history; its first verified available conversation is Carter's September 7 test. This does not establish that Meta exposes all older customer conversations.

## Retrieval and credentials

Both scheduled polls run every five minutes with independent config, conversation, receipt, and lock namespaces (`jddmMessenger` and `jddmInstagram`). Instagram reads the Facebook Login endpoint `/{PAGE_ID}/conversations?platform=instagram`, using the Page credential, not the separate Instagram Login API. Long Instagram conversation IDs map to stable 32-character Discord control IDs. Sending uses `/{PAGE_ID}/messages` for this integration, with `messaging_type: RESPONSE` for Facebook.

`jddmMessengerWebhook` verifies Meta's HMAC signature and accepts only the exact JDDM Page or Instagram object/account pair. It writes a platform-specific wakeup marker; the corresponding Firestore trigger re-reads authoritative messages through Meta. Five-minute polling remains the fallback for missed callbacks or overlapping syncs. No webhook body is trusted as a message source.

The Page credential was verified September 7, 2026 and stored in Secret Manager as `JDDM_MESSENGER_PAGE_TOKEN`; it includes Instagram message access. Meta reports no fixed token expiration, but data-access expiration, revocation, permissions, and platform policy can still interrupt access. Never copy credentials to source control, logs, or Discord.

Carter already had Full access to the business portfolio but only Messages access to its Page asset. Assigning Full access to the JDDM Page resolved the failed Page webhook subscription. Meta now confirms the Page subscription for `messages,message_echoes`, and the app's Instagram `messages` subscription is active. Facebook's real callback was received and its incoming test copied to Discord.

## Meta release restriction

The September 7 Developer Portal still marks this app **Unpublished**, with permissions **Ready for testing**. Instagram settings explicitly limit development sends to app administrators, developers, or testers whose Facebook account is linked to Instagram. The Publish page identifies the missing public privacy-policy URL; the basic settings also contain placeholder Facebook URLs for terms/data deletion. App Review is required before interacting with everyone on Instagram. Do not describe successful administrator tests as approval for unrestricted customer messaging or bulk outreach. No invented policy URL or review attestation has been submitted.

## Live verification — September 7, 2026

Tests used Carter's own Facebook and Instagram accounts; no venue received a test message and no spreadsheet row/date was changed.

- **Facebook:** Carter's incoming message appeared in Discord post `1546636594432315423` (`t_1791868155309568`). Clicking Reply in Discord and submitting the form sent the exact test text to Carter's visible Facebook chat at 7:45 PM Eastern. The outgoing copy remained in the same post with yellow status. A later Facebook reply produced a real Meta callback and blue status in Discord.
- **Instagram:** Carter (`outswarming`) sent a DM to `justdeedeemusic` at 7:50 PM Eastern. The deployed poll, triggered through Cloud Scheduler, imported it silently into post `1546669271948730379` (control ID `4f4e2fa3435ff8f380e17c1235a55cae`) with blue status. Clicking Reply in Discord and submitting sent as Just Dee Dee Music at 7:52 PM. The exact reply visibly arrived in Carter's Instagram chat and was copied into the same Discord post with yellow status. A second incoming Instagram test at 7:55 PM produced a real signed Instagram callback and changed the same post back to blue before the next scheduled poll; the reply still appeared exactly once.

Both controlled conversations are marked `testConversation: true` to exclude venue auto-linking/worklists. Automated validation: `cd functions && npm test` — 276 passing tests. Coverage includes both platforms, long threads, replay recovery, stale official dates, signature/account/recipient isolation, reply windows, duplicate and uncertain sends, and silent incoming/outgoing copies. Private audit logs remain under `work/messenger/` and are not committed.
