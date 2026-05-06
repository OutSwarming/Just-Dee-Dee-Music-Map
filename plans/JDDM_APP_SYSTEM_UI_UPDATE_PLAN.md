# Just Dee Dee Music App System UI Update Plan

Created: May 6, 2026

This is the living plan for turning the Just Dee Dee Music Map into a venue CRM, gig pipeline, email draft center, and next-action dashboard.

This document must be updated by AI/Codex after every finished implementation pass. A task is not considered done until this plan is checked off, validation is recorded, the change is committed, and the branch is pushed to GitHub.

## Non-Negotiable Safety Rules

- [ ] Work against a copied sandbox spreadsheet first, not the real master spreadsheet.
- [ ] Keep the master spreadsheet read-only until sandbox writes have been verified.
- [ ] Point local/dev app config at the sandbox bridge URL while experimenting.
- [ ] Never auto-send emails in the current version.
- [ ] Generating a draft is not the same as sending it.
- [ ] Booking a gig must create a gig record, not only change venue status.
- [ ] A venue can have many gigs.
- [ ] A venue that replied and wants dates is always the highest priority.
- [ ] Do not add money tracking in this version.
- [ ] Avoid hidden automation that changes business state without manual confirmation.
- [ ] Update this document before each final commit for this project area.
- [ ] Push finished work to GitHub after the doc is updated.

## AI Completion Area

AI/Codex should update this section every time work is completed.

| Date | Phase/Task | Files Changed | Validation | Commit/PR | AI Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-05-06 | Created system UI update plan | `plans/JDDM_APP_SYSTEM_UI_UPDATE_PLAN.md` | Markdown/diff sanity pass; no code tests needed for doc-only change | Initial plan commit and GitHub push | Initial living plan created from Carter's system plan. |

## Master Spreadsheet Copy Plan

Before any UI or sync changes are tested against live venue data, create a working copy of the master spreadsheet.

### Sandbox Spreadsheet Requirements

- [ ] Duplicate the real Just Dee Dee Music master spreadsheet in Google Drive.
- [ ] Name the copy `Just Dee Dee Music Booking CRM UI Sandbox - YYYY-MM-DD`.
- [ ] Confirm the copy includes all sheets, formulas, hidden columns, and Apps Script context needed for testing.
- [ ] Add a visible first-row or frozen-note marker: `SANDBOX COPY - SAFE TO TEST`.
- [ ] Deploy the Apps Script bridge from `google-apps-script/jddm-spreadsheet-bridge/Code.gs` against the sandbox copy.
- [ ] Store the sandbox bridge URL only in local config, not in committed files.
- [ ] Set `window.JDDM_VENUE_CSV_URL` to the sandbox bridge CSV endpoint during testing.
- [ ] Run one harmless write against a disposable test row.
- [ ] Confirm the real master spreadsheet did not change.
- [ ] Record the sandbox URL owner/location outside the repo if it contains private data.

### Spreadsheet Cutover Rule

The app may not write to the real master spreadsheet until:

- [ ] Sandbox read works.
- [ ] Sandbox write works.
- [ ] Sandbox dashboard refresh works after write.
- [ ] Contact status transitions are verified.
- [ ] Gig creation is verified.
- [ ] Draft generation is verified to not mark email as sent.
- [ ] Carter explicitly approves real sheet testing.

## Mission

Build the Just Dee Dee Music app as a lightweight booking assistant that helps Dee Dee:

1. Track venues.
2. Know who to contact next.
3. Follow up without forgetting.
4. Convert replies into booked gigs.
5. Prepare before each gig.
6. Follow up after each gig.
7. Build long-term venue relationships.

The map is the visual layer. The real system is the venue pipeline, gig history, and next-action dashboard.

The app should always answer: "What should Dee Dee do next?"

## Core Product Shape

Primary screens:

- [ ] Dashboard: daily next-action command center.
- [ ] Map View: geographic venue layer with status-colored pins.
- [ ] Venue Profile: full venue CRM record, timeline, gig history, assets, and actions.
- [ ] Gig Calendar/List: upcoming, prep, past, thank-you, and rebooking views.
- [ ] Email Draft Center: template-based drafts for review, copy, and mailto.
- [ ] Settings: default EPK, website, Drive assets, samples, home base, and timing values.

Current repo anchors:

- App shell: `index.html`
- Main app boot: `core/app.js`
- Existing booking schema: `modules/bookingSchema.js`
- Existing dashboard: `modules/bookingDashboard.js`
- Existing action service: `modules/bookingActions.js`
- Existing email templates: `modules/bookingEmailTemplates.js`
- Existing data normalization: `modules/dataService.js`
- Spreadsheet service: `services/spreadsheetService.js`
- Spreadsheet bridge: `google-apps-script/jddm-spreadsheet-bridge/Code.gs`
- Key validation gate: `npm run test:booking`

