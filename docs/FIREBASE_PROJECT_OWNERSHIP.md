# Firebase project ownership

Reviewed September 8, 2026. This is the current ownership guide; dated verification reports preserve historical evidence and are not deployment instructions.

| Application | Repository | Allowed Firebase project |
| --- | --- | --- |
| Just Dee Dee Music | `Just-Dee-Dee-Music-Map` | `just-dee-dee-music-map` |
| Bark Ranger | `BarkRangerMap` | `barkrangermap-auth` |

Every JDDM cloud function, database record, scheduler job and secret reference must belong to the JDDM project. All JDDM HTTP function URLs begin with `https://us-central1-just-dee-dee-music-map.cloudfunctions.net/`. Do not deploy JDDM functions or rules to Bark Ranger even if an old report gives that command.

The bridge, calendar review, and morning/nightly activity functions run as `jddm-integrations@just-dee-dee-music-map.iam.gserviceaccount.com`. It has JDDM database access, scoped secret access, and writer permission on the master venue spreadsheet. Its direct Bark Firestore read was denied. Other JDDM functions retain their existing JDDM runtime identity. Bark's default service account no longer has access to the JDDM spreadsheet.

## Deployment safeguards

Always pass `--project just-dee-dee-music-map` and select only the intended resources. Both `firebase.json` and the separate `firebase.inbox.json` enforce the project through predeploy hooks. The main configuration covers functions, hosting and Firestore rules. Missing, Bark, or unknown project IDs are rejected by `scripts/check-firebase-project.cjs`. JDDM function initialization also rejects a mismatched production project.

Run `node --test tests/firebase-project-isolation.test.cjs` before release. Keep endpoint checks and deployment hooks when reorganizing files. Before deploying, confirm the repository, resolved project, exported function names, runtime identities, secret project references, and live URL agree with this guide. A full function deployment can remove unlisted functions, so review its deletion list carefully. The live source was migrated from each deployed function's own archive; don't substitute an unrelated local branch during follow-up changes.

These safeguards protect the documented Firebase CLI workflow. Privileged console/API operations, alternate configuration files, or removing the hooks can bypass them. Stronger administrative isolation would require separately scoped deployment credentials. Documentation cannot guarantee that mixing projects is impossible.

## September 8 separation status

The website (GitHub Pages, version 22), live calendar Apps Script deployment (version 40), cloud callers and local workers now use the JDDM endpoint. Four functions and 135 documents across 11 JDDM collections were migrated with backups and field-by-field verification. Bridge read/save, spreadsheet write permission and unchanged calendar mappings were checked. All 24 non-JDDM Bark function configurations matched their original values after cutover.

The old four JDDM functions are still deployed in Bark for the rollback window: their HTTP entry points reject public access and their morning/nightly schedules are paused. Old JDDM documents and unused secret copies remain there temporarily. Do not treat their presence or ACTIVE function status as permission to use them. Final retirement is gated on the new nightly September 8 and morning September 9 reports; the follow-up begins after September 9 at 08:10 America/New_York. The private runbook and backups are under `work/project-separation/`. Update this status after verified retirement.

## Calendar interval and remaining efficiency work

The separation did not change the calendar to hourly. The existing sync remains every five minutes. Two owners have sync triggers on version 40, and a separate change-monitor trigger runs every five minutes from Head. Review both owners' triggers when consolidating; installing a trigger under one account does not remove another owner's trigger.

The September 8 review found that one duplicate sync trigger fails with a missing `script.external_request` authorization. The identical error appeared at 10:32 AM Eastern before cutover and 10:57 AM afterward. The other owner's sync and the change monitor completed after cutover, including 10:58 AM. This is an existing trigger defect; consolidate ownership instead of blindly authorizing another duplicate. The schedule/authorization cleanup remains pending.

Changing one five-minute schedule to hourly reduces its scheduled runs from 288 to 24 per day, with up to about one hour of freshness delay. That is a run-count estimate, not a promise of the same reduction in document reads. Remove duplicated work and skip unchanged snapshots before expensive review/database work; allow manual refresh when fresher results are needed. These optimizations are pending and should be tested separately from this migration.

JDDM and Bark have separate Secret Manager copies of the same ORS provider credential, so external routing/geocoding quota remains shared. Do not delete or rotate Bark's key during JDDM cleanup. Independent provider quota requires a separately provisioned JDDM key/account. A shared Google billing account also does not imply a shared Firestore database.

## Recovery

No migration failure requiring rollback was found in the immediate post-cutover checks; overnight reporting is still pending. Rollback must reconcile new JDDM writes and notification receipts before restoring old callers or schedules. Simply pointing back to the old database can lose changes or duplicate reports. Keep backup data and secret values out of source control.
