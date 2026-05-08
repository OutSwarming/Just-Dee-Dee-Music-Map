/**
 * profileEngine.js — Gamification, Achievement Vault, Leaderboard, Stats UI
 * Loaded SEVENTH in the boot sequence.
 */
window.BARK = window.BARK || {};

function getParkRepo() {
    return window.BARK.repos && window.BARK.repos.ParkRepo;
}

function getVaultRepo() {
    return window.BARK.repos && window.BARK.repos.VaultRepo;
}

function getProfileVisitedPlacesArray(source) {
    if (Array.isArray(source)) return source.slice();
    if (source instanceof Map) return Array.from(source.values());
    if (source && typeof source.values === 'function') return Array.from(source.values());

    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.getVisits === 'function') {
        return vaultRepo.getVisits().slice();
    }

    return [];
}

function getProfileVisitedPlacesCount() {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.size === 'function') return vaultRepo.size();
    return getProfileVisitedPlacesArray().length;
}

function hasProfileVisitedPlace(placeOrId) {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.hasVisit === 'function') {
        return vaultRepo.hasVisit(placeOrId);
    }

    return false;
}

function hasProfileVerifiedVisit(visitedPlacesArray) {
    return getProfileVisitedPlacesArray(visitedPlacesArray).some(place => place && place.verified);
}

// ====== MANAGE PORTAL ======
function padDatePart(value) {
    return String(value).padStart(2, '0');
}

