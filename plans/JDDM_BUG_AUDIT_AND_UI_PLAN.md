# Just Dee Dee Music Map Bug Audit and UI Plan

Date: 2026-05-04
Audited commit: `b53f293`
Scope: Just Dee Dee Music Map copied project only.
Primary app path: `/Users/carterswarm/Just-Dee-Dee-Music-Map`
Live target observed: `https://outswarming.github.io/Just-Dee-Dee-Music-Map/`
Spreadsheet bridge observed: `https://script.google.com/macros/s/AKfycbyeskUlFOAAfBKjhVtHpDHfjKn_SOfzaN0CIorRvyRirS_hTzTjjwf5w5gB2qs9yiw8/exec`

## Executive Summary

The app is usable enough to continue prototype iteration, and the first critical bug batch is now fixed. The largest original risk was the data pipeline: the map could cold-boot with zero pins when the Google Apps Script spreadsheet bridge took longer than the background timeout and there was no cached sheet data on the device. That path now has a packaged CSV fallback, so a slow sheet bridge no longer makes the map look empty on first load.

The second major risk was test and product-policy drift. The frontend and functions code say Just Dee Dee Music includes full access for every signed-in user, while old ORS tests still expected premium-gated rejection. That mismatch is now resolved in favor of the current JDDM product policy: signed-in users get route/geocode access, unauthenticated users are still rejected, and stale entitlement docs no longer control this copied prototype.

The new highest practical risk is signed-in QA coverage. The full signed-in Playwright smoke now opens a map with pins, but the stored auth states do not produce a Firebase `currentUser` for the current Just Dee Dee Firebase project. That blocks account/profile/settings regression coverage until fresh JDDM storage states are created.

The longer-tail risk is migration debt from the BARK Ranger app. There are still visible and semi-visible BARK, park, trail, expedition, premium, trophy, and leaderboard concepts in code and UI. Some are harmless internal names, but several are likely user-facing or tester-facing and will make this feel like a copied product rather than a focused music booking map.

The best next product direction is a map-first operations UI: fast local map load, visible sheet sync status, clear played/not-played filters, a bottom-sheet venue card, and a single spreadsheet-backed editor. The spreadsheet should remain the source of truth, but the app needs a resilient cache and better status messaging so a slow sheet bridge does not look like a broken map.

## Confidence Scale

| Confidence | Meaning |
|---:|---|
| 95-100% | Reproduced by test/runtime probe or directly contradicted by code. |
| 80-94% | Strong static evidence and likely user impact, but not fully reproduced in all browsers/devices. |
| 60-79% | Plausible bug or risk based on code pattern; needs targeted reproduction before fixing. |
| 40-59% | Suspicion only; document but do not fix without more evidence. |

## Severity Scale

| Severity | Meaning |
|---|---|
| P0 | Blocks the app from working or risks data loss/security. |
| P1 | Major beta blocker or release-confidence blocker. |
| P2 | Visible UX defect or confusing workflow with a workaround. |
| P3 | Polish, maintainability, or low-risk cleanup. |

## Audit Methods

I used static search, local runtime probing, and automated tests.

Commands and checks used:

```bash
pwd
git status --short
git rev-parse --short HEAD
npm test
npm --prefix functions test
rg -n "JDDM_VENUE_CSV_URL|VENUE_CSV_URL|timeoutMs|pollForUpdates|runDataPollCycle|Data poll timed out|cached" modules/dataService.js modules/barkConfig.js config/firebaseConfig.example.js index.html version.json modules/barkState.js
rg -n "BARK|B\\.A\\.R\\.K|Ranger|park|parks|premium|Lemon|paywall|trail|expedition|Trophy|leaderboard" index.html modules services renderers repos state core functions -g '*.js' -g '*.html'
rg -n "alert\\(|confirm\\(|prompt\\(" index.html modules services renderers repos state core -g '*.js' -g '*.html'
rg -n "innerHTML\\s*=|insertAdjacentHTML|outerHTML\\s*=|template" index.html modules services renderers repos state core -g '*.js' -g '*.html'
```

Runtime observation:

- Local app served at `http://localhost:4173/index.html`.
- On a cold/no-cache runtime probe, `window.BARK.repos.ParkRepo.getAll().length` stayed at `0` after waiting.
- Console included: `Data poll timed out after 6s; backing off...`
- Network included aborted Apps Script CSV requests.
- Map object existed and rendered, but marker data did not arrive.

## Automated Test Results

