#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MESSAGES_DB_PATH = path.join(homedir(), "Library", "Messages", "chat.db");
const SERVICE_PRIORITY = ["iMessage", "SMS"];

function getArgValue(flag) {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : "";
}

function appleString(value) {
    return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function appleMessageDate(date) {
    return Math.floor((date.getTime() / 1000 - 978307200) * 1000000000);
}

function sqlString(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

async function sendViaService({ body, recipient, serviceType }) {
    const serviceTest = serviceType === "SMS" ? "SMS" : "iMessage";
    const script = `
        set messageBody to ${appleString(body)}
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
            send messageBody to buddy targetNumber of selectedService
        end tell
        return "${serviceType}"
    `;
    const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 90000 });
    return stdout.trim();
}

async function readLatestStatus(recipient, since) {
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

async function sendMessage({ body, recipient }) {
    const startedAt = new Date();
    const errors = [];
    for (const serviceType of SERVICE_PRIORITY) {
        try {
            const service = await sendViaService({ body, recipient, serviceType });
            await new Promise(resolve => setTimeout(resolve, 2500));
            const status = await readLatestStatus(recipient, startedAt);
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

async function main() {
    const phone = getArgValue("--phone");
    const messageFile = getArgValue("--message-file");
    const inlineMessage = getArgValue("--message");
    const body = messageFile ? await readFile(messageFile, "utf8") : inlineMessage;

    if (!phone || !body) throw new Error("Usage: send-local-message.mjs --phone +14403054062 --message-file /tmp/message.txt");

    const result = await sendMessage({ body, recipient: phone });
    console.log(`sent ${result.recipient} via ${result.service}`);
}

main().catch(error => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
});
