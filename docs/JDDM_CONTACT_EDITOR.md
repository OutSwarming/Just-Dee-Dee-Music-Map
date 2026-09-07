# Venue contacts and follow-up dates

Both Add Place and pin → Edit use the same editor. Email addresses and phone numbers have numbered rows, an inline Add button, and a Notes bubble for each contact. Notes open in a small editor and save with the place. Extra contacts can be removed individually. The first remaining contact is the primary contact used by the existing email/call actions.

The existing Email/Contact and Phone Number columns retain the primary values so existing integrations continue to work. A new Contact Details column stores the full versioned lists, including each value and its note. JSON preserves commas, quotes, and line breaks. Existing rows load without migration of their contact values. A legacy cell with one email address and accompanying text loads the text into its note bubble. Ambiguous legacy contact text can remain unchanged while editing other fields. New email entries use email validation; phone numbers allow international formatting and extensions.

Next Follow Up and Last Contacted always use calendar inputs. Calendar-only dates retain their day; timestamp values are interpreted in America/New_York. New dates save as YYYY-MM-DD text. Invalid calendar dates are rejected. The spreadsheet bridge also normalizes existing date strings when returning rows and CSV to the map and reminder service.

Monitoring / follow-up-added receives “Follow-up added — PLACE”, “Follow-up changed — PLACE”, or “Follow-up removed — PLACE”, with the new and previous dates as applicable. A new place with a follow-up sends both the new-place notification and the follow-up-added confirmation. Resaving the same calendar date sends no duplicate. Customer Communication / daily-follow-ups remains the separate 8 AM Eastern reminder channel.

The live map uses the jddmSpreadsheetBridge function in **barkrangermap-auth**. Deploying a bridge in the email bot's Firebase project does not update the map's connection.

## Verification, September 7, 2026

- 118 booking/browser-service unit tests and 119 function tests passed.
- `node tests/venueEditModal.browser.cjs` exercises Add and Edit, two emails and two phones, separate multiline notes, a date change, saving/reloading, and inline Add placement at desktop and phone sizes.
- A temporary live sheet row verified two emails, three phones, note edits, and fresh reads from Sheets. Discord verification checks one new-place message, one added-date confirmation, one changed-date confirmation, and no duplicate for a same-date save. Temporary test rows are removed after verification.

## Calendar collision repair, September 7, 2026

The old Apps Script calendar sync called `setupComputerSection_` on each run. Its 28-column schema treated Contact Details as an extra column, replaced Sheet1, and discarded AC. A warm Firebase bridge could then retain the old tab ID and dimensions. The live error was `Range (Sheet1!AC1) exceeds grid limits`.

Repair: the Firebase gateway re-reads tab identity and dimensions before every venue operation. Calendar sync no longer runs destructive setup. The bound script's legacy create path received the same narrow removal. The active Apps Script deployment `AKfycbyOems33yVzMEq_ucgoajSg3cYCq-68sM1ngKP2d0pdvA3OpJCG34ZAAM-cIeQouDKu` was updated from version 36 to 37; the five-minute trigger was verified to reference version 37. Saving Head alone was insufficient because the trigger used the deployed version.

Regression checks cover a replaced tab during a warm gateway instance and repeated calendar syncs that update gig facts while preserving the same tab and contact notes. The live Contact Details header was restored without replacing venue data. Manual purge/setup remains an explicit legacy maintenance operation and must not be used as a routine sync step.
