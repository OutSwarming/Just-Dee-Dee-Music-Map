# JDDM conversation workflow

Updated September 7, 2026. This replaces the per-message email workflow in the earlier verification report.

## Discord layout

| Category | Channel | Purpose |
| --- | --- | --- |
| Customer Communication | email-inbox | One forum post per Gmail conversation, containing the chronological messages and replies |
| Customer Communication | daily-follow-ups | Daily 8 AM America/New_York reminder for due and overdue email conversations and map places |
| Monitoring | follow-up-added | Immediate confirmation when a follow-up date is added or changed in the map/app or an email conversation |
| Monitoring | new-places | Confirmation when a place is added through the map/app |

## Working an email conversation

Use the controls on the first message in the post. **Reply by email** sends from `justdeedeemusic@gmail.com` into the original Gmail thread. Ordinary Discord comments stay in Discord.

| Status | Color | Meaning |
| --- | --- | --- |
| Waiting on venue | Yellow | Dee Dee has sent a reply and is waiting |
| Waiting on DEE DEE | Blue | A new incoming message needs attention |
| Resolved | Green | Finished; archives the Gmail conversation |
| Rejected | Red | Declined |
| Spam | Purple | Marks the Gmail conversation as spam |
| Follow up | Orange | Requires a date in YYYY-MM-DD format |

Use **Change conversation status** to update the conversation, or **Set follow-up date** to choose today or a future date. Changing the date produces a confirmation with the conversation name, prior date when applicable, new date, and a link. Saving the same date again produces no extra confirmation. Setting a different status clears its pending reminder.

New received mail changes the conversation to Waiting on DEE DEE; a sent reply changes it to Waiting on venue. New mail clears the prior scheduled follow-up so a stale reminder does not survive a response. A new reminder can then be scheduled. Native forum tags display the status; use the bot controls to keep the date and reminder state synchronized.

Long email bodies are split into ordered Discord messages within the same post. Recognizable repeated reply quotations are trimmed; the original Gmail link preserves access to the full email and attachments. Separate Gmail thread IDs remain separate posts, even if they have similar subjects or the same venue.

## Gig prep and Song requests

The conversation label menu allows **Gig prep** (teal card, 🩵 tag) and **Song requests** (pink card, 🩷 tag), separately or together. These labels persist while the reply status changes. They do not change Gmail labels, archive mail, or remove a follow-up date.

Mail sent directly in the JDDM Gmail website is imported as **Sent by Dee Dee** and turns its Discord conversation yellow. Replies received from the correspondent turn it blue. Replying again through either Gmail or Discord turns it yellow. The poller watches both new-message events and SENT-label events so sending an existing Gmail draft is detected.

## Imported conversation cleanup — September 7

- Standardized names as correspondent plus subject, removed repeated Re/Fwd prefixes, and shortened long contact names so the subject remains visible.
- Added readable latest-message previews; removed technical Gmail IDs from the starter card and email messages. Multi-part emails retain simple Part N of M labels.
- Tidied 50 existing email conversations and 242 message footers. Three historical imports now representing only drafts/deleted mail were archived and excluded from processed-message history so a later send can still import correctly.
- Simplified 54 archived duplicate posts to a link to the complete conversation, removing their redundant email previews and obsolete controls. Original Discord content was backed up locally before this cleanup.
- Resolved, Rejected, and Spam posts are archived after their summary is updated. A later incoming message can reopen the same post.
- Separate Gmail conversations remain separate, even when they involve the same person; this preserves the correct reply destination and email thread.

## Operation

- The Firebase conversation poll runs every five minutes. Unsent drafts and trashed messages are excluded. It uses Gmail history to retrieve changed conversations, with a durable queue for bursts and per-message chunk checkpoints. Up to 25 changed conversations and 100 Discord message chunks are handled per run.
- The old Apps Script email timer is removed (zero triggers verified). Its code remains as a reference and should not be restarted alongside the new poller.
- The daily reminder runs in Firebase at `0 8 * * *`, America/New_York, including daylight-saving time. It includes overdue items, excludes closed map places, and keeps a per-day send record plus chunk checkpoints.
- The local 6 AM reminder launch agent uses `--no-discord`; its existing text-message behavior is preserved. Discord daily reminders now come from the cloud schedule.
- Date notifications for map places depend on saves through the JDDM map/app. Direct spreadsheet edits bypass those hooks.
- The Discord interaction function keeps one warm instance to answer button clicks promptly. Requests are signature checked and acknowledged before Gmail work.
- State is in Firestore: `jddmEmailConversations`, `jddmEmailConfig`, `jddmEmailActions`, `jddmEmailDaily`, and `jddmEmailSyncLocks`. Credentials remain in Secret Manager.
- If an interrupted email send reports an error, check Gmail/the conversation before trying the send again. Ambiguous send failures are not automatically retried.

## Migration and verification

The migration consolidated 107 email posts into 53 canonical Gmail conversations. The 54 redundant posts were archived with links to their shared conversation; historical content was preserved.

Live verification used labeled self-emails and temporary map records. No test replies were sent to a customer.

- An 8,889-character self-email appeared in six ordered parts in its existing Discord post, with its ending preserved.
- Blue, red, purple, green, and yellow status actions updated the same post with the correct forum tag and colored summary.
- The live Discord date form saved September 8 and changed it to September 7. Both confirmations appeared in `follow-up-added`, with the correct previous/new dates.
- A labeled test digest appeared in `daily-follow-ups` with one due email conversation and five due map places. It did not consume the normal September 7 send record, so the scheduled 8 AM digest remains due.
- The updated Reply by email button delivered from the JDDM Gmail address into the same Gmail and Discord conversation.
- A separate self-email was ingested by the deployed cloud poller into that same Discord post; the production health record reported one conversation, one message, and no queued work.
- The completed test conversation was set to Resolved and its follow-up date cleared.
- The existing map create/date-change/unchanged-save checks passed against its production spreadsheet endpoint; the temporary record was removed.
- Automated tests cover long-message resumption, single-topic delivery, status effects, date validation and deduplication, combined email/map reminders, partial digest retry, incremental Gmail polling, and immediate interaction acknowledgement.

Final automated run: **115 tests passed, 0 failed**.

Additional live round-trip verification used `JDDM Gmail round-trip test — September 7`, exchanged only between JDDM and Carter's own mailbox. The same Discord post (`1546377404438548531`) received the original email sent in Gmail, incoming replies, a direct Gmail reply, and a reply sent from Discord. Gmail send → yellow, incoming reply → blue, and direct Gmail reply → yellow were confirmed against both Gmail headers and the saved Discord state. Gig prep and Song requests remained attached through the exchange.