## Core Business Flow

Every venue should move through this pipeline:

```text
NEW_LEAD
RESEARCH_NEEDED
INITIAL_OUTREACH_READY
INITIAL_OUTREACH_SENT
WAITING_FOR_REPLY
FOLLOW_UP_NEEDED
FOLLOW_UP_SENT
OPTIONAL_CALL_NEEDED
GHOSTED_RETRY_60
REPLIED_WANTS_DATES
DATES_SENT
GIG_BOOKED
PRE_GIG_PREP
GIG_PERFORMED
POST_GIG_FOLLOWUP_COMPLETE
REBOOKING / FUTURE DATES LOOP
```

## Venue Data Model

Each venue has one main record.

Required fields:

- [ ] `siteId`
- [ ] `placeName`
- [ ] `address`
- [ ] `latitude`
- [ ] `longitude`
- [ ] `status`
- [ ] `priorityScore`
- [ ] `priorityLabel`
- [ ] `notes`

Contact fields:

- [ ] `contactPersonName`
- [ ] `contactPersonRole`
- [ ] `email`
- [ ] `phone`
- [ ] `facebookPage`
- [ ] `website`
- [ ] `preferredContactMethod`

Preferred contact method options:

- `email`
- `facebook`
- `phone`
- `text`
- `website form`
- `in person`
- `unknown`

Live music fields:

- [ ] `currentlyHasLiveMusic`
- [ ] `liveMusicNotes`

Live music options:

- `yes`
- `no`
- `seasonal`
- `unknown`

History fields:

- [ ] `hasPlayedBefore`
- [ ] `totalGigsPlayed`
- [ ] `lastGigDate`
- [ ] `nextGigDate`
- [ ] `gigHistoryIds`

Outreach tracking fields:

- [ ] `lastContactedDate`
- [ ] `lastContactMethod`
- [ ] `lastContactSummary`
- [ ] `firstOutreachDate`
- [ ] `followUpDate`
- [ ] `followUpSentDate`
- [ ] `callNeededDate`
- [ ] `retryAfterDate`
- [ ] `outreachAttemptCount`
- [ ] `replyReceived`
- [ ] `wantsDates`
- [ ] `datesSentDate`
- [ ] `availableDatesSent`

Pipeline fields:

- [ ] `status`
- [ ] `nextAction`
- [ ] `nextActionDate`
- [ ] `nextActionType`
- [ ] `isArchived`
- [ ] `doNotContact`

Ranking fields:

- [ ] `priorityScore`
- [ ] `priorityLabel`
- [ ] `manualPriorityOverride`
- [ ] `manualPriorityReason`
- [ ] `distanceFromHomeBase`
- [ ] `locationRank`
- [ ] `engagementRank`
- [ ] `exceptionBoostReason`

Asset fields:

- [ ] `epkLink`
- [ ] `websiteLink`
- [ ] `googleDriveMarketingFolderLink`
- [ ] `promoImagesFolderLink`
- [ ] `venueSpecificPosterLink`

## Gig Data Model

A venue can have many gigs over time. Do not reduce gig history to a single yes/no field.

Required gig fields:

- [ ] `gigId`
- [ ] `venueSiteId`
- [ ] `venueName`
- [ ] `gigDate`
- [ ] `status`

Timing fields:

- [ ] `startTime`
- [ ] `endTime`
- [ ] `arrivalTime`
- [ ] `loadInTime`

Location fields:

- [ ] `address`
- [ ] `parkingNotes`
- [ ] `loadInNotes`
- [ ] `indoorOutdoor`

Indoor/outdoor options:

- `indoor`
- `outdoor`
- `patio`
- `mixed`
- `unknown`

Contact fields:

- [ ] `dayOfContactName`
- [ ] `dayOfContactPhone`
- [ ] `dayOfContactEmail`

Setup fields:

- [ ] `equipmentProvided`
- [ ] `equipmentNotes`
- [ ] `powerAvailable`
- [ ] `soundSystemProvided`
- [ ] `setupNotes`

Marketing fields:

- [ ] `preGigMarketingNeeded`
- [ ] `epkSent`
- [ ] `websiteSent`
- [ ] `promoFolderSent`
- [ ] `posterSent`
- [ ] `eventPostedByVenue`
- [ ] `facebookEventLink`
- [ ] `marketingNotes`

