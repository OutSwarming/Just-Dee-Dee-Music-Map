const functions = require('firebase-functions/v1');
const admin = require("firebase-admin");
const axios = require("axios");
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');
const { createHash, createHmac, randomUUID, timingSafeEqual } = require("crypto");

// Initialize Firebase Admin SDK
admin.initializeApp();

// Keep admin callables compatible with the current admin page. The backend
// still enforces signed-in admin status plus per-admin rate limits.
const ADMIN_CALLABLE_OPTIONS = {};

const ADMIN_RATE_LIMITS = {
    extractParkData: { maxRequests: 20, windowMs: 60 * 1000 },
    syncToSpreadsheet: { maxRequests: 10, windowMs: 60 * 1000 }
};

function getCallableUid(context) {
    return context && context.auth && context.auth.uid ? context.auth.uid : null;
}

async function isAdminUser(uid, token = {}) {
    if (token.admin === true || token.isAdmin === true) return true;

    const userDoc = await admin.firestore().collection("users").doc(uid).get();
    return userDoc.exists && userDoc.data() && userDoc.data().isAdmin === true;
}

async function enforceAdminRateLimit(uid, action) {
    const limit = ADMIN_RATE_LIMITS[action];
    if (!limit) return;

    const now = Date.now();
    const windowStart = Math.floor(now / limit.windowMs) * limit.windowMs;
    const windowEndsAt = windowStart + limit.windowMs;
    const safeUid = encodeURIComponent(uid);
    const safeAction = encodeURIComponent(action);
    const ref = admin.firestore()
        .collection("_adminRateLimits")
        .doc(`${safeAction}_${safeUid}_${windowStart}`);

    await admin.firestore().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const currentCount = snapshot.exists ? Number(snapshot.data().count || 0) : 0;

        if (currentCount >= limit.maxRequests) {
            const retrySeconds = Math.max(1, Math.ceil((windowEndsAt - now) / 1000));
            throw new functions.https.HttpsError(
                "resource-exhausted",
                `Rate limit exceeded. Try again in ${retrySeconds} seconds.`
            );
        }

        transaction.set(ref, {
            uid,
            action,
            count: currentCount + 1,
            windowStart: admin.firestore.Timestamp.fromMillis(windowStart),
            windowEndsAt: admin.firestore.Timestamp.fromMillis(windowEndsAt),
            expiresAt: admin.firestore.Timestamp.fromMillis(windowEndsAt + 24 * 60 * 60 * 1000),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });
}

async function requireAdminCallable(context, action) {
    const uid = getCallableUid(context);
    if (!uid) {
        throw new functions.https.HttpsError("unauthenticated", "Sign in is required.");
    }

    const adminAllowed = await isAdminUser(uid, context.auth.token || {});
    if (!adminAllowed) {
        throw new functions.https.HttpsError("permission-denied", "Admin access is required.");
    }

    await enforceAdminRateLimit(uid, action);
}

function requireAuthCallable(context) {
    const uid = getCallableUid(context);
    if (!uid) {
        throw new functions.https.HttpsError("unauthenticated", "Sign in is required.");
    }
    return uid;
}

const PREMIUM_ENTITLEMENT_STATUSES = new Set(["active", "manual_active", "included"]);

function normalizeEntitlement(raw) {
    const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const status = typeof value.status === "string" && value.status.trim()
        ? value.status.trim()
        : "free";
    const source = typeof value.source === "string" && value.source.trim()
        ? value.source.trim()
        : "none";
    const premium = value.premium === true && PREMIUM_ENTITLEMENT_STATUSES.has(status);

    return {
        premium,
        status,
        source,
        manualOverride: value.manualOverride === true,
        currentPeriodEnd: value.currentPeriodEnd === undefined ? null : value.currentPeriodEnd
    };
}

function isEffectivePremium(raw) {
    return normalizeEntitlement(raw).premium === true;
}

async function requirePremiumCallable(context, action, options = {}) {
    const uid = requireAuthCallable(context);
    return {
        uid,
        entitlement: {
            premium: true,
            status: "included",
            source: "client_app",
            manualOverride: true,
            currentPeriodEnd: null
        }
    };
}

function throwHttpsError(error, fallbackMessage) {
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError("internal", fallbackMessage);
}

