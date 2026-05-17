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
            repeat with svc in services
                try
                    if service type of svc is SMS then return id of svc as text
                end try
            end repeat
        end tell
        error "No SMS service is available. Enable iPhone Text Message Forwarding to this Mac."
    `;
    const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 15000 });
    return stdout.trim();
}

async function sendSmsViaMessages({ body, recipients }) {
    const recipientList = recipients.map(appleString).join(", ");
    const script = `
        set reminderBody to ${appleString(body)}
        set targetNumbers to {${recipientList}}
        set sentCount to 0
        set failedMessages to {}

        tell application "Messages"
            set smsService to missing value
            repeat with svc in services
                try
                    if service type of svc is SMS then
                        set smsService to svc
                        exit repeat
                    end if
                end try
            end repeat
            if smsService is missing value then error "No SMS service is available. Enable iPhone Text Message Forwarding to this Mac."

            repeat with phoneNumber in targetNumbers
                try
                    send reminderBody to buddy (phoneNumber as text) of smsService
                    set sentCount to sentCount + 1
                on error errText number errNo
                    set end of failedMessages to ((phoneNumber as text) & ": " & errText & " (" & errNo & ")")
                end try
            end repeat
        end tell

        if (count of failedMessages) > 0 then
            set AppleScript's text item delimiters to linefeed
            error (failedMessages as text)
        end if
        return "sent " & sentCount
    `;
    const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 30000 });
    return stdout.trim();
}

async function sendReminder(reminder, options = {}) {
    const recipients = options.recipients || RECIPIENTS;
    if (options.dryRun) {
        console.log(`[dry-run] ${reminder.label} -> ${recipients.join(", ")}`);
        console.log(reminder.body);
        return;
    }
    const result = await sendSmsViaMessages({ body: reminder.body, recipients });
    await appendLog(`${reminder.id} ${result} to ${recipients.join(",")}`);
    console.log(`${reminder.label}: ${result}`);
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
        console.log(`SMS service available: ${serviceId}`);
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
