# Just Dee Dee Music Map + Booking Assistant Roadmap

## Current Architecture Assumptions

- The app is a static HTML/CSS/JS map app using Leaflet and global `window.BARK` namespaces retained from the original architecture.
- The active venue feed is `assets/data/jddm-venues.csv`, or `window.JDDM_VENUE_CSV_URL` when the live Google Apps Script bridge is configured.
- Spreadsheet writes currently go through `services/spreadsheetService.js` and `modules/venueEditModal.js`.
- The live sheet bridge is `google-apps-script/jddm-spreadsheet-bridge/Code.gs`.
- The old Firebase admin/refinery callables `extractParkData` and `syncToSpreadsheet` are disabled and must not become the booking CRM write path.
- Firebase Auth and Firestore are separate from BARK and configured through `config/firebaseConfig.local.js`, which must remain uncommitted.
- Paywall behavior is retired. Every signed-in or signed-out user gets full access to app features.
- Existing route planner, marker detail panel, search, map rendering, account shell, and spreadsheet edit modal should be preserved while booking features are added.

## Data Model Strategy

Do not rewrite the sheet in one risky pass. First add a schema adapter that can read current legacy headers and future booking headers. Then add missing columns to the Google Sheet in a controlled Apps Script migration.

### Stable ID

- Current sheet generated ID: `Site ID`
- App normalized ID: `id`
- Future preferred sheet alias: `venueId`
- Rule: every venue row must resolve to one stable ID before it can be edited, assigned a status, or used in dashboards.

### Required Venue Fields

| App Field | Current Sheet Alias | Future Sheet Header |
| --- | --- | --- |
| `id` | `Site ID` | `venueId` |
| `name` | `Place` parsed name | `venueName` |
| `address` | `Place` parsed address | `address` |
| `city` | `Place` parsed city | `city` |
| `state` | `Place` parsed state | `state` |
| `zip` | `Place` parsed zip | `zip` |
| `lat` | `Latitude` | `latitude` |
| `lng` | `Longitude` | `longitude` |
| `venueType` | inferred from name/type | `venueType` |
| `website` | `Website` | `website` |
| `bookingContact` | contact fields combined | split fields below |

### Booking CRM Fields

Add these as explicit columns after the existing generated columns when the bridge migration is ready:

- `contactName`
- `contactEmail`
- `contactPhone`
- `facebookUrl`
- `instagramUrl`
- `bookingUrl`
- `notes`
- `privateNotes`
- `lastContactedDate`
- `nextFollowUpDate`
- `contactStatus`
- `draftStatus`
- `priority`
- `bestFitScore`
- `preferredDays`
- `gigHistory`
- `eventDate`
- `eventTime`
- `isPrivateEvent`
- `doNotContact`
- `lastUpdated`

### Controlled Status Values

`contactStatus` values:

- `Not Contacted`
- `Draft Ready`
- `Sent`
- `Follow-Up Needed`
- `Interested`
- `Booked`
- `No Response`
- `Not a Fit`
- `Do Not Contact`

`draftStatus` values:

- `No Draft`
- `Draft Ready`
- `Copied`
- `Opened in Gmail`
- `Sent`
- `Needs Review`

### Data Rules

- Missing latitude/longitude should exclude a row from the map but keep it visible in `Missing Info`.
- Missing email should show `Missing contact info` and suppress email actions.
- `doNotContact` rows must not appear in outreach lists.
- Private events must be clearly marked before any dashboard filters hide them.
- Row number can be used only as a lookup fallback, never as the permanent ID.
- All dashboard writes must be idempotent and write only the intended row.

## Feature Phases

### Phase 0 - Stabilization

Goal: prove the current map and spreadsheet bridge are safe enough to build on.

Work:

- Confirm map loads from local CSV and live Apps Script CSV.
- Confirm marker detail panel opens with venue fields.
- Confirm `Update Spreadsheet` loads and saves a harmless test row.
- Confirm route planner still opens and generates routes where auth/API config allows.
- Confirm Firebase config points to Just Dee Dee only.
- Confirm no active code path writes to BARK Firebase or BARK spreadsheet.
- Add visible error and retry states for spreadsheet bridge failures.