function formatVisitDateInputValue(ts) {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return '';

    return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function renderManagePortal() {
    const listEl = document.getElementById('manage-places-list');
    const countEl = document.getElementById('manage-portal-count');
    if (!listEl || !countEl) return;

    const visitedPlaces = getProfileVisitedPlacesArray();
    countEl.textContent = visitedPlaces.length;
    if (visitedPlaces.length === 0) {
        listEl.innerHTML = '<li style="color: #888; font-style: italic; padding: 10px 0;">Get exploring!</li>';
        return;
    }

    listEl.innerHTML = '';
    const placesArray = visitedPlaces.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    placesArray.forEach(place => {
        const li = document.createElement('li');
        li.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding: 12px 0; border-bottom: 1px solid rgba(0,0,0,0.05);';

        const topRow = document.createElement('div');
        topRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = place.verified ? `🐾 ${place.name}` : place.name;
        nameSpan.style.cssText = 'font-weight: 600; color: #333; flex: 1;';

        const removeBtn = document.createElement('button');
        removeBtn.innerHTML = '&times;';
        removeBtn.style.cssText = 'background: #fee2e2; color: #dc2626; border: none; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: 800;';
        removeBtn.onclick = () => window.BARK.removeVisitedPlace(place.id);

        topRow.appendChild(nameSpan);
        topRow.appendChild(removeBtn);

        const controls = document.createElement('div');
        controls.style.cssText = 'display: flex; align-items: center; gap: 8px;';

        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.style.cssText = 'font-size: 11px; padding: 4px; border: 1px solid #ddd; border-radius: 4px; flex: 1;';
        if (place.ts) {
            dateInput.value = formatVisitDateInputValue(place.ts);
        }

        const updateBtn = document.createElement('button');
        updateBtn.textContent = 'Update';
        updateBtn.style.cssText = 'background: #3b82f6; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; cursor: pointer;';
        updateBtn.onclick = async () => {
            if (dateInput.value) {
                const newTs = new Date(dateInput.value + 'T12:00:00').getTime();
                updateBtn.disabled = true;
                try {
                    await window.BARK.updateVisitDate(place.id, newTs);
                    alert(`${place.name} date updated!`);
                } catch (error) {
                    alert(`Could not update ${place.name}. Please try again.`);
                } finally {
                    updateBtn.disabled = false;
                }
            }
        };

        controls.appendChild(dateInput);
        controls.appendChild(updateBtn);

        li.appendChild(topRow);
        li.appendChild(controls);
        listEl.appendChild(li);
    });
}

window.BARK.renderManagePortal = renderManagePortal;

// ====== LEADERBOARD SYNC ======
let cachedLeaderboardData = [];
let _leaderboardSyncInProgress = false;
let _lastLeaderboardSyncTime = 0;
const LEADERBOARD_SYNC_DEBOUNCE_MS = 10000;

function getCurrentFirebaseUser() {
    if (typeof firebase === 'undefined' || !firebase.auth) return null;

    try {
        return firebase.auth().currentUser || null;
    } catch (error) {
        console.warn('[profileEngine] Firebase auth unavailable for leaderboard sync:', error);
        return null;
    }
}

function getFirestoreForLeaderboardSync() {
    if (typeof firebase === 'undefined' || !firebase.firestore) return null;

    try {
        return firebase.firestore();
    } catch (error) {
        console.warn('[profileEngine] Firestore unavailable for leaderboard sync:', error);
        return null;
    }
}

function getLeaderboardServerTimestamp() {
    if (typeof firebase === 'undefined' || !firebase.firestore || !firebase.firestore.FieldValue) return null;

    try {
        return firebase.firestore.FieldValue.serverTimestamp();
    } catch (error) {
        console.warn('[profileEngine] Firestore server timestamp unavailable for leaderboard sync:', error);
        return null;
    }
}

async function syncScoreToLeaderboard() {
    if (_leaderboardSyncInProgress) return;

    const now = Date.now();
    if (now - _lastLeaderboardSyncTime < LEADERBOARD_SYNC_DEBOUNCE_MS) return;

    const user = getCurrentFirebaseUser();
    if (!user) return;

    const visitedPlaces = getProfileVisitedPlacesArray();
    const scoreSummary = window.BARK.calculateVisitScore(visitedPlaces, window.currentWalkPoints);
    const totalScore = scoreSummary.totalScore;

    if (totalScore === window._lastSyncedScore) return;

    _leaderboardSyncInProgress = true;
    try {
        const db = getFirestoreForLeaderboardSync();
        if (!db) return;

        if (typeof window.BARK.incrementRequestCount === 'function') {
            window.BARK.incrementRequestCount();
        }

        await db.collection('users').doc(user.uid).set({
            totalPoints: totalScore,
            totalVisited: visitedPlaces.length,
            displayName: user.displayName || 'Bark Ranger',
            hasVerified: hasProfileVerifiedVisit(visitedPlaces)
        }, { merge: true });

        const leaderboardPayload = {
            displayName: user.displayName || 'Bark Ranger',
            photoURL: user.photoURL || '',
            totalPoints: totalScore,
            totalVisited: visitedPlaces.length,
            hasVerified: hasProfileVerifiedVisit(visitedPlaces)
        };
        const serverTimestamp = getLeaderboardServerTimestamp();
        if (serverTimestamp) leaderboardPayload.lastUpdated = serverTimestamp;

        await db.collection('leaderboard').doc(user.uid).set(leaderboardPayload, { merge: true });

        window._lastSyncedScore = totalScore;

        if (cachedLeaderboardData.length > 0) {
            const me = cachedLeaderboardData.find(u => u.uid === user.uid);
            if (me) {
                me.totalPoints = totalScore;
                me.totalVisited = visitedPlaces.length;
            } else {
                cachedLeaderboardData.push({
                    uid: user.uid,
                    displayName: user.displayName || 'Bark Ranger',
                    totalPoints: totalScore,
                    totalVisited: visitedPlaces.length,
                    hasVerified: hasProfileVerifiedVisit(visitedPlaces)
                });
            }
            cachedLeaderboardData.sort((a, b) => b.totalPoints - a.totalPoints);
            renderLeaderboard(cachedLeaderboardData);
        }
    } finally {
        _leaderboardSyncInProgress = false;
        _lastLeaderboardSyncTime = Date.now();
    }
}

window.BARK.syncScoreToLeaderboard = syncScoreToLeaderboard;

// ====== EVALUATE ACHIEVEMENTS ======
async function evaluateAchievements(visitedPlacesMap) {
    try {
    const visitedArray = getProfileVisitedPlacesArray(visitedPlacesMap).map(rawVisit => {
        if (!rawVisit || typeof rawVisit !== 'object') return rawVisit;

        const visit = { ...rawVisit };
        const parkRepo = getParkRepo();
        if (!visit.state && parkRepo && typeof parkRepo.getById === 'function') {
            const mapPoint = parkRepo.getById(visit.id);
            if (mapPoint && mapPoint.state) visit.state = mapPoint.state;
        }
        return visit;
    });
    const userLocationMarker = window.BARK.getUserLocationMarker();
    const parkRepo = getParkRepo();
    const allPoints = parkRepo ? parkRepo.getAll() : [];

    let userId = null;
    if (typeof firebase !== 'undefined' && firebase.auth().currentUser) {
        userId = firebase.auth().currentUser.uid;
    }

    const achievements = await window.gamificationEngine.evaluateAndStoreAchievements(userId, visitedArray, null, window.currentWalkPoints || 0);

    // Update Banner
    const titleEl = document.getElementById('current-title-label');
    const scoreEl = document.getElementById('stat-score');
    const progressFill = document.getElementById('tier-progress-fill');
    const fractionEl = document.getElementById('rank-progress-fraction');

    if (titleEl) {
        const oldTitle = window._lastKnownRank || titleEl.textContent || 'Venue Scout';
        const newTitle = achievements.title;
        const isAuth = typeof firebase !== 'undefined' && firebase.auth().currentUser;
        const isSecurelyHydrated = window._serverPayloadSettled;

        if (isAuth && isSecurelyHydrated && window._lastKnownRank && oldTitle !== newTitle && newTitle !== 'Venue Scout') {
            showRankUpCelebration(oldTitle, newTitle);
        }

        window._lastKnownRank = newTitle;
        titleEl.textContent = newTitle;
    }
    if (scoreEl) scoreEl.textContent = achievements.totalScore;

    if (userId) await syncScoreToLeaderboard();

    if (progressFill) {
        const thresholds = [10, 25, 50, 100, 200, 300, 500];
        const next = thresholds.find(t => t > achievements.totalScore) || 500;
        const prev = thresholds[thresholds.indexOf(next) - 1] || 0;
        const pct = Math.min(100, ((achievements.totalScore - prev) / (next - prev)) * 100);
        progressFill.style.width = pct + "%";

        if (fractionEl) {
            if (achievements.totalScore >= 500) {
                fractionEl.textContent = 'MAX RANK ACHIEVED 🏆';
                progressFill.style.width = "100%";
            } else {
                fractionEl.textContent = `${achievements.totalScore} / ${next} PTS`;
            }
        }
    }

    const getSubtitle = (b) => {
        let s = b.desc || b.hint || '';
        if (!s && b.id.includes('Paw')) s = 'Verified Check-ins';
        if (!s && b.id.includes('state')) s = '100% cleared!!';
        return s;
    };

    const esc = (str) => String(str || '').replace(/'/g, "\\'");

    const renderStateBadge = (b) => {
        const isU = b.status === 'unlocked';
        const tCl = isU ? (b.tier === 'verified' ? 'verified-tier' : 'honor-tier') : 'locked-tier';
        const datePlaceholder = b.dateEarned || '--/--/----';
        const upgradeCta = (isU && b.tier === 'honor') ? '<div class="upgrade-pill">⭐ VERIFY TO UPGRADE</div>' : '';
        const sub = getSubtitle(b);
        const shareBtnHtml = isU ? `<button onclick="shareSingleBadge('${esc(b.name)}', '${esc(b.icon)}', '${esc(b.tier)}', false, '${esc(sub)}')" style="margin-top: 8px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 20px; color: white; font-size: 9px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 4px;">📸 SHARE</button>` : '';

        let progressHtml = '';
        if (!isU && typeof b.percentComplete !== 'undefined') {
            const pct = b.percentComplete;
            progressHtml = `
            <div class="state-progress-wrap">
                <div class="state-progress-track">
                    <div class="state-progress-fill" style="width: ${pct}%;"></div>
                </div>
                <span class="state-progress-text">${pct}%</span>
            </div>`;
        }

        return `
        <div class="flip-scene">
            <div class="skeuo-badge ${tCl} ${isU ? 'unlocked hover-float' : 'locked'}">
                <div class="badge-face badge-front">
                    <div class="badge-icon">${b.icon}</div>
                    <div class="badge-details">
                        <h4>${b.name}</h4>
                        <div style="font-size: 11px; font-weight: 600; color: #94a3b8; margin-top: 4px;">${b.criteria || ''}</div>
                    </div>
                    ${progressHtml}
                </div>
                <div class="badge-face badge-back">
                    <div class="engraved-date">EST. ${datePlaceholder}</div>
                    ${upgradeCta}
                    ${shareBtnHtml}
                </div>
            </div>
        </div>`;
    };

    const renderCoin = (b) => {
        const isU = b.status === 'unlocked';
        const tCl = isU ? (b.tier === 'verified' ? 'verified-tier' : 'honor-tier') : 'locked-tier';
        const upgradeCta = (isU && b.tier === 'honor') ? '<div class="upgrade-pill">⭐ VERIFY TO UPGRADE</div>' : '';
        const datePlaceholder = b.dateEarned || '--/--/----';
        const sub = getSubtitle(b);
        const shareBtnHtml = isU ? `<button onclick="shareSingleBadge('${esc(b.name)}', '${esc(b.icon)}', '${esc(b.tier)}', false, '${esc(sub)}')" style="margin-top: 8px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 20px; color: white; font-size: 9px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 4px;">📸 SHARE</button>` : '';

        return `
        <div class="flip-scene">
            <div class="skeuo-badge ${tCl} ${isU ? 'unlocked hover-float' : 'locked'}">
                <div class="badge-face badge-front">
                    <div class="badge-icon">${b.icon}</div>
                    <div class="badge-details">
                        <h4>${b.name}</h4>
                        <div style="font-size: 11px; font-weight: 600; color: #94a3b8; margin-top: 4px;">${b.criteria || ''}</div>
                    </div>
                </div>
                <div class="badge-face badge-back">
                    <div class="engraved-date">EST. ${datePlaceholder}</div>
                    ${upgradeCta}
                    ${shareBtnHtml}
                </div>
            </div>
        </div>`;
    };

    const renderDossier = (b) => {
        const isU = b.status === 'unlocked';
        const sub = getSubtitle(b);
        const shareBtnHtml = isU ? `<button onclick="shareSingleBadge('${esc(b.name)}', '${esc(b.icon)}', 'verified', true, '${esc(sub)}')" class="mystery-share-btn" title="Share Milestone">📸</button>` : '';

        return `
        <div class="mystery-card ${isU ? 'unlocked' : 'locked'}">
            <div class="mystery-icon">${isU ? b.icon : '?'}</div>
            <div class="mystery-info">
                <div class="mystery-title">${isU ? b.name : '[CLASSIFIED]'}</div>
                <div style="font-size: 11px; font-weight: 600; color: #94a3b8; margin-top: 4px;">${b.criteria || b.hint || ''}</div>
            </div>
            ${shareBtnHtml}
        </div>`;
    };

    window.BARK.safeUpdateHTML('rare-feats-grid', achievements.rareFeats.map(renderCoin).join(''));
    window.BARK.safeUpdateHTML('paws-grid', achievements.paws.map(renderCoin).join(''));

    // --- STATES SORT: DISTANCE & COMPLETION ---
    const stateDistances = {};
    const refLatLng = userLocationMarker ? userLocationMarker.getLatLng() : map.getCenter();

    if (allPoints && allPoints.length > 0) {
        allPoints.forEach(p => {
            if (p.state && p.lat && p.lng) {
                const sts = String(p.state).split(/[,/]/);
                const dist = window.BARK.haversineDistance(refLatLng.lat, refLatLng.lng, parseFloat(p.lat), parseFloat(p.lng));
                sts.forEach(s => {
                    const cleanSt = window.gamificationEngine.getNormalizedStateCode(s);
                    if (cleanSt) {
                        if (stateDistances[cleanSt] === undefined || dist < stateDistances[cleanSt]) {
                            stateDistances[cleanSt] = dist;
                        }
                    }
                });
            }
        });
    }

    let minOverallDist = Infinity;
    let currentStateCode = null;
    for (const [code, dist] of Object.entries(stateDistances)) {
        if (dist < minOverallDist) { minOverallDist = dist; currentStateCode = code; }
    }

    achievements.stateBadges.sort((a, b) => {
        const aCode = a.id.replace('state-', '').toUpperCase();
        const bCode = b.id.replace('state-', '').toUpperCase();
        const aIsCurrent = aCode === currentStateCode;
        const bIsCurrent = bCode === currentStateCode;
        if (aIsCurrent && !bIsCurrent) return -1;
        if (!aIsCurrent && bIsCurrent) return 1;
        const aUnlocked = a.status === 'unlocked';
        const bUnlocked = b.status === 'unlocked';
        if (aUnlocked && !bUnlocked) return -1;
        if (!aUnlocked && bUnlocked) return 1;
        if (aUnlocked && bUnlocked) return (b.dateEarnedTs || 0) - (a.dateEarnedTs || 0);
        const aDist = stateDistances[aCode] !== undefined ? stateDistances[aCode] : Infinity;
        const bDist = stateDistances[bCode] !== undefined ? stateDistances[bCode] : Infinity;
        return aDist - bDist;
    });

    const nationalCardHtml = `
        <div class="flip-scene" style="flex: 0 0 auto; width: 140px; scroll-snap-align: center;">
            <div class="skeuo-badge" style="background: linear-gradient(135deg, #0f172a, #1e293b); border: 2px solid #3b82f6; box-shadow: 0 4px 15px rgba(59,130,246,0.3); border-radius: 16px; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px; text-align: center;">
                <div style="font-size: 28px; margin-bottom: 4px;">🇺🇸</div>
                <h4 style="color: #f1f5f9; font-size: 12px; font-weight: 900; text-transform: uppercase; margin: 0 0 8px 0;">National Map</h4>
                <div style="width: 80%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 6px; overflow: hidden; margin-bottom: 4px;">
                    <div style="width: ${achievements.nationalProgress.percentComplete}%; height: 100%; background: linear-gradient(90deg, #38bdf8, #3b82f6); box-shadow: 0 0 8px rgba(56,189,248,0.6);"></div>
                </div>
                <span style="color: #94a3b8; font-size: 9px; font-weight: 800;">${achievements.nationalProgress.totalVisited} / ${achievements.nationalProgress.totalParks} SITES</span>
            </div>
        </div>`;

    window.BARK.safeUpdateHTML('states-grid', nationalCardHtml + achievements.stateBadges.map(renderStateBadge).join(''));
    window.BARK.safeUpdateHTML('mystery-feats-dossier', achievements.mysteryFeats.map(renderDossier).join(''));

    // Re-bind tab listeners
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const content = document.getElementById(btn.dataset.tab + '-content');
            if (content) content.classList.add('active');
        };
    });
    } catch (error) {
        console.error('[profileEngine] Achievement evaluation/render failed; profile update skipped.', {
            visitedCount: visitedPlacesMap && typeof visitedPlacesMap.size === 'number' ? visitedPlacesMap.size : null,
            currentWalkPoints: window.currentWalkPoints || 0,
            error
        });
    }
}