const CANONICAL_PARK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanSheetCell(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function getCanonicalParkId(value) {
    const parkId = cleanSheetCell(value);
    return CANONICAL_PARK_ID_PATTERN.test(parkId) ? parkId : '';
}

// ============================================================================
// 1. LEGACY MAP FUNCTIONS (ROUTING & LEADERBOARD)
// ============================================================================

function getCallablePayload(requestOrData) {
    return requestOrData && requestOrData.data ? requestOrData.data : requestOrData || {};
}

function getOrsApiKey(options = {}) {
    return typeof options.getOrsApiKey === "function" ? options.getOrsApiKey() : process.env.ORS_API_KEY;
}

const LEMONSQUEEZY_API_ORIGIN = "https://api.lemonsqueezy.com";
const LEMONSQUEEZY_CHECKOUTS_URL = `${LEMONSQUEEZY_API_ORIGIN}/v1/checkouts`;
const DEFAULT_LEMONSQUEEZY_STORE_ID = "363425";
const DEFAULT_LEMONSQUEEZY_ANNUAL_VARIANT_ID = "1604336";
const DEFAULT_APP_BASE_URL = "https://outswarming.github.io/Just-Dee-Dee-Music-Map/";
const LEMONSQUEEZY_SUPPORTED_EVENTS = new Set([
    "subscription_created",
    "subscription_updated",
    "subscription_resumed",
    "subscription_payment_success",
    "subscription_payment_recovered",
    "subscription_payment_failed",
    "subscription_expired",
    "subscription_cancelled",
    "subscription_payment_refunded",
    "order_refunded"
]);

function cleanOptionalString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isAllowedAppBaseUrl(url) {
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;

    const hostname = url.hostname.toLowerCase();
    return hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1";
}

function getConfiguredAppBaseUrl(options = {}) {
    const env = options.env || process.env;
    const configured = cleanOptionalString(options.appBaseUrl) || cleanOptionalString(env.APP_BASE_URL);
    const rawBaseUrl = configured || DEFAULT_APP_BASE_URL;

    let url;
    try {
        url = new URL(rawBaseUrl);
    } catch (_error) {
        throw new functions.https.HttpsError("failed-precondition", "Checkout return URL is not configured correctly.");
    }

    if (!isAllowedAppBaseUrl(url)) {
        throw new functions.https.HttpsError("failed-precondition", "Checkout return URL is not allowed.");
    }

    return url.toString();
}

function getLemonSqueezyConfig(options = {}) {
    const env = options.env || process.env;
    const apiKey = cleanOptionalString(options.apiKey) || cleanOptionalString(env.LEMONSQUEEZY_API_KEY);

    if (!apiKey) {
        throw new functions.https.HttpsError("failed-precondition", "Checkout service is not configured.");
    }

    return {
        apiKey,
        storeId: DEFAULT_LEMONSQUEEZY_STORE_ID,
        annualVariantId: DEFAULT_LEMONSQUEEZY_ANNUAL_VARIANT_ID,
        appBaseUrl: getConfiguredAppBaseUrl(options)
    };
}

function buildCheckoutReturnUrl(appBaseUrl, state) {
    const url = new URL(appBaseUrl || DEFAULT_APP_BASE_URL);
    url.searchParams.set("checkout", state);
    url.searchParams.set("provider", "lemonsqueezy");
    return url.toString();
}

function buildLemonSqueezyCheckoutPayload({ uid, token = {}, config }) {
    const successUrl = buildCheckoutReturnUrl(config.appBaseUrl, "success");
    const cancelUrl = buildCheckoutReturnUrl(config.appBaseUrl, "canceled");
    const email = cleanOptionalString(token.email);
    const name = cleanOptionalString(token.name) || cleanOptionalString(token.displayName);
    const checkoutData = {
        custom: {
            firebase_uid: uid,
            source: "just_dee_dee_music_map",
            plan: "included",
            cancel_url: cancelUrl
        }
    };

    if (email) checkoutData.email = email;
    if (name) checkoutData.name = name;

    return {
        data: {
            type: "checkouts",
            attributes: {
                test_mode: true,
                product_options: {
                    enabled_variants: [Number(config.annualVariantId)],
                    redirect_url: successUrl,
                    receipt_button_text: "Return to Just Dee Dee Music Live Map",
                    receipt_link_url: successUrl
                },
                checkout_data: checkoutData
            },
            relationships: {
                store: {
                    data: {
                        type: "stores",
                        id: String(config.storeId)
                    }
                },
                variant: {
                    data: {
                        type: "variants",
                        id: String(config.annualVariantId)
                    }
                }
            }
        }
    };
}

function extractLemonSqueezyCheckoutUrl(response) {
    const checkoutUrl = response &&
        response.data &&
        response.data.data &&
        response.data.data.attributes &&
        response.data.data.attributes.url;

    if (!checkoutUrl || typeof checkoutUrl !== "string") {
        throw new functions.https.HttpsError("internal", "Checkout service returned an invalid response.");
    }

    return checkoutUrl;
}

async function handleCreateCheckoutSession(requestOrData, context, options = {}) {
    requireAuthCallable(context);
    throw new functions.https.HttpsError("failed-precondition", "Paid checkout is disabled. Full access is included for this app.");
    /*
    const uid = requireAuthCallable(context);
    const config = getLemonSqueezyConfig(options);
    const token = context && context.auth && context.auth.token ? context.auth.token : {};
    const payload = buildLemonSqueezyCheckoutPayload({ uid, token, config });
    const post = options.axiosPost || axios.post;

    try {
        const response = await post(LEMONSQUEEZY_CHECKOUTS_URL, payload, {
            headers: {
                "Accept": "application/vnd.api+json",
                "Content-Type": "application/vnd.api+json",
                "Authorization": `Bearer ${config.apiKey}`
            }
        });

        return {
            checkoutUrl: extractLemonSqueezyCheckoutUrl(response)
        };
    } catch (error) {
        if (error instanceof functions.https.HttpsError) throw error;
        console.error("[payments] Lemon Squeezy checkout creation failed.", {
            uid,
            status: error && error.response ? error.response.status : null,
            message: error && error.message ? error.message : String(error)
        });
        throw new functions.https.HttpsError("internal", "Unable to create checkout session.");
    }
    */
}

function getHeaderValue(req, name) {
    if (req && typeof req.get === "function") {
        const value = req.get(name);
        if (value) return value;
    }

    const headers = req && req.headers ? req.headers : {};
    const lowerName = name.toLowerCase();
    return headers[name] || headers[lowerName] || null;
}

function getLemonSqueezyWebhookSecret(options = {}) {
    const env = options.env || process.env;
    return cleanOptionalString(options.webhookSecret) || cleanOptionalString(env.LEMONSQUEEZY_WEBHOOK_SECRET);
}

function getRawWebhookBody(req) {
    const rawBody = req && req.rawBody;
    if (Buffer.isBuffer(rawBody)) return rawBody;
    if (typeof rawBody === "string") return Buffer.from(rawBody, "utf8");
    return null;
}

function normalizeLemonSqueezySignature(signature) {
    const value = cleanOptionalString(signature);
    if (!value) return null;
    return value.startsWith("sha256=") ? value.slice("sha256=".length).trim() : value;
}

function verifyLemonSqueezyWebhookSignature(rawBody, signature, secret) {
    const normalizedSignature = normalizeLemonSqueezySignature(signature);
    if (!Buffer.isBuffer(rawBody) || !normalizedSignature || !secret) return false;

    const digest = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
    const received = Buffer.from(normalizedSignature, "utf8");
    if (digest.length !== received.length) return false;
    return timingSafeEqual(digest, received);
}

function deriveLemonSqueezyEventId(payload, rawBody) {
    const meta = payload && payload.meta && typeof payload.meta === "object" ? payload.meta : {};
    const providerId = cleanOptionalString(meta.event_id) ||
        cleanOptionalString(meta.webhook_event_id) ||
        cleanOptionalString(meta.id);
    if (providerId) return providerId;

    const source = Buffer.isBuffer(rawBody)
        ? rawBody
        : Buffer.from(JSON.stringify(payload || {}), "utf8");
    return `derived_${createHash("sha256").update(source).digest("hex")}`;
}

function getLemonSqueezyEventName(payload, req) {
    const meta = payload && payload.meta && typeof payload.meta === "object" ? payload.meta : {};
    return cleanOptionalString(meta.event_name) || cleanOptionalString(getHeaderValue(req, "X-Event-Name")) || "unknown";
}

function getLemonSqueezyCustomData(payload) {
    const meta = payload && payload.meta && typeof payload.meta === "object" ? payload.meta : {};
    return meta.custom_data && typeof meta.custom_data === "object" && !Array.isArray(meta.custom_data)
        ? meta.custom_data
        : {};
}

function isValidFirebaseUid(uid) {
    return typeof uid === "string" && uid.trim() === uid && uid.length > 0 && uid.length <= 128 && !uid.includes("/");
}

function getLemonSqueezyAttributes(payload) {
    return payload &&
        payload.data &&
        payload.data.attributes &&
        typeof payload.data.attributes === "object" &&
        !Array.isArray(payload.data.attributes)
        ? payload.data.attributes
        : {};
}

function getCurrentPeriodEnd(attributes) {
    return cleanOptionalString(attributes.ends_at) ||
        cleanOptionalString(attributes.renews_at) ||
        cleanOptionalString(attributes.trial_ends_at) ||
        null;
}

function isFutureDate(value, nowMs = Date.now()) {
    const text = cleanOptionalString(value);
    if (!text) return false;
    const time = Date.parse(text);
    return Number.isFinite(time) && time > nowMs;
}

function mapLemonSqueezyEntitlement(payload, eventName, options = {}) {
    if (!LEMONSQUEEZY_SUPPORTED_EVENTS.has(eventName)) {
        return { action: "ignore", reason: "unsupported_event" };
    }

    const attributes = getLemonSqueezyAttributes(payload);
    if (attributes.test_mode !== true) {
        return { action: "ignore", reason: "non_test_mode" };
    }

    if (attributes.store_id !== undefined && String(attributes.store_id) !== DEFAULT_LEMONSQUEEZY_STORE_ID) {
        return { action: "ignore", reason: "store_mismatch" };
    }

    const providerStatus = cleanOptionalString(attributes.status);
    const normalizedStatus = providerStatus ? providerStatus.toLowerCase() : "";
    const currentPeriodEnd = getCurrentPeriodEnd(attributes);
    let entitlement = null;

    if (eventName === "subscription_payment_success" || eventName === "subscription_payment_recovered") {
        entitlement = { premium: true, status: "active" };
    } else if (eventName === "subscription_payment_failed") {
        entitlement = { premium: false, status: "past_due" };
    } else if (eventName === "subscription_expired") {
        entitlement = { premium: false, status: "expired" };
    } else if (eventName === "subscription_cancelled") {
        entitlement = isFutureDate(attributes.ends_at, options.nowMs)
            ? { premium: true, status: "active" }
            : { premium: false, status: "canceled" };
    } else if (eventName === "subscription_payment_refunded" || eventName === "order_refunded") {
        entitlement = { premium: false, status: "canceled" };
    } else if (normalizedStatus === "active") {
        entitlement = { premium: true, status: "active" };
    } else if (normalizedStatus === "expired") {
        entitlement = { premium: false, status: "expired" };
    } else if (normalizedStatus === "past_due" || normalizedStatus === "unpaid") {
        entitlement = { premium: false, status: "past_due" };
    } else if (normalizedStatus === "cancelled" || normalizedStatus === "canceled") {
        entitlement = isFutureDate(attributes.ends_at, options.nowMs)
            ? { premium: true, status: "active" }
            : { premium: false, status: "canceled" };
    }

    if (!entitlement) {
        return { action: "ignore", reason: "unsupported_status" };
    }

    return {
        action: "write",
        entitlement: {
            ...entitlement,
            source: "lemon_squeezy",
            providerCustomerId: attributes.customer_id === undefined ? null : String(attributes.customer_id),
            providerSubscriptionId: payload && payload.data && payload.data.type === "subscriptions"
                ? String(payload.data.id)
                : attributes.subscription_id === undefined ? null : String(attributes.subscription_id),
            providerOrderId: payload && payload.data && payload.data.type === "orders"
                ? String(payload.data.id)
                : attributes.order_id === undefined ? null : String(attributes.order_id),
            currentPeriodEnd
        }
    };
}

function getServerTimestamp(options = {}) {
    return typeof options.serverTimestamp === "function"
        ? options.serverTimestamp()
        : admin.firestore.FieldValue.serverTimestamp();
}

function safeResponse(res, status, body) {
    if (res && typeof res.status === "function") {
        res.status(status);
    } else if (res) {
        res.statusCode = status;
    }

    if (res && typeof res.json === "function") return res.json(body);
    if (res && typeof res.send === "function") return res.send(body);
    if (res && typeof res.end === "function") return res.end(JSON.stringify(body));
    return body;
}

async function handleLemonSqueezyWebhook(req, res, options = {}) {
    if (!req || req.method !== "POST") {
        return safeResponse(res, 405, { ok: false, error: "method_not_allowed" });
    }

    const rawBody = getRawWebhookBody(req);
    if (!rawBody || rawBody.length === 0) {
        return safeResponse(res, 400, { ok: false, error: "missing_raw_body" });
    }

    const signature = getHeaderValue(req, "X-Signature");
    if (!signature) {
        return safeResponse(res, 401, { ok: false, error: "missing_signature" });
    }

    const secret = getLemonSqueezyWebhookSecret(options);
    if (!secret) {
        console.error("[payments] Lemon Squeezy webhook secret is not configured.");
        return safeResponse(res, 500, { ok: false, error: "webhook_not_configured" });
    }

    if (!verifyLemonSqueezyWebhookSignature(rawBody, signature, secret)) {
        return safeResponse(res, 401, { ok: false, error: "invalid_signature" });
    }

    let payload;
    try {
        payload = JSON.parse(rawBody.toString("utf8"));
    } catch (_error) {
        return safeResponse(res, 400, { ok: false, error: "invalid_json" });
    }

    const eventName = getLemonSqueezyEventName(payload, req);
    const eventId = deriveLemonSqueezyEventId(payload, rawBody);
    const customData = getLemonSqueezyCustomData(payload);
    const uid = cleanOptionalString(customData.firebase_uid);

    if (!isValidFirebaseUid(uid)) {
        console.warn("[payments] Lemon Squeezy webhook ignored because firebase_uid is missing or invalid.", {
            eventName,
            eventId
        });
        return safeResponse(res, 200, { ok: true, ignored: true, reason: "missing_uid" });
    }

    const mapping = mapLemonSqueezyEntitlement(payload, eventName, options);
    if (mapping.action !== "write") {
        return safeResponse(res, 200, { ok: true, ignored: true, reason: mapping.reason || "ignored" });
    }

    const db = options.firestore || admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const userSnapshot = await userRef.get();
    const userData = userSnapshot && userSnapshot.exists && typeof userSnapshot.data === "function"
        ? userSnapshot.data()
        : {};
    const existingEntitlement = userData && userData.entitlement && typeof userData.entitlement === "object"
        ? userData.entitlement
        : {};

    if (existingEntitlement.lastProviderEventId === eventId) {
        return safeResponse(res, 200, { ok: true, duplicate: true });
    }

    if (existingEntitlement.status === "manual_active" && existingEntitlement.source !== "lemon_squeezy") {
        return safeResponse(res, 200, { ok: true, ignored: true, reason: "manual_override" });
    }

    const entitlement = {
        ...mapping.entitlement,
        updatedAt: getServerTimestamp(options),
        lastProviderEventId: eventId
    };

    await userRef.set({ entitlement }, { merge: true });
    return safeResponse(res, 200, { ok: true });
}

const DEE_DEE_REMINDER_PHONE_DEFAULT = "4406281508";
const DEE_DEE_REMINDER_APP_URL_DEFAULT = DEFAULT_APP_BASE_URL;

const DEE_DEE_REMINDER_TEMPLATES = Object.freeze([
    {
        id: "today-plan",
        label: "Plan Today",
        slot: "morning",
        hour: 9,
        text: "Tiny booking manager hat on: open the app and check today's booking work."
    },
    {
        id: "available-dates",
        label: "Check Dates",
        slot: "midday",
        hour: 12,
        text: "Quick calendar quest: check available dates before promising a gig."
    },
    {
        id: "follow-ups",
        label: "Follow Ups",
        slot: "afternoon",
        hour: 16,
        text: "Friendly nudge hour: check follow-ups and poke the venues waiting on a reply."
    },
    {
        id: "calendar-cleanup",
        label: "Calendar Sync",
        slot: "evening",
        hour: 19,
        text: "Calendar check: make sure new gigs, vacations, and blocked dates are up to date."
    }
]);

function normalizeSmsPhone(value) {
    return cleanSheetCell(value).replace(/[^\d+]/g, "");
}

function getDeeDeeReminderById(id) {
    return DEE_DEE_REMINDER_TEMPLATES.find(reminder => reminder.id === id) || DEE_DEE_REMINDER_TEMPLATES[0];
}

function getDeeDeeReminderConfig(options = {}) {
    const env = options.env || process.env;
    const accountSid = cleanOptionalString(options.accountSid) || cleanOptionalString(env.TWILIO_ACCOUNT_SID);
    const authToken = cleanOptionalString(options.authToken) || cleanOptionalString(env.TWILIO_AUTH_TOKEN);
    const from = normalizeSmsPhone(options.from || env.TWILIO_FROM_NUMBER);
    const to = normalizeSmsPhone(options.to || env.DEE_DEE_REMINDER_PHONE || DEE_DEE_REMINDER_PHONE_DEFAULT);
    const appUrl = cleanOptionalString(options.appUrl) || cleanOptionalString(env.JDDM_APP_URL) || DEE_DEE_REMINDER_APP_URL_DEFAULT;

    if (!accountSid || !authToken || !from || !to) {
        throw new functions.https.HttpsError("failed-precondition", "Automatic SMS reminders are not configured.");
    }

    return { accountSid, authToken, from, to, appUrl };
}

function buildDeeDeeReminderBody(reminder, appUrl) {
    const selected = reminder || DEE_DEE_REMINDER_TEMPLATES[0];
    return [
        `Hey Dee Dee! ${selected.text}`,
        "",
        `Open the app: ${appUrl || DEE_DEE_REMINDER_APP_URL_DEFAULT}`
    ].join("\n");
}

async function sendTwilioSms({ config, body, axiosPost = axios.post }) {
    const params = new URLSearchParams({
        To: config.to,
        From: config.from,
        Body: body
    });
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
    const response = await axiosPost(url, params.toString(), {
        auth: {
            username: config.accountSid,
            password: config.authToken
        },
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        }
    });
    return response && response.data ? response.data : {};
}