Deliverable: stable beta map with verified read/write sync.

### Phase 1 - Schema Lock

Goal: make venue and booking fields predictable.

Work:

- Add `modules/bookingSchema.js` or equivalent constants for field names, statuses, draft statuses, and date rules.
- Update `modules/dataService.js` to normalize future booking columns while preserving current aliases.
- Update `google-apps-script/jddm-spreadsheet-bridge/Code.gs` to ensure booking columns exist without reordering existing data.
- Update `modules/venueEditModal.js` to show/edit the new booking fields safely.
- Add a schema health check response to Apps Script.

Deliverable: venue rows can carry stable booking CRM fields end to end.

### Phase 2 - Booking Dashboard MVP

Goal: give Dee Dee a daily operational view.

Work:

- Add a `Booking` tab or section to `index.html`.
- Add `modules/bookingDashboard.js`.
- Add dashboard tabs: `Today`, `Follow-Ups Due`, `New Prospects`, `Interested`, `Booked`, `Missing Info`, `Do Not Contact`.
- Add venue cards with map, website, email, booking link, note, and status actions.
- Keep dashboard derived from the same normalized venue array as the map.

Deliverable: Dee Dee can open one screen and see what to do next.

### Phase 3 - Rules-Based Agenda

Goal: create useful prioritization without AI.

Agenda order:

1. Interested venues with follow-up due.
2. Follow-ups overdue.
3. Previously contacted venues with no response.
4. High-fit uncontacted venues.
5. Missing-info venues worth researching.

Deliverable: `Today` tells Dee Dee what deserves attention first.

### Phase 4 - Email Template System

Goal: make outreach fast without Gmail API or AI.

Work:

- Add `modules/emailTemplates.js`.
- Add template types: first outreach, no-response follow-up, interested reply, rebooking, thank-you, private event reply, missing contact info note.
- Add copy subject, copy body, copy full email, open mailto draft, mark sent.
- Never include `privateNotes` in generated email text.

Deliverable: copy-ready outreach with human review.

### Phase 5 - Follow-Up Automation

Goal: keep the sheet organized as Dee Dee works.

Rules:

- `Mark Sent`: `lastContactedDate = today`, `nextFollowUpDate = today + 7`, `contactStatus = Sent`, `draftStatus = Sent`.
- `Mark Interested`: `contactStatus = Interested`, `nextFollowUpDate = today + 2`.
- `Mark Booked`: `contactStatus = Booked`, clear or set rebooking follow-up.
- `Do Not Contact`: `doNotContact = true`, `contactStatus = Do Not Contact`.

Deliverable: status buttons save reliable next steps.

### Phase 6 - Mobile and Client Polish

Goal: make the workflow comfortable on a phone.

Work:

- Large tap targets.
- No horizontal scrolling.
- Clear loading, saved, and failed states.
- Empty states for every dashboard tab.
- Confirmation for `Do Not Contact`.
- Last synced indicator.
- Unsaved changes warning in edit flows.

Deliverable: client-ready mobile workflow.

### Phase 7 - Test Harness

Goal: make demos repeatable.

Work:

- Keep syntax checks for modified JS.
- Add Playwright smoke tests for map load, marker open, dashboard load, mobile layout, email template rendering.
- Add Apps Script bridge manual checklist.
- Add rebrand/security grep checks.

Deliverable: pre-demo checklist and automated smoke coverage.

### Phase 8 - Optional Gmail Draft Integration

Goal: create drafts only, with human approval.

Rules:

- Use Gmail API OAuth only.
- Do not scrape Gmail.
- Do not store passwords.
- Do not auto-send.
- Create draft, open draft, mark draft created.

Deliverable: one-click Gmail draft creation after OAuth.

### Phase 9 - Optional AI Layer

Goal: improve drafting and prioritization after the rules-based version works.

Rules:

- AI drafts only.
- Human reviews and sends.
- Do not send whole spreadsheet.
- Do not include private notes unless explicitly allowed.