window.BARK.evaluateAchievements = evaluateAchievements;

// ====== STATS UI ======
function updateStatsUI() {
    const scoreEl = document.getElementById('stat-score');
    const verifiedEl = document.getElementById('stat-verified');
    const regularEl = document.getElementById('stat-regular');
    const statesEl = document.getElementById('stat-states');
    const parkRepo = getParkRepo();
    const allPoints = parkRepo ? parkRepo.getAll() : [];
    const visitedPlaces = getProfileVisitedPlacesArray();

    if (!scoreEl || !verifiedEl || !regularEl || !statesEl) return;

    const statesSet = new Set();
    allPoints.forEach(p => {
        const isVisited = typeof window.BARK.isParkVisited === 'function'
            ? window.BARK.isParkVisited(p)
            : hasProfileVisitedPlace(p);
        if (isVisited && p.state) {
            const st = p.state.toString().split(/[,/]/);
            st.forEach(s => {
                const trimmed = s.trim().toUpperCase();
                if (trimmed) statesSet.add(trimmed);
            });
        }
    });

    const scoreSummary = window.BARK.calculateVisitScore(visitedPlaces, window.currentWalkPoints);
    const totalScore = scoreSummary.totalScore;
    const verifiedCount = scoreSummary.verifiedCount;
    const regularCount = scoreSummary.regularCount;

    scoreEl.textContent = totalScore;
    verifiedEl.textContent = verifiedCount;
    regularEl.textContent = regularCount;
    statesEl.textContent = statesSet.size;

    let level = 1;
    let max = 10;
    if (totalScore >= 100) { level = 4; max = totalScore; }
    else if (totalScore >= 51) { level = 3; max = 100; }
    else if (totalScore >= 11) { level = 2; max = 50; }

    const pbTitle = document.getElementById('reward-level-title');
    const pbStatus = document.getElementById('reward-level-status');
    const pbBar = document.getElementById('reward-progress-bar');
    if (pbTitle && pbStatus && pbBar) {
        if (level === 4) {
            pbTitle.textContent = "Map Headliner";
            pbStatus.textContent = totalScore + " Pts";
            pbBar.style.width = "100%";
        } else {
            pbTitle.textContent = "Level " + level;
            pbStatus.textContent = totalScore + " / " + max + " Pts";
            const pct = Math.min(100, Math.round((totalScore / max) * 100));
            pbBar.style.width = pct + "%";
        }
    }

    renderManagePortal();
}

