#!/usr/bin/env node
import {notificationRuntime} from './lib/notificationRuntime.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const escape=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const nodePath=await notificationRuntime();
const label='com.justdeedeemusic.follow-ups-due';
const file=path.join(homedir(),'Library/LaunchAgents',label+'.plist');
// Calendar ticks are explicit: StartInterval was deferred on this Mac after failure.
// The worker enforces 8 AM Eastern and skips recipients already sent today.
const intervals=Array.from({length:12},(_,i)=>`<dict><key>Minute</key><integer>${i*5}</integer></dict>`).join('');
const log=escape(path.join(homedir(),'Library/Logs/jddm-dee-dee-reminders.log'));
await mkdir(path.dirname(file),{recursive:true});
await writeFile(file,`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${escape(nodePath)}</string><string>${escape(root+'/scripts/send-due-follow-ups.mjs')}</string></array><key>WorkingDirectory</key><string>${escape(root)}</string><key>StartCalendarInterval</key><array>${intervals}</array><key>RunAtLoad</key><true/><key>StandardOutPath</key><string>${log}</string><key>StandardErrorPath</key><string>${log}</string></dict></plist>`);
console.log('Installed explicit five-minute follow-up checks with an 8 AM Eastern delivery gate.');
