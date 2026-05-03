/**
 * panelRenderer.js - Marker click panel rendering.
 * Phase 2 move-only extraction from dataService.js.
 *
 * Future card architecture notes:
 *   This renderer currently assumes a clicked marker is an official BARK park
 *   with canonical data in marker._parkData. Long term, the slide panel should
 *   become a reusable card host that can render multiple card modes without
 *   competing panels:
 *
 *     1. OfficialParkCard
 *        Canonical BARK data: name, state, category, swag links, official info,
 *        official websites, check-in controls, and "add to trip".
 *
 *     2. TripPlaceCard
 *        User itinerary data for non-official places such as towns, hotels,
 *        restaurants, trailheads, or geocoded stops. This card can show name,
 *        coordinates, directions, remove-from-trip, and later per-trip notes.
 *
 *     3. MyVisitCard / MemoryCard
 *        User-owned content: personal notes, dog/BARK photos, visit dates,
 *        private/public visibility, and future review-style fields. This card
 *        should be lazy-loaded after the panel opens. Do not load photos or
 *        rich editors for every marker during map rendering.
 *
 *   Important separation:
 *     Official data should remain read-only from ParkRepo/CSV.
 *     Personal data should live in a user-owned service/collection and be
 *     composed into the panel at render time. Avoid copying personal notes or
 *     photo refs into marker fingerprints, allPoints, or saved route stops; it
 *     would cause unnecessary marker churn and blur official/user ownership.
 *
 *   Suggested future API:
 *     window.BARK.openPlaceCard({
 *       kind: 'official' | 'tripPlace',
 *       placeId,
 *       customPlaceId,
 *       tripStopId,
 *       focus: 'details' | 'memory' | 'photos' | 'notes'
 *     })
 */
window.BARK = window.BARK || {};

function getVaultRepo() {
    return window.BARK.repos && window.BARK.repos.VaultRepo;
}

function getPanelVisitEntry(place) {
    if (typeof window.BARK.getVisitedPlaceEntry === 'function') {
        return window.BARK.getVisitedPlaceEntry(place);
    }

    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.hasVisit === 'function' && typeof vaultRepo.getVisit === 'function') {
        return vaultRepo.hasVisit(place) ? { id: place.id, record: vaultRepo.getVisit(place) } : null;
    }

    return null;
}

function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getVenueAddress(d) {
    const street = d.address || '';
    const cityStateZip = [d.city, d.state, d.zip].filter(Boolean).join(' ');
    return [street, cityStateZip].filter(Boolean).join(', ');
}

function getVenueEventLabel(d) {
    const dateTime = [d.eventDate, d.eventTime].filter(Boolean).join(' ');
    if (dateTime) return dateTime;
    return d.privateEvent ? 'Private event' : '';
}