Calendar fields:

- [ ] `addedToCalendar`
- [ ] `calendarEventId`

Post-gig fields:

- [ ] `gigCompleted`
- [ ] `thankYouEmailDrafted`
- [ ] `thankYouEmailSent`
- [ ] `thankedOnFacebook`
- [ ] `futureDatesMentioned`
- [ ] `askedForMoreDates`
- [ ] `postGigNotes`
- [ ] `rebookFollowUpDate`

Do not add pay amount, deposit, invoice, or payment status for now.

## Status Definitions And Transitions

### `NEW_LEAD`

Meaning: Venue exists, but Dee Dee has not acted on it.

UI label: `New Lead`

Next actions:

- [ ] Research venue.
- [ ] Find contact info.
- [ ] Check if they have live music.
- [ ] Prepare first outreach.

### `RESEARCH_NEEDED`

Meaning: Venue is missing critical booking info.

Triggered when:

- [ ] No email.
- [ ] No phone.
- [ ] No Facebook.
- [ ] Unknown live music status.
- [ ] No contact person.
- [ ] No website.

Next actions:

- [ ] Find booking email.
- [ ] Check website.
- [ ] Check Facebook.
- [ ] Call and ask who books music.

### `INITIAL_OUTREACH_READY`

Meaning: Venue has enough info to contact.

Next actions:

- [ ] Draft first outreach email.
- [ ] Draft Facebook message.
- [ ] Prepare call script.

### `INITIAL_OUTREACH_SENT`

Meaning: First contact has been made.

Automation after manual confirmation:

- [ ] Set `lastContactedDate = today`.
- [ ] Set `outreachAttemptCount = 1`.
- [ ] Set `followUpDate = today + initialFollowUpDelayDays`.
- [ ] Set `status = WAITING_FOR_REPLY`.
- [ ] Set `nextAction = Wait for reply`.
- [ ] Set `nextActionDate = followUpDate`.

### `WAITING_FOR_REPLY`

Meaning: Initial outreach was sent, but follow-up is not due yet.

Rules:

- [ ] Do not show as urgent before `followUpDate`.
- [ ] Move to `FOLLOW_UP_NEEDED` when `followUpDate <= today`.

### `FOLLOW_UP_NEEDED`

Meaning: A few days passed and no reply.

Next actions:

- [ ] Draft one follow-up email.
- [ ] Optionally suggest a call after follow-up.

### `FOLLOW_UP_SENT`

Meaning: One follow-up email has been sent.

Automation after manual confirmation:

- [ ] Set `followUpSentDate = today`.
- [ ] Increase `outreachAttemptCount`.
- [ ] Set `callNeededDate = today + postFollowUpCallDelayDays`.
- [ ] Set `nextAction = Consider calling venue`.
- [ ] Set `status = OPTIONAL_CALL_NEEDED`.

### `OPTIONAL_CALL_NEEDED`

Meaning: Email and follow-up did not get a reply.

Next actions:

- [ ] Log call attempt.
- [ ] Mark ghosted.
- [ ] Set 60-day retry.

### `GHOSTED_RETRY_60`

Meaning: Venue did not respond after email, follow-up, and optional call path.

Automation after manual confirmation:

- [ ] Set `retryAfterDate = today + ghostRetryDelayDays`.
- [ ] Set `nextAction = Retry outreach after 60 days`.
- [ ] Hide from urgent dashboard until retry date arrives.

Important: ghosted means "not now", not dead forever.

### `REPLIED_WANTS_DATES`

Meaning: Venue replied and wants available dates.

Rules:

- [ ] Highest-priority status in the app.
- [ ] Rank above nearly everything else.
- [ ] Draft email with available dates.
- [ ] Attach/send EPK if needed.
- [ ] Include website if helpful.
- [ ] Include samples only if asked or needed.

### `DATES_SENT`

Meaning: Dee Dee sent available dates.

Next actions:

- [ ] Wait for date confirmation.
- [ ] Follow up manually if needed.
- [ ] Create gig if they choose a date.

### `GIG_BOOKED`

Meaning: Date is confirmed.

Automation after manual confirmation:

- [ ] Create a Gig record.
- [ ] Link gig to venue.
- [ ] Add gig to venue gig history.
- [ ] Set `nextGigDate`.
- [ ] Set `hasPlayedBefore = true` only after gig completion, not merely booking.
- [ ] Create pre-gig prep task one week before gig.
- [ ] Create gig-day task.
- [ ] Create post-gig thank-you task after gig.

### `PRE_GIG_PREP`

Meaning: Gig is coming up and marketing/prep should happen.

Triggered:

- [ ] Seven days before gig.

Next actions:

- [ ] Draft pre-gig marketing email.
- [ ] Send EPK.
- [ ] Send website.
- [ ] Send Google Drive marketing folder.
- [ ] Send promo images/posters.
- [ ] Confirm time/details if needed.

### `GIG_PERFORMED`

Meaning: The gig happened.

Next actions:

- [ ] Add post-gig notes.
- [ ] Draft thank-you email.
- [ ] Thank them on Facebook if appropriate.
- [ ] Mention upcoming dates if any exist.
- [ ] Ask about future dates if no upcoming dates exist.

### `POST_GIG_FOLLOWUP_COMPLETE`

Meaning: Thank-you/future booking loop is complete.

Next actions:

- [ ] If future dates exist, keep venue active.
- [ ] If no future dates, set rebook follow-up.
- [ ] If bad fit, mark low priority or do not contact.

## Follow-Up Rules

Config values:

- [ ] `initialFollowUpDelayDays = 4`
- [ ] `postFollowUpCallDelayDays = 3`
- [ ] `ghostRetryDelayDays = 60`

Default outreach rhythm:

1. Initial outreach sent.
2. Wait 3 to 5 days.
3. Send one follow-up email.
4. If still no reply, optionally call.
5. If still no meaningful reply, set 60-day retry.

Keep these settings easy to change later.

## Priority Ranking System

Engagement beats distance. Distance breaks ties. Manual override can create exceptions.

Priority labels:

- `HOT`
- `HIGH`
- `MEDIUM`
- `LOW`
- `RETRY LATER`
- `DO NOT CONTACT`

Priority score proposal:

- [ ] Start with 0.
- [ ] `+100` if `status = REPLIED_WANTS_DATES`.
- [ ] `+90` if `status = DATES_SENT`.
- [ ] `+80` if `status = GIG_BOOKED`.
- [ ] `+70` if venue has booked Dee Dee before.
- [ ] `+60` if venue replied positively.
- [ ] `+40` if follow-up is due today.
- [ ] `+30` if venue has live music.
- [ ] `+20` if good contact info exists.
- [ ] `+10` if website/Facebook confirms music booking.
- [ ] `+30` if very close.
- [ ] `+20` if close.
- [ ] `+10` if acceptable distance.
- [ ] `+0` if far.
- [ ] `-20` if too far unless manually boosted.
- [ ] `+50` if `manualPriorityOverride = HIGH`.
- [ ] `-50` if `manualPriorityOverride = LOW`.
- [ ] `-999` if `doNotContact = true`.

Highest-priority order:

1. Venue replied and wants dates.
2. Venue replied positively.
3. Venue has booked Dee Dee before.
4. Venue has upcoming date discussion.
5. Venue is close by.
6. Venue has live music and fits her style.
7. Venue has good contact info.
8. Venue is high-value strategically, even if farther away.

## UI Plan

### Screen 1: Dashboard

Purpose: tell Dee Dee what to do today.

Sections in order:

- [ ] Wants Dates.
- [ ] Booked Gigs Needing Prep.
- [ ] Follow-Ups Due.
- [ ] Calls to Consider.
- [ ] 60-Day Retries Due.
- [ ] New Leads Ready for Outreach.
- [ ] Research Needed.

Each dashboard card should show:

- [ ] Venue name.
- [ ] Status.
- [ ] Priority.
- [ ] Distance.
- [ ] Last contacted.
- [ ] Next action.
- [ ] Contact method.

Card buttons:

- [ ] Open venue.
- [ ] Draft email.
- [ ] Log call.
- [ ] Mark replied.
- [ ] Send dates.
- [ ] Book gig.
- [ ] Snooze.

UI direction:

- [ ] Make Dashboard the practical first stop.
- [ ] Keep the page compact, scannable, and action-focused.
- [ ] Avoid marketing-style hero sections.
- [ ] Use grouped work queues, not decorative cards inside cards.
- [ ] Make urgent sections visually distinct without making the whole app loud.

### Screen 2: Map View

Purpose: visualize venues geographically.

Pin colors:

- [ ] Gray = New lead.
- [ ] Purple = Research needed.
- [ ] Blue = Outreach sent / waiting.
- [ ] Yellow = Follow-up needed.
- [ ] Red = Wants dates / hot.
- [ ] Green = Gig booked.
- [ ] Dark green = Played before.
- [ ] Black = Do not contact.
- [ ] Orange = Retry later.

Pin popup fields:

- [ ] Venue name.
- [ ] Status.
- [ ] Priority.
- [ ] Distance.
- [ ] Next action.
- [ ] Last contacted.
- [ ] Next gig date if any.

