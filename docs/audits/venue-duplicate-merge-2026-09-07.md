# Reviewed venue duplicate merge — September 7, 2026

Merged 17 confirmed duplicate pairs in the live master spreadsheet: 537 venue rows became 520. The 28 existing columns and stable surviving Place IDs were retained. Different branches were kept separate.

Full native backup before changes: https://docs.google.com/spreadsheets/d/1nNh3e8DO6vYFt7_cfXQO7gq-BmXP6KDbFNmRc8GW1GQ/edit

## Merged venues

- Beau's Grille
- Beerhead Bar & Eatery
- CharBenay's Wine on the River
- Clinton House Restaurant
- Filia Cellars
- Hoodletown Brewing Co
- Panini's Bar & Grill
- Richfield Brewing
- The Secret At Center
- Wooster Farmers Market
- Scheduled Public Event
- Crafted Artisan Meadery
- Dilly D's Sports Grill
- Johnny J's Pub Medina
- Signature of Solon Country Club
- Vincent William Wine
- Brickyard Bar & Grill

## Preserved data and references

Contacts were merged conservatively, preserving separate people and their notes. Nonempty follow-up dates had no conflicts. Gig dates were unioned and counts recalculated. Original conflicting labels and malformed data were retained in Notes instead of guessed. Beau’s incomplete phone value and malformed last-contacted value were retained as notes.

Eight duplicate derived Venues rows were consolidated, and three event/history Place ID references were repointed. Three calendar review cards were refreshed. One email conversation was repointed and its starter card refreshed; its archived state and tags were preserved. No Gmail messages were modified.

## Verification

- All 503 unaffected master rows matched the prewrite snapshot immediately after the atomic merge.
- All 17 merged rows matched the planned values, contacts and follow-up dates; all 520 Place IDs are unique.
- 476 merged cells retained their validation and native notes. Formatting stayed intact apart from Sheets automatically making two recovered website URLs clickable.
- All 17 venues loaded through the deployed app bridge. Three representative no-op saves and readbacks passed (Filia, Panini’s, Brickyard), with no changed headers.
- The real Apps Script calendar sync resumed successfully: 196 events, 36 updated rows, no added rows, 520 formatted venue rows, no warnings. Non-calendar values were unchanged, allowing equivalent native date/number representations.
- Derived Venues, Events and Venue_Artist_History references contain no retired IDs from these merges.
- Apps Script bridge tests: 28 passed, including maintenance pause expiry.

The bound Apps Script deployment is now version 39. It adds an expiring `JDDM_VENUE_MERGE_UNTIL` guard to avoid calendar writes during a reviewed merge. The property was cleared and temporary pause/resume helpers were removed. The repository guard mirrors this production change; the live Code.gs must still be patched selectively, not replaced wholesale.

Private snapshots, plans, write requests, Firestore backups and verification results are under `work/venue-merge/` and are not committed.

## Uncertain pairs left separate

- Heritage Farms / Peninsula Foundation — same address, potentially distinct organizations.
- Rocky Point Winery / The Red Fern Inn — same address, potentially distinct businesses.
- B ROX / R Box — same phone but differing street numbers (2119 / 2199 Mentor Ave).

These require the owner’s confirmation before merging.