| Test Command | Result | Notes |
|---|---|---|
| `npm test` | PASS 50/50 | Includes data sync fallback regression tests. |
| `npm --prefix functions test` | PASS 54/54 | ORS tests now match the current JDDM full-access policy for signed-in users. |
| `npm run test:functions:emulator` | PASS 9/9 | Emulator discovery timeout raised to 30 seconds; callable behavior matches full-access policy. |
| `npm run test:rules` | PASS 17/17 | Rules suite still passes. |
| Focused cold-start browser probe | PASS | With Apps Script blocked and no cache, packaged fallback loaded 503 pins. |
| Signed-in `npm run test:e2e:smoke` with storage env | FAIL 7/7 | Map has pins, but tests time out waiting for Firebase `currentUser`; storage states appear stale/invalid for the current JDDM Firebase project. |

## Bug Inventory

| ID | Title | Severity | Confidence | Status | Evidence | Likely Owner |
|---|---|---|---:|---|---|---|
| JDDM-BUG-001 | Empty map on cold boot when Apps Script CSV takes longer than background timeout | P0/P1 | 95% | FIXED / QC PASSED | Packaged CSV fallback now loads when sheet polling times out; focused browser probe loaded 503 pins with Apps Script blocked. | `modules/dataService.js`, `tests/dataServiceSyncStatus.test.js` |
| JDDM-BUG-002 | Functions ORS entitlement unit tests fail because product policy changed to full access | P1 | 98% | FIXED / QC PASSED | `npm --prefix functions test` now passes 54/54 with signed-in full-access expectations. | `functions/tests/ors-entitlement.test.js` |
| JDDM-BUG-003 | Functions emulator callable tests fail for same premium/full-access mismatch | P1 | 95% | FIXED / QC PASSED | `npm run test:functions:emulator` now passes 9/9 after aligning callable expectations and increasing discovery timeout. | `functions/tests/ors-callable-emulator.test.js`, `package.json` |
| JDDM-BUG-004 | App version labels disagree across files | P2/P3 | 95% | Proven static | `version.json` is `1`, index label starts at `12`, `barkState.js` defaults to `26`. | `version.json`, `index.html`, `modules/barkState.js` |
| JDDM-BUG-005 | Legacy BARK, park, trail, premium, trophy, leaderboard language remains | P2 | 90% | Proven static | Static scan found many old product concepts, including user-facing expedition and leaderboard sections. | `index.html`, `modules/*`, `functions/index.js` |
| JDDM-BUG-006 | Profile still contains old gamification and expedition product model | P2 | 80% | Static/product risk | Profile has expedition, trophy case, leaderboard, trail language. May be unrelated to JDDM workflow. | `index.html`, `modules/expeditionEngine.js`, `modules/profileEngine.js` |
| JDDM-BUG-007 | Native `alert`, `confirm`, and `prompt` calls interrupt mobile workflows | P2 | 85% | Proven static | Dozens of blocking browser dialogs found in map, settings, search, profile, expedition, share. | `renderers/panelRenderer.js`, `modules/settingsController.js`, `modules/searchEngine.js`, others |
| JDDM-BUG-008 | Dynamic `innerHTML` use needs spreadsheet-data escaping audit | P1/P2 | 70% | Needs targeted review | Many dynamic HTML assignments exist; some escape, some need line-by-line proof. | `modules/venueEditModal.js`, `modules/bookingDashboard.js`, `renderers/panelRenderer.js`, others |
| JDDM-BUG-009 | No first-class user-facing state for slow sheet updates on cold boot | P1/P2 | 90% | Reproduced as UX layer | Current sync status helps manual connect, but cold background load can leave an empty map. | `modules/dataService.js`, UI sync status elements |
| JDDM-BUG-010 | Production config is named `firebaseConfig.example.js` | P2 | 85% | Proven static | `index.html` loads `config/firebaseConfig.example.js`; `.local` is ignored/excluded. Naming causes setup confusion. | `index.html`, `config/*`, docs |
| JDDM-BUG-011 | E2E smoke command skips without env, hiding signed-in/runtime risk | P2/P3 | 95% | Proven earlier | Existing Playwright smoke requires base URL and storage-state env vars; casual run can skip. | `package.json`, Playwright specs |
| JDDM-BUG-012 | Firebase CLI warns current Java will soon be unsupported | P3 | 80% | Observed earlier | Emulator warning says Firebase CLI 15 will require Java 21+. Local Java observed as 18. | local dev environment/docs |
| JDDM-BUG-013 | BARK namespace and repo names remain everywhere | P3 | 100% | Proven static | `window.BARK`, `ParkRepo`, `BARK.config` still own JDDM runtime. | global architecture |
| JDDM-BUG-014 | Old disabled payment/paywall code remains in fork | P2/P3 | 80% | Proven static | `paywallController` retired shim, checkout callable disabled, Lemon tests remain. | `modules/paywallController.js`, `functions/index.js`, tests |
| JDDM-BUG-015 | Route/geocode backend behavior is ambiguous for the JDDM product | P1 | 90% | Proven by tests/code mismatch | If full access is intended, tests are wrong. If gating is intended, backend is wrong. | Product decision plus functions/tests |
| JDDM-BUG-016 | Cold data path has no packaged CSV fallback when configured sheet URL fails | P1 | 90% | Proven static/runtime | `BARK.config.VENUE_CSV_URL` prefers Apps Script URL and does not fall back to `assets/data/jddm-venues.csv` on timeout. | `modules/barkConfig.js`, `modules/dataService.js` |
| JDDM-BUG-017 | Search/edit/card behavior cannot be trusted until cold data load is fixed | P2 | 75% | Derived risk | With no marker records, pin card and update flows cannot be exercised reliably. | downstream UI |
| JDDM-BUG-018 | User-facing error copy still references old/full-access/premium concepts inconsistently | P2 | 75% | Static/product risk | Some components say full access, others retain premium naming, old functions still talk entitlement. | UI/services/functions |
| JDDM-BUG-019 | Signed-in Playwright storage states are stale for the JDDM Firebase project | P1 | 95% | REPRODUCED | Signed-in smoke with env fails 7/7 waiting for `firebase.auth().currentUser`, while pins render. | `playwright/.auth/*`, Playwright auth setup/docs |