Pin popup buttons:

- [ ] Open profile.
- [ ] Draft message.
- [ ] Log contact.
- [ ] Book gig.

### Screen 3: Venue Profile

Header:

- [ ] Venue name.
- [ ] Status.
- [ ] Priority label.
- [ ] Distance.
- [ ] Next action.

Contact info:

- [ ] Contact person.
- [ ] Email.
- [ ] Phone.
- [ ] Facebook.
- [ ] Website.
- [ ] Preferred contact method.

Live music info:

- [ ] Has live music?
- [ ] Live music notes.
- [ ] Booking notes.

Outreach timeline:

- [ ] Date.
- [ ] Method.
- [ ] Summary.
- [ ] Outcome.
- [ ] Next action created.

Gig history:

- [ ] Past gigs.
- [ ] Upcoming gigs.
- [ ] Completed gigs.
- [ ] Canceled/rescheduled gigs later if needed.

Assets:

- [ ] EPK link.
- [ ] Website link.
- [ ] Google Drive marketing folder.
- [ ] Promo images/posters folder.
- [ ] Venue-specific materials.

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

### Screen 4: Gig Calendar / Gig List

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
- [ ] Contact.
- [ ] Setup notes.
- [ ] Marketing status.

Gig card buttons:

- [ ] Open venue.
- [ ] Open map.
- [ ] Draft pre-gig email.
- [ ] Mark performed.
- [ ] Draft thank-you.

### Screen 5: Email Draft Center

Purpose: generate structured drafts for Dee Dee to review and send.

Current phase: no AI required. Use templates with variables.

Future phase: AI can personalize using venue notes, website, and past history.

Draft types:

- [ ] Initial outreach.
- [ ] Follow-up.
- [ ] Available dates.
- [ ] Samples/EPK response.
- [ ] Pre-gig marketing packet.
- [ ] Thank-you after gig.
- [ ] Ask for future dates.
- [ ] 60-day retry.

Draft UI requirements:

- [ ] Show subject.
- [ ] Show body.
- [ ] Show recipient.
- [ ] Show missing field warnings.
- [ ] Copy to clipboard.
- [ ] Open mailto.
- [ ] Later: allow Gmail draft creation.

Manual confirmation requirements:

- [ ] `I sent this email`.
- [ ] `I logged this call`.
- [ ] `They replied`.
- [ ] `Dates sent`.
- [ ] `Gig booked`.

## Email Template Style

Long-term structure can use:

- Research.
- Reference.
- Reward.
- Request.

Current templates should stay:

- [ ] Short.
- [ ] Friendly.
- [ ] Specific.
- [ ] Easy to respond to.
- [ ] Focused on one clear ask.
- [ ] Free of fake personalization.

Avoid:

- [ ] Long walls of text.
- [ ] Robotic language.
- [ ] Too many links.
- [ ] Multiple questions at once.
- [ ] Overly salesy tone.

## Email Draft Templates

### Initial Outreach

Use when venue is ready for first contact.

Subject:

```text
Live music at {{venueName}}?
```

Body:

```text
Hi {{contactPersonNameOrVenueTeam}},

I'm reaching out for Dee Dee, a live musician based in Northeast Ohio.

I saw that {{venueName}} {{researchLine}}, and thought her music could be a good fit for an upcoming date.

Here is her website:
{{websiteLink}}

Here is her EPK:
{{epkLink}}

Would you be the right person to talk to about booking live music, or is there someone else I should reach out to?

Thanks,
{{senderName}}
```

### Follow-Up

Subject:

```text
Following up about live music
```

Body:

```text
Hi {{contactPersonNameOrVenueTeam}},

Just wanted to follow up on my note about Dee Dee playing at {{venueName}}.

If you are currently booking live music, I'd be happy to send over a few available dates.

Here is her website again:
{{websiteLink}}

Thanks,
{{senderName}}
```

### Available Dates

Subject:

```text
Available dates for Dee Dee
```

Body:

```text
Hi {{contactPersonName}},

Absolutely, thank you for getting back to me.

Here are a few dates Dee Dee currently has available:

{{availableDatesList}}

Her EPK is here:
{{epkLink}}

And her website is here:
{{websiteLink}}

Do any of those dates work for {{venueName}}?

Thanks,
{{senderName}}
```

### Samples / EPK Response

Subject:

```text
Dee Dee music samples
```

Body:

```text
Hi {{contactPersonName}},

Of course, here are a few links for Dee Dee:

Website:
{{websiteLink}}

EPK:
{{epkLink}}

Samples:
{{samplesLink}}

If it seems like a good fit, I can also send over a few available dates.

Thanks,
{{senderName}}
```

