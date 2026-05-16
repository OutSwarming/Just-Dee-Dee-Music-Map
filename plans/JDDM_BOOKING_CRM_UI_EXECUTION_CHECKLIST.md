# Just Dee Dee Music Booking CRM UI Execution Checklist

Created: May 6, 2026

Use this as the fast check-off document while Codex/AI implements the booking CRM UI. The longer system spec lives in `plans/JDDM_APP_SYSTEM_UI_UPDATE_PLAN.md`; this file is the sprint board.

## Operating Rule

The app should always answer one question:

```text
What should Dee Dee do next?
```

## How AI Should Use This File

- [ ] Before each implementation pass, read the next unchecked section.
- [ ] Mark items complete only when code, UI, sync behavior, and validation are actually done.
- [ ] Add a completion-log row after each pass.
- [ ] Record tests run, manual checks, and any skipped validation.
- [ ] Do not mark email as sent when a draft is generated.
- [ ] Do not add money tracking in this version.
- [ ] Do not build AI personalization until the template-based system is stable.
- [ ] Do not write to the real master spreadsheet until sandbox writes are verified.

## Completion Log

| Date | Pass | What Changed | Files Changed | Validation | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-05-06 | Plan setup | Created fast AI execution checklist | `plans/JDDM_BOOKING_CRM_UI_EXECUTION_CHECKLIST.md` | Markdown sanity only; doc-only change | Built from the full CRM + gig pipeline + email drafting + map UI plan. |
| 2026-05-06 | Spreadsheet bridge setup | Pointed docs/config to the new spreadsheet and disabled old committed bridge URL until a new `/exec` URL is deployed | `config/firebaseConfig.example.js`, `docs/JDDM_SPREADSHEET_BRIDGE_SETUP.md` | Pending Apps Script deploy; run bridge health after new deployment URL exists | New spreadsheet: `1qWwyf4M61o0yt3fWBS0fgtXl0_N7yNnlZADKHuzTydo`. Use the bound Apps Script from the Sheet, not an old script URL. |
| 2026-05-06 | Revert to old bridge | Rewired app config back to the original working Apps Script bridge after the copied Sheet's script project failed to open | `config/firebaseConfig.example.js`, `docs/JDDM_SPREADSHEET_BRIDGE_SETUP.md` | Pending local app smoke against old bridge | Use the old working spreadsheet/bridge as the active source while adding the CRM changes. |
| 2026-05-06 | Calendar gig sync | Added Dee Dee Google Calendar ICS staging and Apps Script calendar sync for durable gig history and future bookings | `google-apps-script/jddm-spreadsheet-bridge/Code.gs`, `scripts/lib/jddmCalendarIcsParser.mjs`, `scripts/stage-jddm-calendar-gigs.mjs`, `data/staged/jddm-calendar-gigs.json`, `data/staged/jddm-calendar-gigs.csv`, tests/docs | `npm run bookings:calendar:stage -- --write`, `npm run test:booking`, `npm run test:smoke:jddm`, `git diff --check` | Parsed 191 gig-related events: 132 past, 57 future, 2 proposed. Deploy updated Apps Script before live Sheet sync. |

## Already Coded, Verify Before Rebuilding

These items appear to exist from the current roadmap/codebase. Verify them before rewriting anything.

- [ ] App shell is already rebranded for Just Dee Dee Music.
- [ ] Map reads normalized venue data.
- [ ] Spreadsheet bridge path exists through Apps Script.
- [ ] Venue editor can write booking fields through the spreadsheet bridge.
- [ ] Booking Planner exists in the bottom navigation.
- [ ] Dashboard groups already exist for core booking views.
- [ ] Email templates already exist.
- [ ] Copy buttons already exist.
- [ ] Mailto draft buttons already exist.
- [ ] Status actions already exist for draft ready, sent, interested, booked, not a fit, and do not contact.
- [ ] Manual follow-up date control already exists.
- [ ] Priority and best-fit scoring controls already exist.
- [ ] Website future/past booking preview tabs already exist.
- [ ] Booking tests already exist.
- [ ] JDDM smoke gate already exists.

Verification commands:

```bash
npm run test:booking
npm run test:smoke:jddm
git diff --check
```

## P0 Safety Gate

Do this before any real sheet write testing.

- [ ] Duplicate the master Just Dee Dee Music spreadsheet into a sandbox copy.
- [ ] Name sandbox clearly with date.
- [ ] Deploy Apps Script bridge against the sandbox copy.
- [ ] Point local/dev config at sandbox bridge URL only.
- [ ] Verify sandbox CSV/read endpoint.
- [ ] Verify one harmless sandbox write against a disposable venue row.
- [ ] Confirm the real master spreadsheet did not change.
- [ ] Record sandbox validation in the completion log.
- [ ] Keep master spreadsheet read-only until Carter approves real-sheet testing.

