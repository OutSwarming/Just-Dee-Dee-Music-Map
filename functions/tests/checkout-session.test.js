const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const {
    __test: {
        handleCreateCheckoutSession
    }
} = require("../index.js");

function authedContext(uid = "user-a", token = {}) {
    return { auth: { uid, token } };
}

function getHttpsErrorCode(error) {
    return String(error && error.code ? error.code : "").replace(/^functions\//, "");
}

async function assertRejectsCode(promise, code, messagePattern) {
    await assert.rejects(
        promise,
        (error) => {
            assert.equal(getHttpsErrorCode(error), code);
            if (messagePattern) assert.match(error.message, messagePattern);
            return true;
        }
    );
}

describe("Disabled paid checkout callable", () => {
    it("still requires sign-in before returning checkout state", async () => {
        await assertRejectsCode(
            handleCreateCheckoutSession({}, {}, {
                axiosPost: async () => {
                    throw new Error("checkout provider should not be called");
                }
            }),
            "unauthenticated"
        );
    });

    it("fails closed for signed-in users because full access is included", async () => {
        let providerCalled = false;

        await assertRejectsCode(
            handleCreateCheckoutSession(
                {
                    uid: "client-forged",
                    variantId: "client-variant",
                    successUrl: "https://attacker.example/success"
                },
                authedContext("server-user", {
                    email: "server-user@example.test",
                    name: "Server User"
                }),
                {
                    apiKey: "test-api-key",
                    axiosPost: async () => {
                        providerCalled = true;
                        throw new Error("checkout provider should not be called");
                    }
                }
            ),
            "failed-precondition",
            /Full access is included/i
        );

        assert.equal(providerCalled, false);
    });
});