### Pre-Gig Marketing

Subject:

```text
Promo materials for Dee Dee at {{venueName}} on {{gigDate}}
```

Body:

```text
Hi {{contactPersonName}},

Looking forward to Dee Dee performing at {{venueName}} on {{gigDate}}.

Here are the promo materials in case you would like to use them for your website, Facebook, or event calendar:

EPK:
{{epkLink}}

Website:
{{websiteLink}}

Marketing materials folder:
{{googleDriveMarketingFolderLink}}

Promo images/posters:
{{promoImagesFolderLink}}

The event details I have are:

Date: {{gigDate}}
Time: {{startTime}} to {{endTime}}
Location: {{venueName}}

Please let me know if you need anything else for promotion.

Thanks,
{{senderName}}
```

### Post-Gig Thank-You With Upcoming Dates

Subject:

```text
Thank you from Dee Dee
```

Body:

```text
Hi {{contactPersonName}},

Thank you again for having Dee Dee at {{venueName}}.

She really appreciated the opportunity to perform there.

I also have these upcoming dates on the calendar:

{{upcomingGigDatesList}}

Please let me know if there is anything else you need for those dates.

Thanks,
{{senderName}}
```

### Post-Gig Thank-You Ask For More Dates

Subject:

```text
Thank you from Dee Dee
```

Body:

```text
Hi {{contactPersonName}},

Thank you again for having Dee Dee at {{venueName}}.

She really appreciated the opportunity to perform there.

If you are booking more live music dates, I'd be happy to send over some upcoming availability.

Thanks,
{{senderName}}
```

### 60-Day Retry

Subject:

```text
Checking back about live music
```

Body:

```text
Hi {{contactPersonNameOrVenueTeam}},

I wanted to check back in about Dee Dee playing at {{venueName}}.

If you are booking live music for upcoming dates, I'd be happy to send over her availability.

Website:
{{websiteLink}}

EPK:
{{epkLink}}

Thanks,
{{senderName}}
```

## Contact Event Log

Every interaction should be logged.

Contact event fields:

- [ ] `eventId`
- [ ] `venueSiteId`
- [ ] `date`
- [ ] `method`
- [ ] `direction`
- [ ] `summary`
- [ ] `result`
- [ ] `createdBy`
- [ ] `createdAt`

Methods:

- `email`
- `facebook`
- `phone`
- `text`
- `website form`
- `in person`

Directions:

- `outbound`
- `inbound`

Results:

- `no reply`
- `replied`
- `wants dates`
- `asked for samples`
- `booked`
- `not interested`
- `wrong contact`
- `call back later`
- `ghosted`

The contact log powers:

- [ ] Last contacted date.
- [ ] Follow-up dates.
- [ ] Priority ranking.
- [ ] Venue timeline.
- [ ] Rebooking logic.

## Post-Gig Logic

When a gig is marked performed:

- [ ] Set `gig.status = COMPLETED`.
- [ ] Set `venue.hasPlayedBefore = true`.
- [ ] Increment `venue.totalGigsPlayed`.
- [ ] Set `venue.lastGigDate = gigDate`.
- [ ] Check whether the venue has future gigs.
- [ ] If future gigs exist, draft thank-you email that mentions upcoming dates.
- [ ] If no future gigs exist, draft thank-you email asking about future dates.
- [ ] Set `nextAction` based on the correct thank-you path.
- [ ] Optionally create `rebookFollowUpDate`, defaulting to 30 to 60 days later.

## Pre-Gig Logic

When a gig is booked, create prep tasks:

- [ ] Send EPK.
- [ ] Send website.
- [ ] Send Google Drive marketing folder.
- [ ] Send promo images/posters.
- [ ] Confirm event date/time.
- [ ] Confirm arrival/load-in details.
- [ ] Confirm contact person.
- [ ] Confirm equipment/setup notes.
- [ ] Add to calendar.

One week before the gig:

- [ ] Show in Dashboard under `Booked Gigs Needing Prep`.
- [ ] Generate pre-gig marketing email draft.

## Google Drive Materials

Global assets:

- [ ] Dee Dee EPK.
- [ ] Dee Dee website.
- [ ] Main Google Drive marketing folder.
- [ ] General promo image folder.
- [ ] General poster folder.

Venue-specific assets:

- [ ] Venue-specific poster.
- [ ] Venue-specific promo image.
- [ ] Venue-specific event graphic.
- [ ] Facebook event link.

Settings page fields:

- [ ] `defaultEpkLink`
- [ ] `defaultWebsiteLink`
- [ ] `defaultMarketingFolderLink`
- [ ] `defaultPromoImagesFolderLink`
- [ ] `defaultSamplesLink`
- [ ] `homeBaseAddress`
- [ ] `initialFollowUpDelayDays`
- [ ] `postFollowUpCallDelayDays`
- [ ] `ghostRetryDelayDays`

## Spreadsheet Sync Requirements

The spreadsheet remains the source of editable venue data for now.

App should sync:

- [ ] Venue records.
- [ ] Contact info.
- [ ] Status.
- [ ] Priority.
- [ ] Notes.
- [ ] Last contacted.
- [ ] Next action.
- [ ] Follow-up date.
- [ ] Gig history summary.

### Sheet 1: Venues

Columns:

- [ ] `siteId`
- [ ] `placeName`
- [ ] `address`
- [ ] `latitude`
- [ ] `longitude`
- [ ] `status`
- [ ] `priorityLabel`
- [ ] `priorityScore`
- [ ] `contactPersonName`
- [ ] `email`
- [ ] `phone`
- [ ] `facebookPage`
- [ ] `website`
- [ ] `preferredContactMethod`
- [ ] `currentlyHasLiveMusic`
- [ ] `liveMusicNotes`
- [ ] `hasPlayedBefore`
- [ ] `totalGigsPlayed`
- [ ] `lastGigDate`
- [ ] `nextGigDate`
- [ ] `lastContactedDate`
- [ ] `lastContactMethod`
- [ ] `followUpDate`
- [ ] `retryAfterDate`
- [ ] `nextAction`
- [ ] `notes`
- [ ] `doNotContact`

### Sheet 2: ContactLog

Columns:

- [ ] `eventId`
- [ ] `venueSiteId`
- [ ] `date`
- [ ] `method`
- [ ] `direction`
- [ ] `summary`
- [ ] `result`
- [ ] `createdAt`

### Sheet 3: Gigs

Columns:

- [ ] `gigId`
- [ ] `venueSiteId`
- [ ] `venueName`
- [ ] `gigDate`
- [ ] `startTime`
- [ ] `endTime`
- [ ] `arrivalTime`
- [ ] `status`
- [ ] `address`
- [ ] `contactName`
- [ ] `contactPhone`
- [ ] `contactEmail`
- [ ] `setupNotes`
- [ ] `parkingNotes`
- [ ] `epkSent`
- [ ] `websiteSent`
- [ ] `promoFolderSent`
- [ ] `posterSent`
- [ ] `thankYouSent`
- [ ] `postGigNotes`

### Sheet 4: Settings

Columns:

- [ ] `key`
- [ ] `value`

Settings examples:

- [ ] `defaultEpkLink`
- [ ] `defaultWebsiteLink`
- [ ] `defaultMarketingFolderLink`
- [ ] `defaultPromoImagesFolderLink`
- [ ] `defaultSamplesLink`
- [ ] `homeBaseAddress`
- [ ] `initialFollowUpDelayDays`
- [ ] `ghostRetryDelayDays`

## MVP Implementation Phases

### Phase 0: Plan And Sandbox Setup

Goal: make experimentation safe before UI work begins.

- [x] Create this living plan.
- [x] Commit and push this plan to GitHub.
- [ ] Copy the master spreadsheet into a sandbox spreadsheet.
- [ ] Deploy Apps Script bridge to sandbox.
- [ ] Connect local config to sandbox.
- [ ] Verify sandbox read/write with a disposable row.
- [ ] Update this doc with sandbox status and validation notes.

### Phase 1: Stable Venue CRM

Goal: make the existing map/spreadsheet app into a stable venue tracker.

Build:

- [ ] Venue profile page.
- [ ] Status field.
- [ ] Priority label.
- [ ] Last contacted.
- [ ] Next action.
- [ ] Follow-up date.
- [ ] Notes.
- [ ] Contact buttons.
- [ ] Basic spreadsheet sync.

Do not build yet:

- [ ] AI personalization.
- [ ] Auto-email sending.
- [ ] Money tracking.
- [ ] Complex automation.

### Phase 2: Dashboard

Goal: make the app tell Dee Dee what to do today.

Build dashboard sections:

- [ ] Wants dates.
- [ ] Follow-ups due.
- [ ] New leads ready.
- [ ] Research needed.
- [ ] 60-day retries.
- [ ] Gigs needing prep.
- [ ] Post-gig thank-you needed.

This is the biggest practical value feature.

### Phase 3: Email Drafts

