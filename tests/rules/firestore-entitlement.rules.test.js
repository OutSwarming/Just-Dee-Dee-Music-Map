const { after, before, beforeEach, describe, it } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} = require('@firebase/rules-unit-testing');

const {
    collection,
    deleteDoc,
    doc,
    getDoc,
    serverTimestamp,
    setDoc,
    updateDoc
} = require('firebase/firestore');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-jddm-rules-test';
const RULES_PATH = path.resolve(__dirname, '../../firestore.rules');

let testEnv;

function authedDb(uid) {
    return testEnv.authenticatedContext(uid).firestore();
}

function unauthDb() {
    return testEnv.unauthenticatedContext().firestore();
}

async function seedDoc(pathSegments, data) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), ...pathSegments), data);
    });
}

describe('Firestore entitlement and admin field rules', () => {
    before(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: PROJECT_ID,
            firestore: {
                rules: fs.readFileSync(RULES_PATH, 'utf8')
            }
        });
    });

    beforeEach(async () => {
        await testEnv.clearFirestore();
    });

    after(async () => {
        await testEnv.cleanup();
    });

    it('allows a user to read only their own user document', async () => {
        await seedDoc(['users', 'alice'], {
            settings: { mapStyle: 'default' },
            entitlement: { premium: true, status: 'manual_active' }
        });
        await seedDoc(['users', 'bob'], {
            settings: { mapStyle: 'satellite' }
        });

        const aliceDb = authedDb('alice');

        await assertSucceeds(getDoc(doc(aliceDb, 'users', 'alice')));
        await assertFails(getDoc(doc(aliceDb, 'users', 'bob')));
    });

    it('denies unauthenticated user document and savedRoutes access', async () => {
        const publicDb = unauthDb();

        await assertFails(setDoc(doc(publicDb, 'users', 'alice'), {
            settings: { mapStyle: 'default' }
        }));

        await seedDoc(['users', 'alice'], {
            settings: { mapStyle: 'default' },
            visitedPlaces: []
        });
        await seedDoc(['users', 'alice', 'savedRoutes', 'route1'], {
            tripName: 'Seeded Route',
            createdAt: 1710000000000,
            tripDays: []
        });

        await assertFails(getDoc(doc(publicDb, 'users', 'alice')));
        await assertFails(updateDoc(doc(publicDb, 'users', 'alice'), {
            settings: { mapStyle: 'terrain' }
        }));
        await assertFails(getDoc(doc(publicDb, 'users', 'alice', 'savedRoutes', 'route1')));
        await assertFails(setDoc(doc(publicDb, 'users', 'alice', 'savedRoutes', 'route1'), {
            tripName: 'Unauthenticated Write',
            createdAt: 1710000000001,
            tripDays: []
        }));
    });

    it('allows current app-owned settings and visitedPlaces writes on the owner user document', async () => {
        const aliceDb = authedDb('alice');
        const aliceRef = doc(aliceDb, 'users', 'alice');

        await assertSucceeds(setDoc(aliceRef, {
            settings: {
                mapStyle: 'default',
                visitedFilter: 'all',
                premiumClustering: false
            }
        }));

        await assertSucceeds(updateDoc(aliceRef, {
            visitedPlaces: [
                { id: 'yosemite', name: 'Yosemite', ts: 1710000000000 }
            ]
        }));
    });

    it('allows allowed user writes while preserving server-written entitlement', async () => {
        await seedDoc(['users', 'alice'], {
            entitlement: {
                premium: true,
                status: 'manual_active',
                source: 'admin_override',
                manualOverride: true,
                currentPeriodEnd: null
            },
            settings: { mapStyle: 'default' }
        });

        const aliceDb = authedDb('alice');
        const aliceRef = doc(aliceDb, 'users', 'alice');

        await assertSucceeds(updateDoc(aliceRef, {
            settings: { mapStyle: 'terrain', visitedFilter: 'visited' },
            visitedPlaces: [{ id: 'zion', name: 'Zion', ts: 1710000000001 }]
        }));
    });

    it('denies creating a user document with entitlement fields', async () => {
        const aliceDb = authedDb('alice');

        await assertFails(setDoc(doc(aliceDb, 'users', 'alice'), {
            settings: { mapStyle: 'default' },
            entitlement: {
                premium: true,
                status: 'manual_active'
            }
        }));
    });

    it('denies updating entitlement fields, including nested entitlement.premium', async () => {
        await seedDoc(['users', 'alice'], {
            settings: { mapStyle: 'default' },
            entitlement: {
                premium: false,
                status: 'free',
                source: 'none',
                manualOverride: false,
                currentPeriodEnd: null
            }
        });

        const aliceDb = authedDb('alice');
        const aliceRef = doc(aliceDb, 'users', 'alice');

        await assertFails(updateDoc(aliceRef, {
            entitlement: {
                premium: true,
                status: 'manual_active',
                source: 'admin_override',
                manualOverride: true,
                currentPeriodEnd: null
            }
        }));

        await assertFails(updateDoc(aliceRef, {
            'entitlement.premium': true
        }));

        await assertFails(updateDoc(aliceRef, {
            'entitlement.status': 'manual_active'
        }));
    });

    it('denies top-level premium, provider, and admin escalation fields', async () => {
        const protectedFields = [
            ['premium', true],
            ['premiumStatus', 'active'],
            ['subscription', { status: 'active' }],
            ['subscriptions', [{ status: 'active' }]],
            ['plan', 'pro'],
            ['manualOverride', true],
            ['providerCustomerId', 'cus_test'],
            ['providerSubscriptionId', 'sub_test'],
            ['currentPeriodEnd', 1999999999999],
            ['source', 'admin_override'],
            ['status', 'manual_active'],
            ['isAdmin', true],
            ['admin', true],
            ['role', 'admin'],
            ['roles', ['admin']]
        ];

        const aliceDb = authedDb('alice');

        for (const [field, value] of protectedFields) {
            await assertFails(setDoc(doc(aliceDb, 'users', `alice-${field}`), {
                settings: { mapStyle: 'default' },
                [field]: value
            }));
        }
    });

    it('denies deleting the owner user document', async () => {
        await seedDoc(['users', 'alice'], {
            settings: { mapStyle: 'default' },
            entitlement: { premium: true, status: 'manual_active' }
        });

        const aliceDb = authedDb('alice');

        await assertFails(deleteDoc(doc(aliceDb, 'users', 'alice')));
    });

    it('allows own savedRoutes and denies another user savedRoutes', async () => {
        const aliceDb = authedDb('alice');

        await assertSucceeds(setDoc(doc(aliceDb, 'users', 'alice', 'savedRoutes', 'route-1'), {
            tripName: 'Rules Test Trip',
            createdAt: 1710000000000,
            tripDays: []
        }));

        await assertSucceeds(getDoc(doc(aliceDb, 'users', 'alice', 'savedRoutes', 'route-1')));
        await assertFails(setDoc(doc(aliceDb, 'users', 'bob', 'savedRoutes', 'route-1'), {
            tripName: 'Other User Trip',
            createdAt: 1710000000000,
            tripDays: []
        }));
        await assertFails(getDoc(doc(aliceDb, 'users', 'bob', 'savedRoutes', 'route-1')));
    });

    it('allows owner to read and write their own achievements', async () => {
        const aliceDb = authedDb('alice');
        const achievementRef = doc(aliceDb, 'users', 'alice', 'achievements', 'bronzePaw');

        await assertSucceeds(setDoc(achievementRef, {
            achievementId: 'bronzePaw',
            tier: 'honor',
            dateEarned: serverTimestamp()
        }));

        await assertSucceeds(getDoc(achievementRef));

        await assertSucceeds(setDoc(achievementRef, {
            achievementId: 'bronzePaw',
            tier: 'verified',
            dateEarned: serverTimestamp()
        }, { merge: true }));
    });

    it('allows exact BUG-001 owner achievement path and denies unsafe access', async () => {
        const runtimeUid = 'LkevgscKPvPqRg9c5YKKXVqtwv02';
        const achievementId = 'bug001RuntimeSmoke';
        const ownerDb = authedDb(runtimeUid);
        const otherDb = authedDb('not-the-runtime-owner');
        const publicDb = unauthDb();
        const ownerAchievementRef = doc(ownerDb, 'users', runtimeUid, 'achievements', achievementId);

        await assertSucceeds(setDoc(ownerAchievementRef, {
            achievementId,
            tier: 'verified',
            dateEarned: serverTimestamp()
        }));

        await assertSucceeds(getDoc(ownerAchievementRef));

        await assertFails(setDoc(doc(otherDb, 'users', runtimeUid, 'achievements', achievementId), {
            achievementId,
            tier: 'verified',
            dateEarned: serverTimestamp()
        }));

        await assertFails(setDoc(doc(publicDb, 'users', runtimeUid, 'achievements', achievementId), {
            achievementId,
            tier: 'verified',
            dateEarned: serverTimestamp()
        }));

        await assertFails(setDoc(ownerAchievementRef, {
            achievementId,
            tier: 'verified',
            dateEarned: serverTimestamp(),
            admin: true
        }));

        await assertFails(deleteDoc(ownerAchievementRef));
    });

    it('denies reading and writing another user achievements', async () => {
        await seedDoc(['users', 'bob', 'achievements', 'bronzePaw'], {
            achievementId: 'bronzePaw',
            tier: 'honor',
            dateEarned: new Date('2026-01-01T00:00:00.000Z')
        });

        const aliceDb = authedDb('alice');

        await assertFails(getDoc(doc(aliceDb, 'users', 'bob', 'achievements', 'bronzePaw')));
        await assertFails(setDoc(doc(aliceDb, 'users', 'bob', 'achievements', 'silverPaw'), {
            achievementId: 'silverPaw',
            tier: 'honor',
            dateEarned: serverTimestamp()
        }));
    });

    it('denies unauthenticated achievement reads and writes', async () => {
        await seedDoc(['users', 'alice', 'achievements', 'bronzePaw'], {
            achievementId: 'bronzePaw',
            tier: 'honor',
            dateEarned: new Date('2026-01-01T00:00:00.000Z')
        });

        const publicDb = unauthDb();

        await assertFails(getDoc(doc(publicDb, 'users', 'alice', 'achievements', 'bronzePaw')));
        await assertFails(setDoc(doc(publicDb, 'users', 'alice', 'achievements', 'silverPaw'), {
            achievementId: 'silverPaw',
            tier: 'honor',
            dateEarned: serverTimestamp()
        }));
    });

    it('denies achievements with unexpected or dangerous fields', async () => {
        const aliceDb = authedDb('alice');

        await assertFails(setDoc(doc(aliceDb, 'users', 'alice', 'achievements', 'bronzePaw'), {
            achievementId: 'bronzePaw',
            tier: 'honor',
            dateEarned: serverTimestamp(),
            entitlement: { premium: true, status: 'manual_active' }
        }));

        await assertFails(setDoc(doc(aliceDb, 'users', 'alice', 'achievements', 'silverPaw'), {
            achievementId: 'silverPaw',
            tier: 'honor',
            dateEarned: serverTimestamp(),
            isAdmin: true
        }));

        await assertFails(setDoc(doc(aliceDb, 'users', 'alice', 'achievements', 'goldPaw'), {
            achievementId: 'wrong-id',
            tier: 'honor',
            dateEarned: serverTimestamp()
        }));

        await assertFails(setDoc(doc(aliceDb, 'users', 'alice', 'achievements', 'platinumPaw'), {
            achievementId: 'platinumPaw',
            tier: 'admin',
            dateEarned: serverTimestamp()
        }));
    });

    it('allows owner leaderboard writes and denies writing another user leaderboard doc', async () => {
        const aliceDb = authedDb('alice');

        await assertSucceeds(setDoc(doc(aliceDb, 'leaderboard', 'alice'), {
            displayName: 'Alice',
            photoURL: '',
            totalPoints: 42,
            totalVisited: 3,
            hasVerified: false
        }));

        await assertFails(setDoc(doc(aliceDb, 'leaderboard', 'bob'), {
            displayName: 'Bob',
            photoURL: '',
            totalPoints: 999,
            totalVisited: 999,
            hasVerified: true
        }));
    });

    it('denies unknown subcollections under users by default', async () => {
        const aliceDb = authedDb('alice');

        await assertFails(setDoc(doc(collection(aliceDb, 'users', 'alice', 'entitlement')), {
            premium: true,
            status: 'manual_active'
        }));
    });

    it('denies arbitrary top-level collections by default', async () => {
        await seedDoc(['randomCollection', 'doc1'], {
            seeded: true
        });

        const aliceDb = authedDb('alice');
        const publicDb = unauthDb();

        await assertFails(getDoc(doc(aliceDb, 'randomCollection', 'doc1')));
        await assertFails(setDoc(doc(aliceDb, 'randomCollection', 'doc1'), {
            seeded: false
        }));
        await assertFails(setDoc(doc(aliceDb, 'randomCollection', 'doc2'), {
            seeded: false
        }));
        await assertFails(setDoc(doc(publicDb, 'randomCollection', 'doc1'), {
            seeded: false
        }));
        await assertFails(setDoc(doc(publicDb, 'randomCollection', 'doc3'), {
            seeded: false
        }));
    });
});
