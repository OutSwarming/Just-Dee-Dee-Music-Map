#!/usr/bin/env node
/**
 * notify-new-place.mjs — post a confirmation to the Discord #new-places channel
 * that a venue was actually added to the spreadsheet. Intended to be called
 * after the spreadsheet bridge confirms the row was written.
 *
 * Usage:
 *   node scripts/notify-new-place.mjs --name "Venue" [--city "Akron OH"] \
 *     [--status "Not Contacted Yet"] [--source "Google Places"] [--test]
 * Webhook resolved from JDDM_NEW_PLACES_DISCORD_WEBHOOK or the config file
 *   ~/Library/Application Support/Just Dee Dee Music Map/discord-new-places-webhook.json
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const CONFIG = path.join(homedir(), "Library", "Application Support", "Just Dee Dee Music Map", "discord-new-places-webhook.json");
const WEBHOOK_RE = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/i;

function argValue(flag) {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? String(process.argv[i + 1] || "").trim() : "";
}
function hasFlag(flag) { return process.argv.includes(flag); }

async function resolveWebhook() {
    const env = String(process.env.JDDM_NEW_PLACES_DISCORD_WEBHOOK || "").trim();
    if (env) return env;
    try {
        const cfg = JSON.parse(await readFile(CONFIG, "utf8"));
        return String(cfg.webhookUrl || cfg.url || "").trim();
    } catch { return ""; }
}

export function buildNewPlaceMessage(fields = {}) {
    const name = String(fields.name || "").trim() || "Unnamed venue";
    const bits = [];
    if (fields.city) bits.push(String(fields.city).trim());
    if (fields.status) bits.push(String(fields.status).trim());
    const meta = bits.length ? ` (${bits.join(" · ")})` : "";
    const source = fields.source ? ` via ${String(fields.source).trim()}` : "";
    const prefix = fields.test ? "TEST — " : "";
    return `${prefix}✅ Added to the spreadsheet${source}: **${name}**${meta}`;
}

async function postNewPlace(fields = {}) {
    const url = await resolveWebhook();
    if (!url) return { skipped: true, reason: "no webhook configured" };
    if (!WEBHOOK_RE.test(url)) return { ok: false, reason: "invalid webhook url" };
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "New Places", content: buildNewPlaceMessage(fields).slice(0, 1900) })
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, reason: `HTTP ${res.status} ${String(text).slice(0, 200)}` };
    }
    return { ok: true };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith("notify-new-place.mjs");
if (isMain) {
    const fields = {
        name: argValue("--name"),
        city: argValue("--city"),
        status: argValue("--status"),
        source: argValue("--source"),
        test: hasFlag("--test")
    };
    const result = await postNewPlace(fields);
    if (result.ok) {
        console.log("Posted to #new-places.");
    } else if (result.skipped) {
        console.log(`Skipped: ${result.reason}`);
    } else {
        console.error(`Failed: ${result.reason}`);
        process.exit(1);
    }
}

export { postNewPlace };