async function handleSendDeeDeeReminder(requestOrData, context, options = {}) {
    if (options.requireAdmin !== false) await requireAdminCallable(context, "sendDeeDeeReminder");
    const payload = getCallablePayload(requestOrData);
    const reminder = getDeeDeeReminderById(cleanSheetCell(payload.reminderId));
    const config = getDeeDeeReminderConfig(options);
    const body = buildDeeDeeReminderBody(reminder, config.appUrl);
    const providerResult = await sendTwilioSms({
        config,
        body,
        axiosPost: options.axiosPost || axios.post
    });

    return {
        ok: true,
        reminderId: reminder.id,
        label: reminder.label,
        to: config.to,
        sid: providerResult.sid || null,
        status: providerResult.status || "queued"
    };
}

function getReminderDateParts(date = new Date(), timeZone = "America/New_York") {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hour12: false
    }).formatToParts(date);
    const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return {
        dateKey: `${byType.year}-${byType.month}-${byType.day}`,
        hour: Number(byType.hour)
    };
}

function selectScheduledDeeDeeReminder(date = new Date(), options = {}) {
    const parts = getReminderDateParts(date, options.timeZone || "America/New_York");
    const sorted = DEE_DEE_REMINDER_TEMPLATES.slice().sort((a, b) => Math.abs(a.hour - parts.hour) - Math.abs(b.hour - parts.hour));
    const reminder = sorted[0] || DEE_DEE_REMINDER_TEMPLATES[0];
    return {
        ...reminder,
        runKey: `${parts.dateKey}_${reminder.slot}`
    };
}

