const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const {
    __test: {
        normalizeEntitlement,
        isEffectivePremium,
        requirePremiumCallable,
        handlePremiumRoute,
        handlePremiumGeocode
    }
} = require("../index.js");

function authedContext(uid = "user-a") {
    return { auth: { uid, token: {} } };
}

function getHttpsErrorCode(error) {
    return String(error && error.code ? error.code : "").replace(/^functions\//, "");
}

async function assertRejectsCode(promise, code) {
    await assert.rejects(
        promise,
        (error) => getHttpsErrorCode(error) === code
    );
}

function makeFirestore({ entitlement, exists = true, data } = {}) {
    const state = {
        reads: 0,
        requestedCollection: null,
        requestedDoc: null
    };

    return {
        state,
        collection(collectionName) {
            state.requestedCollection = collectionName;
            return {
                doc(docId) {
                    state.requestedDoc = docId;
                    return {
                        async get() {
                            state.reads += 1;
                            return {
                                exists,
                                data: () => data || { entitlement }
                            };
                        }
                    };
                }
            };
        }
    };
}

const premiumEntitlement = {
    premium: true,
    status: "manual_active",
    source: "admin_override",
    manualOverride: true,
    currentPeriodEnd: null
};

describe("ORS callable full-access helpers", () => {
    it("normalizes missing and malformed entitlements to non-premium", () => {
        assert.deepEqual(normalizeEntitlement(null), {
            premium: false,
            status: "free",
            source: "none",
            manualOverride: false,
            currentPeriodEnd: null
        });
        assert.equal(isEffectivePremium("premium"), false);
        assert.equal(isEffectivePremium({ premium: true, status: "free" }), false);
    });

    it("allows only active and manual_active premium entitlements", () => {
        assert.equal(isEffectivePremium({ premium: true, status: "active" }), true);
        assert.equal(isEffectivePremium({ premium: true, status: "manual_active" }), true);

        for (const status of ["canceled", "expired", "past_due", "trialing", "free"]) {
            assert.equal(isEffectivePremium({ premium: true, status }), false, status);
        }
    });

    it("rejects unauthenticated premium callable requests", async () => {
        await assertRejectsCode(
            requirePremiumCallable({}, "getPremiumRoute", {
                firestore: makeFirestore({ entitlement: premiumEntitlement })
            }),
            "unauthenticated"
        );
    });

    it("includes signed-in users without reading entitlement documents", async () => {
        const firestore = makeFirestore({
            entitlement: { premium: false, status: "free", source: "none" }
        });

        const result = await requirePremiumCallable(authedContext("free-user"), "getPremiumRoute", { firestore });

        assert.equal(result.uid, "free-user");
        assert.deepEqual(result.entitlement, {
            premium: true,
            status: "included",
            source: "client_app",
            manualOverride: true,
            currentPeriodEnd: null
        });
        assert.equal(firestore.state.requestedCollection, null);
        assert.equal(firestore.state.requestedDoc, null);
        assert.equal(firestore.state.reads, 0);
    });

    it("ignores stale or inactive entitlement documents because JDDM includes full access", async () => {
        for (const entitlement of [
            "premium",
            { premium: true },
            { premium: true, status: "canceled" },
            { premium: true, status: "expired" },
            { premium: true, status: "past_due" }
        ]) {
            const firestore = makeFirestore({ entitlement });
            const result = await requirePremiumCallable(authedContext("included-user"), "getPremiumGeocode", {
                firestore
            });

            assert.equal(result.uid, "included-user");
            assert.equal(result.entitlement.premium, true);
            assert.equal(result.entitlement.status, "included");
            assert.equal(firestore.state.reads, 0);
        }
    });

    it("returns an included entitlement even for old manual override users", async () => {
        const result = await requirePremiumCallable(authedContext("premium-user"), "getPremiumRoute", {
            firestore: makeFirestore({ entitlement: premiumEntitlement })
        });

        assert.equal(result.uid, "premium-user");
        assert.equal(result.entitlement.premium, true);
        assert.equal(result.entitlement.status, "included");
    });
});

describe("ORS callable handlers", () => {
    it("allows signed-in route requests through because JDDM includes full access", async () => {
        let postCalls = 0;

        const result = await handlePremiumRoute(
            {
                data: {
                    coordinates: [[-122.4, 37.8], [-122.5, 37.9]],
                    isPremium: false,
                    entitlement: { premium: false, status: "free" }
                }
            },
            authedContext("free-user"),
            {
                firestore: makeFirestore({
                    entitlement: { premium: false, status: "free", source: "none" }
                }),
                getOrsApiKey: () => "test-key",
                axiosPost: async () => {
                    postCalls += 1;
                    return { data: { ok: true } };
                }
            }
        );

        assert.deepEqual(result, { ok: true });
        assert.equal(postCalls, 1);
    });

    it("allows signed-in geocode requests through because JDDM includes full access", async () => {
        let getCalls = 0;

        const result = await handlePremiumGeocode(
            { text: "San Francisco", isPremium: false, uid: "someone-else" },
            authedContext("free-user"),
            {
                firestore: makeFirestore({
                    entitlement: { premium: false, status: "free", source: "none" }
                }),
                getOrsApiKey: () => "test-key",
                axiosGet: async () => {
                    getCalls += 1;
                    return { data: { features: [] } };
                }
            }
        );

        assert.deepEqual(result, { features: [] });
        assert.equal(getCalls, 1);
    });

    it("allows premium route requests through to the ORS transport path", async () => {
        let capturedRequest = null;

        const result = await handlePremiumRoute(
            {
                data: {
                    coordinates: [[-122.4, 37.8], [-122.5, 37.9]],
                    radiuses: [350, 350]
                }
            },
            authedContext("premium-user"),
            {
                firestore: makeFirestore({ entitlement: premiumEntitlement }),
                getOrsApiKey: () => "test-key",
                axiosPost: async (url, body, config) => {
                    capturedRequest = { url, body, config };
                    return { data: { type: "FeatureCollection" } };
                }
            }
        );

        assert.deepEqual(result, { type: "FeatureCollection" });
        assert.match(capturedRequest.url, /openrouteservice\.org\/v2\/directions/);
        assert.deepEqual(capturedRequest.body.radiuses, [350, 350]);
        assert.equal(capturedRequest.config.headers.Authorization, "test-key");
    });

    it("allows premium geocode requests through to the ORS transport path", async () => {
        let capturedUrl = "";

        const result = await handlePremiumGeocode(
            { data: { text: "Seattle", size: 3, country: "US" } },
            authedContext("premium-user"),
            {
                firestore: makeFirestore({ entitlement: premiumEntitlement }),
                getOrsApiKey: () => "test-key",
                axiosGet: async (url) => {
                    capturedUrl = url;
                    return { data: { features: [{ properties: { label: "Seattle" } }] } };
                }
            }
        );

        assert.equal(result.features[0].properties.label, "Seattle");
        assert.match(capturedUrl, /openrouteservice\.org\/geocode\/search/);
        assert.match(capturedUrl, /text=Seattle/);
        assert.match(capturedUrl, /size=3/);
        assert.match(capturedUrl, /boundary\.country=US/);
    });
});
