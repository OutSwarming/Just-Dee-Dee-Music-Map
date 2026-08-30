#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(dirname(fileURLToPath(import.meta.url)), "..");

const APP_URL = "https://outswarming.github.io/Just-Dee-Dee-Music-Map/";
const RECIPIENTS = ["+14403054062", "+12168499292"];
const LOG_PATH = path.join(homedir(), "Library", "Logs", "jddm-dee-dee-reminders.log");
const STATE_PATH = path.join(homedir(), "Library", "Application Support", "Just Dee Dee Music Map", "local-text-reminders-state.json");
const MESSAGES_DB_PATH = path.join(homedir(), "Library", "Messages", "chat.db");
const VENUES_CSV_PATH = path.join(REPO_ROOT, "assets", "data", "jddm-venues.csv");
const CALENDAR_GIGS_PATH = path.join(REPO_ROOT, "data", "staged", "jddm-calendar-gigs.json");
const WEBSITE_FUTURE_PATH = path.join(REPO_ROOT, "data", "staged", "jddm-website-bookings-future.json");
const ARTIST_SYNC_HEALTH_PATH = path.join(homedir(), "Library", "Application Support", "Just Dee Dee Music Map", "artist-gig-tracker-health.json");
const ARTIST_SYNC_STALE_AFTER_MS = 7 * 60 * 60 * 1000;
const BRIDGE_API_URL = process.env.JDDM_SPREADSHEET_BRIDGE_URL
    || "https://script.google.com/macros/s/AKfycbyOems33yVzMEq_ucgoajSg3cYCq-68sM1ngKP2d0pdvA3OpJCG34ZAAM-cIeQouDKu/exec";
const LIVE_MAP_CSV_URL = process.env.JDDM_VENUE_CSV_URL
    || "https://script.google.com/macros/s/AKfycbyOems33yVzMEq_ucgoajSg3cYCq-68sM1ngKP2d0pdvA3OpJCG34ZAAM-cIeQouDKu/exec?action=csv";
const SERVICE_PRIORITY = ["iMessage", "SMS"];
const FALLBACK_SERVICE_PRIORITY = ["SMS", "iMessage"];
const MAX_DYNAMIC_DATA_AGE_MS = 48 * 60 * 60 * 1000;
const DELIVERY_FALLBACK_AFTER_MS = 48 * 60 * 60 * 1000;

const REMINDERS = Object.freeze([
    {
        id: "today-plan",
        label: "Plan Today",
        slot: "morning",
        hour: 9,
        body: `Hey Dee Dee! Tiny booking manager hat on: open the app and check today's booking work.\n\n${APP_URL}`
    },
    {
        id: "available-dates",
        label: "Check Dates",
        slot: "midday",
        hour: 12,
        body: `Hey Dee Dee! Quick calendar quest: check available dates before promising a gig.\n\n${APP_URL}`
    },
    {
        id: "follow-ups",
        label: "Follow Ups",
        slot: "afternoon",
        hour: 16,
        body: `Hey Dee Dee! Friendly nudge hour: check follow-ups and poke the venues waiting on a reply.\n\n${APP_URL}`
    },
    {
        id: "calendar-cleanup",
        label: "Calendar Sync",
        slot: "evening",
        hour: 19,
        body: `Hey Dee Dee! Calendar check: make sure new gigs, vacations, and blocked dates are up to date.\n\n${APP_URL}`
    }
]);

function getArgValue(flag) {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : "";
}

function hasFlag(flag) {
    return process.argv.includes(flag);
}

function clean(value) {
    return String(value === undefined || value === null ? "" : value).trim();
}

export function isDataFresh(modifiedAtMs, nowMs = Date.now(), maxAgeMs = MAX_DYNAMIC_DATA_AGE_MS) {
    const modified = Number(modifiedAtMs);
    return Number.isFinite(modified) && modified > 0 && Math.max(0, Number(nowMs) - modified) <= Number(maxAgeMs);
}

function normalizeLoose(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getTodayKey(date = new Date()) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });
    return formatter.format(date);
}

function getNewYorkHour(date = new Date()) {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        hour12: false
    });
    return Number(formatter.format(date));
}

