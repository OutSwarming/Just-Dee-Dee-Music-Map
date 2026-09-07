#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
const file=path.join(homedir(),'Library/LaunchAgents/com.justdeedeemusic.follow-ups-due.plist');
// Keep the 8 AM launch and poll every five minutes for missed/failed delivery.
// The worker enforces Eastern time and checkpoints each of the two recipients.
const root=path.resolve('scripts/send-due-follow-ups.mjs');
const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>com.justdeedeemusic.follow-ups-due</string><key>ProgramArguments</key><array><string>${process.execPath}</string><string>${root}</string><string>--no-discord</string></array><key>StartCalendarInterval</key><dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict><key>StartInterval</key><integer>300</integer><key>RunAtLoad</key><true/><key>StandardOutPath</key><string>${homedir()}/Library/Logs/jddm-dee-dee-reminders.log</string><key>StandardErrorPath</key><string>${homedir()}/Library/Logs/jddm-dee-dee-reminders.log</string></dict></plist>`;
await writeFile(file,xml);
console.log('Updated daily follow-up worker: Eastern 8 AM, per-recipient retries, two recipients only.');
