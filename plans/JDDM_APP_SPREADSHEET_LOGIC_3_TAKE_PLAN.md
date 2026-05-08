# JDDM App Spreadsheet Logic - 3 Take Plan

Date: 2026-05-08

## Goal

Make the app behave like the friendly working layer on top of the cleaned Google Sheet.

The Sheet stays the durable storage layer. The app reads that data, recommends the most useful next work, and writes back only deliberate user edits.

## Non-Negotiable Rules

- `Status` is the only app-state and row-highlight authority.
- Calendar sync updates gig facts only: `Past Gigs`, `Future Gigs`, gig counts, `Last Played`, `Next Booked`, and `Last Synced`.
- Calendar sync must not change `Status`.
- App UI or manual sheet edits are the only normal ways to change `Status`.
- The app may recommend status changes, but it should not silently apply them.
- Sheet writes must be narrow patches, not full-row rewrites unless the user explicitly saves an editor form.

## Current Code Map

- Pin editor: `modules/venueEditModal.js`
- Spreadsheet bridge client: `services/spreadsheetService.js`
- Data normalization and map CSV load: `modules/dataService.js`
- Planner grouping and agenda ranking: `modules/bookingSchema.js`
- Planner UI/cards/tabs: `modules/bookingDashboard.js`
- Planner action writes: `modules/bookingActions.js`
- Sheet bridge script: `google-apps-script/jddm-spreadsheet-bridge/Code.gs`
- Planner HTML shell: `index.html`

## Take 1 - Pin CRM Editor

### Purpose

When Mom clicks a pin, she should be able to update the most important CRM fields without seeing the whole spreadsheet row.

### Editable Pin Fields

Show and save only:

- `Status`
- `Last Contacted`
- `Contact Name`
- `Email/Contact`
- `Phone Number`
- `Contact Type`
- `Next Follow Up`
- `Notes`

Keep place identity, address, coordinates, gig history, counts, and sync fields read-only or hidden in this editor.

### Implementation

- Update `modules/venueEditModal.js`.
- Replace the current full source-row editor with a focused CRM editor.
- Keep `service.getVenue(id)` as the source of truth when opening the editor.
- Save with `service.saveVenue({ id, rawFields })`, where `rawFields` contains only the eight editable fields.
- Use a dropdown for `Status`.
- Use date inputs for `Last Contacted` and `Next Follow Up`.
- Use text inputs for contact name, email, phone, and contact type.
- Use a textarea for `Notes`.
- After save, update the local venue object and refresh map/planner data.
- Preserve current slow-sheet status messages.

### Acceptance Checks

- Click a pin, edit `Status`, save, and confirm the Sheet updates only `Status`.
- Click a pin, edit contact fields, save, and confirm only the requested fields change.
- Green/yellow/red row highlighting follows the saved `Status`.
- Map played pin logic still treats only `Booked`, `Played in the Past`, and `Played in the Past - Awaiting Reply` as played.

### Tests

- Update `tests/venueEditModal.test.js`.
- Confirm only the eight editable headers render.
- Confirm save payload excludes identity, address, coordinate, and gig columns.

## Take 2 - Planner Algorithm And Daily Agenda

### Purpose

Planner should tell Mom what to do today without overwhelming her.

The Daily Agenda should have three lanes:

1. Reply/Catch-Up
2. New Places
3. Data Cleanup

### Reply/Catch-Up Lane

Target: up to 8 items, but it can show fewer.

Order:

1. Gmail reply detected from a venue that was previously emailed.
2. `Next Follow Up` is today or in the past.
3. Previously contacted venue with no reply and no scheduled follow-up.

Gmail rule:

- Use Gmail only as a read signal after explicit connector/OAuth approval.
- Do not auto-send.
- Do not change `Status` from Gmail alone.
- A Gmail reply should create a top agenda item saying the venue replied and needs review.
- Later action buttons can let Mom set `Status` to `Interested`, `Booked`, `Closed and Not Booking`, or another chosen state.

### New Places Lane

Target: top 3 suggested venues.

Inputs:

- `Status = Not Contacted Yet`
- Has usable contact info for its `Contact Type`
- Closer locations rank higher
- Higher `Priority` ranks higher
- Good venue types and fit can help, but distance and clean contact data matter first

Do not include:

- Highlighted final states
- `Needs Review`
- Closed/no/not interested states
- Already booked or played states

### Data Cleanup Lane

Target: 3 venues to clean up.

Inputs:

