#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pythonPath = process.env.PYTHON || execSync("command -v python3", { encoding: "utf8" }).trim();
const nodePath = execSync("command -v node", { encoding: "utf8" }).trim();
const syncScript = path.join(repoRoot, "scripts", "sync-artist-gig-tracker.py");
const label = "com.justdeedeemusic.artist-gig-tracker-sync";
const launchAgentPath = path.join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
const logPath = path.join(homedir(), "Library", "Logs", "jddm-artist-gig-tracker-sync.log");

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
        <string>${xmlEscape(syncScript)}</string>
        <string>--import-google-sheet</string>
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
        <integer>8</integer>
        <key>Minute</key>
        <integer>30</integer>
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
console.log(`${pythonPath} ${syncScript} --import-google-sheet`);