Hard blockers:

- [ ] No hidden automation changes business state without a visible user action.
- [ ] Generating a draft does not update sent/contacted fields.
- [ ] Booking a gig creates a gig record.
- [ ] A venue can have many gigs.
- [ ] `REPLIED_WANTS_DATES` always outranks distance.
- [ ] `doNotContact` removes venue from outreach work queues.

## Phase 1: UI Audit And Alignment

Goal: confirm what is already coded and map existing UI to the new pipeline language.

- [ ] Audit `modules/bookingSchema.js` for current statuses and fields.
- [ ] Audit `modules/bookingDashboard.js` for current dashboard sections.
- [ ] Audit `modules/bookingActions.js` for current status transitions.
- [ ] Audit `modules/bookingEmailTemplates.js` for current draft types.
- [ ] Audit `modules/dataService.js` for normalized venue fields.
- [ ] Audit `modules/venueEditModal.js` for editable CRM fields.
- [ ] Audit `renderers/panelRenderer.js` for map popup/detail actions.
- [ ] Mark existing checklist items as complete after verification.
- [ ] Create a gap list before writing UI code.

Acceptance:

- [ ] Clear list of existing features vs missing features.
- [ ] No duplicated UI built over working code.
- [ ] Existing behavior remains intact after audit-only pass.

## Phase 2: Dashboard Command Center

Goal: make the first screen tell Dee Dee what to do today.

Dashboard sections, in this order:

- [ ] Wants Dates.
- [ ] Booked Gigs Needing Prep.
- [ ] Follow-Ups Due.
- [ ] Calls to Consider.
- [ ] 60-Day Retries Due.
- [ ] New Leads Ready for Outreach.
- [ ] Research Needed.
- [ ] Post-Gig Thank-You Needed.

Each dashboard card shows:

- [ ] Venue name.
- [ ] Status.
- [ ] Priority label.
- [ ] Priority score where useful.
- [ ] Distance.
- [ ] Last contacted.
- [ ] Next action.
- [ ] Next action date.
- [ ] Contact method.
- [ ] Missing-field warning when required info is absent.

Card actions:

- [ ] Open venue.
- [ ] Draft email.
- [ ] Log call.
- [ ] Mark replied.
- [ ] Send dates.
- [ ] Book gig.
- [ ] Snooze.
- [ ] Mark ghosted.
- [ ] Mark do not contact with confirmation.

Dashboard behavior:

- [ ] `REPLIED_WANTS_DATES` appears at the top of the dashboard.
- [ ] Follow-ups appear only when due.
- [ ] 60-day retries stay hidden until due.
- [ ] Do-not-contact venues are excluded from outreach queues.
- [ ] Empty states are useful but brief.
- [ ] Cards are compact and mobile-friendly.
- [ ] No nested cards inside cards.

Acceptance:

- [ ] Dee Dee can open one screen and know the next best action.
- [ ] Dashboard works on desktop.
- [ ] Dashboard works around 390px mobile width.
- [ ] Dashboard actions do not silently mutate state without confirmation.

## Phase 3: Venue Profile UI

Goal: one place for the full venue record, timeline, history, assets, and actions.

Header:

- [ ] Venue name.
- [ ] Status.
- [ ] Priority label.
- [ ] Distance.
- [ ] Next action.
- [ ] Next action date.
- [ ] Next gig date if any.

Contact Info:

- [ ] Contact person name.
- [ ] Contact person role.
- [ ] Email.
- [ ] Phone.
- [ ] Facebook page.
- [ ] Website.
- [ ] Preferred contact method.

Live Music Info:

- [ ] Currently has live music.
- [ ] Live music notes.
- [ ] Booking notes.

Outreach Timeline:

- [ ] Contact events render in date order.
- [ ] Date shown.
- [ ] Method shown.
- [ ] Direction shown.
- [ ] Summary shown.
- [ ] Result/outcome shown.
- [ ] Next action created shown when available.

Gig History:

- [ ] Upcoming gigs.
- [ ] Past gigs.
- [ ] Completed gigs.
- [ ] Venue can show multiple gigs.
- [ ] `hasPlayedBefore` is based on completed gigs, not merely booked gigs.

Assets:

- [ ] EPK link.
- [ ] Website link.
- [ ] Google Drive marketing folder link.
- [ ] Promo images/posters folder link.
- [ ] Venue-specific poster/materials link.

Actions:

- [ ] Draft initial email.
- [ ] Draft follow-up.
- [ ] Draft available dates email.
- [ ] Draft pre-gig marketing email.
- [ ] Draft thank-you email.
- [ ] Log call.
- [ ] Log Facebook message.
- [ ] Mark replied.
- [ ] Send dates.
- [ ] Create gig.
- [ ] Mark ghosted.
- [ ] Set 60-day retry.
- [ ] Mark do not contact.

Acceptance:

- [ ] Venue profile can be opened from dashboard.
- [ ] Venue profile can be opened from map popup.
- [ ] Profile edits preserve existing sheet sync behavior.
- [ ] Profile is usable on mobile without horizontal scrolling.

## Phase 4: Map UI Update

Goal: keep the map as the visual layer for venue status and urgency.

Pin colors:

- [ ] Gray = New lead.
- [ ] Purple = Research needed.
- [ ] Blue = Outreach sent / waiting.
- [ ] Yellow = Follow-up needed.
- [ ] Red = Wants dates / hot.
- [ ] Green = Gig booked.
- [ ] Dark green = Played before.
- [ ] Orange = Retry later.
- [ ] Black = Do not contact.

Pin popup content:

- [ ] Venue name.
- [ ] Status.
- [ ] Priority.
- [ ] Distance.
- [ ] Next action.
- [ ] Last contacted.
- [ ] Next gig date if any.

Pin popup actions:

- [ ] Open profile.
- [ ] Draft message.
- [ ] Log contact.
- [ ] Book gig.

Acceptance:

- [ ] Pin color reflects normalized status.
- [ ] Hot/wants-dates venues are visually obvious.
- [ ] Do-not-contact venues are visibly distinct and not presented as outreach targets.
- [ ] Existing map loading and marker click behavior remain stable.

## Phase 5: Email Draft Center

Goal: generate clean drafts for human review and sending.

Draft types:

- [ ] Initial outreach.
- [ ] Follow-up.
- [ ] Available dates.
- [ ] Samples/EPK response.
- [ ] Pre-gig marketing packet.
- [ ] Thank-you after gig.
- [ ] Ask for future dates.
- [ ] 60-day retry.

Draft UI:

- [ ] Show recipient.
- [ ] Show subject.
- [ ] Show body.
- [ ] Show missing field warnings.
- [ ] Copy subject.
- [ ] Copy body.
- [ ] Copy full email.
- [ ] Open mailto.
- [ ] Show manual confirmation button: `I sent this email`.
- [ ] Log contact event only after manual confirmation.

Template style:

- [ ] Short.
- [ ] Friendly.
- [ ] Specific.
- [ ] One clear ask.
- [ ] No fake personalization.
- [ ] No long walls of text.
- [ ] No auto-send.

Acceptance:

- [ ] Generating a draft does not change venue status.
- [ ] Copy works.
- [ ] Mailto works.
- [ ] Missing links/contact info are obvious before sending.
- [ ] `I sent this email` updates status/date only after click.

## Phase 6: Gig Calendar / Gig List

Goal: support multiple gigs per venue and make pre/post-gig work visible.

Tabs:

- [ ] Upcoming gigs.
- [ ] Needs pre-gig prep.
- [ ] Past gigs.
- [ ] Needs thank-you.
- [ ] Rebooking opportunities.

Gig card fields:

- [ ] Venue.
- [ ] Date.
- [ ] Time.
- [ ] Address.
- [ ] Arrival time.
- [ ] Day-of contact.
- [ ] Setup notes.
- [ ] Parking notes.
- [ ] Marketing status.

Gig actions:

- [ ] Open venue.
- [ ] Open map.
- [ ] Draft pre-gig email.
- [ ] Mark performed.
- [ ] Draft thank-you.

Gig record requirements:

- [ ] `gigId`.
- [ ] `venueSiteId`.
- [ ] `venueName`.
- [ ] `gigDate`.
- [ ] `status`.
- [ ] `startTime`.
- [ ] `endTime`.
- [ ] `arrivalTime`.
- [ ] `loadInTime`.
- [ ] `address`.
- [ ] `parkingNotes`.
- [ ] `loadInNotes`.
- [ ] `indoorOutdoor`.
- [ ] `dayOfContactName`.
- [ ] `dayOfContactPhone`.
- [ ] `dayOfContactEmail`.
- [ ] `setupNotes`.
- [ ] Marketing flags.
- [ ] Post-gig fields.

Acceptance:

- [ ] Booking a gig creates a gig record.
- [ ] Venue profile shows all gigs for that venue.
- [ ] Marking a gig performed updates venue history.
- [ ] Completed gig increments total gigs played.
- [ ] Upcoming gigs do not set `hasPlayedBefore = true` until completed.

