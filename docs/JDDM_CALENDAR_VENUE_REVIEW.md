# Calendar venue review

The calendar and website importers must never append a venue automatically. They resolve to one stable, unique spreadsheet Place ID, or leave the event pending for a decision. No spreadsheet columns are added. Follow-up dates and contacts are not part of a calendar decision.

## Runtime

- `barkrangermap-auth`: `jddmSpreadsheetBridge` and `jddmCalendarVenueReview`, using the canonical sheet gateway and Firestore in that project.
- `just-dee-dee-music-map`: the existing signed Discord interaction endpoint forwards `jddmcal:` controls after acknowledging them. It preserves the original Discord signature; the receiving endpoint independently validates it. The existing calendar monitor submits signed future-event lists for review.
- Apps Script: the exact live calendar project's `Code.gs` must use reviewed mappings and reject automatic appends. Add `CalendarReview.gs` beside it. Do not replace live `Code.gs` wholesale with the repository version. Patch the matching/sync functions in the downloaded live source, preserving unrelated modules and its active deployment configuration.
- The review function scales to zero. The existing warm email interaction endpoint acknowledges before forwarding so a cold review instance does not miss Discord's response deadline.

## Configuration

Firestore document `jddmCalendarReview/config` in barkrangermap-auth contains `channelId` for the text channel `calendar-review` under Monitoring. The bot needs View Channel, Send Messages and Read Message History there; Manage Channels is needed only to provision it. Posts suppress mentions and push notifications.

The review function uses the existing Discord bot token/public key and calendar-monitor HMAC key, provisioned as secrets in barkrangermap-auth. Do not put credentials in source code or spreadsheet cells.

## Decisions and safeguards

`jddmCalendarReviews` stores reviews keyed by normalized venue name and location, independent of date. Recurrences share one review. Calendar and website source snapshots are tracked separately; cancellation disables New row when neither source has an upcoming date.

- **New row** opens a confirmation and rechecks the live sheet. A deterministic Place ID and request ID support safe recovery after an interrupted append. Existing name candidates require Link instead.
- **Link** opens an immediate dropdown, with suggested matches first and Search venues below. The same spelling-tolerant search used by email linking searches the full venue list. A selection is bound to its user, offered IDs, review revision, and ten-minute expiry. Duplicate Place IDs cannot be selected.
- **Ignore** requires confirmation, remembers the decision for that name/location and never deletes Gmail or calendar events.

Review locks prevent concurrent decisions. A missing/deleted linked venue reopens review. Pending reviews are durable even before the Discord channel is configured. A review-service outage never enables automatic row creation. Discord message publication retries from the stored decision; row creation is not repeated to repair a failed card update.

`jddmCalendarReview/websiteOwnership` tracks the website's gig dates by Place ID, so later website updates remove only dates from its prior snapshot. Unknown historical ownership is preserved conservatively. Existing duplicate rows are not deleted by this workflow.

## Validation

Run `npm --prefix functions test`, `node --test tests/appsScriptBridgeColumns.test.js`, and `node --test tests/calendarMonitor.test.cjs`.

For rollout, provision the Discord channel, deploy the two functions in barkrangermap-auth, then the interaction and monitor functions in just-dee-dee-music-map. Update the exact live Apps Script source and its legacy versioned sync deployment/trigger separately. Confirm the live calendar source no longer contains an automatic append path. Re-run a real signed snapshot twice, verify one review per venue/location, and compare all spreadsheet contact/follow-up cells and row count before/after. Exercise the dropdown without selecting a real venue unless the decision is intended.