## Detailed Findings

### JDDM-BUG-001: Empty Map on Cold Boot When Sheet Bridge Is Slow

Severity: P0/P1
Confidence: 95%

What happened:

- The map itself initialized.
- The dataset did not load.
- `ParkRepo.getAll().length` stayed at `0`.
- Runtime console warned that the data poll timed out after 6 seconds.
- Apps Script requests were aborted.

Why this matters:

If a new user opens the map on a fresh device, the map can look broken even though the tile layer is fine. The app currently depends too heavily on the live Apps Script bridge being fast enough on first load.

Evidence:

```text
config/firebaseConfig.example.js:19
window.JDDM_VENUE_CSV_URL = `${window.JDDM_SPREADSHEET_API_URL}?action=csv&autofill=0`;

modules/barkConfig.js:50
window.BARK.config.VENUE_CSV_URL = window.JDDM_VENUE_CSV_URL || 'assets/data/jddm-venues.csv';

modules/dataService.js:560
const timeoutMs = options.userInitiated ? 30000 : 6000;
```

The fallback CSV exists:

```text
assets/data/jddm-venues.csv
size: about 109 KB
```

Expected behavior:

- If live sheet fetch is fast, use it.
- If live sheet fetch is slow and cached sheet data exists, show cached data and a status chip.
- If live sheet fetch is slow and no cached sheet data exists, load the packaged CSV immediately, then keep checking the sheet in the background.
- If the user presses Connect/Refresh Spreadsheet, show an explicit "Checking for updates..." state and keep the long timeout.

Fix implemented:

1. Added a packaged CSV fallback path in `dataService`.
2. On initial background load with no cache, the app starts packaged fallback immediately while sheet polling continues in the background.
3. Manual spreadsheet refresh still uses the longer Apps Script path and does not silently fall back to the packaged CSV.
4. Sync status now preserves the actual source label, including `Packaged CSV fallback` and `Manual Refresh`.
5. Added regression tests for:
   - no cache + sheet timeout still renders packaged markers
   - existing cache avoids packaged fallback when sheet polling fails
   - manual refresh uses the `autofill=1` sheet endpoint without packaged fallback

QC evidence:

```text
node --test tests/dataServiceSyncStatus.test.js
5 pass
0 fail
```

Cold-start browser probe with Apps Script requests blocked:

```json
{
  "count": 503,
  "status": {
    "hasCachedData": true,
    "source": "Packaged CSV fallback"
  },
  "first": "1285 Winery"
}
```

This fixed the blank-map cold-start path without making every boot wait 30 seconds.

### JDDM-BUG-002 and JDDM-BUG-003: ORS Tests Fail Because Full-Access Policy and Old Premium Tests Disagree

