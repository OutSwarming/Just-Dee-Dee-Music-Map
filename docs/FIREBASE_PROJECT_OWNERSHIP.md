# Firebase project ownership

Reviewed September 9, 2026. This is the current ownership guide; dated verification reports preserve historical evidence and are not deployment instructions.

| Application | Repository | Allowed Firebase project |
| --- | --- | --- |
| Just Dee Dee Music | `Just-Dee-Dee-Music-Map` | `just-dee-dee-music-map` |
| Bark Ranger | `BarkRangerMap` | `barkrangermap-auth` |

Every JDDM cloud function, database record, scheduler job and secret reference must belong to the JDDM project. All JDDM HTTP function URLs begin with `https://us-central1-just-dee-dee-music-map.cloudfunctions.net/`. Do not deploy JDDM functions or rules to Bark Ranger even if an old report gives that command.

The bridge, calendar review, morning/nightly activity, and efficiency repair functions run as `jddm-integrations@just-dee-dee-music-map.iam.gserviceaccount.com`. It has JDDM database access, scoped secret access, and writer permission on the master venue spreadsheet. Its direct Bark Firestore read was denied. Other JDDM functions retain their existing JDDM runtime identity. Bark's default service account no longer has access to the JDDM spreadsheet.

## Deployment safeguards

Always pass `--project just-dee-dee-music-map` and select only the intended resources. Both `firebase.json` and the separate `firebase.inbox.json` enforce the project through predeploy hooks. The main configuration covers functions, hosting and Firestore rules. Missing, Bark, or unknown project IDs are rejected by `scripts/check-firebase-project.cjs`. JDDM function initialization also rejects a mismatched production project.

Run `node --test tests/firebase-project-isolation.test.cjs` before release. Keep endpoint checks and deployment hooks when reorganizing files. Before deploying, confirm the repository, resolved project, exported function names, runtime identities, secret project references, and live URL agree with this guide. A full function deployment can remove unlisted functions, so review its deletion list carefully. The live source was migrated from each deployed function's own archive; don't substitute an unrelated local branch during follow-up changes.

These safeguards protect the documented Firebase CLI workflow. Privileged console/API operations, alternate configuration files, or removing the hooks can bypass them. Stronger administrative isolation would require separately scoped deployment credentials. Documentation cannot guarantee that mixing projects is impossible.

## September 8 separation status

The website (GitHub Pages), live calendar Apps Script deployment (version 41), cloud callers and local workers now use the JDDM endpoint. Four functions and 135 documents across 11 JDDM collections were migrated with backups and field-by-field verification. Bridge read/save, spreadsheet write permission and unchanged calendar mappings were checked. All 24 non-JDDM Bark function configurations matched their original values after cutover.

Final retirement completed September 9 at 08:20 America/New_York. The new September 8 nightly report was sent; the September 9 morning report was intentionally skipped by its normal logic. Both function executions succeeded and the JDDM schedules remain enabled. The four old JDDM functions, two old scheduler jobs and their Pub/Sub topics, 135 unchanged backed-up JDDM documents, and six unused JDDM secret copies were removed from Bark. No old JDDM rollback resources in that allowlist remain active or stored in Bark.

Bark's 24 remaining function configurations and five other scheduler configurations were verified unchanged. Bark's ORS secret metadata and versions are unchanged. All 11 JDDM scheduler configurations remain unchanged; the bridge, recent calendar execution and both public sites passed availability checks. Private backups, deletion receipts and `retirement-complete.json` remain under `work/project-separation/`; never publish those files.

## Calendar efficiency and routing — September 8 follow-up

Both live calendar schedules now run hourly under justdeedeemusic@gmail.com: one spreadsheet sync and one Head change monitor. The owner's failed duplicate sync was removed. Both source installers now default to hourly; inspect every owner's triggers before reinstalling. Each schedule runs about 24 times per day instead of 288. Calendar changes can take about an hour to appear. The notification digest accepts a successful calendar check within 90 minutes.

Venue resolution now caches results by source, review/mapping mode, calendar content, venue matching fields, Eastern date and manual-decision revision. An unchanged cache hit uses two Firestore document reads and no writes, skipping per-venue lookups, locks and repeated review publication. Changed inputs and manual decisions invalidate results; six-hour expiry provides reconciliation. This is a resolver improvement, not zero total application reads: calendar health, real changes, users and cache misses still perform work.

JDDM routing is disabled in the browser and the getPremiumRoute backend. Trip engines are no longer loaded and saved-route reads are disabled. Address geocoding remains available for venues. Bark routing is unchanged. JDDM and Bark retain separate Secret Manager copies of the same ORS provider credential, so geocoding can still share external provider quota. Do not delete or rotate Bark's key during JDDM cleanup; independent geocoding quota requires a separately provisioned JDDM key/account.

Carter Swarm Commands includes a JDDM reads, writes & stats view. Its analytics identity has monitoring.viewer on JDDM only for aggregate Cloud Monitoring usage. The project ID is pinned to just-dee-dee-music-map; no JDDM venue/database role was granted. Analytics history lives in Carter Swarm's private database. This owner dashboard permission does not connect the two applications' runtime databases.

## September 8 Firestore efficiency

The JDDM release updates 21 existing functions from their own deployed source archives and adds `jddmEfficiencyRepair`. The disabled `getPremiumRoute` deployment stays unchanged. Existing runtime settings, secret references, endpoints and all 11 Cloud Scheduler jobs were verified unchanged; the seven frequent workers still run every five minutes. Local booking workers use the same database wrapper. No Bark resource was changed by this release.

Read `FIRESTORE_EFFICIENCY.md` before adding or changing a database writer. Registered collections now have compact snapshots updated atomically with canonical records, plus an asynchronous repair handler for other writes. The snapshots are private under the existing Firestore rules. `jddmEfficiency/config.enabled=false` disables snapshot reads without changing the canonical data or schedules. Per-process counts are available through `scripts/jddm-io-report.cjs`.

## Recovery

Overnight verification and final retirement passed; no migration failure requiring rollback was found. Rollback must reconcile new JDDM writes and notification receipts before restoring old callers or schedules. Simply pointing back to the old database can lose changes or duplicate reports. Keep backup data and secret values out of source control.
