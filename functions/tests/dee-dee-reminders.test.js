const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const {
    __test: {
        buildDeeDeeReminderBody,
        getDeeDeeReminderConfig,
        handleScheduledDeeDeeReminder,
        handleSendDeeDeeReminder,
        normalizeSmsPhone,
        normalizeSmsPhones,
        selectScheduledDeeDeeReminder
    }
} = require("../index.js");

function makeConfig(overrides = {}) {
    return {
        accountSid: "AC_test",
        authToken: "secret-token",
        from: "+15551234567",
        to: "440-305-4062, 216-849-9292",
        appUrl: "https://example.test/app/",
        ...overrides
    };
}

function makeFirestore(existingIds = []) {
    const docs = new Map(existingIds.map(id => [id, { seeded: true }]));
    const refs = new Map();

    function makeRef(id) {
        if (!refs.has(id)) {
            refs.set(id, {
                id,
                async set(data, options = {}) {
                    const current = docs.get(id) || {};
                    docs.set(id, options.merge ? { ...current, ...data } : data);
                }
            });
        }
        return refs.get(id);
    }

    return {
        docs,
        collection(name) {
            assert.equal(name, "_deeDeeReminderRuns");
            return {
                doc(id) {
                    return makeRef(id);
                }
            };
        },
        async runTransaction(callback) {
            return callback({
                async get(ref) {
                    return {
                        exists: docs.has(ref.id),
                        data: () => docs.get(ref.id)
                    };
                },
                set(ref, data) {
                    docs.set(ref.id, data);
                }
            });
        }
    };
}

describe("Dee Dee automatic SMS reminders", () => {
    it("normalizes configured SMS phone values", () => {
        assert.equal(normalizeSmsPhone("(440) 628-1508"), "+14406281508");
        assert.equal(normalizeSmsPhone("+1 440 628 1508"), "+14406281508");
        assert.deepEqual(normalizeSmsPhones("440-305-4062, 216-849-9292"), ["+14403054062", "+12168499292"]);
    });

    it("requires Twilio configuration before sending", () => {
        assert.throws(
            () => getDeeDeeReminderConfig({ env: {} }),
            /Automatic SMS reminders are not configured/i
        );
    });

    it("builds fun reminder bodies with the app link", () => {
        const body = buildDeeDeeReminderBody({
            text: "Tiny booking manager hat on."
        }, "https://example.test/app/");

        assert.match(body, /Hey Dee Dee!/);
        assert.match(body, /Tiny booking manager hat on/);
        assert.match(body, /Open the app: https:\/\/example\.test\/app\//);
    });

    it("sends an immediate reminder through Twilio", async () => {
        const postCalls = [];
        const result = await handleSendDeeDeeReminder(
            { reminderId: "available-dates" },
            {},
            {
                ...makeConfig(),
                requireAdmin: false,
                axiosPost: async (...args) => {
                    postCalls.push(args);
                    return { data: { sid: `SM${postCalls.length}`, status: "queued" } };
                }
            }
        );

        assert.equal(result.ok, true);
        assert.equal(result.reminderId, "available-dates");
        assert.equal(result.sentCount, 2);
        assert.deepEqual(result.to, ["+14403054062", "+12168499292"]);
        assert.deepEqual(result.sids, ["SM1", "SM2"]);
        assert.equal(postCalls.length, 2);

        const firstFormBody = new URLSearchParams(postCalls[0][1]);
        const secondFormBody = new URLSearchParams(postCalls[1][1]);
        assert.match(postCalls[0][0], /api\.twilio\.com/);
        assert.equal(firstFormBody.get("To"), "+14403054062");
        assert.equal(secondFormBody.get("To"), "+12168499292");
        assert.equal(firstFormBody.get("From"), "+15551234567");
        assert.match(firstFormBody.get("Body"), /Quick calendar quest/);
        assert.match(firstFormBody.get("Body"), /Open the app: https:\/\/example\.test\/app\//);
    });

    it("selects scheduled reminders by New York hour", () => {
        const reminder = selectScheduledDeeDeeReminder(new Date("2026-05-16T16:05:00Z"), {
            timeZone: "America/New_York"
        });
        assert.equal(reminder.id, "available-dates");
        assert.equal(reminder.runKey, "2026-05-16_midday");
    });

    it("deduplicates scheduled reminder runs", async () => {
        const firestore = makeFirestore(["2026-05-16_midday"]);
        let providerCalls = 0;
        const result = await handleScheduledDeeDeeReminder(
            { eventId: "event-1" },
            {
                ...makeConfig(),
                firestore,
                now: new Date("2026-05-16T16:05:00Z"),
                axiosPost: async () => {
                    providerCalls += 1;
                    return { data: { sid: "SM_should_not_send" } };
                }
            }
        );

        assert.equal(result.duplicate, true);
        assert.equal(providerCalls, 0);
    });
});
