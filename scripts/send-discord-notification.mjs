#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {postNotification} from './lib/notificationClient.mjs';
const arg=n=>process.argv[process.argv.indexOf(n)+1];
const kind=arg('--kind'),file=arg('--message-file');
if(!process.argv.includes('--kind')||!process.argv.includes('--message-file'))throw Error('Notification kind and message file required');
const result=await postNotification(kind,await readFile(file,'utf8'));
console.log(JSON.stringify(result));