## Phase 7: Pre-Gig And Post-Gig Workflows

Goal: make the app useful before and after each performance.

When gig is booked:

- [ ] Create pre-gig prep task one week before gig.
- [ ] Create gig-day task.
- [ ] Create post-gig thank-you task after gig.
- [ ] Set venue `nextGigDate`.

Pre-gig checklist:

- [ ] Send EPK.
- [ ] Send website.
- [ ] Send Google Drive marketing folder.
- [ ] Send promo images/posters.
- [ ] Confirm event date/time.
- [ ] Confirm arrival/load-in details.
- [ ] Confirm contact person.
- [ ] Confirm equipment/setup notes.
- [ ] Add to calendar.

When gig is marked performed:

- [ ] Set gig status to completed.
- [ ] Set venue `hasPlayedBefore = true`.
- [ ] Increment venue `totalGigsPlayed`.
- [ ] Set venue `lastGigDate`.
- [ ] Check for future gigs.
- [ ] If future gigs exist, draft thank-you that mentions upcoming dates.
- [ ] If no future gigs exist, draft thank-you asking for more dates.
- [ ] Create optional rebook follow-up date.

Acceptance:

- [ ] Dashboard shows gigs needing prep within 7 days.
- [ ] Dashboard shows thank-you tasks after performed gigs.
- [ ] Thank-you path changes based on whether future gigs exist.

## Phase 8: Data Model And Spreadsheet Sync

Goal: spreadsheet stays source of editable venue data for now.

Venue fields:

- [ ] `siteId`.
- [ ] `placeName`.
- [ ] `address`.
- [ ] `latitude`.
- [ ] `longitude`.
- [ ] `status`.
- [ ] `priorityScore`.
- [ ] `priorityLabel`.
- [ ] `notes`.
- [ ] Contact fields.
- [ ] Live music fields.
- [ ] Gig history summary fields.
- [ ] Outreach tracking fields.
- [ ] Pipeline fields.
- [ ] Ranking fields.
- [ ] Asset fields.

Sheets:

- [ ] `Venues` sheet is readable/writable.
- [ ] `ContactLog` sheet is readable/writable.
- [ ] `Gigs` sheet is readable/writable.
- [ ] `CalendarGigs` sheet is created/updated by Google Calendar sync.
- [ ] `Settings` sheet is readable/writable.

ContactLog fields:

- [ ] `eventId`.
- [ ] `venueSiteId`.
- [ ] `date`.
- [ ] `method`.
- [ ] `direction`.
- [ ] `summary`.
- [ ] `result`.
- [ ] `createdAt`.

Settings:

- [ ] `defaultEpkLink`.
- [ ] `defaultWebsiteLink`.
- [ ] `defaultMarketingFolderLink`.
- [ ] `defaultPromoImagesFolderLink`.
- [ ] `defaultSamplesLink`.
- [ ] `homeBaseAddress`.
- [ ] `initialFollowUpDelayDays`.
- [ ] `postFollowUpCallDelayDays`.
- [ ] `ghostRetryDelayDays`.

Acceptance:

- [ ] Existing columns continue to work.
- [ ] New columns can be added without reordering existing data.
- [ ] Writes target stable venue ID, not row number as permanent identity.
- [ ] Sync errors show recovery guidance in UI.

## Phase 9: Status Transitions

Goal: every status has a clear action and safe manual confirmation.

Statuses:

- [ ] `NEW_LEAD`.
- [ ] `RESEARCH_NEEDED`.
- [ ] `INITIAL_OUTREACH_READY`.
- [ ] `INITIAL_OUTREACH_SENT`.
- [ ] `WAITING_FOR_REPLY`.
- [ ] `FOLLOW_UP_NEEDED`.
- [ ] `FOLLOW_UP_SENT`.
- [ ] `OPTIONAL_CALL_NEEDED`.
- [ ] `GHOSTED_RETRY_60`.
- [ ] `REPLIED_WANTS_DATES`.
- [ ] `DATES_SENT`.
- [ ] `GIG_BOOKED`.
- [ ] `PRE_GIG_PREP`.
- [ ] `GIG_PERFORMED`.
- [ ] `POST_GIG_FOLLOWUP_COMPLETE`.

Transition rules:

- [ ] Initial outreach sent sets last contacted date.
- [ ] Initial outreach sent sets outreach attempt count to 1.
- [ ] Initial outreach sent sets follow-up date using `initialFollowUpDelayDays`.
- [ ] Follow-up due triggers only when follow-up date arrives.
- [ ] Follow-up sent increments outreach attempt count.
- [ ] Follow-up sent sets call-needed date using `postFollowUpCallDelayDays`.
- [ ] Ghosted sets retry date using `ghostRetryDelayDays`.
- [ ] Wants-dates jumps to highest priority.
- [ ] Dates sent waits for confirmation and does not create a gig yet.
- [ ] Gig booked creates a gig record.
- [ ] Gig performed updates venue history.

Acceptance:

- [ ] Every dashboard button maps to an explicit transition or log event.
- [ ] Every transition has a manual user action.
- [ ] Every transition can be tested.

## Phase 10: Ranking

Goal: prioritize booking likelihood first, distance second.

Rules:

- [ ] Start score at 0.
- [ ] `+100` for `REPLIED_WANTS_DATES`.
- [ ] `+90` for `DATES_SENT`.
- [ ] `+80` for `GIG_BOOKED`.
- [ ] `+70` if venue has booked Dee Dee before.
- [ ] `+60` if venue replied positively.
- [ ] `+40` if follow-up is due today.
- [ ] `+30` if venue has live music.
- [ ] `+20` if good contact info exists.
- [ ] `+10` if website/Facebook confirms music booking.
- [ ] Distance adds tie-breaker points.
- [ ] Manual high override adds boost.
- [ ] Manual low override subtracts.
- [ ] `doNotContact` forces do-not-contact priority.

Priority labels:

- [ ] HOT.
- [ ] HIGH.
- [ ] MEDIUM.
- [ ] LOW.
- [ ] RETRY LATER.
- [ ] DO NOT CONTACT.

Acceptance:

- [ ] Engagement beats distance.
- [ ] Distance breaks ties.
- [ ] Manual override works.
- [ ] Wants-dates ranks above closer cold leads.

## Phase 11: UI Polish And Mobile

Goal: make the CRM fast and comfortable on a phone.

- [ ] Large tap targets.
- [ ] No horizontal scrolling.
- [ ] Text fits inside buttons/cards.
- [ ] Clear loading states.
- [ ] Clear saved states.
- [ ] Clear failed states.
- [ ] Empty states for every dashboard tab/section.
- [ ] Confirmation before do-not-contact.
- [ ] Last synced indicator.
- [ ] Unsaved changes warning in edit flows.
- [ ] Visual hierarchy is compact and operational, not marketing-like.
- [ ] Leftover BARK naming removed only where safe.

Acceptance:

- [ ] Mobile dashboard is usable at 390px width.
- [ ] Venue profile is usable at 390px width.
- [ ] Map controls do not overlap on mobile.
- [ ] Buttons are readable and tappable.

## Phase 12: Tests

Automated:

- [ ] Smoke tests for all status transitions.
- [ ] Tests for multiple gigs per venue.
- [ ] Test that generating a draft does not mark email as sent.
- [ ] Test that wants-dates ranks above distance.
- [ ] Test that completed gig updates venue history.
- [ ] Test dashboard section membership.
- [ ] Test do-not-contact exclusion.
- [ ] Test 60-day retry visibility.
- [ ] Test pre-gig prep visibility.
- [ ] Test post-gig thank-you visibility.

Manual:

- [ ] Dashboard opens.
- [ ] Map pins render.
- [ ] Venue profile opens from dashboard.
- [ ] Venue profile opens from map.
- [ ] Email draft copy works.
- [ ] Mailto opens.
- [ ] Draft generation does not mark sent.
- [ ] Mark sent updates only after confirmation.
- [ ] Create gig creates gig record.
- [ ] Mark performed updates venue history.
- [ ] Sandbox sheet write affects sandbox only.

Validation commands:

```bash
npm run test:booking
npm run test:smoke:jddm
npm test
git diff --check
```

## Do Not Build Yet

- [ ] AI personalization.
- [ ] Auto-send email.
- [ ] Gmail draft creation unless explicitly approved.
- [ ] Pay amount.
- [ ] Deposit.
- [ ] Invoice.
- [ ] Payment status.
- [ ] Complex automation that changes state without confirmation.

## Recommended Fast Execution Order

1. [ ] Verify already-coded baseline and check off what exists.
2. [ ] Finish Dashboard command center.
3. [ ] Add/finish Venue Profile.
4. [ ] Add/finish Email Draft Center.
5. [ ] Add Gig records and Gig List.
6. [ ] Add pre-gig/post-gig workflows.
7. [ ] Add map pin status colors.
8. [ ] Add settings for default assets and timing.
9. [ ] Add ranking logic and wants-dates priority.
10. [ ] Harden spreadsheet sync and tests.
11. [ ] Polish mobile UI.
12. [ ] Final tester QA pass.