async function handleScheduledDeeDeeReminder(context = {}, options = {}) {
    const firestore = options.firestore || admin.firestore();
    const reminder = selectScheduledDeeDeeReminder(options.now || new Date(), options);
    const runRef = firestore.collection("_deeDeeReminderRuns").doc(reminder.runKey);
    let shouldSend = false;

    await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(runRef);
        if (snapshot.exists) return;
        shouldSend = true;
        transaction.set(runRef, {
            reminderId: reminder.id,
            slot: reminder.slot,
            runKey: reminder.runKey,
            createdAt: getServerTimestamp(options),
            scheduleEventId: context.eventId || null
        });
    });

    if (!shouldSend) {
        return { ok: true, duplicate: true, reminderId: reminder.id, runKey: reminder.runKey };
    }

    const config = getDeeDeeReminderConfig(options);
    const body = buildDeeDeeReminderBody(reminder, config.appUrl);
    const providerResult = await sendTwilioSms({
        config,
        body,
        axiosPost: options.axiosPost || axios.post
    });
    await runRef.set({
        sentAt: getServerTimestamp(options),
        providerSid: providerResult.sid || null,
        providerStatus: providerResult.status || "queued"
    }, { merge: true });

    return {
        ok: true,
        reminderId: reminder.id,
        runKey: reminder.runKey,
        sid: providerResult.sid || null,
        status: providerResult.status || "queued"
    };
}

