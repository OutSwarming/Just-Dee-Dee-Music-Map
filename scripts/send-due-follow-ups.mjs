#!/usr/bin/env node
/**
 * send-due-follow-ups.mjs — every morning, text out EVERY venue whose
 * "Next Follow Up" date is due (<= today) and post the same list to the
 * Discord "follow up" channel. Lists all of them by name, so a follow-up you
 * set on a pin always fires its own named nudge on its date. The list grows
 * each morning and an item only drops off once the venue is actioned
 * (marked done/closed, or its follow-up date pushed forward).
 *
 * Modes:
 *   --dry-run            build + print the message, send/post nothing
 *   --only-me            text Carter only (+14403054062), for testing
 *   --discord-only       post to Discord only, no texts (webhook test)
 *   --today YYYY-MM-DD   pretend today is this date (testing future fires)
 *   --force              ignore the once-per-day guard
 * Text recipients default to Carter + Dee Dee, override with
 *   JDDM_FOLLOWUP_RECIPIENTS="+1...,+1..."
 * Discord webhook comes from JDDM_FOLLOWUP_DISCORD_WEBHOOK or the config file
 *   ~/Library/Application Support/Just Dee Dee Music Map/discord-follow-up-webhook.json
 *   ({ "webhookUrl": "https://discord.com/api/webhooks/…" })
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadPlannerSnapshot } from "./dee-dee-local-text-reminders.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEND_SCRIPT = path.join(REPO_ROOT, "scripts", "send-local-message.mjs");
const APP_URL = "https://outswarming.github.io/Just-Dee-Dee-Music-Map/";
const CARTER = "+14403054062";
const DEE_DEE = "+12168499292";
const SUPPORT_DIR = path.join(homedir(), "Library", "Application Support", "Just Dee Dee Music Map");
const LOG_PATH = path.join(homedir(), "Library", "Logs", "jddm-dee-dee-reminders.log");
const STATE_PATH = path.join(SUPPORT_DIR, "due-follow-ups-state.json");
const DISCORD_WEBHOOK_CONFIG = path.join(SUPPORT_DIR, "discord-follow-up-webhook.json");
const DISCORD_WEBHOOK_RE = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/i;

function hasFlag(flag) { return process.argv.includes(flag); }
function argValue(flag) {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? String(process.argv[i + 1] || "") : "";
}
function clean(v) { return String(v === undefined || v === null ? "" : v).trim(); }

function recipients() {
    if (hasFlag("--only-me")) return [CARTER];
    const override = clean(process.env.JDDM_FOLLOWUP_RECIPIENTS);
    if (override) return override.split(/[,\s;]+/).map(clean).filter(Boolean);
    return [CARTER, DEE_DEE];
}

function dueDate(venue) {
    const text = clean(venue["Next Follow Up"]);
    if (!text) return null;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
}
function isClosed(status) {
    const s = clean(status).toLowerCase().replace(/[^a-z0-9]+/g, " ");
    return ["booked", "played in the past", "open microphone", "told no closed no music"].some(m => s.includes(m));
}

async function appendLog(message) {
    await mkdir(path.dirname(LOG_PATH), { recursive: true });
    await writeFile(LOG_PATH, `${new Date().toISOString()} ${message}\n`, { flag: "a" });
}
async function readState() {
    try { return JSON.parse(await readFile(STATE_PATH, "utf8")); } catch { return {}; }
}
async function writeState(state) {
    await mkdir(path.dirname(STATE_PATH), { recursive: true });
    await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}
function todayKey(date) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

async function resolveDiscordWebhook() {
    const fromEnv = clean(process.env.JDDM_FOLLOWUP_DISCORD_WEBHOOK);
    if (fromEnv) return fromEnv;
    try {
        const cfg = JSON.parse(await readFile(DISCORD_WEBHOOK_CONFIG, "utf8"));
        return clean(cfg.webhookUrl || cfg.url);
    } catch { return ""; }
}

async function postToDiscord(body) {
    const url = await resolveDiscordWebhook();
    if (!url) return { skipped: true, reason: "no webhook configured" };
    if (!DISCORD_WEBHOOK_RE.test(url)) return { ok: false, reason: "invalid webhook url" };
    // Discord content hard-caps at 2000 chars; the due list can keep growing.
    let content = body;
    if (content.length > 1900) content = `${content.slice(0, 1890)}\n…`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "Follow Up", content })
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, reason: `HTTP ${res.status} ${clean(text).slice(0, 200)}` };
    }
    return { ok: true };
}

async function sendText(recipient, messageFile) {
    const { stdout } = await execFileAsync(process.execPath, [SEND_SCRIPT, "--phone", recipient, "--message-file", messageFile], { timeout: 120000 });
    return clean(stdout);
}

async function buildDueMessage(now) {
    const cutoff = new Date(now); cutoff.setHours(23, 59, 59, 999);
    const snapshot = await loadPlannerSnapshot();
    const due = snapshot.venues
        .map(v => ({ name: v.name, status: v.status, date: dueDate(v) }))
        .filter(x => x.date && x.date <= cutoff && !isClosed(x.status))
        .sort((a, b) => a.date - b.date);
    const lines = due.map(x => `• ${x.name} — due ${x.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} (${x.status})`);
    const body = [
        `Hey Dee Dee! ${due.length} follow-up${due.length === 1 ? "" : "s"} due today:`,
        ...lines,
        "",
        `Open the app: ${APP_URL}`
    ].join("\n");
    return { due, body };
}

async function main() {
    const dryRun = hasFlag("--dry-run");
    const discordOnly = hasFlag("--discord-only");
    const todayOverride = argValue("--today");
    const now = todayOverride ? new Date(`${todayOverride}T12:00:00`) : new Date();

    const { due, body } = await buildDueMessage(now);

    if (!due.length && !discordOnly) {
        await appendLog("due-follow-ups none-due");
        console.log("No follow-ups due today.");
        return;
    }

    if (dryRun) {
        const webhook = await resolveDiscordWebhook();
        console.log(`[dry-run] texts -> ${recipients().join(", ")} | discord -> ${webhook ? "configured" : "NOT configured"}`);
        console.log(body);
        return;
    }

    // Discord-only mode: just post, no texts, no daily guard (webhook test).
    if (discordOnly) {
        const discord = await postToDiscord(body);
        await appendLog(`due-follow-ups discord-only ${discord.ok ? "posted" : (discord.skipped ? "skipped" : "failed")} ${discord.reason || ""}`.trim());
        console.log(`Discord: ${discord.ok ? "posted" : (discord.skipped ? "skipped (" + discord.reason + ")" : "failed (" + discord.reason + ")")}`);
        if (discord.ok === false) process.exit(1);
        return;
    }

    // Once per day: don't re-blast if already sent for this NY calendar day.
    const key = todayKey(now);
    const state = await readState();
    if (!hasFlag("--force") && state.lastSentDay === key) {
        await appendLog(`due-follow-ups skipped already-sent ${key}`);
        console.log(`Already sent due follow-ups for ${key}.`);
        return;
    }

    const messageFile = path.join(tmpdir(), `jddm-due-follow-ups-${Date.now()}.txt`);
    await writeFile(messageFile, body);

    const targets = recipients();
    const sent = [];
    const failed = [];
    for (const recipient of targets) {
        try {
            sent.push(`${recipient}:${await sendText(recipient, messageFile)}`);
        } catch (error) {
            failed.push(`${recipient} ${error && error.message ? error.message : String(error)}`);
        }
    }

    const discord = await postToDiscord(body);

    state.lastSentDay = key;
    state.lastSentAt = new Date().toISOString();
    state.lastDueCount = due.length;
    state.lastDiscord = discord.ok ? "posted" : (discord.skipped ? "skipped" : "failed");
    await writeState(state);
    await appendLog(`due-follow-ups due ${due.length} sent ${sent.length} failed ${failed.length} to ${targets.join(",")} discord ${state.lastDiscord}${discord.reason ? " (" + discord.reason + ")" : ""}`);
    console.log(`Due follow-ups: ${due.length} due, texts sent ${sent.length}/${targets.length}, discord ${state.lastDiscord}.`);
    if (failed.length) {
        console.error(failed.join("\n"));
        process.exit(1);
    }
}

main().catch(async (error) => {
    await appendLog(`due-follow-ups error ${error && error.message ? error.message : String(error)}`);
    console.error(error && error.message ? error.message : error);
    process.exit(1);
});
