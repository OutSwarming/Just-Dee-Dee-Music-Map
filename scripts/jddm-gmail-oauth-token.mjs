#!/usr/bin/env node
/**
 * One-time helper: mint a Gmail refresh token for justdeedeemusic@gmail.com so
 * the Discord email action bot (functions/discordEmailInteractions.js) can send
 * replies and move messages to Spam / Archive / Done on your behalf.
 *
 * Prerequisites (Google Cloud Console, any project — the Firebase one is fine):
 *   1. Enable the Gmail API.
 *   2. OAuth consent screen (Audience): keep it External and "In production" so the
 *      refresh token does not expire. At consent time Google shows an "unverified
 *      app" warning — click Advanced -> Go to <app> -> Allow.
 *   3. Create an OAuth client ID of type **Desktop app**. Copy its Client ID and
 *      Client secret.
 *
 * Run (from the repo root), ready to pick justdeedeemusic@gmail.com in the browser.
 * Easiest is to point it at the client JSON you downloaded from Google:
 *
 *   npm run jddm:gmail-oauth -- /path/to/client_secret_XXXX.json
 *
 * (or pass JDDM_GMAIL_CLIENT_ID / JDDM_GMAIL_CLIENT_SECRET as env vars instead).
 *
 * It prints a URL to open, captures the redirect on 127.0.0.1, and prints the
 * refresh token. Store it as a Firebase secret:
 *
 *   firebase functions:secrets:set JDDM_GMAIL_REFRESH_TOKEN
 */

import http from 'node:http';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let google;
try {
    ({ google } = require('googleapis'));
} catch (error) {
    try {
        ({ google } = require('./../functions/node_modules/googleapis'));
    } catch (innerError) {
        console.error('Could not load "googleapis". Run `npm install` at the repo root (or `npm --prefix functions install`) first.');
        process.exit(1);
    }
}

// Credentials come from either the OAuth client JSON you downloaded from Google
// (preferred — nothing sensitive on the command line) or explicit env vars.
// Pass the JSON path as the first argument or via JDDM_GMAIL_CLIENT_JSON.
let CLIENT_ID = (process.env.JDDM_GMAIL_CLIENT_ID || '').trim();
let CLIENT_SECRET = (process.env.JDDM_GMAIL_CLIENT_SECRET || '').trim();
const jsonPath = (process.argv[2] || process.env.JDDM_GMAIL_CLIENT_JSON || '').trim();
if ((!CLIENT_ID || !CLIENT_SECRET) && jsonPath) {
    try {
        const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const creds = parsed.installed || parsed.web || parsed;
        CLIENT_ID = CLIENT_ID || (creds.client_id || '').trim();
        CLIENT_SECRET = CLIENT_SECRET || (creds.client_secret || '').trim();
    } catch (error) {
        console.error(`Could not read the OAuth client JSON at "${jsonPath}": ${error.message}`);
        process.exit(1);
    }
}
const PORT = Number(process.env.JDDM_GMAIL_OAUTH_PORT || 53682);

const SCOPES = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify'
];

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Provide the OAuth client credentials one of these ways:');
    console.error('  Easiest — point at the JSON you downloaded from Google:');
    console.error('    npm run jddm:gmail-oauth -- /path/to/client_secret_XXXX.json');
    console.error('  Or with env vars:');
    console.error('    JDDM_GMAIL_CLIENT_ID=xxx JDDM_GMAIL_CLIENT_SECRET=yyy npm run jddm:gmail-oauth');
    process.exit(1);
}

const redirectUri = `http://127.0.0.1:${PORT}`;
const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, redirectUri);

const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token even if previously granted
    scope: SCOPES,
    login_hint: 'justdeedeemusic@gmail.com'
});

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, redirectUri);
        const code = url.searchParams.get('code');
        const oauthError = url.searchParams.get('error');
        if (oauthError) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Authorization failed: ' + oauthError + '. You can close this tab.');
            console.error('\nAuthorization was denied or failed:', oauthError);
            server.close();
            process.exit(1);
        }
        if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('No authorization code received. You can close this tab.');
            return;
        }
        const { tokens } = await oauth2.getToken(code);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>Just Dee Dee Music — Gmail authorized.</h2><p>You can close this tab and return to the terminal.</p>');

        if (!tokens.refresh_token) {
            console.error('\nNo refresh_token was returned. Remove this app from');
            console.error('https://myaccount.google.com/permissions and run this script again.');
            server.close();
            process.exit(1);
        }

        console.log('\n=====================================================================');
        console.log('SUCCESS — copy the refresh token below and store it as a secret:');
        console.log('\n  firebase functions:secrets:set JDDM_GMAIL_REFRESH_TOKEN');
        console.log('\nRefresh token:\n');
        console.log(tokens.refresh_token);
        console.log('\nScopes granted: ' + (tokens.scope || SCOPES.join(' ')));
        console.log('=====================================================================\n');
        server.close();
        process.exit(0);
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Token exchange failed. Check the terminal.');
        console.error('\nToken exchange failed:', error && error.message ? error.message : error);
        server.close();
        process.exit(1);
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('Waiting for Google authorization on ' + redirectUri);
    console.log('\n1) Open this URL in a browser signed in as justdeedeemusic@gmail.com:\n');
    console.log(authUrl);
    console.log('\n2) Approve the Gmail permissions. The token will print here automatically.\n');
});
