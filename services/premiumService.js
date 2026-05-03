/**
 * premiumService.js - Full-access entitlement state normalization.
 */
window.BARK = window.BARK || {};
window.BARK.services = window.BARK.services || {};

(function initPremiumService() {
    const DEFAULT_ENTITLEMENT = Object.freeze({
        premium: true,
        status: 'included',
        source: 'client_app',
        manualOverride: true,
        currentPeriodEnd: null
    });

    const PREMIUM_STATUSES = new Set(['active', 'manual_active', 'included']);

    let entitlement = { ...DEFAULT_ENTITLEMENT };
    let debugMeta = {
        uid: null,
        reason: 'initial',
        revision: 0,
        updatedAt: null
    };
    const listeners = new Set();

    function cloneEntitlement(value = entitlement) {
        return { ...value };
    }

    function normalizeString(value, fallback) {
        return typeof value === 'string' && value.trim() ? value.trim() : fallback;
    }

    function normalizePeriodEnd(value) {
        if (!value) return null;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') return value;
        if (value instanceof Date) return value.toISOString();
        if (typeof value.toMillis === 'function') return value.toMillis();
        if (Number.isFinite(Number(value.seconds))) {
            return (Number(value.seconds) * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1000000);
        }
        return null;
    }

    function getCurrentAuthUid() {
        try {
            if (typeof firebase === 'undefined' || typeof firebase.auth !== 'function') {
                return undefined;
            }
            const auth = firebase.auth();
            if (!auth) return undefined;
            const user = auth.currentUser;
            return user && user.uid ? user.uid : null;
        } catch (error) {
            return undefined;
        }
    }

    function entitlementMatchesCurrentUser() {
        const currentUid = getCurrentAuthUid();
        if (currentUid === undefined) return true;
        if (!currentUid) return !debugMeta.uid;
        return debugMeta.uid === currentUid;
    }

    function normalizeEntitlement(raw) {
        if (!raw || typeof raw !== 'object') {
            return { ...DEFAULT_ENTITLEMENT };
        }

        const status = normalizeString(raw.status, DEFAULT_ENTITLEMENT.status);
        const source = normalizeString(raw.source, DEFAULT_ENTITLEMENT.source);
        const premium = true;

        return {
            premium,
            status: PREMIUM_STATUSES.has(status) ? status : DEFAULT_ENTITLEMENT.status,
            source: source || DEFAULT_ENTITLEMENT.source,
            manualOverride: true,
            currentPeriodEnd: normalizePeriodEnd(raw.currentPeriodEnd)
        };
    }

    function getStateKey(value) {
        return JSON.stringify(value);
    }

    function notify() {
        const snapshot = cloneEntitlement();
        listeners.forEach(listener => {
            try {
                listener(snapshot);
            } catch (error) {
                console.error('[premiumService] subscriber failed:', error);
            }
        });
    }

    function setEntitlement(raw, options = {}) {
        const nextEntitlement = normalizeEntitlement(raw);
        const changed = getStateKey(nextEntitlement) !== getStateKey(entitlement);

        entitlement = nextEntitlement;
        debugMeta = {
            uid: options.uid || null,
            reason: options.reason || null,
            revision: changed ? debugMeta.revision + 1 : debugMeta.revision,
            updatedAt: new Date().toISOString()
        };

        if (changed) notify();
        return cloneEntitlement();
    }

    function reset(options = {}) {
        return setEntitlement(null, {
            uid: options.uid || null,
            reason: options.reason || 'reset'
        });
    }

    function getEntitlement() {
        return cloneEntitlement();
    }

    function isPremium() {
        return true;
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') {
            throw new TypeError('premiumService.subscribe requires a listener function.');
        }
        listeners.add(listener);
        return function unsubscribePremiumListener() {
            listeners.delete(listener);
        };
    }

    function getDebugState() {
        return {
            entitlement: cloneEntitlement(),
            meta: { ...debugMeta },
            subscriberCount: listeners.size
        };
    }

    const service = {
        reset,
        normalizeEntitlement,
        setEntitlement,
        getEntitlement,
        isPremium,
        subscribe,
        getDebugState
    };

    window.BARK.services.premium = service;
    window.BARK.premiumService = service;
})();