- `Status = Needs Review`
- Missing `Contact Name`
- `Contact Type` says email but `Email/Contact` has no email
- `Contact Type` says phone/call/text but `Phone Number` has no phone
- Missing important place data should also rank here if it affects map/planner quality

### Implementation

- Update `modules/bookingSchema.js`.
- Add explicit agenda builders:
  - `getReplyCatchUpAgenda(groups, gmailSignals, limit = 8)`
  - `getNewPlacesAgenda(groups, limit = 3)`
  - `getDataCleanupAgenda(groups, limit = 3)`
- Keep current groups for full tab lists.
- Add a Gmail signal adapter boundary, but do not couple planner logic directly to Gmail UI.
- Add sorting helpers for:
  - due date first
  - reply signal first
  - distance or map-center proximity
  - priority score
  - data completeness

### Acceptance Checks

- A venue with a Gmail reply appears at the top of Reply/Catch-Up.
- Due follow-ups fill the lane until the lane reaches 8.
- New Places shows up to 3 `Not Contacted Yet` venues with usable contact info.
- Data Cleanup shows up to 3 `Needs Review` venues.
- Agenda never silently changes `Status`.

### Tests

- Update `tests/bookingSchema.test.js`.
- Add tests for agenda lane limits and ordering.
- Add Gmail signal fixtures without requiring real Gmail during unit tests.

## Take 3 - Planner Sidebar Lists And Sheet Sync Polish

### Purpose

Planner should become a clean working sidebar/list system where each section is easy to scan and act on.

### Sections

Keep the tab/list idea, but clean the sections around actual Sheet states:

- Daily Agenda
- Past Gigs
- Booked
- Follow Ups
- New Prospects
- Needs Review
- Open Microphone
- Closed
- All Venues

### Past Gigs Section

Show:

- Place name
- Contact info
- `Past Gigs`
- `Past Gig Count`
- `Last Played`
- Current `Status`
- Update/Edit button

Use this for venues Mom has played before, especially places that may need rebooking.

### Booked Section

Show booked tiles with:

- Place name
- `Future Gigs`
- `Future Gig Count`
- `Next Booked`
- Contact info
- Notes
- Update/Edit button

### Follow Ups Section

Include every card with a `Next Follow Up` date.

Sort:

1. Past due
2. Today
3. Soonest future

### New Prospects Section

Use `Status = Not Contacted Yet`.

Prioritize:

- Usable contact method
- Closer to Mom/default map center
- Higher `Priority`
- Cleaner venue data

### Needs Review Section

Use `Status = Needs Review`.

Make the task clear: missing contact name, missing email, missing phone, unclear contact type, or other cleanup reason.

### Implementation

- Update `modules/bookingDashboard.js`.
- Adjust `TABS`.
- Render Daily Agenda as three compact lanes before the tab list.
- Update card metadata for each tab so it shows the fields that matter for that section.
- Keep edit buttons wired to the focused pin CRM editor from Take 1.
- Keep sheet health and sync status visible.

### Acceptance Checks

- Planner opens with the 3-lane agenda.
- Past Gigs and Booked cards show gig dates from the Sheet.
- Follow Ups includes all rows with `Next Follow Up`.
- New Prospects is driven by `Not Contacted Yet`.
- Needs Review is driven by `Needs Review`.
- Edit buttons open the same focused CRM editor as pin clicks.

### Tests

- Update `tests/bookingDashboardHealth.test.js`.
- Add/extend dashboard rendering tests for the new tabs and card fields.
- Run focused booking suite:

```bash
source ~/.nvm/nvm.sh && node --test tests/bookingSchema.test.js tests/venueEditModal.test.js tests/bookingActions.test.js tests/bookingDashboardHealth.test.js tests/spreadsheetService.test.js tests/dataServiceSyncStatus.test.js
```

## Later: Gmail Integration Notes

Gmail reply detection should be treated as a signal source, not the state machine.

Recommended data shape:

```js
{
  venueId: "dragonfly-winery-canal-fulton-oh-44614",
  signalType: "gmailReply",
  from: "booking@example.com",
  subject: "Re: Live acoustic music booking inquiry",
  receivedAt: "2026-05-08T10:15:00-04:00",
  snippet: "Yes, please send available dates..."
}
```

The planner can rank this signal first, but Mom still chooses what status to set.

## Definition Of Done For All 3 Takes

- The app can read from the cleaned Sheet.
- Pin editor can write the important CRM columns back to the Sheet.
- Planner agenda is understandable at a glance.
- Calendar sync can update gigs without disturbing status.
- `Status` remains the only highlight/app-state column.
- Tests pass for the changed modules.