window.BARK.updateStatsUI = updateStatsUI;

// ====== LEADERBOARD ======
window._lastLeaderboardDoc = null;
let isFetchingMoreLeaderboard = false;

function getLeaderboardRenderer() {
    return window.BARK && window.BARK.leaderboardRenderer;
}

function parseLeaderboardRankCount(countData) {
    const rawCount = countData &&
        countData[0] &&
        countData[0].result &&
        countData[0].result.aggregateFields &&
        countData[0].result.aggregateFields.rankCount &&
        countData[0].result.aggregateFields.rankCount.integerValue;
    const parsedCount = Number.parseInt(rawCount, 10);
    if (!Number.isFinite(parsedCount) || parsedCount < 0) return null;
    return parsedCount;
}

function buildPersonalLeaderboardFallback(user, visitedPlaces, localScore, exactRank = null) {
    const visitedPlacesArray = getProfileVisitedPlacesArray(visitedPlaces);
    return {
        uid: user.uid,
        displayName: user.displayName || 'Bark Ranger',
        totalPoints: localScore,
        totalVisited: visitedPlacesArray.length,
        hasVerified: hasProfileVerifiedVisit(visitedPlacesArray),
        isPersonalFallback: true,
        exactRank: getLeaderboardRenderer().getSafeLeaderboardRank(exactRank)
    };
}