function renderMarkerClickPanel(context) {
    const marker = context.marker;
    const slidePanel = context.slidePanel;
    const titleEl = context.titleEl;
    const infoSection = context.infoSection;
    const infoEl = context.infoEl;
    const websitesContainer = context.websitesContainer;
    const picsEl = context.picsEl;
    const videoEl = context.videoEl;
    const firebaseService = window.BARK.services && window.BARK.services.firebase;
    const refreshOnly = context.refreshOnly === true;

    if (!refreshOnly && window.BARK.activePinMarker && window.BARK.activePinMarker._icon) {
        window.BARK.activePinMarker._icon.classList.remove('active-pin');
    }
    if (marker._icon) {
        marker._icon.classList.add('active-pin');
    }
    window.BARK.activePinMarker = marker;

    const panelScrollContainer = document.querySelector('.panel-content');
    if (panelScrollContainer && !refreshOnly) panelScrollContainer.scrollTop = 0;

    if (!refreshOnly) document.getElementById('filter-panel').classList.add('collapsed');

    const d = marker._parkData;
    if (titleEl) titleEl.textContent = d.name || 'Unknown Venue';

    const metaContainer = document.getElementById('panel-meta-container');
    if (metaContainer) {
        const address = getVenueAddress(d) || d.state || 'Northeast Ohio';
        const venueType = d.venueType || d.category || d.swagType || 'Other Venue';
        const eventLabel = getVenueEventLabel(d);
        const eventPill = eventLabel ? `<div class="meta-pill">Date ${escapeHtml(eventLabel)}</div>` : '';
        metaContainer.innerHTML = `
            <div class="meta-pill">Location ${escapeHtml(address)}</div>
            <div class="meta-pill">Type ${escapeHtml(venueType)}</div>
            ${eventPill}
        `;
    }

    const suggestEditBtn = document.getElementById('suggest-edit-btn');
    if (suggestEditBtn) {
        const subject = encodeURIComponent(`Just Dee Dee Music Map Update: ${d.name}`);
        const body = encodeURIComponent(`Venue Name: ${d.name}\nID: ${d.id}\nAddress: ${getVenueAddress(d)}\n\n--- Please describe the update below ---\n`);
        suggestEditBtn.href = `mailto:booking@justdeedeemusic.com?subject=${subject}&body=${body}`;
    }

    // --- UPDATES & REPORTS ---
    if (d.info) {
        if (infoSection) infoSection.style.display = 'block';
        const container = document.getElementById('panel-info-container');
        const showMoreBtn = document.getElementById('show-more-info');
        if (infoEl) infoEl.innerHTML = escapeHtml(d.info).replace(/\n/g, '<br>');

        const hasManyLines = (infoEl.innerHTML.match(/<br>/g) || []).length > 4;

        if (d.info.length > 250 || hasManyLines) {
            if (container) container.classList.add('report-collapsed');
            if (showMoreBtn) {
                showMoreBtn.style.display = 'block';
                showMoreBtn.onclick = () => {
                    container.classList.remove('report-collapsed');
                    showMoreBtn.style.display = 'none';
                };
            }
        } else {
            if (container) container.classList.remove('report-collapsed');
            if (showMoreBtn) showMoreBtn.style.display = 'none';
        }
    } else {
        if (infoSection) infoSection.style.display = 'none';
        if (infoEl) infoEl.innerHTML = '';
    }

    if (d.pics && typeof d.pics === 'string') {
        const formattedPics = window.BARK.formatSwagLinks(d.pics);
        if (formattedPics.includes('<a ')) {
            if (picsEl) { picsEl.style.display = 'grid'; picsEl.innerHTML = formattedPics; }
        } else {
            if (picsEl) { picsEl.style.display = 'none'; picsEl.innerHTML = ''; }
        }
    } else {
        if (picsEl) { picsEl.style.display = 'none'; picsEl.innerHTML = ''; }
    }

    if (d.video && typeof d.video === 'string' && d.video.startsWith('http')) {
        if (videoEl) { videoEl.style.display = 'block'; videoEl.href = d.video; }
    } else {
        if (videoEl) { videoEl.style.display = 'none'; videoEl.removeAttribute('href'); }
    }

    if (websitesContainer) {
        websitesContainer.innerHTML = '';
        if (d.website && typeof d.website === 'string') {
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const urls = d.website.match(urlRegex);
            if (urls && urls.length > 0) {
                websitesContainer.style.display = 'grid';
                urls.forEach((url, index) => {
                    const link = document.createElement('a');
                    link.href = url.replace(/['",]+$/, '');
                    link.target = '_blank';
                    link.className = 'website-btn';
                    link.textContent = urls.length > 1 ? `Venue Link ${index + 1}` : 'Venue Website';
                    websitesContainer.appendChild(link);
                });
            } else {
                websitesContainer.style.display = 'none';
            }
        } else {
            websitesContainer.style.display = 'none';
        }
    }

    // --- MAP URLS & BUTTON RENDERING ---
    const stickyFooter = document.getElementById('panel-sticky-footer');
    if (stickyFooter) {
        stickyFooter.style.display = 'grid';
        stickyFooter.innerHTML = `
            <a href="https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}" target="_blank" class="dir-btn">🗺️ Google</a>
            <a href="http://maps.apple.com/?q=${encodeURIComponent(d.name)}&ll=${d.lat},${d.lng}" target="_blank" class="dir-btn">🧭 Apple</a>
            <button class="glass-btn btn-trip">Add to Route</button>
        `;

        const btnTrip = stickyFooter.querySelector('.btn-trip');
        if (btnTrip) {
            const tripDays = window.BARK.tripDays;
            const syncPopupUI = () => {
                const inTripDay = Array.from(tripDays).findIndex(day => day.stops.some(s => s.id === d.id));
                if (inTripDay > -1) {
                    btnTrip.innerHTML = `In Route (Day ${inTripDay + 1})`;
                    btnTrip.style.background = '#e8f5e9';
                    btnTrip.style.borderColor = '#4CAF50';
                    btnTrip.style.color = '#2E7D32';
                } else {
                    btnTrip.innerHTML = `Add to Route`;
                    btnTrip.style.background = '#fff';
                    btnTrip.style.borderColor = '#cbd5e1';
                    btnTrip.style.color = '#333';
                }
            };
            syncPopupUI();
            btnTrip.onclick = (e) => {
                e.preventDefault();
                if (window.addStopToTrip({ id: d.id, name: d.name, lat: d.lat, lng: d.lng })) {
                    syncPopupUI();
                }
            };
        }
    }

    // --- VISITED SECTION ---
    const visitedSection = document.getElementById('panel-visited-section');
    const markVisitedBtn = document.getElementById('mark-visited-btn');
    const markVisitedText = document.getElementById('mark-visited-text');
    const verifyBtn = document.getElementById('verify-checkin-btn');
    const verifyBtnText = document.getElementById('verify-checkin-text');
    const checkinService = window.BARK.services && window.BARK.services.checkin;

    if (visitedSection && markVisitedBtn && markVisitedText && verifyBtn) {
        if (firebaseService && firebaseService.getCurrentUser()) {
            visitedSection.style.display = 'grid';

            const visitedEntry = getPanelVisitEntry(d);

            if (visitedEntry) {
                const cachedObj = visitedEntry.record;

                markVisitedBtn.classList.add('visited');
                markVisitedText.textContent = 'Visited Venue';

                if (cachedObj.verified) {
                    markVisitedBtn.disabled = true;
                    markVisitedBtn.style.cursor = 'default';
                    markVisitedBtn.style.opacity = '0.7';
                } else {
                    markVisitedBtn.disabled = false;
                    markVisitedBtn.style.cursor = 'pointer';
                    markVisitedBtn.style.opacity = '1';
                }

                if (window.allowUncheck && !cachedObj.verified) {
                    markVisitedBtn.style.background = '#4CAF50';
                    markVisitedBtn.onmouseenter = () => markVisitedText.textContent = 'Remove Visit';
                    markVisitedBtn.onmouseleave = () => markVisitedText.textContent = 'Visited Venue';
                } else {
                    markVisitedBtn.onmouseenter = null;
                    markVisitedBtn.onmouseleave = null;
                }

                if (cachedObj.verified) {
                    verifyBtn.style.background = '#4CAF50';
                    verifyBtnText.textContent = 'Verified Stop';
                    verifyBtn.disabled = true;
                    verifyBtn.style.cursor = 'default';
                    verifyBtn.style.opacity = '0.7';
                } else {
                    verifyBtn.style.background = '#FF9800';
                    verifyBtnText.textContent = 'Verify Stop';
                    verifyBtn.disabled = false;
                    verifyBtn.style.cursor = 'pointer';
                    verifyBtn.style.opacity = '1';
                }
            } else {
                markVisitedBtn.classList.remove('visited');
                markVisitedText.textContent = 'Mark Venue Visited';
                markVisitedBtn.disabled = false;
                markVisitedBtn.style.cursor = 'pointer';
                markVisitedBtn.style.opacity = '1';
                markVisitedBtn.onmouseenter = null;
                markVisitedBtn.onmouseleave = null;

                verifyBtn.style.background = '#FF9800';
                verifyBtnText.textContent = 'Verify Stop';
                verifyBtn.disabled = false;
                verifyBtn.style.cursor = 'pointer';
                verifyBtn.style.opacity = '1';
            }

            verifyBtn.onclick = async () => {
                if (!checkinService || typeof checkinService.verifyGpsCheckin !== 'function') {
                    alert("Check-in service is unavailable. Try again later.");
                    return;
                }
                verifyBtnText.textContent = 'Locating...';

                try {
                    const checkinResult = await checkinService.verifyGpsCheckin(d);
                    if (checkinResult.success) {
                        alert(`Venue check-in verified. You earned 2 points.`);

                        verifyBtn.style.background = '#4CAF50';
                        verifyBtnText.textContent = 'Verified Stop';
                        verifyBtn.disabled = true;
                        verifyBtn.style.cursor = 'default';
                        verifyBtn.style.opacity = '0.7';

                        markVisitedBtn.classList.add('visited');
                        markVisitedText.textContent = 'Visited Venue';
                        markVisitedBtn.disabled = true;
                        markVisitedBtn.style.cursor = 'default';
                        markVisitedBtn.style.opacity = '0.7';

                        window.syncState();
                        window.BARK.updateStatsUI();
                    } else {
                        const radiusKm = window.BARK.config && window.BARK.config.CHECKIN_RADIUS_KM;
                        if (checkinResult.error === 'OUT_OF_RANGE' && Number.isFinite(checkinResult.distance)) {
                            alert(`Out of Range! You are ${checkinResult.distance.toFixed(1)} km away. You must be within ${radiusKm} km to verify.`);
                        } else if (checkinResult.error === 'GEOLOCATION_UNSUPPORTED') {
                            alert("Geolocation is not supported by your browser.");
                        } else if (checkinResult.error === 'PERMISSION_DENIED') {
                            alert("Location permission denied. GPS is required for verified check-ins.");
                        } else if (checkinResult.error === 'LOCATION_FAILED') {
                            alert("Failed to get location. Try again later.");
                        } else if (checkinResult.error === 'FREE_VISIT_LIMIT') {
                            const limit = checkinResult.limit || 20;
                            alert(`Visit limit reached at ${limit} venues. Full access should be enabled; refresh and try again.`);
                        } else {
                            alert("Check-in could not be verified. Try again later.");
                        }
                        verifyBtnText.textContent = 'Verify Stop';
                    }
                } catch (error) {
                    console.error("[panelRenderer] verify check-in failed:", error);
                    alert("Failed to get location. Try again later.");
                    verifyBtnText.textContent = 'Verify Stop';
                }
            };

            markVisitedBtn.onclick = async () => {
                if (!checkinService || typeof checkinService.markAsVisited !== 'function') {
                    alert("Check-in service is unavailable. Try again later.");
                    return;
                }

                try {
                    const visitResult = await checkinService.markAsVisited(d);
                    if (!visitResult.success) {
                        if (visitResult.error === 'UNCHECK_LOCKED') {
                            alert("Data Safety Lock Active\n\nTo prevent you from accidentally losing visit history, unchecking venues is disabled by default.\n\nYou can turn off this safety feature in Settings by enabling 'Allow Uncheck Visited'.");
                        } else if (visitResult.error === 'FREE_VISIT_LIMIT') {
                            const limit = visitResult.limit || 20;
                            alert(`Visit limit reached at ${limit} venues. Full access should be enabled; refresh and try again.`);
                        } else if (visitResult.error !== 'ALREADY_VERIFIED') {
                            alert("Check-in service is unavailable. Try again later.");
                        }
                        return;
                    }

                    if (visitResult.action === 'removed') {
                        markVisitedBtn.classList.remove('visited');
                        markVisitedText.textContent = 'Mark Venue Visited';
                        markVisitedBtn.onmouseenter = null;
                        markVisitedBtn.onmouseleave = null;

                        window.syncState();
                        return;
                    }

                    markVisitedBtn.classList.add('visited');
                    markVisitedText.textContent = 'Visited Venue';
                    markVisitedBtn.disabled = false;
                    markVisitedBtn.style.cursor = 'pointer';
                    markVisitedBtn.style.opacity = '1';

                    window.syncState();
                } catch (error) {
                    console.error("[panelRenderer] mark visited failed:", error);
                    alert("Check-in service is unavailable. Try again later.");
                }
            };
        } else {
            visitedSection.style.display = 'none';
        }
    }

    // --- SMART AUTO-PAN ---
    if (!refreshOnly && !window.stopAutoMovements) {
        const currentZoom = map.getZoom();
        const xOffset = window.innerWidth >= 768 ? -250 : 0;
        const yOffset = window.innerWidth < 768 ? 180 : 0;
        const targetPoint = map.project([d.lat, d.lng], currentZoom).add([xOffset, yOffset]);
        const targetLatLng = map.unproject(targetPoint, currentZoom);

        map.panTo(targetLatLng, {
            animate: !window.instantNav,
            duration: window.instantNav ? 0 : 0.5
        });
    }

    const mapIsActive = typeof window.BARK.isMapVisibleByDefaultViewState === 'function'
        ? window.BARK.isMapVisibleByDefaultViewState()
        : !document.querySelector('.ui-view.active');

    if (slidePanel) {
        if (mapIsActive) slidePanel.classList.add('open');
        else slidePanel.classList.remove('open');
    }
}

window.BARK.renderMarkerClickPanel = renderMarkerClickPanel;
