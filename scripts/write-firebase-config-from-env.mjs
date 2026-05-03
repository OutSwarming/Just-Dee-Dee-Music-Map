import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const envPath = path.join(repoRoot, '.env.local');
const outputPath = path.join(repoRoot, 'config', 'firebaseConfig.local.js');

const requiredKeys = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID'
];

function parseEnv(text) {
    const env = {};
    text.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const separator = trimmed.indexOf('=');
        if (separator === -1) return;
        const key = trimmed.slice(0, separator).trim();
        let value = trimmed.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    });
    return env;
}

function requireEnv(env, key) {
    const value = env[key];
    if (!value) {
        throw new Error(`Missing ${key} in .env.local`);
    }
    return value;
}

if (!fs.existsSync(envPath)) {
    throw new Error('Missing .env.local. Copy .env.example to .env.local and fill the VITE_FIREBASE_* values from Firebase Console.');
}

const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
const missing = requiredKeys.filter((key) => !env[key]);

if (missing.length > 0) {
    throw new Error(`Missing required Firebase env values: ${missing.join(', ')}`);
}

const projectId = requireEnv(env, 'VITE_FIREBASE_PROJECT_ID');
if (/barkrangermap/i.test(projectId) || /bark-ranger/i.test(projectId)) {
    throw new Error(`Refusing to write BARK Firebase project config for copied Just Dee Dee app: ${projectId}`);
}

const config = {
    apiKey: requireEnv(env, 'VITE_FIREBASE_API_KEY'),
    authDomain: requireEnv(env, 'VITE_FIREBASE_AUTH_DOMAIN'),
    projectId,
    storageBucket: requireEnv(env, 'VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: requireEnv(env, 'VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: requireEnv(env, 'VITE_FIREBASE_APP_ID'),
    measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || ''
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `// Generated from .env.local by npm run firebase:config:local.\n// Do not commit this file.\nwindow.JDDM_FIREBASE_CONFIG = ${JSON.stringify(config, null, 4)};\n`, 'utf8');

console.log(`Wrote ${path.relative(repoRoot, outputPath)} for Firebase project ${projectId}.`);