async function handlePremiumRoute(requestOrData, context, options = {}) {
    await requirePremiumCallable(context, "getPremiumRoute", options);

    const payload = getCallablePayload(requestOrData);
    const coordinates = payload.coordinates;
    const radiuses = payload.radiuses;

    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        throw new functions.https.HttpsError("invalid-argument", "Payload mismatch!");
    }

    const apiKey = getOrsApiKey(options);
    if (!apiKey) {
        throw new functions.https.HttpsError("failed-precondition", "Routing service is not configured.");
    }

    const url = "https://api.openrouteservice.org/v2/directions/driving-car/geojson";
    const body = { coordinates };
    if (Array.isArray(radiuses) && radiuses.length === coordinates.length) {
        body.radiuses = radiuses;
    }

    try {
        const post = options.axiosPost || axios.post;
        const response = await post(url, body, {
            headers: {
                "Authorization": apiKey,
                "Content-Type": "application/json",
                "Accept": "application/json, application/geo+json; charset=utf-8"
            }
        });
        return response.data;
    } catch (error) {
        console.error("Networking/ORS Error:", error.message);
        throw new functions.https.HttpsError("internal", "Failed to calculate route.");
    }
}

async function handlePremiumGeocode(requestOrData, context, options = {}) {
    await requirePremiumCallable(context, "getPremiumGeocode", options);

    const payload = getCallablePayload(requestOrData);
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';

    if (!text) {
        throw new functions.https.HttpsError("invalid-argument", "Search query is required.");
    }

    const apiKey = getOrsApiKey(options);
    if (!apiKey) {
        throw new functions.https.HttpsError("failed-precondition", "Geocoding service is not configured.");
    }

    const requestedSize = parseInt(payload.size, 10);
    const size = Number.isFinite(requestedSize) ? Math.min(Math.max(requestedSize, 1), 10) : 5;

    const params = new URLSearchParams({
        api_key: apiKey,
        text,
        size: String(size)
    });
    if (payload.country) {
        params.set('boundary.country', String(payload.country));
    }

    try {
        const get = options.axiosGet || axios.get;
        const response = await get(`https://api.openrouteservice.org/geocode/search?${params.toString()}`);
        return response.data;
    } catch (error) {
        console.error("Networking/ORS Geocode Error:", error.message);
        throw new functions.https.HttpsError("internal", "Failed to perform geocode.");
    }
}

