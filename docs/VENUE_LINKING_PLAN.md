# Venue identity linking plan

The official spreadsheet is the venue directory and sole source of follow-up dates. Linking never creates a row, column, booking, contact, or follow-up date. Manual choices and explicit unlinks win.

1. Build a common evidence model for email addresses, normalized US phones, exact social profiles, scoped social sender IDs, contact names, venue names, and calendar addresses. Distinguish sender identity from a venue merely mentioned in message text.
2. Rank exact confirmed identities and saved contact methods first. Shared addresses, chains, agencies, duplicate Place IDs, conflicting evidence, missing data, and multiple matching branches require review. Fuzzy spelling helps dropdown ordering only.
3. Remember manual links per source/identity. Corrections replace that conversation's contribution; different venues linked to the same identity make it ambiguous. Never train from automatic guesses. Keep explicit unlinks sticky.
4. Apply matching on new messages and recheck previously unmatched records after spreadsheet updates. Save the decision, reason, candidates, and evidence version. Preserve manual decisions and official dates. A directory failure must not interrupt message delivery.
5. Improve calendar matching with normalized full street/location evidence, branch conflicts, safe name aliases, and existing manual review decisions. Unmatched calendar events continue to calendar-review and cannot create rows automatically.
6. Backfill existing conversations with a read-only audit first, then apply only deterministic matches. Keep uncertain matches visible on their current Discord post and prioritize them in its Link venue dropdown.
7. Validate exact/ambiguous/negative cases, shared contacts, forwarded/bounce mail, outgoing replies, generic domains, quoted text, social IDs, missing names, duplicate records, stale corrections, invalid dates, outages, repeated sync, and calendar branch addresses. Verify live records and unchanged spreadsheet shape before/after.

Local AI was considered for 5:30 AM review. It must never establish an authoritative link, fabricate an identity/profile, modify a spreadsheet, or override human decisions. The initial implementation uses explainable deterministic evidence and leaves ambiguous cases for human review; no additional AI schedule is required for reliable live matching.

Contact enrichment is a separate explicit action: linking a conversation alone does not prove that the sender should replace an existing contact person. Existing contact groups in Booking Contact can later hold verified social methods without adding columns.

## Implemented behavior

- Email: exact saved participants and unique business domains; delivery-recipient and structured forwarded-header handling; system sender addresses are never learned as reusable customer identities. Subject-only references suggest venues without automatically linking them.
- Google Calendar notification email: authenticated Google Calendar notifications can use their event title and Location block with the same calendar branch checks. This links the event, without learning Google's notification address as a venue contact.
- Facebook/Instagram: scoped sender identity, exact saved Instagram handle/profile, or a unique saved full contact name corroborated by incoming venue/contact evidence. Outgoing text, quotes, first names alone, and unrelated body contact details cannot establish a link.
- Google Voice: normalized US number and prior confirmed identity, shared across text/call/voicemail types; shared numbers require review.
- Calendar: venue aliases plus complete street, direction, available state/ZIP and unit checks; duplicate branches with missing addresses remain pending. Newly sufficient directory evidence can resolve a pending review. Explicit Link/Ignore decisions remain authoritative.
- All incoming sources recheck automatic links after directory updates, keep candidates available in the current dropdown, and preserve manual overrides/unlinks. Automatic conflicts remove the uncertain link and retain its previous venue ID for audit.

## Validation on September 7, 2026

252 backend tests pass, including new positive, negative, ambiguous, malformed-data, manual-correction, source-isolation, repeat-import, branch-address, and directory-update scenarios. Both Firebase projects received the deployed changes.

The read-only audit covered 517 venue rows / 28 existing columns, 49 email conversations, 35 Facebook conversations, and 13 Google Voice threads. Applying the audited matcher linked Abbey Swanson to Patina Porch and the authenticated Filia Cellars event email to its venue. Two open-mic newsletters and one online-meeting invitation lost subject-only links and retain suggested venues for review. Existing manual links were preserved. Facebook reprocessing posted zero duplicate history messages.

The live calendar endpoint evaluated 211 saved events (85 distinct venue/location keys): 39 linked keys; 46 unmatched or ignored keys, which include non-venue/historical items. Controlled read-only checks matched Filia Cellars at its saved address, rejected the same house number on a different street, and left an unknown venue unlinked without creating a row or test review message.

Chrome/Discord verification: Change linked venue opened the private dropdown immediately; Search venues with “Filia Celars” returned Filia Cellars with its Wadsworth location. No venue was selected during this search test, preserving the existing conversation link.

Instagram's matcher and source separation pass automated tests, and its live poll succeeds, but Meta currently returns zero Instagram conversations. A real Instagram conversation match is therefore still unverified. Unmatched Facebook/Voice records generally lack a confirmed corresponding identity in the sheet; they are not assigned from incidental venue mentions. No local AI job or paid AI dependency was added.

Final live readback confirmed that the spreadsheet CSV was byte-for-byte unchanged (517 rows, 28 columns), every linked conversation used its current official spreadsheet follow-up date, all manual links and email statuses were preserved, and the changed Discord cards displayed the expected venue/review state. Abbey’s Facebook post visibly shows Patina Porch and “Official spreadsheet follow-up: not scheduled.”