Deliverable: AI-assisted agenda and personalized draft preview.

### Phase 10 - Production Handoff

Goal: make the app maintainable without developer babysitting.

Work:

- Deployment steps.
- Backup process.
- Spreadsheet bridge instructions.
- Client guide.
- Known limitations.
- Recovery steps.

Deliverable: client operating manual.

## Files Likely To Edit

| File | Purpose | Risk |
| --- | --- | --- |
| `modules/dataService.js` | Normalize new booking fields from CSV | High, affects all pins |
| `google-apps-script/jddm-spreadsheet-bridge/Code.gs` | Read/write sheet rows and ensure columns | P0, data loss risk |
| `services/spreadsheetService.js` | Browser bridge client | High, write path |
| `modules/venueEditModal.js` | Existing edit UI | Medium-high, live save flow |
| `index.html` | Add Booking dashboard shell | Medium, layout risk |
| `styles.css` | Dashboard/mobile styles | Medium |
| `renderers/panelRenderer.js` | Marker details and booking entry points | Medium |
| `modules/searchEngine.js` | Dashboard search reuse | Medium |
| `engines/tripPlannerCore.js` | Keep route planner unaffected | Medium |
| `package.json` | Add safe smoke commands | Low-medium |
| `tests/playwright/*` | Add regression tests | Low |
| `docs/JDDM_SPREADSHEET_BRIDGE_SETUP.md` | Document new sheet columns and setup | Low |

## Risks

- Wrong sheet writes: protect by stable `venueId`/`Site ID` lookup and explicit test row.
- Column drift: Apps Script should ensure headers and return schema health.
- Hidden BARK paths: keep grep checks before demo and deploy.
- Spreadsheet contact data exposure: decide whether checked-in CSV with contact info should remain public.
- Browser-visible edit token: acceptable for prototype only; not real security.
- Dashboard overbuild: start with read-only derived lists before adding write buttons.
- Mobile crowding: dashboard cards need compact, non-nested layout.
- Obsolete premium tests: keep paywall-retired test path separate from active smoke tests.

## Testing Plan

### Automated Checks

- `git diff --check`
- `node --check modules/dataService.js`
- `node --check modules/venueEditModal.js`
- `node --check services/spreadsheetService.js`
- `node --check google-apps-script/jddm-spreadsheet-bridge/Code.gs` is not supported directly; manually lint Apps Script changes.
- `node --test functions/tests/checkout-session.test.js`
- `npm run test:e2e:premium`
- Add new `npm run test:e2e:jddm-smoke` after dashboard exists.

### Manual Smoke

- Open map locally on a port that is not serving BARK.
- Confirm title is `Just Dee Dee Music Live Map`.
- Confirm no visible `BARK Ranger` copy.
- Confirm venue markers render.
- Open a marker.
- Open spreadsheet edit modal.
- Refresh source row.
- Edit harmless field.
- Save.
- Confirm Google Sheet row changes.
- Confirm map refreshes from sheet.
- Confirm mobile viewport works.
- Confirm route planner opens.
- Confirm email template copy works after Phase 4.

### Rebrand/Security Greps

```bash
rg -n "barkrangermap|bark-ranger-map|BARK Ranger|AIza[0-9A-Za-z_-]+" --glob '!node_modules/**'
rg -n "syncToSpreadsheet|extractParkData" functions pages modules services --glob '!node_modules/**'
rg -n "LEMONSQUEEZY|paywall-title|Upgrade" index.html modules services tests package.json --glob '!node_modules/**'
```

## Rollback Plan

- Keep each phase in its own commit.
- Before Apps Script changes, duplicate the Google Sheet or export CSV backup.
- Before schema migration, run bridge `health` and `schema` actions against a copied sheet first.
- If dashboard breaks, remove only the dashboard script/tag and leave map/spreadsheet edit path intact.
- If sheet writes fail, unset `window.JDDM_SPREADSHEET_API_URL` and fall back to checked-in CSV while debugging.
- If route planner breaks, revert only route-related changes and keep booking dashboard read-only.

## Issue Tracker

