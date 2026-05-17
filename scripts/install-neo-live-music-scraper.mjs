#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pythonPath = process.env.PYTHON || execSync("command -v python3", { encoding: "utf8" }).trim();
const scraperScript = path.join(repoRoot, "scripts", "neo_live_music_google_scraper.py");
const userDataDir = path.join(homedir(), "Library", "Application Support", "Just Dee Dee Music Map", "neo-live-music-browser");
const label = "com.justdeedeemusic.neo-live-music-scraper";
const launchAgentPath = path.join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
const logPath = path.join(homedir(), "Library", "Logs", "neo-live-music-scraper.log");

function xmlEscape(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

const intervals = [14, 22].map(hour => `
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
        <string>${xmlEscape(pythonPath)}</string>
        <string>${xmlEscape(scraperScript)}</string>
        <string>--headless</string>
        <string>--text</string>
        <string>--user-data-dir</string>
        <string>${xmlEscape(userDataDir)}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${xmlEscape(repoRoot)}</string>
    <key>StartCalendarInterval</key>
    <array>${intervals}
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
console.log(`${pythonPath} ${scraperScript} --headless --text`);