Goal: generate clean drafts that a human reviews and sends.

Build:

- [ ] Initial outreach draft.
- [ ] Follow-up draft.
- [ ] Available dates draft.
- [ ] Samples/EPK draft.
- [ ] Pre-gig marketing draft.
- [ ] Thank-you draft.
- [ ] Future dates ask.
- [ ] 60-day retry draft.

Actions:

- [ ] Copy subject/body.
- [ ] Open mailto.
- [ ] Mark as sent manually.
- [ ] Log contact event.

### Phase 4: Gig History

Goal: support multiple gigs per venue.

Build:

- [ ] Create gig.
- [ ] Upcoming gigs.
- [ ] Past gigs.
- [ ] Gig detail page.
- [ ] Link gigs to venue.
- [ ] Show full gig history on venue profile.

Important: this replaces simple `played before` tracking with real history.

### Phase 5: Pre-Gig And Post-Gig Checklists

Goal: make the app useful before and after performances.

Build:

- [ ] One-week-before prep tasks.
- [ ] Marketing materials checklist.
- [ ] Day-of info.
- [ ] Mark gig performed.
- [ ] Thank-you task.
- [ ] Rebooking logic.

### Phase 6: Smarter Ranking

Goal: make priority ranking more useful.

Build:

- [ ] Engagement-based ranking.
- [ ] Distance-based ranking.
- [ ] Manual overrides.
- [ ] Hot lead detection.
- [ ] Wants dates always on top.

### Phase 7: Future AI Assistant

Not now.

Later AI could:

- [ ] Personalize cold emails.
- [ ] Summarize venue websites.
- [ ] Suggest research line.
- [ ] Suggest best next action.
- [ ] Draft Dan Martell-style emails automatically.
- [ ] Score venue quality.
- [ ] Build daily outreach agenda.

Do not implement this until the normal template-based system is stable.

## Coding TODO List

- [ ] Add/confirm venue status enum.
- [ ] Add venue priority fields.
- [ ] Add `nextAction` and `nextActionDate`.
- [ ] Add outreach tracking fields.
- [ ] Add contact log data structure.
- [ ] Add gig data structure.
- [ ] Add venue profile UI sections.
- [ ] Add dashboard UI.
- [ ] Add status transition functions.
- [ ] Add email draft template functions.
- [ ] Add manual `mark sent` workflow.
- [ ] Add follow-up date calculation.
- [ ] Add 60-day retry calculation.
- [ ] Add pre-gig task creation.
- [ ] Add post-gig thank-you logic.
- [ ] Add gig history display.
- [ ] Add settings for global EPK/website/Drive links.
- [ ] Add ranking function.
- [ ] Add map pin color rules.
- [ ] Add spreadsheet sync fields.
- [ ] Add smoke tests for all status transitions.
- [ ] Add tests for multiple gigs per venue.
- [ ] Add tests that generating draft does not mark email as sent.
- [ ] Add tests that `wants dates` ranks above distance.
- [ ] Add tests that completed gig updates venue history.

## Validation Checklist

Run as relevant before each GitHub push:

- [ ] `npm run test:booking`
- [ ] `npm run test:smoke:jddm`
- [ ] Manual local UI smoke: Dashboard opens.
- [ ] Manual local UI smoke: Map pins render.
- [ ] Manual local UI smoke: Venue profile opens.
- [ ] Manual local UI smoke: Email draft copy works.
- [ ] Manual local UI smoke: Draft generation does not mark sent.
- [ ] Sandbox Sheet smoke: one row update writes to sandbox only.
- [ ] Sandbox Sheet smoke: map refreshes after sandbox write.

## Definition Of Done

For each implementation pass:

- [ ] The feature works against sandbox data.
- [ ] The master spreadsheet was not edited.
- [ ] Relevant tests pass or failures are documented here.
- [ ] This plan is updated with completed checkboxes.
- [ ] The AI completion area is updated.
- [ ] A focused commit is created.
- [ ] Finished work is pushed to GitHub.
- [ ] PR/link/commit is recorded in this plan.

## Final Product Description

The Just Dee Dee Music app should become a booking command center.

It should help Dee Dee:

- See venues on a map.
- Track who has been contacted.
- Know who needs follow-up.
- Know who replied and wants dates.
- Send available dates quickly.
- Keep full history of every gig at every venue.
- Prepare marketing materials before each gig.
- Thank venues after each performance.
- Ask for more dates when appropriate.
- Retry ghosted venues after 60 days.

The app should feel simple:

```text
Here is who to contact today.
Here is what to send.
Here is what is booked.
Here is what needs follow-up.
```