exports.getPremiumRoute = functions
    .runWith({ secrets: ["ORS_API_KEY"] })
    .https.onCall(async (requestOrData, context) => {
        return handlePremiumRoute(requestOrData, context);
    });

exports.getPremiumGeocode = functions
    .runWith({ secrets: ["ORS_API_KEY"] })
    .https.onCall(async (requestOrData, context) => {
        return handlePremiumGeocode(requestOrData, context);
    });

exports.createCheckoutSession = functions
    .https.onCall(async (requestOrData, context) => {
        return handleCreateCheckoutSession(requestOrData, context);
    });

exports.lemonSqueezyWebhook = functions
    .https.onRequest(async (req, res) => {
        return res.status(410).json({ ok: false, error: "paywall_disabled" });
    });

exports.sendDeeDeeReminder = functions
    .runWith({ secrets: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "DEE_DEE_REMINDER_PHONE", "JDDM_APP_URL"] })
    .https.onCall(async (requestOrData, context) => {
        return handleSendDeeDeeReminder(requestOrData, context);
    });

exports.sendScheduledDeeDeeReminders = functions
    .runWith({ secrets: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "DEE_DEE_REMINDER_PHONE", "JDDM_APP_URL"] })
    .pubsub.schedule("0 9,12,16,19 * * *")
    .timeZone("America/New_York")
    .onRun(async (context) => {
        return handleScheduledDeeDeeReminder(context);
    });

if (process.env.NODE_ENV === "test") {
    exports.__test = {
        normalizeEntitlement,
        isEffectivePremium,
        requirePremiumCallable,
        handlePremiumRoute,
        handlePremiumGeocode,
        getLemonSqueezyConfig,
        buildCheckoutReturnUrl,
        buildLemonSqueezyCheckoutPayload,
        extractLemonSqueezyCheckoutUrl,
        handleCreateCheckoutSession,
        verifyLemonSqueezyWebhookSignature,
        deriveLemonSqueezyEventId,
        mapLemonSqueezyEntitlement,
        handleLemonSqueezyWebhook,
        DEE_DEE_REMINDER_TEMPLATES,
        buildDeeDeeReminderBody,
        getDeeDeeReminderConfig,
        getReminderDateParts,
        handleScheduledDeeDeeReminder,
        handleSendDeeDeeReminder,
        normalizeSmsPhone,
        selectScheduledDeeDeeReminder
    };
}

exports.generateHourlyLeaderboard = functions.pubsub.schedule("0 * * * *")
    .timeZone("America/New_York")
    .onRun(async (context) => {
        const db = admin.firestore();
        try {
            const snapshot = await db.collection("leaderboard").orderBy("totalPoints", "desc").limit(100).get();
            const leaderboardArray = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                leaderboardArray.push({
                    uid: doc.id,
                    displayName: data.displayName || "Anonymous Ranger",
                    totalPoints: data.totalPoints || data.totalVisited || 0,
                    totalVisited: data.totalVisited || 0,
                    hasVerified: !!data.hasVerified
                });
            });
            await db.collection("system").doc("leaderboardData").set({
                topUsers: leaderboardArray,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
            return null;
        } catch (error) {
            console.error("Error generating leaderboard:", error);
            return null;
        }
    });

// ============================================================================
// 2. DATA REFINERY: GEMINI AI EXTRACTION
// ============================================================================

