# Just Dee Dee Inbox — Meta approval checklist

App: Just Dee Dee Inbox (`3287693101437222`). Operator: Just Dee Dee Music. Scope: its own Facebook Page and linked `justdeedeemusic` Instagram professional account, with human replies in the JDDM Discord workspace. No personal Facebook inbox access, no public self-service SaaS onboarding, and no bulk marketing sends.

## Progress — September 7, 2026

- [x] Confirm actual storage and data flows against the deployed code.
- [x] Publish a public app-information page: https://just-dee-dee-inbox.web.app/
- [x] Publish privacy policy: https://just-dee-dee-inbox.web.app/privacy.html
- [x] Publish deletion/access/correction instructions: https://just-dee-dee-inbox.web.app/data-deletion.html
- [x] Publish app terms: https://just-dee-dee-inbox.web.app/terms.html
- [x] Replace the placeholder Facebook URLs in Meta Basic Settings; set Business and pages category.
- [x] Verify pages are publicly accessible without login and all local links work; visually inspect the policy in Chrome.
- [x] Publish the Meta app. The Developer Portal displayed “Your app was successfully published” and “Your app is now available for the public to use.”
- [x] Verify Facebook and Instagram signed callbacks, isolated account identities, and human Discord reply controls in real administrator tests.
- [x] Verify silent message copies, grouping, state changes, recipient checks, duplicate-send protection, and failed-send handling (276 backend checks passed before publication).
- [x] Inspect post-publication permissions: messaging permissions still display Ready for testing. Add to App Review opens a mandatory Tech Provider conversion dialog with business/access verification and a warning that the conversion cannot be reversed. No conversion or false attestation was submitted.
- [ ] Resolve whether Advanced Access is needed for the own-business workflow through a consenting non-role sender test; if needed, obtain explicit owner approval for the permanent conversion and complete the required verification.
- [ ] Verify an authorized test involving a sender without an app/business role. Do not send unsolicited tests to real venues.
- [x] Document the full human-operated deletion procedure in JDDM_PRIVACY_REQUEST_RUNBOOK.md and implement sender restriction checks to block reimport/replies.
- [ ] Complete the full deletion operational rehearsal, including secondary copies; 279 automated checks pass, including suppression coverage.
- [x] Verify anonymous Firestore inbox/restriction reads are denied. The Discord server has five members and is not publicly discoverable; the two inbox forums inherit server/category access. Public policy accurately describes visibility to members with channel access.
- [x] Keep the policy deployment limited to six public files. Add private work/secret exclusions to Git and the general Hosting config to prevent accidental future publication.
- [ ] Review all retained local working copies and the authorization of each server member as an ongoing operational check.
- [ ] Supply any required business verification details/documents from the owner; never invent identity, addresses, or registrations.
- [ ] Attach a real reviewer demonstration and reviewer access instructions if requested by Meta.
- [ ] Submit only accurate permission explanations and attestations, then record Meta’s decision and any remediation.

## Permission explanations prepared for review

| Permission | Actual use |
| --- | --- |
| `pages_messaging` | Read conversations sent to JDDM’s Facebook Page and send a human-written reply from the associated Discord conversation. |
| `instagram_manage_messages` | Read messages sent to the linked JDDM Instagram professional account and send a human-written reply to the verified Instagram participant. |
| `instagram_basic` | Verify the linked Instagram account identity and available profile information before importing or replying. |
| `pages_manage_metadata` | Subscribe the JDDM Page to message events so incoming messages can trigger an immediate authoritative sync. |
| `pages_read_engagement` | Read Page metadata needed to identify the connected JDDM asset and its messaging context. |
| `pages_show_list` | Allow an authorized account manager to identify/select the Page during connection setup. |

Do not request ads, paid marketing, unrelated personal profile fields, or Human Agent access unless a implemented feature needs them. `business_management` is present in the app; document whether it is required for asset setup before requesting elevated access. Standard 24-hour replies are implemented; a 7-day Human Agent exception is not implemented.

## Reviewer narrative

Just Dee Dee Inbox is an internal booking communications tool operated by Just Dee Dee Music. The business connects its own Facebook Page and Instagram professional account. Authorized team members read incoming booking conversations in separate Discord forum channels, link them to existing venue records, update follow-up dates, and send human-written replies from the conversation’s Reply in Discord form. A reply is sent only after the team member submits the form. The service verifies the source account and recipient, respects the standard messaging window, and preserves each conversation’s incoming and outgoing messages together. Ordinary Discord chat is not forwarded automatically. No customer account login, scraping, personal Messenger access, or bulk outreach is involved.

## Demonstration checklist

1. Show the public app page, privacy policy, deletion instructions, and contact address.
2. Show the authorized JDDM Page / Instagram connection without displaying a credential.
3. From a consenting controlled sender, send a clearly labeled booking test to JDDM.
4. Show the same incoming text in the correct Discord forum post and blue status.
5. Open Reply in Discord, type a response, and submit; show yellow status and one outgoing copy.
6. Show that exact response arriving in the sender’s original Messenger/Instagram inbox.
7. Show linking to an existing venue and reading its official follow-up date. Use isolated test data for writes; do not alter a real venue just for the video.
8. Explain the no-role test result separately from administrator tests; do not imply an approval not shown in Meta.
9. Show the deletion request route and its operational handling. Capture no unrelated customer messages, tokens, passwords, or private spreadsheet records.

## Sources checked

- Meta’s Messenger Platform Conversations API requirements: https://www.postman.com/meta/messenger-platform-api/folder/22794852-255610cd-47f5-4f4d-b3fa-71aec360be9a
- Live Meta Developer Portal, Basic Settings, Publish, and Instagram Messaging settings for this app.
- App implementation: `messengerInbox.js`, `messengerReplies.js`, `messengerWebhook.js`, `venueIdentity.js`, `linkingReview.js`, and the local summary script.

## Publishing the public information pages

Use the dedicated Firebase Hosting site, not a deployment of the repository root:

```
npx firebase deploy --config firebase.inbox.json --only hosting --project just-dee-dee-music-map --non-interactive
```

This site publishes only `inbox-public/`. It includes no service credentials, private `work/` files, inbox records, customer data, or application runtime. Policy statements must be kept aligned with actual operational behavior; changed automation, new recipients, retention, or data sharing require review of these pages.