function parseGigCount(value) {
    const parsed = Number(String(value === undefined || value === null ? '' : value).replace(/,/g, '').trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function toProfileIsoDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

function getTodayIsoDate() {
    const now = new Date();
    return toProfileIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
}

function parseProfileDateCandidate(value) {
    if (value instanceof Date) return toProfileIsoDate(value);
    const text = String(value === undefined || value === null ? '' : value).trim();
    if (!text) return '';
    if (!/\b\d{4}-\d{1,2}-\d{1,2}\b/.test(text) &&
        !/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(text) &&
        !/\b(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i.test(text)) {
        return '';
    }
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) {
        const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
        return toProfileIsoDate(date);
    }
    const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slash) {
        const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
        const date = new Date(year, Number(slash[1]) - 1, Number(slash[2]));
        return toProfileIsoDate(date);
    }
    const parsed = new Date(text);
    return toProfileIsoDate(parsed);
}

function extractProfileGigDates(value) {
    const text = String(value || '').trim();
    if (!text) return [];
    const dates = new Set();
    const add = candidate => {
        const isoDate = parseProfileDateCandidate(candidate);
        if (isoDate) dates.add(isoDate);
    };

    (text.match(/\b\d{4}-\d{1,2}-\d{1,2}\b/g) || []).forEach(add);
    (text.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g) || []).forEach(add);
    (text.match(/\b(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi) || []).forEach(add);
    text.split(/[;\n]+/)
        .map(part => part.trim().split('|')[0])
        .forEach(add);

    return Array.from(dates).sort();
}

function countCalendarEventLines(value) {
    const today = getTodayIsoDate();
    const counts = { past: 0, future: 0 };
    String(value || '')
        .split(/\n+/)
        .map(line => line.trim())
        .filter(line => line && !/^manual sheet history:/i.test(line))
        .forEach(line => {
            if (/\bPROPOSED\b/i.test(line)) return;
            const match = line.match(/\b(\d{4}-\d{2}-\d{2})\b/);
            if (!match) return;
            if (match[1] < today) counts.past += 1;
            else counts.future += 1;
        });
    return counts;
}

function getVenueCalendarCounts(venue = {}) {
    const schema = window.BARK && window.BARK.bookingSchema;
    if (schema && typeof schema.getVenueGigStats === 'function') {
        const stats = schema.getVenueGigStats(venue);
        return {
            pastCount: stats.pastCount || 0,
            futureCount: stats.futureCount || 0
        };
    }

    const booking = venue.booking || {};
    const today = getTodayIsoDate();
    const pastDates = new Set(extractProfileGigDates(venue.calendarPastGigEvents || booking.calendarPastGigEvents));
    const futureDates = new Set();

    extractProfileGigDates(venue.calendarFutureGigEvents || booking.calendarFutureGigEvents).forEach(date => {
        if (date < today) pastDates.add(date);
        else futureDates.add(date);
    });

    const parsedCounts = countCalendarEventLines(venue.calendarGigEvents || booking.calendarGigEvents || '');
    const hasDateEvidence = pastDates.size > 0 || futureDates.size > 0 || parsedCounts.past > 0 || parsedCounts.future > 0;
    const pastCount = hasDateEvidence
        ? Math.max(pastDates.size, parsedCounts.past)
        : parseGigCount(venue.calendarPastGigCount) || parseGigCount(booking.calendarPastGigCount);
    const futureCount = hasDateEvidence
        ? Math.max(futureDates.size, parsedCounts.future)
        : parseGigCount(venue.calendarFutureGigCount) || parseGigCount(booking.calendarFutureGigCount);

    return { pastCount, futureCount };
}

function getGlobalGigTrackerStats() {
    const parkRepo = getParkRepo();
    const venues = parkRepo && typeof parkRepo.getAll === 'function' ? parkRepo.getAll() : [];
    let pastGigs = 0;
    let futureGigs = 0;
    let differentPlaces = 0;

    venues.forEach(venue => {
        const counts = getVenueCalendarCounts(venue);
        pastGigs += counts.pastCount;
        futureGigs += counts.futureCount;
        if (counts.pastCount > 0 || counts.futureCount > 0) differentPlaces += 1;
    });

    return {
        pastGigs,
        futureGigs,
        differentPlaces,
        venueCount: venues.length
    };
}

function createGlobalGigTrackerRow(label, value, detail) {
    const li = document.createElement('li');
    li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; margin-bottom: 10px; border-radius: 10px; background: #f8fafc; border: 1px solid #e2e8f0;';

    const copy = document.createElement('div');
    copy.style.cssText = 'display: flex; flex-direction: column; min-width: 0;';
    const labelEl = document.createElement('span');
    labelEl.style.cssText = 'font-size: 13px; font-weight: 900; color: #1e293b;';
    labelEl.textContent = label;
    copy.appendChild(labelEl);
    if (detail) {
        const detailEl = document.createElement('span');
        detailEl.style.cssText = 'font-size: 11px; color: #64748b; margin-top: 2px;';
        detailEl.textContent = detail;
        copy.appendChild(detailEl);
    }

    const valueEl = document.createElement('span');
    valueEl.style.cssText = 'font-size: 16px; font-weight: 900; color: #0f766e; background: #ccfbf1; border: 1px solid #99f6e4; padding: 4px 10px; border-radius: 999px;';
    valueEl.textContent = Number(value || 0).toLocaleString();

    li.appendChild(copy);
    li.appendChild(valueEl);
    return li;
}

function renderLeaderboard(topUsers) {
    if (topUsers) cachedLeaderboardData = topUsers;
    const data = cachedLeaderboardData;

    const containerEl = document.getElementById('leaderboard-container');
    const listEl = document.getElementById('leaderboard-list');
    const rankEl = document.getElementById('personal-rank-display');
    const controlsEl = document.getElementById('leaderboard-controls');
    if (!listEl || !rankEl || !controlsEl) return;
    if (containerEl) containerEl.style.setProperty('display', 'block', 'important');

    listEl.innerHTML = '';
    const stats = getGlobalGigTrackerStats();
    if (rankEl) rankEl.textContent = 'Live';
    listEl.appendChild(createGlobalGigTrackerRow('Past gigs', stats.pastGigs, 'Completed calendar gigs'));
    listEl.appendChild(createGlobalGigTrackerRow('Future gigs', stats.futureGigs, 'Booked upcoming calendar dates'));
    listEl.appendChild(createGlobalGigTrackerRow('Different places', stats.differentPlaces, 'Venues with at least one gig'));
    controlsEl.innerHTML = '';
    if (!data.length && stats.venueCount === 0) controlsEl.textContent = 'Loading venue data...';
}

async function loadLeaderboard() {
    renderLeaderboard(cachedLeaderboardData);
    if (typeof firebase === 'undefined') return;
    try {
        window.BARK.incrementRequestCount();
        const snapshot = await firebase.firestore().collection('leaderboard').orderBy('totalPoints', 'desc').limit(5).get();
        let topUsers = [];
        if (!snapshot.empty) window._lastLeaderboardDoc = snapshot.docs[snapshot.docs.length - 1];
        else window._lastLeaderboardDoc = null;

        snapshot.forEach(doc => {
            const d = doc.data();
            topUsers.push({ uid: doc.id, displayName: d.displayName || 'Bark Ranger', totalPoints: d.totalPoints !== undefined ? d.totalPoints : (d.totalVisited || 0), totalVisited: d.totalVisited || 0, hasVerified: !!d.hasVerified });
        });

        const user = firebase.auth().currentUser;
        if (user && !topUsers.find(u => u.uid === user.uid)) {
            const visitedPlaces = getProfileVisitedPlacesArray();
            const localScore = window.BARK.calculateVisitScore(visitedPlaces, window.currentWalkPoints).totalScore;

            let exactRank = null;
            try {
                const projectId = firebase.app().options.projectId;
                const idToken = await firebase.auth().currentUser.getIdToken();
                const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runAggregationQuery`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: 'leaderboard' }], where: { fieldFilter: { field: { fieldPath: 'totalPoints' }, op: 'GREATER_THAN', value: Number.isInteger(localScore) ? { integerValue: localScore } : { doubleValue: localScore } } } }, aggregations: [{ alias: 'rankCount', count: {} }] } })
                });
                const countData = await response.json();
                const countMatched = parseLeaderboardRankCount(countData);
                if (countMatched !== null) exactRank = countMatched + 1;
            } catch (e) { console.warn('REST API aggregate rank lookup failed.', e); }

            topUsers.push(buildPersonalLeaderboardFallback(user, visitedPlaces, localScore, exactRank));
        }

        cachedLeaderboardData = topUsers;
        renderLeaderboard(cachedLeaderboardData);
    } catch (err) { console.error('Leaderboard load error:', err); }
}

async function loadMoreLeaderboard() {
    if (!window._lastLeaderboardDoc || isFetchingMoreLeaderboard) return;
    isFetchingMoreLeaderboard = true;
    const btn = document.getElementById('lb-load-more-btn');
    if (btn) btn.textContent = 'Loading...';

    try {
        window.BARK.incrementRequestCount();
        const snapshot = await firebase.firestore().collection('leaderboard').orderBy('totalPoints', 'desc').startAfter(window._lastLeaderboardDoc).limit(5).get();
        if (snapshot.empty) { window._lastLeaderboardDoc = null; renderLeaderboard(cachedLeaderboardData); return; }
        window._lastLeaderboardDoc = snapshot.docs[snapshot.docs.length - 1];
        cachedLeaderboardData = cachedLeaderboardData.filter(u => !u.isPersonalFallback);

        snapshot.forEach(doc => {
            if (!cachedLeaderboardData.find(u => u.uid === doc.id)) {
                const d = doc.data();
                cachedLeaderboardData.push({ uid: doc.id, displayName: d.displayName || 'Bark Ranger', totalPoints: d.totalPoints !== undefined ? d.totalPoints : (d.totalVisited || 0), totalVisited: d.totalVisited || 0, hasVerified: !!d.hasVerified });
            }
        });

        const user = firebase.auth().currentUser;
        if (user && !cachedLeaderboardData.find(u => u.uid === user.uid)) {
            const visitedPlaces = getProfileVisitedPlacesArray();
            const localScore = window.BARK.calculateVisitScore(visitedPlaces, window.currentWalkPoints).totalScore;
            let exactRank = null;

            try {
                const projectId = firebase.app().options.projectId;
                const idToken = await firebase.auth().currentUser.getIdToken();
                const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runAggregationQuery`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: 'leaderboard' }], where: { fieldFilter: { field: { fieldPath: 'totalPoints' }, op: 'GREATER_THAN', value: Number.isInteger(localScore) ? { integerValue: localScore } : { doubleValue: localScore } } } }, aggregations: [{ alias: 'rankCount', count: {} }] } })
                });
                const countData = await response.json();
                const countMatched = parseLeaderboardRankCount(countData);
                if (countMatched !== null) exactRank = countMatched + 1;
            } catch (e) { console.warn('REST API aggregate rank lookup failed in loadMore', e); }

            cachedLeaderboardData.push(buildPersonalLeaderboardFallback(user, visitedPlaces, localScore, exactRank));
        }

        renderLeaderboard(cachedLeaderboardData);
    } catch (err) { console.error('Error fetching more leaderboard:', err); }
    finally { isFetchingMoreLeaderboard = false; }
}