// ============================================================================
// 1. DATA REFINERY: GEMINI AI EXTRACTION (The "Bouncer")
// ============================================================================
exports.extractParkData = functions
    .runWith({ ...ADMIN_CALLABLE_OPTIONS, secrets: ["GEMINI_API_KEY", "GEMINI_PAID_API_KEY"], memory: '1GB' })
    .https.onCall(async (data, context) => {
        await requireAdminCallable(context, "extractParkData");
        throw new functions.https.HttpsError("failed-precondition", "Legacy BARK admin extraction is disabled in the Just Dee Dee Music fork.");

        try {
            const payload = data || {};
            // Read the route from the frontend, default to free-3
            const engineRoute = payload.engineRoute || "free-3";
            
            let targetApiKey = "";
            let targetModelName = "";

            // --- THE 7-WAY ROUTING LOGIC ---
            if (engineRoute === "free-3") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-3-flash-preview";
            } 
            else if (engineRoute === "free-31-lite") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-3.1-flash-lite-preview"; 
            }
            else if (engineRoute === "free-25") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-2.5-flash";
            }
            else if (engineRoute === "free-25-lite") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-2.5-flash-lite";
            }
            else if (engineRoute === "free-20") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-2.0-flash";
            }
            else if (engineRoute === "free-20-lite") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-2.0-flash-lite";
            }
            else if (engineRoute === "paid-3") {
                targetApiKey = process.env.GEMINI_PAID_API_KEY;
                targetModelName = "gemini-3-flash-preview";
            }

            if (!targetApiKey) {
                throw new functions.https.HttpsError("failed-precondition", "AI extraction key is not configured for the selected engine.");
            }

            // Initialize the AI with the dynamically selected key and model
            const genAI = new GoogleGenerativeAI(targetApiKey);
            const model = genAI.getGenerativeModel({ model: targetModelName });

            const prompt = `You are a strict data extraction parser for a National Park accessibility database. 
            Analyze the provided text or sequence of images (labeled with their filenames) and extract the B.A.R.K. Ranger data.
            
            CRITICAL FILTERING RULES:
            1. IGNORE restaurants, pubs, city dog parks, festivals, and personal side-trips.
            2. ONLY extract official National Parks, State Parks, National Historic Sites, or locations explicitly stating they have a B.A.R.K. Ranger program.
            
            DATA EXTRACTION RULES:
            - approvedTrails: Specific trails or areas where dogs ARE allowed.
            - strictRules: Where dogs are NOT allowed, stroller rules, and BARK Ranger tag requirements.
            - hazards: Physical dangers or product issues (e.g., weak tag hooks).

            OUTPUT FORMAT:
            You must output an ARRAY of JSON objects. If the post mentions multiple valid parks, create an object for each. 
            
            [
              {
                "sourceImage": "IMG_2281.PNG", // CRITICAL: Use the exact filename provided for the image (e.g., 'IMG_2281.PNG' or 'Text' if not an image).
                "dateFound": "April 2026", // Extract the date the post was made if visible in the text or header.
                "parkName": "Name of official park",
                "entranceFee": "...",
                "swagLocation": "...",
                "approvedTrails": "...",
                "strictRules": "...",
                "hazards": "...",
                "extraSwag": "..."
              }
            ]
            
            Output ONLY a valid JSON array. No markdown, no explanations.`;

            let parts = [];
            
            // 1. TRUE BUNDLE BATCHING: Now with filenames
            if (payload.images && payload.images.length > 0) {
                payload.images.forEach((imgObj) => {
                    const cleanBase64 = imgObj.data.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
                    
                    // We label the part so the AI knows which name belongs to which image
                    parts.push(`--- START OF IMAGE: ${imgObj.name} ---`);
                    parts.push({ inlineData: { data: cleanBase64, mimeType: "image/jpeg" } });
                });
                // Add the text prompt at the very end of the pile
                parts.push(prompt);
            } 
            // 2. Fallback for a single image
            else if (payload.image) {
                const base64String = payload.image.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
                parts = [{ inlineData: { data: base64String, mimeType: "image/jpeg" } }, prompt];
            } 
            // 3. Fallback for raw text
            else {
                parts = [payload.text, prompt];
            }

            const result = await model.generateContent(parts);
            const responseText = result.response.text();
            const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const aiData = JSON.parse(cleanedText);
            console.log("AI RAW OUTPUT:", JSON.stringify(aiData, null, 2));
            return aiData;
        } catch (error) {
            console.error("AI Error:", error);
            throwHttpsError(error, error.message || "AI extraction failed.");
        }
    });

