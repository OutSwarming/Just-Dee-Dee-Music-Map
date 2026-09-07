# JDDM Discord verification — September 6–7, 2026

Verified against the production map's spreadsheet endpoint and the JDDM Discord server.

| Workflow | Live result |
| --- | --- |
| Add a place through the map's spreadsheet API | One alert in `#new-places`, with correct name, city, state, and status |
| Set a follow-up date | Alert in `#follow-up` with the place name and September 20 date |
| Change that date | Second alert with September 22 |
| Save the same date again | No changed columns and no additional alert |
| Gmail intake | Three labeled self-test emails appeared in `#email-inbox` |
| Reply in Discord | Reply delivered in the original Gmail thread, From `JustDeeDeeMusic <justdeedeemusic@gmail.com>` |
| Archive button | Original test message lost its Gmail INBOX label |
| Spam button | Test message gained SPAM and lost INBOX/UNREAD |
| Done button | Test message received the JDDM Done label and lost INBOX/UNREAD |
| Edit Discord tags | Added Done to the test forum post and verified the saved tag |
| Automatic polling | One five-minute trigger owned by the JDDM mailbox; time-driven execution completed at 11:43:55 PM Eastern |

The temporary place `jddm-e2e-1788752256461` was removed with guarded cleanup. No customer emails were sent or acted on during button tests. Labeled test posts remain as evidence.

## Production changes

- Deployed the spreadsheet notifier in `barkrangermap-auth`, where the live map's spreadsheet service actually runs. Configured its two existing JDDM webhook destinations there.
- Deployed the restricted email intake adapter and repaired Reply modal in `just-dee-dee-music-map`.
- Updated the live Apps Script to use the adapter, check individual message age, send up to 20 messages per poll, prioritize new arrivals, and defer rate-limited work.
- Confirmed the OAuth application is In production.

## Operational limits

- Changes must go through the JDDM map/app. Direct Google Sheets edits bypass these notification hooks.
- Intake checks the newest 50 conversations from the configured 30-day window every five minutes. A large backlog drains over multiple polls.
- Forum tags are shared Discord organization; changing one does not rename Gmail labels.
- Buttons act on the represented Gmail message. Normal Discord chat replies do not send email; use the bot's Reply button.
- A Gmail action can complete while a slow Discord acknowledgement times out. Check the conversation before retrying a send after an error.
- The first setup run posted some older messages before the per-message date check was repaired. Existing posts were preserved.

Automated verification: 15 intake bridge tests, 19 interaction tests, 4 transport tests, 14 spreadsheet bridge tests, and 15 spreadsheet-service/venue-editor tests passed.