window.BARK.loadLeaderboard = loadLeaderboard;
window.BARK.getGlobalGigTrackerStats = getGlobalGigTrackerStats;
if (typeof window.addEventListener === 'function') {
    window.addEventListener(window.BARK.VENUE_DATA_SYNC_EVENT || 'jddm:venue-data-sync', () => {
        renderLeaderboard(cachedLeaderboardData);
    });
}

// ====== RANK-UP CELEBRATION ======
function showRankUpCelebration(oldTitle, newTitle) {
    const overlay = document.createElement('div');
    overlay.id = 'rank-up-overlay';
    overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.92); z-index: 99999; display: flex; flex-direction: column; align-items: center; justify-content: center; animation: fadeInOverlay 0.3s ease-out; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);`;

    overlay.innerHTML = `
        <style>
            @keyframes fadeInOverlay { from { opacity: 0; } to { opacity: 1; } }
            @keyframes rankBounce { 0% { transform: scale(0.3); opacity: 0; } 50% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
            @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
            @keyframes confettiFall { 0% { transform: translateY(-100vh) rotate(0deg); opacity: 1; } 100% { transform: translateY(100vh) rotate(720deg); opacity: 0; } }
        </style>
        <div style="text-align: center; animation: rankBounce 0.6s ease-out; max-width: 340px; padding: 0 20px;">
            <div style="font-size: 72px; margin-bottom: 16px; filter: drop-shadow(0 4px 12px rgba(245, 158, 11, 0.5));">🎖️</div>
            <div style="font-size: 12px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px;">RANK UP!</div>
            <div style="font-size: 14px; color: #64748b; margin-bottom: 4px; font-weight: 600; text-decoration: line-through; opacity: 0.6;">${oldTitle}</div>
            <div style="font-size: 10px; color: #f59e0b; margin-bottom: 8px;">▼</div>
            <div style="font-size: 28px; font-weight: 900; background: linear-gradient(90deg, #f59e0b, #fbbf24, #f59e0b); background-size: 200% auto; -webkit-background-clip: text; -webkit-text-fill-color: transparent; animation: shimmer 2s linear infinite; margin-bottom: 20px; line-height: 1.3;">${newTitle}</div>
            <p style="font-size: 13px; color: #cbd5e1; line-height: 1.5; margin-bottom: 24px;">Congratulations, Ranger! Keep exploring to unlock the next rank.</p>
            <button onclick="document.getElementById('rank-up-overlay').remove()" style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border: none; padding: 14px 40px; border-radius: 12px; font-size: 14px; font-weight: 900; cursor: pointer; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);">🐾 Awesome!</button>
        </div>`;

    document.body.appendChild(overlay);

    const confettiColors = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'];
    if (!window.lowGfxEnabled) {
        for (let i = 0; i < 40; i++) {
            const particle = document.createElement('div');
            const color = confettiColors[Math.floor(Math.random() * confettiColors.length)];
            const left = Math.random() * 100;
            const delay = Math.random() * 2;
            const duration = 2 + Math.random() * 3;
            const size = 6 + Math.random() * 8;
            particle.style.cssText = `position: fixed; top: -20px; left: ${left}%; width: ${size}px; height: ${size}px; background: ${color}; border-radius: ${Math.random() > 0.5 ? '50%' : '2px'}; z-index: 100000; pointer-events: none; animation: confettiFall ${duration}s ease-in ${delay}s forwards;`;
            overlay.appendChild(particle);
        }
    }

    setTimeout(() => { const el = document.getElementById('rank-up-overlay'); if (el) el.remove(); }, 8000);
}