// ============================================================================
// 2. SPREADSHEET BRIDGE: THE NEW SITE GUARDRAIL
// ============================================================================
exports.syncToSpreadsheet = functions
    .runWith(ADMIN_CALLABLE_OPTIONS)
    .https.onCall(async (data, context) => {
        await requireAdminCallable(context, "syncToSpreadsheet");
        throw new functions.https.HttpsError("failed-precondition", "Legacy BARK spreadsheet sync is disabled in the Just Dee Dee Music fork.");

        try {
            const auth = new google.auth.GoogleAuth({
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            });
            const sheets = google.sheets({ version: 'v4', auth });

            const spreadsheetId = '1fnlZfRbfQIy-o2Df6FgEdTMw9OWTR3-JX011s-7oWlE'; 
            const sheetName = 'National B.A.R.K Ranger'; 
            const newPark = data; 

            // 1. Fetch the ENTIRE row through Park ID so updates can preserve it.
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: `'${sheetName}'!A:P`,
            });

            const rows = response.data.values || [];
        
        // --- HIGH-PRECISION MATCHING ENGINE ---
        const superNormalize = (str) => {
            let s = str.toLowerCase();
            s = s.replace(/\./g, ' '); 
            s = s.replace(/&/g, 'and');
            s = s.replace(/\bmt\b/g, 'mount');
            s = s.replace(/\bft\b/g, 'fort');
            s = s.replace(/\bst\b/g, 'saint');
            s = s.replace(/\bnp\b/g, 'national park');
            s = s.replace(/\bnm\b/g, 'national monument');
            s = s.replace(/\bnhs\b/g, 'national historic site');
            s = s.replace(/\bnra\b/g, 'national recreation area');
            s = s.replace(/\b96\b/g, 'ninetysix');
            return s.replace(/[^a-z0-9]/g, '');
        };
        
        const aiNameNorm = superNormalize(newPark.parkName);
        let bestMatch = { rowIndex: -1, score: 0, lengthDiff: 999 };

        for (let i = 0; i < rows.length; i++) {
            if (!rows[i][0]) continue;
            
            const sheetNameNorm = superNormalize(rows[i][0]);
            let currentScore = 0;

            if (sheetNameNorm === aiNameNorm) {
                currentScore = 100;
            } else if (sheetNameNorm.includes(aiNameNorm) || aiNameNorm.includes(sheetNameNorm)) {
                currentScore = 80;
            }

            const currentDiff = Math.abs(sheetNameNorm.length - aiNameNorm.length);

            if (currentScore > bestMatch.score) {
                bestMatch = { rowIndex: i + 1, score: currentScore, lengthDiff: currentDiff };
            } else if (currentScore === bestMatch.score && currentScore > 0) {
                if (currentDiff < bestMatch.lengthDiff) {
                    bestMatch = { rowIndex: i + 1, score: currentScore, lengthDiff: currentDiff };
                }
            }
        }

        // --- SMART MERGE LOGIC ---
        const dateString = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
        
        const mergeCell = (oldVal, newVal) => {
            if (!newVal || newVal.trim() === '') return oldVal || '';
            if (!oldVal || oldVal.trim() === '') return newVal;
            if (oldVal.includes(newVal.trim())) return oldVal;
            return `${oldVal}\n\n[${dateString}]: ${newVal}`;
        };

        // --- GEOLOCATION INTEGRITY ENGINE ---
        let existingLat = null;
        let existingLng = null;

        if (bestMatch.rowIndex !== -1) {
            const existingRow = rows[bestMatch.rowIndex - 1] || [];
            existingLat = existingRow[7]; // Column H
            existingLng = existingRow[8]; // Column I
        }

        // Only Geocode if missing OR forceGeocode is true
        if (!existingLat || !existingLng || newPark.forceGeocode === true) {
            try {
                const googleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
                if (!googleMapsKey) {
                    console.warn(`GOOGLE_MAPS_API_KEY not configured; skipping geocoding for ${newPark.parkName}`);
                } else {
                    console.log(`Geocoding: ${newPark.parkName}...`);
                    const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(newPark.parkName)}&key=${googleMapsKey}`;
                    const geoResponse = await axios.get(geoUrl);
                    if (geoResponse.data.results && geoResponse.data.results.length > 0) {
                        const location = geoResponse.data.results[0].geometry.location;
                        newPark.lat = location.lat;
                        newPark.lng = location.lng;
                        console.log(`Found Coords: ${newPark.lat}, ${newPark.lng}`);
                    }
                }
            } catch (e) {
                console.error("Geocoding failed:", e.message);
            }
        } else {
            newPark.lat = existingLat;
            newPark.lng = existingLng;
            console.log(`Locked: Using existing coordinates for ${newPark.parkName}`);
        }

        // 2. Perform the Update or Append
        if (bestMatch.rowIndex !== -1 && bestMatch.score >= 80) {
            const existingRow = rows[bestMatch.rowIndex - 1] || [];
            
            const existingParkId = cleanSheetCell(existingRow[15]); // Column P

            // Map the spreadsheet columns: H=7, I=8, J=9, K=10, L=11, M=12, N=13, O=14.
            // Column P is Park ID and must never be overwritten by refinery updates.
            const updateData = [
                newPark.lat || existingLat || '',  // H
                newPark.lng || existingLng || '',  // I
                mergeCell(existingRow[9], newPark.entranceFee), // J
                mergeCell(existingRow[10], newPark.swagLocation), // K
                mergeCell(existingRow[11], newPark.approvedTrails), // L
                mergeCell(existingRow[12], newPark.strictRules), // M
                mergeCell(existingRow[13], newPark.hazards), // N
                mergeCell(existingRow[14], newPark.extraSwag) // O
            ];

            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: `'${sheetName}'!H${bestMatch.rowIndex}:O${bestMatch.rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [updateData] }
            });
            return { success: true, action: 'updated', row: bestMatch.rowIndex, confidence: bestMatch.score, parkIdPreserved: existingParkId || null };
        } else {
            // NEW GUARDRAIL: Only append if the frontend explicitly gave permission
            if (newPark.allowAppend !== true) {
                return { 
                    success: false, 
                    requiresConfirmation: true, 
                    message: `⚠️ New Site Detected: "${newPark.parkName}"` 
                };
            }

            const appendParkId = getCanonicalParkId(newPark.parkId) || randomUUID();
            const appendData = [
                newPark.parkName, "", "", "", "", "", "", 
                newPark.lat || '', 
                newPark.lng || '', 
                newPark.entranceFee, newPark.swagLocation, newPark.approvedTrails, 
                newPark.strictRules, newPark.hazards, newPark.extraSwag,
                appendParkId
            ];
            await sheets.spreadsheets.values.append({
                spreadsheetId: spreadsheetId,
                range: `'${sheetName}'!A:P`,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                resource: { values: [appendData] }
            });
            return { success: true, action: 'appended', parkId: appendParkId };
        }
    } catch (error) {
        console.error("Spreadsheet Error:", error);
        throwHttpsError(error, 'Failed to sync to Sheets');
    }
});