Severity: P1
Confidence: 98%

Original failing test result:

```text
npm --prefix functions test
49 pass
5 fail
```

Failing tests:

- `rejects signed-in free users`
- `rejects malformed and inactive premium entitlements`
- `allows premium manual override users`
- `rejects free route requests before ORS is called and ignores client isPremium`
- `rejects free geocode requests before ORS is called and ignores client isPremium`

Static code evidence:

```text
services/premiumService.js:10
status: 'included'

modules/paywallController.js:4
Just Dee Dee Music Live Map includes full access for every user.

functions/index.js:121
status: "included"
```

Interpretation:

This is not a random test failure. It is a product-policy mismatch.

Decision implemented: full access is intended for this JDDM prototype.

Signed-in users are allowed to reach route/geocode behavior, regardless of stale or malformed old entitlement docs. Unauthenticated callers are still rejected. The tests now describe that policy directly instead of carrying over old BARK premium expectations.

Fix implemented:

- Updated ORS entitlement unit tests to assert signed-in included access.
- Updated callable emulator tests to assert signed-in route/geocode calls reach the stubbed ORS path.
- Preserved unauthenticated rejection coverage.
- Preserved manual override coverage as a compatible included path.
- Increased the Functions emulator discovery timeout to 30 seconds so local function discovery does not fail before assertions run.

QC evidence:

```text
npm --prefix functions test
54 pass
0 fail

npm run test:functions:emulator
9 pass
0 fail
```

### JDDM-BUG-004: Version Labels Disagree

Severity: P2/P3
Confidence: 95%

Evidence:

```text
version.json -> { "version": 1 }
index.html -> Just Dee Dee Music Live Map v12
modules/barkState.js -> localStorage default jddm_seen_version || '26'
```

Impact:

This will confuse debugging, tester reports, and cache-busting conversations. If someone says "I am on v12" while runtime logs say v26 and `version.json` says 1, support gets messy.

Recommended fix:

- Make `version.json` the one source of truth.
- Set the visible version only after loading `version.json`.
- If version fetch fails, show a safe fallback like `local`.
- Remove hardcoded `12` and `26` defaults unless deliberately documented.

### JDDM-BUG-005 and JDDM-BUG-006: Legacy Product Language and Old Profile Model Remain

Severity: P2
Confidence: 90% for legacy language, 80% for profile mismatch

Evidence examples:

```text
core/app.js -> B.A.R.K. Boot Sequence
index.html -> premium-filters-wrap, premium-trail-controls
index.html -> Experience America's greatest trails right from your neighborhood.
index.html -> expedition trophy case
index.html -> leaderboard
repos/ParkRepo.js -> Canonical park record repository
functions/index.js -> Legacy BARK admin extraction disabled
```

Impact:

The app can work technically while still feeling like a copied park app. That is especially risky for a prototype where trust matters: the user should feel this was made for booking music venues, not retrofitted from a different domain.

Recommended fix:

- Keep internal namespaces until a deliberate refactor is worth it.
- Immediately clean user-facing labels, modals, settings labels, profile sections, console-visible support text, and tester docs.
- Replace "parks" with "venues" in UI copy.
- Replace "visited" with "played" where the user-facing concept is gig history.
- Replace "trip/planner" copy with "booking route" or "booking day" only where it matches actual behavior.

### JDDM-BUG-007: Native Browser Dialogs Are Overused

Severity: P2
Confidence: 85%

Evidence:

Many `alert`, `confirm`, and `prompt` calls remain in:

- `renderers/panelRenderer.js`
- `modules/settingsController.js`
- `modules/searchEngine.js`
- `modules/expeditionEngine.js`
- `services/firebaseService.js`
- `modules/shareEngine.js`
- `modules/profileEngine.js`

Impact:

Native dialogs block the UI, look rough on mobile, can be missed in browser permission states, and make workflows feel inconsistent. They are acceptable for quick debugging, but not for a polished one-person operations app.

Recommended fix:

- Add one app-level toast/dialog helper.
- Use non-blocking toast for success.
- Use app modal for destructive confirmation.
- Use in-form validation for spreadsheet row edits.
- Leave native dialogs only for emergency fallback.

### JDDM-BUG-008: Dynamic HTML Needs a Spreadsheet-Data Escaping Audit

Severity: P1/P2
Confidence: 70%

Evidence:

The code uses dynamic `innerHTML` in many places:

- `modules/venueEditModal.js`
- `modules/bookingDashboard.js`
- `renderers/panelRenderer.js`
- `modules/searchEngine.js`
- `renderers/routeRenderer.js`
- `modules/profileEngine.js`
- `modules/shareEngine.js`

Some code paths escape values, but the app now treats a spreadsheet as the source of truth. Spreadsheet rows can contain venue names, notes, websites, booking contacts, and user-entered edits. Any unescaped insertion from those fields can become broken HTML at minimum and script injection at worst.

Recommended fix:

- Audit each dynamic HTML block.
- Prefer DOM creation and `textContent`.
- Where templates are still used, require `escapeHtml` on every spreadsheet-derived value.
- Add tests with venue names like:
  - `<b>Venue</b>`
  - `"quoted" & ampersand`
  - `<img src=x onerror=alert(1)>`

### JDDM-BUG-009 and JDDM-BUG-016: Slow Sheet State Needs a First-Class UX

Severity: P1/P2
Confidence: 90%

The user already noticed that Connect to Spreadsheet can take a long time. That is not automatically a design flaw if Apps Script is slow, but the UI needs to explain the state.

Expected user-facing states:

- `Using saved venue data`
- `Checking spreadsheet for updates`
- `Spreadsheet is taking longer than usual`
- `Map updated from spreadsheet`
- `Could not reach spreadsheet. Showing saved data.`

Recommended behavior:

- Initial load should never show a blank map if packaged data exists.
- Manual Connect should show a loading state immediately.
- If the check exceeds a threshold, keep showing progress rather than looking stuck.
- When the live sheet finally returns, update pins in place and show a small success toast.

### JDDM-BUG-010: Config Naming Is Confusing

Severity: P2
Confidence: 85%

Evidence:

```text
index.html loads config/firebaseConfig.example.js
.gitignore ignores config/firebaseConfig.local.js
firebase.json excludes config/firebaseConfig.local.js from hosting
```

This works, but it reads backwards: the live hosted app loads an `example` config, while the more official-sounding `local` config is ignored and excluded.

Recommended fix:

- Rename hosted public config to `config/firebaseConfig.public.js`.
- Keep `config/firebaseConfig.local.js` for local overrides if needed.
- Update setup docs to say that Firebase web config values are public identifiers, while service keys and secrets must never be committed.

### JDDM-BUG-011: E2E Smoke Can Skip Too Easily

Severity: P2/P3
Confidence: 95%

The app has valuable Playwright specs, but some require environment variables and storage states. A casual run can skip the most meaningful signed-in checks.

Recommended fix:

- Add `npm run test:e2e:smoke:signed-in` that fails fast if env vars/storage states are missing.
- Keep the current skip-friendly command for CI/dev convenience.
- Add a short `docs/TESTING.md` with the exact env block.

Current signed-in smoke result:

The signed-in smoke was rerun with the expected env vars:

```bash
BARK_E2E_BASE_URL=http://localhost:4173/index.html
BARK_E2E_STORAGE_STATE="$PWD/playwright/.auth/free-user.json"
BARK_E2E_STORAGE_STATE_B="$PWD/playwright/.auth/free-user-b.json"
BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/playwright/.auth/premium-user.json"
npm run test:e2e:smoke
```

Result:

```text
FAIL 7/7
```

The failures are not the old blank-map failure. The page snapshot showed many venue pin buttons, but every signed-in spec timed out waiting for `firebase.auth().currentUser`. That points to stale or invalid Playwright storage states for the current Just Dee Dee Firebase project.

### JDDM-BUG-019: Signed-In Storage States Are Stale for the JDDM Firebase Project

Severity: P1
Confidence: 95%

What happened:

- The app loaded.
- Venue pins rendered.
- The signed-in tests waited for Firebase Auth to report `currentUser`.
- `currentUser` never appeared before the timeout.

Evidence:

```text
Signed-in npm run test:e2e:smoke
FAIL 7/7
Timeout waiting for firebase.auth().currentUser
```

Likely cause:

The storage state files were created during earlier BARK/premium work or before the Just Dee Dee Firebase setup stabilized. Browser storage can exist while Firebase Auth still cannot restore a valid session for the current `just-dee-dee-music-map` project.

Expected fix:

1. Recreate `playwright/.auth/free-user.json` against the Just Dee Dee Firebase project.
2. Recreate `playwright/.auth/free-user-b.json` with a distinct second account.
3. Recreate any needed signed-in/admin/editor state.
4. Keep all auth JSON files ignored and uncommitted.
5. Rerun signed-in smoke.

