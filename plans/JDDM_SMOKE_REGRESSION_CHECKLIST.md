# Just Dee Dee Music Smoke + Regression Checklist

Run this before every client demo or live sheet change.

## Automated Gate

- `npm test`
- `npm run test:smoke:jddm`
- `npm run build --if-present`
- `git diff --check`

## Manual Smoke

- App opens without console errors.
- Map loads or shows the map-unavailable recovery message.
- Venue pins render from the current data source.
- Marker detail opens for at least one venue.
- Booking Planner opens from the bottom nav.
- Daily Agenda shows real counts or a clear empty state.
- Search finds a known venue by name, city, status, and contact.
- Priority / Best Fit score saves on a harmless test venue.
- Follow-up date saves on a harmless test venue.
- Status actions save on a harmless test venue.
- Copy Subject, Copy Body, Copy Email, and Email Draft behave as expected.
- Mobile viewport has no horizontal scrolling in Planner.

## Live Sheet Safety

- `git remote -v` points to `OutSwarming/Just-Dee-Dee-Music-Map`.
- Apps Script health says the bridge schema matches the app.
- Writes go to the Just Dee Dee Music Google Sheet, never BARK Ranger.
- Test edits are made on a clearly disposable venue row first.
- `priority` and `bestFitScore` columns exist before scoring live venues.
- `doNotContact` venues do not appear in outreach lists.

## Rollback

- Revert the last app commit if the frontend breaks.
- Re-deploy the previous Apps Script version if sheet writes break.
- Restore the Google Sheet from version history if a bad edit reaches live data.
