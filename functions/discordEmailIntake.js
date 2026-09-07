'use strict';

// Apps Script's fixed User-Agent is rejected by Discord (40333). This adapter
// uses Discord's documented bot client format and exposes only the JDDM forum.
// Credentials are passed through in memory; Discord authenticates every call.
const BOT_ID = '1546320745225785346';
const CHANNEL_ID = '1543777722042679436';
const CHANNEL_PATH = `/channels/${CHANNEL_ID}`;
const USER_AGENT = 'DiscordBot (https://outswarming.github.io/Just-Dee-Dee-Music-Map/, 1.0)';

function createDiscordEmailIntakeHandler({ fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    return async function discordEmailIntake(req, res) {
        res.set('Cache-Control', 'no-store');
        // Keep Discord's credential out of the platform's IAM Authorization header.
        const authorization = String(req.get('x-jddm-bot-authorization') || '');
        const match = /^Bot ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(authorization);
        if (!match || authorization.length > 160 || Buffer.from(match[1], 'base64url').toString() !== BOT_ID) {
            return res.status(401).json({ message: 'The JDDM bot credential is required.' });
        }
        const routeAllowed = (req.method === 'GET' && req.path === CHANNEL_PATH) ||
            (req.method === 'POST' && req.path === CHANNEL_PATH + '/threads');
        if (!routeAllowed) return res.status(404).json({ message: 'Unsupported JDDM intake route.' });

        let body;
        if (req.method === 'POST') {
            const payload = req.body;
            if (!payload || typeof payload.name !== 'string' || !payload.name.trim() ||
                payload.name.length > 100 || !payload.message || typeof payload.message !== 'object' || Array.isArray(payload.message)) {
                return res.status(400).json({ message: 'A forum post name and message are required.' });
            }
            body = JSON.stringify({ ...payload, message: { ...payload.message, allowed_mentions: { parse: [] } } });
            if (Buffer.byteLength(body) > 32768) return res.status(413).json({ message: 'Email post is too large.' });
        }
        try {
            // Retry only explicit rate limits, never ambiguous network failures
            // after POST, because those retries could duplicate email posts.
            for (let attempt = 0; attempt < 3; attempt++) {
                const upstream = await fetchImpl('https://discord.com/api/v10' + req.path, {
                    method: req.method,
                    headers: { Authorization: authorization, 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
                    body,
                    redirect: 'error',
                    signal: AbortSignal.timeout(12000)
                });
                const responseBody = await upstream.text();
                if (upstream.status === 429 && attempt < 2) {
                    let retrySeconds;
                    try { retrySeconds = Number(JSON.parse(responseBody).retry_after); } catch (_) { /* preserve response */ }
                    if (Number.isFinite(retrySeconds) && retrySeconds >= 0 && retrySeconds <= 5) {
                        await sleep(Math.ceil(retrySeconds * 1000) + 100);
                        continue;
                    }
                }
                res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
                const retryAfter = upstream.headers.get('retry-after');
                if (retryAfter) res.set('Retry-After', retryAfter);
                return res.status(upstream.status).send(responseBody);
            }
        } catch (_) {
            return res.status(502).json({ message: 'Discord could not be reached. Delivery may be uncertain; check the forum before retrying.' });
        }
    };
}

module.exports = { createDiscordEmailIntakeHandler, BOT_ID, CHANNEL_ID, USER_AGENT };