Do not confuse this with the map data fallback: the data fallback now works, and the failing smoke is specifically an auth-state restoration problem.

### JDDM-BUG-012: Firebase Emulator Java Warning

Severity: P3
Confidence: 80%

Firebase CLI warned that future versions will require Java 21+. This is not a product bug today, but it will become a tooling bug later.

Recommended fix:

- Add Java 21 to local setup notes.
- Avoid upgrading Firebase CLI blindly until the team is ready.

### JDDM-BUG-013: Internal Names Still Say BARK and ParkRepo

Severity: P3
Confidence: 100%

This is not the first thing to fix. Internal namespace cleanup can be expensive and risky. But it makes the code harder for future maintainers to reason about.

Recommended approach:

- Do not broad-refactor now.
- Rename only user-facing copy first.
- Later, move toward aliases like `window.JDDM` and `VenueRepo`, while keeping compatibility wrappers if needed.

### JDDM-BUG-014 and JDDM-BUG-015: Old Payment/Premium Objects Remain in a Full-Access Fork

Severity: P1/P2 depending on product decision
Confidence: 90%

The code currently contains:

- disabled checkout callable
- full-access premium service
- old Lemon Squeezy tests
- ORS premium helper names
- old premium UI classes

This is okay only if the app has a documented "full access included" policy. If the app might later become paid again, the current state needs to be very explicit so nobody accidentally assumes the old BARK premium model still protects routes.

Recommended fix:

- Add `plans/JDDM_PRODUCT_POLICY.md`.
- State whether routing/geocode/full map features are free in this prototype.
- Make tests match that policy.

## Research-Backed UI Principles

The UI plan below is grounded in a few durable usability principles:

1. Visibility of system status.
   Nielsen Norman Group's heuristics emphasize keeping users informed about what is happening with timely feedback. For this app, spreadsheet sync status must always be visible when data is loading, stale, slow, or updated.

2. Match the user's real world.
   The same NN/g guidance says interfaces should use the user's language. JDDM users need venue, booking, played, follow-up, and spreadsheet terms, not park, ranger, trail, expedition, or premium terminology.

3. User control and freedom.
   Users need clear exits from modals, bottom sheets, editors, and sync states. The venue editor should always support cancel, save, and close without trapping the user.

4. Recognition over recall.
   Important state should be visible on pins, cards, and filters. The user should not have to remember whether a venue has been played, contacted, booked, or missing information.

5. Target sizes and mobile comfort.
   WCAG 2.2 target-size guidance sets a minimum baseline for pointer targets. For this app, use larger practical mobile targets, about 44px where possible, because the core user will work quickly on a phone.

6. Navigation should serve top-level tasks.
   Material Design navigation-bar guidance supports bottom navigation for top-level destinations on mobile. The current bottom nav can work, but each tab should be tightly tied to a real JDDM task.

7. Progress feedback should be explicit.
   Material Design progress-indicator guidance supports using progress feedback when a process is ongoing. For sheet sync, use determinate language when possible and indeterminate loading when timing is unknown.

Sources are linked in the final Sources section.

## Optimal UI Plan

### UI North Star

This should feel like a lightweight booking operations map for one working musician, not a consumer travel game.

The first screen should answer:

- Where are the venues?
- Which ones have been played?
- Which ones need booking follow-up?
- What should I do next?
- Is the spreadsheet synced?

### Recommended Top-Level Navigation

Keep 4 primary tabs:

| Tab | Purpose | Notes |
|---|---|---|
| Map | Live venue map and filters | Default landing tab. |
| Planner | Today's booking work and route list | Rename copy away from trip planning if the workflow is booking. |
| Data | Spreadsheet-backed row editor and sync health | One editor, not duplicate blank/editor sections. |
| Settings | Account, sync, display, advanced tools | Keep low-frequency controls out of the map. |

If Profile remains, it should become Account/Settings unless there is a real user-facing profile purpose.

### Map Screen

Recommended layout:

1. Top search field:
   - Placeholder: `Search venues, cities, contacts...`
   - Filter button opens filter sheet.

2. Status chip below search:
   - `Sheet synced 2 min ago`
   - `Checking spreadsheet...`
   - `Using saved data`
   - `Spreadsheet slow. Updating in background.`

3. Horizontal filter chips:
   - `All`
   - `Played`
   - `Not Played`
   - `Booked`
   - `Needs Follow-up`
   - `Missing Info`

