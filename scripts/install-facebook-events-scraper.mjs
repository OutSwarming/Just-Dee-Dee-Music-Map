#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pythonPath = process.env.PYTHON || execSync("command -v python3", { encoding: "utf8" }).trim();
const nodePath = execSync("command -v node", { encoding: "utf8" }).trim();
const scraperScript = path.join(repoRoot, "scripts", "facebook_events_scraper.py");
const inputPath = path.join(repoRoot, "data", "artist_sources", "artist_scraper_sources.csv");
const label = "com.justdeedeemusic.facebook-events-scraper";
const launchAgentPath = path.join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
const logPath = path.join(homedir(), "Library", "Logs", "facebook-events-scraper.log");

function xmlEscape(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

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
        <string>--input</string>
        <string>${xmlEscape(inputPath)}</string>
        <string>--mode</string>
        <string>future_only</string>
        <string>--skip-search</string>
        <string>--headless</string>
        <string>--text</string>
        <string>--limit</string>
        <string>25</string>
        <string>--max-scrolls</string>
        <string>6</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${xmlEscape(repoRoot)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>JDDM_NODE_BIN</key>
        <string>${xmlEscape(nodePath)}</string>
        <key>PATH</key>
        <string>${xmlEscape(`${path.dirname(nodePath)}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string>
    </dict>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>6</integer>
        <key>Minute</key>
        <integer>44</integer>
    </dict>
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
console.log(`${pythonPath} ${scraperScript} --input ${inputPath} --mode future_only --skip-search --headless --text --limit 25 --max-scrolls 6`);
