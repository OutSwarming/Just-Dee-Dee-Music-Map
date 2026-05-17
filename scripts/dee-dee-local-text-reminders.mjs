#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const APP_URL = "https://outswarming.github.io/Just-Dee-Dee-Music-Map/";
const RECIPIENTS = ["+14403054062", "+12168499292"];
const LOG_PATH = path.join(homedir(), "Library", "Logs", "jddm-dee-dee-reminders.log");
const STATE_PATH = path.join(homedir(), "Library", "Application Support", "Just Dee Dee Music Map", "local-text-reminders-state.json");
const MESSAGES_DB_PATH = path.join(homedir(), "Library", "Messages", "chat.db");
const SERVICE_PRIORITY = ["iMessage", "SMS"];

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
        if (!service) return null;
        return {
            service,
            isSent: Number(isSent) === 1,
            isDelivered: Number(isDelivered) === 1,
            error: Number(error || 0)
        };
    } catch {
        return null;
    }
}

async function sendToRecipient({ body, recipient }) {
    const startedAt = new Date();
    const errors = [];

    for (const serviceType of SERVICE_PRIORITY) {
        try {
            const service = await sendViaMessagesService({ body, recipient, serviceType });
            await new Promise(resolve => setTimeout(resolve, 2500));
            const status = await readLatestMessageStatus(recipient, startedAt);
            if (!status || status.error === 0 || status.isSent || status.isDelivered) {
                return { recipient, service, status };
            }
            errors.push(`${serviceType} database status error ${status.error}`);
        } catch (error) {
            errors.push(`${serviceType} ${error && error.message ? error.message : String(error)}`);
        }
    }

    throw new Error(`${recipient}: ${errors.join("; ")}`);
}

async function sendMessages({ body, recipients }) {
    const results = [];
    const failures = [];
    for (const recipient of recipients) {
        try {
            results.push(await sendToRecipient({ body, recipient }));
        } catch (error) {
            failures.push(error && error.message ? error.message : String(error));
        }
    }
    if (failures.length) throw new Error(failures.join("\n"));
    return results;
}

async function sendReminder(reminder, options = {}) {
    const recipients = options.recipients || RECIPIENTS;
    if (options.dryRun) {
        console.log(`[dry-run] ${reminder.label} -> ${recipients.join(", ")}`);
        console.log(reminder.body);
        return;
    }
    const results = await sendMessages({ body: reminder.body, recipients });
    const serviceSummary = results.map(result => `${result.recipient}:${result.service}`).join(",");
    await appendLog(`${reminder.id} sent ${results.length} via ${serviceSummary}`);
    console.log(`${reminder.label}: sent ${results.length} via ${serviceSummary}`);
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
    await sendReminder(reminder);
    state[runKey] = new Date().toISOString();
    await writeState(state);
}

async function main() {
    if (hasFlag("--help")) {
        console.log([
            "Usage:",
            "  node scripts/dee-dee-local-text-reminders.mjs --check",
            "  node scripts/dee-dee-local-text-reminders.mjs --send available-dates",
            "  node scripts/dee-dee-local-text-reminders.mjs --scheduled",
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

    throw new Error("Missing command. Run with --help.");
}

main().catch(async (error) => {
    await appendLog(`error ${error && error.message ? error.message : String(error)}`);
    console.error(error && error.message ? error.message : error);
    process.exit(1);
});
