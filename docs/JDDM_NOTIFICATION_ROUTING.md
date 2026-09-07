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

`scripts/lib/notificationClient.mjs` and `scripts/discord_notifications.py` provide Discord-only transport for non-critical local senders. Notification receipts checkpoint multi-part posts, suppress repeated content, and retain failed messages for the five-minute queue worker to retry. Mentions are disabled. The legacy scraper text transports were removed. The generic Messages helper now rejects non-approved phone numbers and calls without an approved daily-follow-up or daily-AI-summary marker.

The old Twilio reminder functions are not deployed and no old Twilio scheduler was found in either active Firebase project. The remaining four-slot local reminder LaunchAgent uses Discord transport. No spreadsheet columns or contact records changed.

## Validation

- 122 existing backend tests passed.
- 16 planner/digest/delivery tests passed: Eastern date boundaries, due/overdue filtering, exact two-day horizon, empty lists, email follow-ups, closed places, recipient allowlist, and partial-recipient retries.
- 59 artist tracker tests and 13 scraper tests passed.
- Live digest preview: 5 due places; horizon contains 4 places and 1 email conversation; current live calendar is available.
- All seven destination channels created and confirmed; live planning/open-date/gig/cleanup posts routed successfully.
- The exact test “automated gig followup test message\nHave a good night :)” was sent separately to Dee Dee and Carter in Messages; both showed Delivered. The same test was posted in daily-follow-ups.
- Saved Mac launch jobs loaded successfully, and the cloud daily scheduler remains 8 AM Eastern.

## Quiet default and local AI daily summary

Server default notifications are **Only @mentions**. Members' explicit personal overrides remain theirs to control. Routine automated channels disable mentions; members may opt into more alerts themselves. The scheduled Daily Follow-ups message pings everyone only on its first part. Test previews and subsequent parts stay quiet, and incidental mentions inside source text are neutralized.

**ai-daily-summary** (1546439180245143602), under DEE DEE Notifications, prepares at **6 AM**, refreshes at **7:45 AM**, and delivers at **8:05 AM America/New_York**. The worker checks current records again before delivery, reuses an unchanged draft, and regenerates if the sources changed. It holds early drafts until 8:05; if sources or generation are delayed it waits and retries. The Mac LaunchAgent `com.justdeedeemusic.ai-daily-summary` also checks every five minutes for retry/catch-up after sleep or failure. The existing `com.ollama.native` job provides local Ollama. The worker uses the already installed **qwen3.6:27b** model at **http://127.0.0.1:11434**. Before inference the worker verifies the installed model is a local GGUF, with no remote host/model alias. There is no cloud AI call or fallback. The full recap posts in Discord, and a shorter recap goes separately to Dee Dee and Carter through this Mac’s Messages app. Each destination is checkpointed independently; a failed destination retries without resending successful destinations. The same prepared recap is retained once any destination accepts it.

All summary calculations and generation run locally. The authenticated notification endpoint supplies current email status metadata and the calendar snapshot; the worker also reads the live venue spreadsheet and recent Discord notification posts. It calculates the displayed numbers directly, then asks the local model for a concise email overview and suggested next steps with links to the source records.

The recap opens with today’s recorded gig, Eastern time and location; missing times and locations are disclosed. Calendar holds and items unmatched to spreadsheet bookings are listed separately. If there is no venue gig recorded today, it says so and shows the next recorded date.

The numbers include waiting email conversations, venue rows waiting on reply, this week's follow-up places and email conversations separately, overdue items, recorded future venue gigs, gigs this week, distinct booked locations, total venue locations, and new gig dates since the previous successful recap. Weeks are Monday–Sunday in Eastern time. Repeated venue/date pairs count once. Waiting conversations are not assumed to be confirmed gigs. Gig totals cover dates saved in the existing Future Gigs column, through its latest date; calendar-only/unnamed entries are discussed separately. The first successful recap establishes a baseline for new gig dates. Later additions may include newly synced historical booking records and must not be represented as bookings made that day without evidence.

Source gaps, stale calendar data, and truncated detail are disclosed. Known setup/test notices are excluded. Source references must validate before posting. A local generation failure leaves the daily recap unsent and retries; a once-daily quiet cleanup notice reports the delay. Generated content is saved before delivery; multipart Discord receipts resume without re-alerting on already sent parts. A directory lock prevents overlapping model runs. Private working files and receipts live in the existing local Application Support directory.

Files: `scripts/jddm-ai-daily-summary.mjs`, `scripts/lib/dailySummaryMetrics.mjs`, `scripts/lib/todayGigPlan.mjs`, `scripts/lib/summarySchedule.mjs`, `scripts/install-ai-daily-summary.mjs`, and `functions/discordNotifications.js`. Run `npm run test:ai-summary` for metrics, Eastern schedule, strict local generation, reference validation, test filtering, and single-alert behavior.

Live validation: server default mode 1 (Only @mentions), channel topic/schedule saved, local Ollama generated a reviewed two-part preview with no everyone ping, the LaunchAgent ran successfully and correctly waited before 8:05, and the daily cloud sender/private source endpoint deployed successfully. Tests passed: 124 backend, 16 notification, and 12 AI-summary tests. The cloud AI service remains disabled; no cloud inference was used. The sample snapshot counted 28 future venue/date entries across 19 booked locations, through June 8, 2027; 536 distinct venue identifiers; 2 conversations waiting on Dee Dee and 10 on venues; 6 places and 1 email conversation with follow-up dates this week. These are live snapshot values, not fixed template numbers.

The local model has no per-call AI fee, and no paid AI or SMS service was added. This does not guarantee the entire system is free forever: existing Firebase/Google services, internet/electricity, and carrier plans have their own terms. The Mac must be awake and online for early preparation and local delivery; if asleep, the worker catches up after waking. Server defaults do not override members’ personal notification preferences.

Early-preparation validation: 12 AI-summary tests and 16 notification tests passed, including changes at 8:05, partial delivery retries, local-only model inventory, DST and midnight boundaries. Two local model previews were reviewed and the prompt tightened to avoid unsupported booking/status claims. Live checks verified all 11 routine destinations (including the email forum) were quiet, while Daily Follow-ups and the AI recap each produced an everyone alert only on the first part. Temporary routing test posts were removed. The reviewed AI recap remains in its channel; separate recap test texts to Dee Dee and Carter both showed Delivered. The worker enforces 6:00 preparation, 7:45 refresh and 8:05 delivery. The installed LaunchAgent now uses explicit five-minute calendar ticks; these include each scheduled time.

## September 7 morning delivery incident

The 8 AM follow-up worker ran but both recipient sends failed. At 8:05 the AI worker posted to Discord, but both Messages sends also failed. macOS TCC logs showed the Homebrew Node runtime requesting Automation access to Messages, then timing out waiting for approval. Earlier interactive Messages tests validated the visible app, not that background runtime’s permission.

Both LaunchAgents had StartInterval=300 but did not execute those retries; their interval spawns remained pending while explicit calendar-triggered jobs ran. The installers now use twelve explicit minute entries (0, 5, …, 55) each hour, with Eastern-time gates in the workers. Follow-up failures persist per-recipient diagnostics, including a clear Automation timeout message. Use `scripts/install-daily-follow-ups.mjs` and `scripts/install-ai-daily-summary.mjs` to install the schedules. Approval in System Settings → Privacy & Security → Automation → node → Messages is required for the actual runtime used by launchd. After approval and reloading, verify the background receipts and actual Messages delivery before declaring the service healthy.