| ID | Feature / Task | Priority | Phase | Status | Acceptance Criteria |
| --- | --- | --- | --- | --- | --- |
| JDDM-001 | Confirm no BARK Firebase references | P0 | 0 | Open | Search finds no old project/config writes |
| JDDM-002 | Confirm spreadsheet read/write sync | P0 | 0 | Open | App reads and updates one test row correctly |
| JDDM-003 | Lock venue ID system | P0 | 1 | Open | Every row has stable unique `venueId` or `Site ID` |
| JDDM-004 | Add contactStatus support | P0 | 1 | Open | App reads/writes `contactStatus` |
| JDDM-005 | Add nextFollowUpDate support | P0 | 1 | Open | Follow-up date saves and reloads |
| JDDM-006 | Add Booking Dashboard tab | P1 | 2 | Open | User can open Booking section without disturbing map |
| JDDM-007 | Add Follow-Ups Due list | P1 | 3 | Open | Due venues appear correctly and exclude booked/DNC |
| JDDM-008 | Add New Prospects list | P1 | 3 | Open | Not-contacted venues with email appear |
| JDDM-009 | Add email template renderer | P1 | 4 | Open | Template fills venue variables safely |
| JDDM-010 | Add copy email button | P1 | 4 | Open | Email copies to clipboard with success feedback |
| JDDM-011 | Add mailto draft button | P1 | 4 | Open | Mail client opens populated draft |
| JDDM-012 | Add Mark Sent action | P1 | 5 | Open | Status/date update writes to sheet |
| JDDM-013 | Add Mark Interested action | P1 | 5 | Open | Status/follow-up update writes |
| JDDM-014 | Add Mark Booked action | P1 | 5 | Open | Venue moves to Booked list |
| JDDM-015 | Add Do Not Contact action | P1 | 5 | Open | Venue excluded from outreach lists |
| JDDM-016 | Add mobile smoke test | P1 | 6 | Open | Dashboard usable at 390px width |
| JDDM-017 | Add error/loading states | P1 | 6 | Open | Failed sheet writes show useful recovery message |
| JDDM-018 | Add regression checklist | P1 | 7 | Open | Repeatable pre-demo checklist exists |
| JDDM-019 | Gmail API draft creation | P3 | 8 | Backlog | Draft appears in Gmail after OAuth |
| JDDM-020 | AI daily agenda | P3 | 9 | Backlog | AI summarizes top tasks with preview only |
| JDDM-021 | Contact info privacy decision | P0 | 0 | Open | Decide whether contact CSV can remain in repo |
| JDDM-022 | Apps Script schema health check | P0 | 1 | Open | Bridge returns expected columns and schema version |
| JDDM-023 | Read-only dashboard first pass | P1 | 2 | Open | Lists derive from venue data without writing anything |
| JDDM-024 | Status update write adapter | P1 | 5 | Open | One function writes booking fields by venue ID |
| JDDM-025 | Client guide | P2 | 10 | Open | Non-technical workflow doc exists |

## Bug Tracker Categories

- Data Sync
- Map
- Spreadsheet Bridge
- Booking Dashboard
- Email Templates
- Mobile
- Auth
- Firebase
- Rebrand
- Performance
- Security/Privacy

## Recommended First Coding Pass

Do not start by building the whole dashboard. Start with the adapter layer.

1. Add `modules/bookingSchema.js` with field names, status constants, draft status constants, date helpers, and dashboard predicates.
2. Load it before `modules/dataService.js`.
3. Update `modules/dataService.js` to normalize booking fields from both current and future sheet headers.
4. Add a read-only console/debug summary for counts: follow-ups due, new prospects, interested, booked, missing info, do not contact.
5. Add unit-like browser-free tests for date/status predicates if practical.
6. Do not write to the sheet in this pass.

Acceptance for first pass:

- Existing map still loads.
- Existing spreadsheet edit modal still saves.
- Normalized venue objects include booking fields with safe defaults.
- No dashboard UI exists yet, or it is hidden behind a simple feature flag.
- No schema migration has touched the live sheet.