4. Pin appearance:
   - Keep round pins with rings.
   - Played pins use the requested blue state.
   - Not played pins use the requested black state.
   - Cluster/bubble mode should stay active longer when venues are dense.
   - Breakout should happen only at a closer zoom level.

5. Venue bottom sheet:
   - Venue name
   - City/state
   - Status pill
   - Played toggle
   - Booking/contact quick info
   - Next follow-up
   - Primary action: `Update Spreadsheet Row`
   - Secondary actions: `Add to Planner`, `Open Website`, `Copy Booking Email`

### Data Screen

The Data tab should have exactly one source-of-truth editor:

- No separate blank entry section plus spreadsheet section.
- Show every spreadsheet column until the user confirms which columns can be hidden.
- Prefill all known values from the selected row.
- Save writes back to the spreadsheet bridge.
- After save, update the map from the returned CSV or the next sheet fetch.
- Display row id/site id clearly, but allow hiding it later.

Recommended states:

- No venue selected: `Select a pin to edit its spreadsheet row.`
- Selected venue: show the full row editor.
- Saving: disable duplicate saves and show `Saving to spreadsheet...`
- Saved: show `Saved. Map updated.`
- Slow bridge: show `Spreadsheet is still updating. You can keep working; the map will refresh shortly.`
- Error: show a plain-language explanation and retry button.

### Planner Screen

Current planner should become more explicitly booking-focused:

- `Today's booking queue`
- `Due follow-ups`
- `Interested venues`
- `Booked upcoming`
- `Missing contact info`
- `Do not contact`

Avoid adding broad planner persistence until product decides it is required.

### Settings Screen

Recommended groups:

1. Map Display
   - Bubble mode
   - Detailed pins
   - Limit zoom-out floor
   - Low graphics mode

2. Data Sync
   - Connected sheet URL/status
   - Last sync time
   - Manual refresh
   - Cache reset

3. Account
   - Sign in/out
   - Auth status

4. Advanced
   - Diagnostics
   - Version
   - Developer-only reset actions

### Error and Toast System

Replace scattered native dialogs with one UI system:

| Use Case | Recommended Pattern |
|---|---|
| Successful save | Toast |
| Slow spreadsheet | Persistent status chip plus toast |
| Delete or dangerous action | App modal |
| Missing required field | Inline field error |
| Auth unavailable | Non-blocking banner |
| Sync failed | Toast plus retry in Data tab |

## Recommended Fix Order

### Phase 1: Stop Blank-Map Cold Starts

Goal: No new user should see an empty map just because Apps Script is slow.

Tasks:

1. Add packaged CSV fallback on initial load.
2. Keep live sheet polling in the background.
3. Make sync status visible.
4. Add test for sheet timeout plus packaged fallback.

This should be the first code fix.

### Phase 2: Resolve Functions Policy Drift

Goal: The backend test suite should match the JDDM product policy.

Decision needed:

- Is ORS/geocode full access for everyone?
- Or should route/geocode be protected again?

After decision:

- Update `functions/tests/ors-entitlement.test.js`.
- Update `functions/tests/ors-callable-emulator.test.js`.
- Update helper names or docs if "premium" no longer applies.

### Phase 3: Clean Visible Product Language

Goal: Make the app feel native to JDDM.

Tasks:

1. Replace visible BARK/Ranger/park/trail/expedition/premium terms.
2. Keep internal namespaces until later.
3. Remove or hide profile sections that do not serve booking.
4. Run a mobile smoke after copy cleanup.

### Phase 4: Make the Data Editor the Single Source of Truth

Goal: One spreadsheet-backed editor, all columns visible until intentionally hidden.

Tasks:

1. Remove duplicate blank entry UI from the Data tab.
2. Show full row editor for selected pin.
3. Preserve spreadsheet column order.
4. Add save status and conflict/slow bridge messages.

### Phase 5: UI Polish and Accessibility

Goal: Make daily use feel calm, fast, and obvious.

Tasks:

1. Replace native dialogs.
2. Improve mobile touch target sizing.
3. Add a consistent toast/dialog component.
4. Add keyboard/focus behavior for modals.
5. Audit `innerHTML` and spreadsheet escaping.

## Suggested Immediate Tickets

### Ticket 1: Fix Cold Map Boot With Local CSV Fallback

Status: DONE / QC PASSED

Acceptance criteria:

- Clear localStorage and load app.
- Simulate Apps Script timeout.
- Map still renders packaged venue pins.
- Status says saved/package data is being used while sheet updates.
- When Apps Script returns, map updates without full page reload.

