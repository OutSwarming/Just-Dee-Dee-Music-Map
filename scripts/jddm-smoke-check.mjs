import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const checks = [];

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function record(name, passed, detail = '') {
    checks.push({ name, passed, detail });
    if (!passed) {
        const suffix = detail ? `: ${detail}` : '';
        throw new Error(`${name}${suffix}`);
    }
}

function assertCheck(name, condition, detail = '') {
    record(name, Boolean(condition), detail);
}

function matchVersion(source, pattern, label) {
    const match = source.match(pattern);
    assertCheck(`${label} version is declared`, match && match[1], `Could not find ${label} version.`);
    return match[1];
}

const packageJson = JSON.parse(read('package.json'));
const indexHtml = read('index.html');
const manifest = read('manifest.json');
const bookingDashboard = read('modules/bookingDashboard.js');
const bookingActions = read('modules/bookingActions.js');
const bookingSchema = read('modules/bookingSchema.js');
const websiteBookingsService = read('modules/websiteBookingsService.js');
const bridge = read('google-apps-script/jddm-spreadsheet-bridge/Code.gs');

const runtimeText = [
    indexHtml,
    manifest,
    read('config/firebaseConfig.example.js'),
    bookingDashboard,
    bookingActions,
    bookingSchema,
    read('services/spreadsheetService.js')
].join('\n');

assertCheck(
    'Git remote points at Just Dee Dee repo',
    /OutSwarming\/Just-Dee-Dee-Music-Map(?:\.git)?/i.test(execSync('git remote -v', { cwd: ROOT, encoding: 'utf8' })),
    'Refusing to smoke-check against an unexpected remote.'
);
assertCheck('Runtime files do not show BARK Ranger branding', !/BARK Ranger/i.test(runtimeText));
assertCheck('Index title is Just Dee Dee Music', /<title>Just Dee Dee Music Live Map<\/title>/i.test(indexHtml));
assertCheck('Planner view exists', /id="planner-view"/.test(indexHtml));
assertCheck('Booking dashboard root exists', /id="booking-planner-dashboard"/.test(indexHtml));
assertCheck('Booking planner bottom-nav badge exists', /id="booking-planner-badge"/.test(indexHtml));
assertCheck('Manifest is rebranded', /Just Dee Dee Music Live Map/i.test(manifest) && /JDDM Map/i.test(manifest));
assertCheck('Booking schema module is loaded', /modules\/bookingSchema\.js/.test(indexHtml));
assertCheck('Booking actions module is loaded', /modules\/bookingActions\.js/.test(indexHtml));
assertCheck('Website booking service module is loaded', /modules\/websiteBookingsService\.js/.test(indexHtml));
assertCheck('Booking dashboard module is loaded', /modules\/bookingDashboard\.js/.test(indexHtml));
assertCheck('Priority score save action exists', /SET_PRIORITY_SCORE/.test(bookingActions) && /savePriorityScore/.test(bookingActions));
assertCheck('Priority planner tab exists', /priorityLeads/.test(bookingDashboard));
assertCheck('Planner View Map shows and selects clustered pins', /zoomToShowLayer/.test(bookingDashboard) && /active-pin/.test(bookingDashboard));
assertCheck('Website booking service reads staged event files', /loadWebsiteBookings/.test(websiteBookingsService) && /getWebsiteBookingGroups/.test(websiteBookingsService));
assertCheck('Apps Script calendar gig sync action exists', /syncCalendarGigEvents/.test(bridge) && /CalendarGigs/.test(bridge));

const dashboardVersion = matchVersion(
    bookingDashboard,
    /EXPECTED_SPREADSHEET_SCHEMA_VERSION\s*=\s*'([^']+)'/,
    'Dashboard bridge schema'
);
const bridgeVersion = matchVersion(
    bridge,
    /JDDM_SCHEMA_VERSION\s*=\s*'([^']+)'/,
    'Apps Script bridge schema'
);
assertCheck(
    'Dashboard and Apps Script schema versions match',
    dashboardVersion === bridgeVersion,
    `${dashboardVersion} !== ${bridgeVersion}`
);

[
    'contactStatus',
    'lastContactedDate',
    'nextFollowUpDate',
    'priority',
    'bestFitScore',
    'calendarLastGigDate',
    'calendarNextGigDate',
    'calendarTotalGigsPlayed',
    'calendarLastSyncedAt'
].forEach((header) => {
    assertCheck(`Bridge exposes ${header}`, bridge.includes(header));
});

[
    'contactStatus',
    'draftStatus',
    'lastContactedDate',
    'nextFollowUpDate',
    'doNotContact',
    'priority',
    'bestFitScore',
    'calendarGigEvents',
    'calendarLastGigDate',
    'calendarNextGigDate',
    'calendarTotalGigsPlayed',
    'calendarLastSyncedAt'
].forEach((field) => {
    assertCheck(`Booking schema normalizes ${field}`, bookingSchema.includes(field));
});

[
    'contactStatus',
    'lastContactedDate',
    'nextFollowUpDate',
    'priority',
    'bestFitScore',
    'calendarNextGigDate'
].forEach((field) => {
    assertCheck(`Dashboard uses ${field}`, bookingDashboard.includes(field));
});

assertCheck('Website event planner tabs exist', /websiteUpcoming/.test(bookingDashboard) && /websitePast/.test(bookingDashboard));
assertCheck(
    'Staged website booking data files exist',
    fs.existsSync(path.join(ROOT, 'data/staged/jddm-website-bookings-future.json')) &&
    fs.existsSync(path.join(ROOT, 'data/staged/jddm-website-booking-history.json'))
);

assertCheck('Unit test script exists', Boolean(packageJson.scripts && packageJson.scripts.test));
assertCheck('JDDM smoke script is registered', packageJson.scripts['test:smoke:jddm'] === 'node scripts/jddm-smoke-check.mjs');

console.log(`JDDM smoke checks passed (${checks.length}/${checks.length}).`);