function selectScheduledReminder(date = new Date()) {
    const hour = getNewYorkHour(date);
    return REMINDERS.find(reminder => reminder.hour === hour)
        || REMINDERS.slice().sort((a, b) => Math.abs(a.hour - hour) - Math.abs(b.hour - hour))[0];
}

export function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];

        if (char === "\"") {
            if (quoted && next === "\"") {
                cell += "\"";
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (char === "," && !quoted) {
            row.push(cell);
            cell = "";
        } else if ((char === "\n" || char === "\r") && !quoted) {
            if (char === "\r" && next === "\n") index += 1;
            row.push(cell);
            if (row.some(value => clean(value))) rows.push(row);
            row = [];
            cell = "";
        } else {
            cell += char;
        }
    }

    row.push(cell);
    if (row.some(value => clean(value))) rows.push(row);
    if (!rows.length) return [];

    const headers = rows[0].map(clean);
    return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, clean(values[index])])));
}

function parseLocalDate(value) {
    const text = clean(value);
    if (!text) return null;
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slash) {
        const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
        return new Date(year, Number(slash[1]) - 1, Number(slash[2]));
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function formatIsoDate(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function addDays(date, days) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + days);
    return next;
}

function formatDisplayDate(isoDate) {
    const date = parseLocalDate(isoDate);
    if (!date) return isoDate;
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function normalizeScore(value) {
    const score = Number(clean(value));
    return Number.isFinite(score) ? Math.max(0, Math.min(10, Math.round(score))) : 0;
}

function hasContactInfo(venue) {
    return Boolean(clean(venue["Email/Contact"]) || clean(venue.Website) || clean(venue["Phone Number"]) || clean(venue["Booking Contact"]));
}

function isClosedOrDone(status) {
    return [
        "booked",
        "played in the past",
        "open microphone",
        "told no closed no music"
    ].some(match => normalizeLoose(status).includes(match));
}

function isDueDate(value, today = new Date()) {
    const date = parseLocalDate(value);
    if (!date) return false;
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return date <= todayStart;
}

function venuePriorityScore(venue) {
    return (normalizeScore(venue.Priority) * 10) + normalizeScore(venue["Best Fit"]);
}

function sortVenuePriority(a, b) {
    const scoreDiff = venuePriorityScore(b) - venuePriorityScore(a);
    if (scoreDiff) return scoreDiff;
    return clean(a["Place Name"]).localeCompare(clean(b["Place Name"]));
}

async function readFreshJsonFile(filePath, fallback, options = {}) {
    try {
        const [contents, fileStats] = await Promise.all([
            readFile(filePath, "utf8"),
            stat(filePath)
        ]);
        const maxAgeMs = Number(options.maxAgeMs || MAX_DYNAMIC_DATA_AGE_MS);
        const ageMs = Math.max(0, Date.now() - fileStats.mtimeMs);
        return {
            value: JSON.parse(contents),
            fresh: isDataFresh(fileStats.mtimeMs, Date.now(), maxAgeMs),
            modifiedAt: fileStats.mtime.toISOString(),
            ageMs
        };
    } catch (error) {
        return {
            value: fallback,
            fresh: false,
            modifiedAt: null,
            ageMs: null,
            error: error && error.message ? error.message : String(error)
        };
    }
}

async function fetchLiveVenueCsv(options = {}) {
    const fetchImpl = options.fetchImpl || fetch;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Number(options.timeoutMs || 20000));
    const separator = LIVE_MAP_CSV_URL.includes("?") ? "&" : "?";
    try {
        const response = await fetchImpl(`${LIVE_MAP_CSV_URL}${separator}t=${Date.now()}`, {
            cache: "no-store",
            redirect: "follow",
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`Live map CSV returned HTTP ${response.status}.`);
        const csv = await response.text();
        if (!/\bPlace Name\b/i.test(csv) || csv.length < 100) {
            throw new Error("Live map CSV response was incomplete.");
        }
        return csv;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function loadVenueRows(options = {}) {
    if (options.venueCsvText !== undefined) {
        return { rows: parseCsv(options.venueCsvText), source: "injected", fresh: true, fetchedAt: new Date().toISOString() };
    }

    try {
        const csv = await fetchLiveVenueCsv(options);
        return { rows: parseCsv(csv), source: "live-map", fresh: true, fetchedAt: new Date().toISOString() };
    } catch (error) {
        const reason = error && error.message ? error.message : String(error);
        await appendLog(`live-map-fallback ${reason}`);
        const fallbackStats = await stat(VENUES_CSV_PATH);
        const fallbackAgeMs = Math.max(0, Date.now() - fallbackStats.mtimeMs);
        if (!isDataFresh(fallbackStats.mtimeMs)) {
            const staleError = new Error(`Packaged venue fallback is stale (${Math.floor(fallbackAgeMs / 86400000)} days old).`);
            staleError.code = "STALE_VENUE_FALLBACK";
            throw staleError;
        }
        return {
            rows: parseCsv(await readFile(VENUES_CSV_PATH, "utf8")),
            source: "packaged-fallback",
            fresh: true,
            fetchedAt: fallbackStats.mtime.toISOString()
        };
    }
}

export function extractGigDates(value) {
    const text = clean(value);
    if (!text) return [];
    const matches = [
        ...(text.match(/\b\d{4}-\d{1,2}-\d{1,2}\b/g) || []),
        ...(text.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g) || []),
        ...(text.match(/\b(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi) || [])
    ];
    return Array.from(new Set(matches
        .map(parseLocalDate)
        .filter(Boolean)
        .map(formatIsoDate)))
        .sort();
}

function buildMapFutureGigs(venueRows, todayIso) {
    const seen = new Set();
    const gigs = [];
    venueRows.forEach(venue => {
        const dates = extractGigDates([venue["Future Gigs"], venue["Next Booked"]].filter(Boolean).join("; "));
        dates.filter(date => date >= todayIso).forEach(eventDate => {
            const venueName = clean(venue["Place Name"]) || "Venue TBD";
            const key = `${eventDate}|${normalizeLoose(venueName)}`;
            if (seen.has(key)) return;
            seen.add(key);
            gigs.push({ eventDate, venueName, title: venueName, source: "live-map" });
        });
    });
    return gigs;
}

export async function loadPlannerSnapshot(options = {}) {
    const venueSnapshot = await loadVenueRows(options);
    const venueRows = venueSnapshot.rows;
    const calendarSnapshot = options.calendarPayload
        ? { value: options.calendarPayload, fresh: true, modifiedAt: new Date().toISOString(), ageMs: 0 }
        : await readFreshJsonFile(CALENDAR_GIGS_PATH, { gigs: [], blockedEvents: [] });
    const websiteSnapshot = options.websitePayload
        ? { value: options.websitePayload, fresh: true, modifiedAt: new Date().toISOString(), ageMs: 0 }
        : await readFreshJsonFile(WEBSITE_FUTURE_PATH, { bookings: [] });
    const artistHealthSnapshot = options.artistHealthPayload
        ? { value: options.artistHealthPayload, fresh: options.artistHealthFresh !== false, modifiedAt: new Date().toISOString(), ageMs: 0 }
        : await readFreshJsonFile(ARTIST_SYNC_HEALTH_PATH, { status: "missing" }, { maxAgeMs: ARTIST_SYNC_STALE_AFTER_MS });
    const calendar = calendarSnapshot.value;
    const website = websiteSnapshot.value;
    const today = new Date();
    const todayIso = formatIsoDate(today);
    const normalizedVenues = venueRows.map(row => ({
        ...row,
        status: clean(row.Status) || "Not Set",
        name: clean(row["Place Name"]) || "Unknown venue"
    }));
    const activeVenues = normalizedVenues.filter(venue => !isClosedOrDone(venue.status));
    const followUps = activeVenues
        .filter(venue => /follow up|responded|waiting/.test(normalizeLoose(venue.status)) || isDueDate(venue["Next Follow Up"], today))
        .sort((a, b) => clean(a["Next Follow Up"]).localeCompare(clean(b["Next Follow Up"])) || sortVenuePriority(a, b));
    const newPlaces = activeVenues
        .filter(venue => ["not contacted yet", "draft ready"].includes(normalizeLoose(venue.status)) && hasContactInfo(venue))
        .sort(sortVenuePriority);
    const missingInfo = activeVenues
        .filter(venue => normalizeLoose(venue.status) === "needs review" || !hasContactInfo(venue))
        .sort(sortVenuePriority);
    const responded = activeVenues
        .filter(venue => normalizeLoose(venue.status).includes("responded"))
        .sort(sortVenuePriority);
    const combinedFutureGigs = [
        ...buildMapFutureGigs(venueRows, todayIso),
        ...(Array.isArray(calendar.gigs) ? calendar.gigs : []),
        ...(Array.isArray(website.bookings) ? website.bookings : [])
    ]
        .filter(event => clean(event.eventDate) >= todayIso)
        .sort((a, b) => clean(a.eventDate).localeCompare(clean(b.eventDate)));
    const futureGigs = [];
    const seenFutureGigs = new Set();
    combinedFutureGigs.forEach(event => {
        const key = `${clean(event.eventDate)}|${normalizeLoose(event.venueName || event.title)}`;
        if (!clean(event.eventDate) || seenFutureGigs.has(key)) return;
        seenFutureGigs.add(key);
        futureGigs.push(event);
    });
    const blockedEvents = Array.isArray(calendar.blockedEvents) ? calendar.blockedEvents : [];

    return {
        today,
        venues: normalizedVenues,
        followUps,
        newPlaces,
        missingInfo,
        responded,
        futureGigs,
        blockedEvents,
        venueDataSource: venueSnapshot.source,
        venueDataFresh: venueSnapshot.fresh !== false,
        venueDataFetchedAt: venueSnapshot.fetchedAt || null,
        calendarDataFresh: calendarSnapshot.fresh,
        calendarDataModifiedAt: calendarSnapshot.modifiedAt,
        websiteDataFresh: websiteSnapshot.fresh,
        websiteDataModifiedAt: websiteSnapshot.modifiedAt,
        artistSyncFresh: artistHealthSnapshot.fresh && clean(artistHealthSnapshot.value.status).toLowerCase() === "ok",
        artistSyncStatus: clean(artistHealthSnapshot.value.status) || "missing",
        artistSyncUpdatedAt: clean(artistHealthSnapshot.value.updatedAt) || artistHealthSnapshot.modifiedAt,
        freshnessWarnings: [
            calendarSnapshot.fresh ? "" : "Calendar snapshot is more than two days old or unavailable.",
            websiteSnapshot.fresh ? "" : "Website booking snapshot is more than two days old or unavailable."
        ].filter(Boolean),
        calendarGeneratedAt: calendar.generatedAt || website.pulledAt || null,
        availability: {
            weekends: getAvailableDates({
                startDate: today,
                calendarEvents: futureGigs,
                blockedEvents,
                mode: "weekends",
                limit: 8
            }),
            weekdays: getAvailableDates({
                startDate: today,
                calendarEvents: futureGigs,
                blockedEvents,
                mode: "weekdays",
                limit: 8
            })
        }
    };
}

export function appendArtistSyncWarning(body, snapshot) {
    if (!snapshot || snapshot.artistSyncFresh !== false) return body;
    const lastUpdate = snapshot.artistSyncUpdatedAt ? ` Last update: ${snapshot.artistSyncUpdatedAt}.` : "";
    return `${body}\n⚠️ Artist events and Who Plays There are stale or failed.${lastUpdate}`;
}

function addBusyRange(busyDates, startValue, endValue, reason, isAllDay) {
    const start = parseLocalDate(startValue);
    if (!start) return;
    let end = parseLocalDate(endValue) || start;
    if (isAllDay && end > start) end = addDays(end, -1);
    if (end < start) end = start;
    for (let date = start; date <= end; date = addDays(date, 1)) {
        const iso = formatIsoDate(date);
        if (!busyDates.has(iso)) busyDates.set(iso, new Set());
        if (reason) busyDates.get(iso).add(reason);
    }
}

function isModeDate(date, mode) {
    const day = date.getDay();
    if (mode === "weekdays") return day >= 1 && day <= 4;
    return day === 5 || day === 6 || day === 0;
}

function getAvailableDates(options = {}) {
    const mode = options.mode === "weekdays" ? "weekdays" : "weekends";
    const start = parseLocalDate(options.startDate) || new Date();
    const limit = Number(options.limit || 8);
    const lookaheadDays = Number(options.lookaheadDays || 120);
    const busyDates = new Map();
    [...(options.calendarEvents || []), ...(options.websiteEvents || [])].forEach(event => {
        addBusyRange(busyDates, event.eventDate, event.eventEndDate, clean(event.venueName || event.title), Boolean(event.isAllDay));
    });
    (options.blockedEvents || []).forEach(event => {
        addBusyRange(busyDates, event.eventDate, event.eventEndDate, clean(event.summary || event.venueName), Boolean(event.isAllDay));
    });

    const dates = [];
    for (let offset = 0; offset <= lookaheadDays && dates.length < limit; offset += 1) {
        const date = addDays(start, offset);
        const iso = formatIsoDate(date);
        if (isModeDate(date, mode) && !busyDates.has(iso)) dates.push(iso);
    }
    return { dates, busyCount: busyDates.size };
}

function listNames(venues, limit = 2) {
    return venues.slice(0, limit).map(venue => venue.name).filter(Boolean).join(", ");
}

function nextGigText(snapshot) {
    const nextGig = snapshot.futureGigs[0];
    if (!nextGig) return "No upcoming gig found in the staged calendar.";
    return `Next gig: ${formatDisplayDate(nextGig.eventDate)} at ${clean(nextGig.venueName || nextGig.title) || "venue TBD"}.`;
}

export function buildReminderBody(reminder, snapshot) {
    if (!snapshot) return reminder.body;
    if (["available-dates", "calendar-cleanup"].includes(reminder.id) && !snapshot.calendarDataFresh) {
        return [
            reminder.body.split("\n\n")[0],
            "The calendar snapshot is more than two days old, so no date totals are being sent. Open the app and verify the calendar before promising a date.",
            APP_URL
        ].join("\n");
    }
    const todaysNewPlaces = Math.min(8, snapshot.newPlaces.length);
    const todaysContactCleanups = Math.min(8, snapshot.missingInfo.length);
    const openWeekends = snapshot.availability.weekends.dates.slice(0, 3).map(formatDisplayDate).join(", ");
    const openWeekdays = snapshot.availability.weekdays.dates.slice(0, 3).map(formatDisplayDate).join(", ");
    const newNames = listNames(snapshot.newPlaces);
    const followNames = listNames(snapshot.followUps);
    const missingNames = listNames(snapshot.missingInfo);

    if (reminder.id === "today-plan") {
        return [
            `Hey Dee Dee! Today in the booking app: ${snapshot.followUps.length} follow-ups, ${todaysNewPlaces} new places to check, and ${todaysContactCleanups} contact cleanups.`,
            snapshot.newPlaces.length > todaysNewPlaces ? `${snapshot.newPlaces.length} total new-place leads are waiting in the queue.` : "",
            newNames ? `Start with new places: ${newNames}.` : "",
            followNames ? `Follow-up first: ${followNames}.` : "",
            APP_URL
        ].filter(Boolean).join("\n");
    }

    if (reminder.id === "available-dates") {
        return [
            `Hey Dee Dee! Available date scout: next open weekends are ${openWeekends || "none in the next window"}.`,
            `Weekday options: ${openWeekdays || "none in the next window"}.`,
            `${snapshot.availability.weekends.busyCount} booked or blocked dates are on the calendar radar.`,
            APP_URL
        ].join("\n");
    }

    if (reminder.id === "follow-ups") {
        return [
            `Hey Dee Dee! Follow-up hour: ${snapshot.followUps.length} venues need a nudge and ${snapshot.responded.length} responses need decisions.`,
            followNames ? `Top nudges: ${followNames}.` : "No urgent follow-ups in the current CSV. Nice.",
            APP_URL
        ].join("\n");
    }

    if (reminder.id === "calendar-cleanup") {
        return [
            `Hey Dee Dee! Evening calendar tidy-up: ${snapshot.futureGigs.length} upcoming gigs are staged and ${snapshot.blockedEvents.length} vacation/blocked holds are tracked.`,
            nextGigText(snapshot),
            missingNames ? `Tomorrow's cleanup starter: ${missingNames}.` : "",
            APP_URL
        ].filter(Boolean).join("\n");
    }

    return reminder.body;
}

function appleString(value) {
    return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function appendLog(message) {
    await mkdir(path.dirname(LOG_PATH), { recursive: true });
    await writeFile(LOG_PATH, `${new Date().toISOString()} ${message}\n`, { flag: "a" });
}

async function readState() {
    try {
        return JSON.parse(await readFile(STATE_PATH, "utf8"));
    } catch {
        return {};
    }
}

async function writeState(state) {
    await mkdir(path.dirname(STATE_PATH), { recursive: true });
    await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

async function assertSmsServiceAvailable() {
    const script = `
        tell application "Messages"
            set hasIMessage to false
            set hasSms to false
            repeat with svc in services
                try
                    if service type of svc is iMessage then set hasIMessage to true
                    if service type of svc is SMS then set hasSms to true
                end try
            end repeat
            if hasIMessage then return "iMessage"
            if hasSms then return "SMS"
        end tell
        error "No Messages sending service is available. Sign in to Messages on this Mac."
    `;
    const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 15000 });
    return stdout.trim();
}

async function sendViaMessagesService({ body, recipient, serviceType }) {
    const serviceTest = serviceType === "SMS" ? "SMS" : "iMessage";
    const script = `
        set reminderBody to ${appleString(body)}
        set targetNumber to ${appleString(recipient)}

        tell application "Messages"
            set selectedService to missing value
            repeat with svc in services
                try
                    if service type of svc is ${serviceTest} then
                        set selectedService to svc
                        exit repeat
                    end if
                end try
            end repeat
            if selectedService is missing value then error "No ${serviceType} service is available."
            send reminderBody to buddy targetNumber of selectedService
        end tell
        return "${serviceType}"
    `;
    const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 30000 });
    return stdout.trim();
}

function appleMessageDate(date) {
    return Math.floor((date.getTime() / 1000 - 978307200) * 1000000000);
}

function sqlString(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

async function readLatestMessageStatus(recipient, since) {
    const sinceDate = appleMessageDate(new Date(since.getTime() - 2000));
    const sql = `
        SELECT m.service || '|' || m.is_sent || '|' || m.is_delivered || '|' || m.error
        FROM message m
        LEFT JOIN handle h ON h.ROWID = m.handle_id
        WHERE h.id = ${sqlString(recipient)} AND m.date >= ${sinceDate}
        ORDER BY m.date DESC
        LIMIT 1;
    `;
    try {
        const { stdout } = await execFileAsync("sqlite3", [MESSAGES_DB_PATH, sql], { timeout: 15000 });
        const [service, isSent, isDelivered, error] = stdout.trim().split("|");
        if (!service) return { verified: false, reason: "No matching outgoing message was visible in the Messages database." };
        return {
            verified: true,
            service,
            isSent: Number(isSent) === 1,
            isDelivered: Number(isDelivered) === 1,
            error: Number(error || 0)
        };
    } catch (error) {
        return {
            verified: false,
            reason: error && error.message ? error.message : "Messages database could not be read."
        };
    }
}

export function isVerifiedMessageStatus(status) {
    return Boolean(status && status.verified === true && status.error === 0 && (status.isSent || status.isDelivered));
}

export function updateDeliveryHealth(previousHealth = {}, results = [], now = new Date()) {
    const nowIso = now.toISOString();
    const nextHealth = { ...previousHealth, recipients: { ...(previousHealth.recipients || {}) } };

    results.forEach(result => {
        const recipient = clean(result && result.recipient);
        if (!recipient) return;
        const previous = nextHealth.recipients[recipient] || {};
        const verified = Boolean(result.verified);
        nextHealth.recipients[recipient] = {
            ...previous,
            lastAttemptAt: nowIso,
            lastService: clean(result.service),
            lastVerified: verified,
            lastVerificationReason: verified ? "" : clean(result.verificationReason || (result.status && result.status.reason)),
            lastVerifiedAt: verified ? nowIso : (previous.lastVerifiedAt || null),
            unverifiedSince: verified ? null : (previous.unverifiedSince || nowIso)
        };
    });

    const staleRecipients = Object.entries(nextHealth.recipients)
        .filter(([, health]) => health.unverifiedSince && now.getTime() - Date.parse(health.unverifiedSince) >= DELIVERY_FALLBACK_AFTER_MS)
        .map(([recipient]) => recipient);
    nextHealth.updatedAt = nowIso;
    nextHealth.fallbackRecommended = staleRecipients.length > 0;
    nextHealth.staleRecipients = staleRecipients;
    return nextHealth;
}

export function getServicePriorityForHealth(deliveryHealth = {}) {
    return deliveryHealth.fallbackRecommended
        ? FALLBACK_SERVICE_PRIORITY.slice()
        : SERVICE_PRIORITY.slice();
}

async function sendToRecipient({ body, recipient, servicePriority = SERVICE_PRIORITY }) {
    const startedAt = new Date();
    const errors = [];

    for (const serviceType of servicePriority) {
        try {
            const service = await sendViaMessagesService({ body, recipient, serviceType });
            await new Promise(resolve => setTimeout(resolve, 2500));
            const status = await readLatestMessageStatus(recipient, startedAt);
            if (isVerifiedMessageStatus(status)) {
                return { recipient, service, status, verified: true };
            }
            if (status && status.verified === true && status.error === 0) {
                return {
                    recipient,
                    service,
                    status,
                    verified: false,
                    verificationReason: "The outgoing message exists but is not yet marked sent or delivered."
                };
            }
            if (status && status.verified === false) {
                return {
                    recipient,
                    service,
                    status,
                    verified: false,
                    verificationReason: status.reason || "Delivery could not be verified."
                };
            }
            errors.push(`${serviceType} database status error ${status.error}`);
        } catch (error) {
            errors.push(`${serviceType} ${error && error.message ? error.message : String(error)}`);
        }
    }

    throw new Error(`${recipient}: ${errors.join("; ")}`);
}

async function sendMessages({ body, recipients, servicePriority = SERVICE_PRIORITY }) {
    const results = [];
    const failures = [];
    for (const recipient of recipients) {
        try {
            results.push(await sendToRecipient({ body, recipient, servicePriority }));
        } catch (error) {
            failures.push(error && error.message ? error.message : String(error));
        }
    }
    if (failures.length) throw new Error(failures.join("\n"));
    return results;
}

async function sendReminder(reminder, options = {}) {
    const recipients = options.recipients || RECIPIENTS;
    const servicePriority = options.servicePriority || SERVICE_PRIORITY;
    let body = reminder.body;
    let snapshot = null;
    try {
        snapshot = await loadPlannerSnapshot();
        body = appendArtistSyncWarning(buildReminderBody(reminder, snapshot), snapshot);
    } catch (error) {
        await appendLog(`smart-body-fallback ${reminder.id} ${error && error.message ? error.message : String(error)}`);
    }

    if (options.dryRun) {
        console.log(`[dry-run] ${reminder.label} -> ${recipients.join(", ")}`);
        console.log(body);
        return { results: [], snapshot, body, dryRun: true };
    }
    const results = await sendMessages({ body, recipients, servicePriority });
    const serviceSummary = results.map(result => `${result.recipient}:${result.service}`).join(",");
    const verifiedCount = results.filter(result => result.verified).length;
    const source = snapshot ? snapshot.venueDataSource : "static-body";
    await appendLog(`${reminder.id} sent ${results.length} verified ${verifiedCount} source ${source} via ${serviceSummary}`);
    console.log(`${reminder.label}: sent ${results.length}, verified ${verifiedCount}, source ${source}, via ${serviceSummary}`);
    return { results, snapshot, body, dryRun: false };
}

async function runScheduled() {
    const reminder = selectScheduledReminder();
    const runKey = `${getTodayKey()}_${reminder.slot}`;
    const state = await readState();
    if (state[runKey]) {
        await appendLog(`${reminder.id} skipped duplicate ${runKey}`);
        console.log(`${reminder.label}: already sent for ${runKey}`);
        return;
    }
    state._deliveryHealth = updateDeliveryHealth(state._deliveryHealth, []);
    const servicePriority = getServicePriorityForHealth(state._deliveryHealth);
    if (state._deliveryHealth.fallbackRecommended) {
        await appendLog(`delivery-fallback-active SMS-first recipients ${state._deliveryHealth.staleRecipients.join(",")}`);
    }
    const sendResult = await sendReminder(reminder, { servicePriority });
    state._deliveryHealth = updateDeliveryHealth(state._deliveryHealth, sendResult.results);
    if (state._deliveryHealth.fallbackRecommended) {
        await appendLog(`delivery-fallback-recommended 48h recipients ${state._deliveryHealth.staleRecipients.join(",")}`);
    }
    state[runKey] = new Date().toISOString();
    await writeState(state);
}

export async function postReminderBridge(action, payload = {}, options = {}) {
    const fetchImpl = options.fetchImpl || fetch;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Number(options.timeoutMs || 30000));
    try {
        const response = await fetchImpl(options.bridgeUrl || BRIDGE_API_URL, {
            method: "POST",
            redirect: "follow",
            cache: "no-store",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action, ...payload }),
            signal: controller.signal
        });
        const text = await response.text();
        const result = text ? JSON.parse(text) : null;
        if (!response.ok || !result || result.ok === false) {
            throw new Error((result && result.message) || `Reminder bridge returned HTTP ${response.status}.`);
        }
        return result;
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function processReminderQueue(options = {}) {
    const bridgeOptions = {
        fetchImpl: options.fetchImpl,
        bridgeUrl: options.bridgeUrl,
        timeoutMs: options.timeoutMs
    };
    const result = await postReminderBridge("getPendingReminders", { limit: 20 }, bridgeOptions);
    const reminders = Array.isArray(result.reminders) ? result.reminders : [];
    const state = options.state || await readState();
    state._processedReminderRequests = state._processedReminderRequests || {};
    const sendImpl = options.sendReminderImpl || sendReminder;
    let sent = 0;
    let failed = 0;

    for (const queued of reminders) {
        const requestId = clean(queued.requestId);
        const reminder = REMINDERS.find(item => item.id === clean(queued.reminderId));
        try {
            if (!requestId || !reminder) throw new Error(`Unknown queued reminder: ${clean(queued.reminderId) || "missing"}`);
            if (!state._processedReminderRequests[requestId]) {
                await sendImpl(reminder);
                state._processedReminderRequests[requestId] = new Date().toISOString();
                const entries = Object.entries(state._processedReminderRequests).slice(-200);
                state._processedReminderRequests = Object.fromEntries(entries);
                if (!options.state) await writeState(state);
            }
            await postReminderBridge("completeReminder", { requestId, status: "sent", result: "Messages worker sent the reminder." }, bridgeOptions);
            sent += 1;
        } catch (error) {
            failed += 1;
            const message = error && error.message ? error.message : String(error);
            await appendLog(`queue-failed ${requestId || "missing"} ${message}`);
            if (requestId) {
                try {
                    await postReminderBridge("completeReminder", { requestId, status: "failed", result: message }, bridgeOptions);
                } catch (completionError) {
                    await appendLog(`queue-completion-failed ${requestId} ${completionError && completionError.message ? completionError.message : completionError}`);
                }
            }
        }
    }
    await appendLog(`queue-processed pending ${reminders.length} sent ${sent} failed ${failed}`);
    return { pending: reminders.length, sent, failed };
}

async function main() {
    if (hasFlag("--help")) {
        console.log([
            "Usage:",
            "  node scripts/dee-dee-local-text-reminders.mjs --check",
            "  node scripts/dee-dee-local-text-reminders.mjs --send available-dates",
            "  node scripts/dee-dee-local-text-reminders.mjs --scheduled",
            "  node scripts/dee-dee-local-text-reminders.mjs --process-queue",
            "  node scripts/dee-dee-local-text-reminders.mjs --dry-run --send follow-ups"
        ].join("\n"));
        return;
    }

    if (hasFlag("--check")) {
        const serviceId = await assertSmsServiceAvailable();
        console.log(`Messages service available: ${serviceId}`);
        return;
    }

    const dryRun = hasFlag("--dry-run");
    const sendId = getArgValue("--send");
    if (sendId) {
        const reminder = REMINDERS.find(item => item.id === sendId);
        if (!reminder) throw new Error(`Unknown reminder id: ${sendId}`);
        await sendReminder(reminder, { dryRun });
        return;
    }

    if (hasFlag("--scheduled")) {
        if (dryRun) {
            const reminder = selectScheduledReminder();
            await sendReminder(reminder, { dryRun });
            return;
        }
        await runScheduled();
        return;
    }

    if (hasFlag("--process-queue")) {
        await processReminderQueue();
        return;
    }

    throw new Error("Missing command. Run with --help.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(async (error) => {
        await appendLog(`error ${error && error.message ? error.message : String(error)}`);
        console.error(error && error.message ? error.message : error);
        process.exit(1);
    });
}
