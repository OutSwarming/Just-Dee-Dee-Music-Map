#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodePath = process.execPath;
const reminderScript = path.join(repoRoot, "scripts", "dee-dee-local-text-reminders.mjs");
const label = "com.justdeedeemusic.local-text-reminders";
const launchAgentPath = path.join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
const logPath = path.join(homedir(), "Library", "Logs", "jddm-dee-dee-reminders.log");

function xmlEscape(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

const calendarIntervals = [9, 12, 16, 19].map(hour => `
        <dict>
            <key>Hour</key>
            <integer>${hour}</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>`).join("");

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xmlEscape(nodePath)}</string>
        <string>${xmlEscape(reminderScript)}</string>
        <string>--scheduled</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>${calendarIntervals}
    </array>
    <key>StandardOutPath</key>
    <string>${xmlEscape(logPath)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(logPath)}</string>
</dict>
</plist>
`;

await mkdir(path.dirname(launchAgentPath), { recursive: true });
await writeFile(launchAgentPath, plist);

console.log(`Wrote ${launchAgentPath}`);
console.log("Load it with:");
console.log(`launchctl bootstrap gui/$(id -u) ${launchAgentPath}`);
console.log("Run once now with:");
console.log(`node ${reminderScript} --send available-dates`);