### Ticket 2: Decide and Fix ORS Full-Access Test Policy

Status: DONE / QC PASSED

Acceptance criteria for full-access policy:

- `npm --prefix functions test` passes.
- `npm run test:functions:emulator` passes.
- Tests no longer describe free users as rejected if product says everyone has access.

Former gated-policy path:

- Free route/geocode is rejected before ORS.
- Premium/manual allowed.
- UI matches backend.

This path was not selected for the current one-person JDDM prototype.

### Ticket 3: Refresh Signed-In JDDM Storage States

Status: NEXT CRITICAL

Acceptance criteria:

- Fresh `playwright/.auth/free-user.json` signs into the current `just-dee-dee-music-map` Firebase project.
- Fresh `playwright/.auth/free-user-b.json` uses a distinct second account if account-switch tests still need it.
- Auth JSON files remain ignored and uncommitted.
- Signed-in smoke no longer times out waiting for Firebase `currentUser`.

### Ticket 4: Normalize Version Source

Acceptance criteria:

- `version.json`, settings UI, console logs, and cache version agree.
- No hardcoded contradictory version numbers remain.

### Ticket 5: Visible Copy Sweep

Acceptance criteria:

- No user-facing BARK/Ranger/trail/expedition/premium copy remains unless intentionally part of compatibility docs.
- Pins, filters, cards, Data tab, and planner use JDDM terms.

### Ticket 6: Spreadsheet HTML Escaping Audit

Acceptance criteria:

- Spreadsheet-provided fields render as text unless explicitly allowed.
- Test rows with HTML-like content do not alter DOM structure.
- Venue editor, pin card, booking dashboard, and search suggestions are covered.

## Go/No-Go Recommendation

For private prototype use by one person:

`GO WITH KNOWN RISKS`

The app can continue to be used while the map/data workflow is hardened.

For sharing with testers:

`GO FOR MAP/DATA PROTOTYPE REVIEW AFTER JDDM-BUG-019 IS RESOLVED`

Reason:

- The blank-map cold boot path is fixed.
- The functions suite is green.
- Signed-in QA is still blocked by stale storage states, so account/profile/settings regression coverage is not clean yet.

For public launch:

`NO-GO`

Reason:

- The app still has migration debt, inconsistent product language, native dialogs, possible escaping risks, stale signed-in test setup, and old premium/payment/backend remnants.

## Sources

- Nielsen Norman Group, "10 Usability Heuristics for User Interface Design": https://www.nngroup.com/articles/ten-usability-heuristics/
- W3C WAI, "Understanding Success Criterion 2.5.8: Target Size (Minimum)": https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- Material Design 3, "Navigation bar": https://m3.material.io/components/navigation-bar/guidelines
- Material Design 3, "Progress indicators": https://m3.material.io/components/progress-indicators/guidelines

## Appendix: Evidence Snapshots

### Root Test Suite

```text
npm test
50 pass
0 fail
```

### Functions Test Suite

```text
npm --prefix functions test
54 pass
0 fail
```

### Functions Emulator Callable Suite

```text
npm run test:functions:emulator
9 pass
0 fail
```

### Firestore Rules Suite

```text
npm run test:rules
17 pass
0 fail
```

### Signed-In E2E Smoke

```text
npm run test:e2e:smoke
7 fail
0 pass
```

Failure class:

- Tests timed out waiting for Firebase `currentUser`.
- Venue pins rendered, so this is not the cold-start data fallback bug.
- Storage states need to be recreated for the current Just Dee Dee Firebase project.

### Data Timeout Evidence

```text
modules/dataService.js:560
const timeoutMs = options.userInitiated ? 30000 : 6000;

modules/dataService.js:641
console.warn(`Data poll timed out after ${options.userInitiated ? 30 : 6}s; backing off...`);
```

### Config Evidence

```text
index.html:1310
<script src="config/firebaseConfig.example.js?v=2" defer></script>

config/firebaseConfig.example.js:18
window.JDDM_SPREADSHEET_API_URL = "https://script.google.com/macros/s/AKfycbyeskUlFOAAfBKjhVtHpDHfjKn_SOfzaN0CIorRvyRirS_hTzTjjwf5w5gB2qs9yiw8/exec";

modules/barkConfig.js:50
window.BARK.config.VENUE_CSV_URL = window.JDDM_VENUE_CSV_URL || 'assets/data/jddm-venues.csv';
```
