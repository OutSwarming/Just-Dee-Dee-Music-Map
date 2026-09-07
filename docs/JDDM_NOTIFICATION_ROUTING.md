# JDDM notification routing

Effective September 7, 2026.

## Daily follow-ups

At 8 AM America/New_York, the cloud `jddmDailyFollowUps` job posts in Customer Communication → daily-follow-ups (1546328487537672343). The Mac Messages worker sends the same frozen morning list to Carter (+14403054062) and Dee Dee (+12168499292), and nobody else.

The message begins “Hi Dee Dee, here are the places you need to contact today:” and includes every due/overdue active venue by name. Due email conversations are included separately. “On the horizon — the next 2 days” appears only if tomorrow or the following day contains venue or email follow-ups. Completed/closed venue statuses and dates beyond that horizon are excluded. Unclear dates are excluded rather than guessed.

`functions/followUpDigest.js` supplies both destinations. The authenticated `jddmNotificationDigest` endpoint and scheduled Discord sender share `jddmFollowUpDigests/YYYY-MM-DD` so the lists match. Pre-8 AM previews do not freeze the morning data. The local worker has an explicit 8 AM launch plus five-minute retries, waits until 8 AM Eastern, and checkpoints delivery independently for each recipient. If the Mac is asleep/offline, Messages delivery catches up after it wakes/connects. Discord's scheduled post runs independently in the cloud.

Private connection settings live in `~/Library/Application Support/Just Dee Dee Music Map/notification-routing.json` (mode 0600); the digest key is a Firebase secret. No connection credentials are committed.

## Discord-only notifications

DEE DEE Notifications category: 1546432441646845982.

| Channel | Source / schedule |
| --- | --- |
| booking-plan | Existing 9 AM planning reminder |
| open-weekend-dates | Existing noon availability reminder; also includes weekday options |
| upcoming-gigs | Replaces the old 4 PM follow-up text |
| daily-cleanup | Existing 7 PM cleanup reminder and data freshness notices |
| other-artists | Official musician website change alerts, including tracked artists such as Furious George |
| facebook-gig-leads | Existing Facebook event discovery alerts |
| local-gig-leads | Existing local live-music scan alerts |

Monitoring → new-places, follow-up-added, and calendar-changes remain in their existing channels. These do not send texts. Manual reminder queue requests now route to Discord too. A manual Follow Ups request goes to daily-follow-ups; the scheduled afternoon slot goes to upcoming-gigs.

`scripts/lib/notificationClient.mjs` and `scripts/discord_notifications.py` provide Discord-only transport for non-critical local senders. Notification receipts checkpoint multi-part posts, suppress repeated content, and retain failed messages for the five-minute queue worker to retry. Mentions are disabled. The legacy scraper text transports were removed. The generic Messages helper now rejects non-approved phone numbers and calls without the daily-follow-up marker.

The old Twilio reminder functions are not deployed and no old Twilio scheduler was found in either active Firebase project. The remaining four-slot local reminder LaunchAgent uses Discord transport. No spreadsheet columns or contact records changed.

## Validation

- 122 existing backend tests passed.
- 16 planner/digest/delivery tests passed: Eastern date boundaries, due/overdue filtering, exact two-day horizon, empty lists, email follow-ups, closed places, recipient allowlist, and partial-recipient retries.
- 59 artist tracker tests and 13 scraper tests passed.
- Live digest preview: 5 due places; horizon contains 4 places and 1 email conversation; current live calendar is available.
- All seven destination channels created and confirmed; live planning/open-date/gig/cleanup posts routed successfully.
- The exact test “automated gig followup test message\nHave a good night :)” was sent separately to Dee Dee and Carter in Messages; both showed Delivered. The same test was posted in daily-follow-ups.
- Saved Mac launch jobs loaded successfully, and the cloud daily scheduler remains 8 AM Eastern.
