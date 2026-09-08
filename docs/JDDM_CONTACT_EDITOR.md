# Venue contact groups and follow-up dates

Project ownership and migration status: [Firebase project ownership](FIREBASE_PROJECT_OWNERSHIP.md).

Add Place and pin → Edit share one contact editor. Each person or venue has a free-form name, preferred method/contact type, contact notes, and multiple emails, phone numbers and other contact methods. Each person has one Contact notes box shared by their methods. Add stays beside the method on phones. Removing a contact removes that person's methods; editing one person keeps the others intact.

## Original 28-column storage

No new spreadsheet column is required. Booking Contact (N) stores a versioned `JDDM_CONTACTS_V2` envelope. It contains the contacts and any previous booking text. Contact Name (K), Email/Contact (L), Phone Number (M), and Contact Type (O) remain plain text summaries for existing email, call and notification integrations. Venue Notes (AB) remains separate. The first contact supplies the main name and preferred method; the first available email and phone across the contacts supply the primary action values.

The shared browser/server codec is `functions/contactRecords.js`. Commas, quotes, newlines, phone extensions, free-text preferences and per-method notes round-trip without delimiter guessing. A baseline records the plain summary fields, allowing direct spreadsheet changes to those fields to appear in the editor without deleting alternate methods. Old free text in Email/Contact becomes an Other method when it cannot be safely interpreted as an email. Existing names are not split or assigned to invented people.

The migration backs up Sheet1 before writing only Booking Contact. It preserves the original 28 cells of each row except N, verifies every saved contact record, then removes the temporary Contact Details column AC. Both rows with saved AC notes are included. Existing legacy records continue to load without requiring migration. Old editor submissions using AC are translated when safe; after a row has grouped contacts, an old editor must refresh before saving, avoiding loss of person/method associations.

## Dates and notifications

Next Follow Up and Last Contacted use calendar inputs. Timestamps are interpreted in America/New_York; new dates save as YYYY-MM-DD text. Invalid dates are rejected. Monitoring / follow-up-added receives added, changed or removed confirmations with the place name and dates. New places with a follow-up send both notifications. Resaving the same Eastern calendar date does not notify again. Customer Communication / daily-follow-ups remains the separate 8 AM Eastern reminder channel.

The live map uses jddmSpreadsheetBridge in **just-dee-dee-music-map**. The email bot uses this same JDDM project. GitHub Pages publishes the map from main.

## Calendar preservation

The old Apps Script sync ran destructive spreadsheet setup every five minutes. That routine replaced Sheet1 and removed AC. The Firebase gateway now refreshes sheet identity and dimensions, and routine calendar sync no longer calls setup. Active Apps Script deployment `AKfycbyOems33yVzMEq_ucgoajSg3cYCq-68sM1ngKP2d0pdvA3OpJCG34ZAAM-cIeQouDKu` is version 37, including its scheduled trigger. Keep that deployment updated when changing the bound script; saving Head alone does not update the trigger. Manual purge/setup is not a routine sync step.

## Verification

`npm run test:booking`, `npm test --prefix functions`, and `node tests/venueEditModal.browser.cjs` cover contact storage, legacy migration, Add/Edit, multiple people, notes, removal confirmations, calendars and desktop/mobile layout. Live verification creates a temporary marked venue, edits multiple people and notes, runs the deployed calendar sync, checks fresh spreadsheet reads and Discord new-place/follow-up confirmations, and removes the test row.

## Incomplete contacts and saving on close (v20)

Names and methods are optional. A person can have only a phone, only an email, or notes while the missing method remains blank. Placeholders describe missing information without inserting fake values into the spreadsheet. Primary phone/email summaries skip empty methods; email greetings use the name of the email owner rather than a different phone-only contact.

Complete US numbers display and save as (330) 555-0123, dropping an optional leading 1 and preserving extensions. Incomplete or ambiguous legacy text remains intact rather than inventing digits.

X, the backdrop and Escape save changed fields before closing. Failed saves and invalid fields leave the editor open with the draft intact. Unchanged editors and untouched new-place forms close without writing. Duplicate close requests and Save followed by X share a single in-flight save. Fields cannot change during that write. A new-place retry reuses its request ID and applies subsequent edits to the same created venue if the original response was lost. Late loading responses cannot overwrite another editor. Reload saves current edits before fetching fresh data.

`node tests/venueEditModal.edges.browser.cjs` covers fragmented contacts, unknown names, missing-method notes, formatting, save-on-close, failed saves/retries, repeated X, Save+X, empty new forms, invalid email, interrupted create responses and stale loads.

## Contact cleanup and confirmations (v21)

One Contact notes box replaces method-specific notes. Migration joins existing person notes and labeled legacy method notes without losing their context; method note properties remain empty for older-client compatibility. Repeat cleanup is idempotent. Recognizable whitespace-separated email lists and clearly delimited US phone lists become individual rows. Websites misplaced in email/contact fields move to Other with type Website. An email saved in the name field moves to email without guessing a person's name. Ambiguous strings remain intact. Venue notes are still separate and unchanged. The sheet remains 28 columns.

Removing a person or an extra method requires confirmation. Closing a dirty editor with X, backdrop or Escape offers Save and close, Keep editing or Discard changes. Failed saves offer retry, keep or discard; they never silently close. Browser navigation also warns while there is an unsaved draft or pending save. An unchanged editor closes without writing.

Save requests include the loaded raw fields. If another editor changed a submitted field, the bridge rejects overwriting it unless the requested value already matches the saved value (safe retry). Reloading after a conflict requires confirmation before discarding the stale draft. New-place retries retain the stable request ID.
