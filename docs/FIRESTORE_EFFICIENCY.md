# JDDM Firestore efficiency

This release belongs only to `just-dee-dee-music-map`. It preserves the five-minute inbox, campaign and review schedules, human decisions, Gmail history/backlogs, delivery receipts, Discord cards, follow-up dates and existing runtime identities. No Bark deployment is part of it.

## Reading and writing

`functions/operationStore.js` wraps server Firestore access. `jddmEfficiency/config.enabled` controls collection materialization reads; absent/false uses canonical reads. Each registered whole-collection query can read one compressed snapshot in `jddmEfficiencySnapshots`. Canonical documents remain authoritative. Predicate queries, individual document reads, locks and transaction reads use Firestore directly. Four inbox configuration documents and the venue-identity snapshot are reused only within one invocation and cleared after writes.

Every application writer must use `operationDb(db)`. Registered canonical writes update an existing valid materialization in the same transaction, after all reads and before commit. Failed transactions publish neither copy. An unsupported field operation/type or an oversized snapshot invalidates the materialization; the next collection read rebuilds from canonical documents or falls back to the full authoritative query. Results are never truncated to fit the cache. Compressed payloads are capped at 650 KB; snapshots reconcile after six hours. Concurrent rebuilds and writers share the snapshot transaction lock.

`jddmEfficiencyRepair` observes top-level document writes. For a registered collection it compares the current canonical record with the materialization, rather than applying an event's potentially old values. A discrepancy invalidates the complete snapshot. Upgraded application writes already agree and require no repair write. This is a recovery path for console/legacy writes, with asynchronous trigger latency; use the wrapper for immediate consistency. Other collections, including the snapshots themselves, are ignored. Keep retries enabled.

Registered collections: `jddmBooking2027Venues`, `jddmBooking2027Mail`, `jddmBookingDrafts`, `jddmBooking2027Jobs`, `jddmEmailConversations`, `jddmMessengerConversations`, `jddmInstagramConversations`, `jddmVoiceConversations`, `jddmCalendarReviews`, `jddmLinkingReviews`, `jddmVenueWorklistTasks`, `jddmVenueIdentities`.

## Unchanged work

- Gmail polling still reads its history and rotates existing drafts to find content edits. Unchanged normalized messages skip Firestore writes; `seenAt` advances when content changes rather than being a per-message heartbeat. Poll health/checkpoints still record checks.
- Linking reviews fingerprint all source fields except observation time plus the venue directory. Stable input skips per-review locks and writes. Changed input, directory changes, manual decisions and failed publication still use existing review handling. A deferred retry does no work until due. Obsolete retry flags clear once when the desired card already matches its stored content hash.
- Email rematching uses the records already fetched and avoids saving unchanged link fields or refreshing a timestamp alone. Transactions still protect manual links.
- Messenger and Voice re-evaluate matching but acquire per-record locks and write only for actual changes. Discord card reconciliation remains active. Linked venue/date refreshes also check for changes before locking and reread under the lock before saving.

## Accounting and rollout

`instrument` adds one `[jddm-io]` JSON log per cloud invocation. `localOperationStore.js` adds process-level accounting to local workers. Logs contain process/collection names and counts, never message bodies, recipients or document IDs. They distinguish successful document reads, cache hits, records delivered, transaction attempts, attempted writes and confirmed writes/deletes. Empty queries count as one read. Retry attempts appear in the counters; these application counters do not include every billing category, such as index-entry charges or browser requests. Cloud Monitoring project totals are the acceptance measure.

Deploy each existing function from its own current source archive, replacing only modules matching the reviewed baseline and wrapping its database factories/entry point. Preserve historical module differences, secrets, identities and trigger definitions. Do not deploy the whole local index: it contains historical exports that are not live. Upgrade cloud and local writers, deploy the repair handler, then enable and warm the materializations. Compare canonical and snapshot contents before measuring savings.

Rollback of reads: set `jddmEfficiency/config.enabled` to false. Canonical documents and normal polling continue. Keep upgraded writers and the repair handler in place. Restoring old writer source while reads are enabled is unsafe. Private archives, operation IDs and verification evidence belong under `work/efficiency/`, never in Git.

## Validation

Run `npm test --prefix functions`, `node --test tests/firebase-project-isolation.test.cjs`, and `FIRESTORE_EMULATOR_HOST=127.0.0.1:8098 node --test functions/tests/operation-store-emulator.test.js` against an isolated Firestore emulator using the `demo-jddm-efficiency` project. The emulator suite verifies complete result equivalence, atomic mutations, concurrent writes, aborts, native transforms, corrupt/oversized snapshots, disabled reads and current-state repair.

Production measurements and rollout outcome will be recorded after verification. The baseline full hour was 24,650 reads and 7,202 writes; the code-derived seven-worker quiet-cycle baseline was approximately 2,010 reads and 584 writes every five minutes. A 90% reduction requires comparable totals below 2,465 reads and 720 writes per hour, including the snapshot overhead.

## Repeating the usage report

From the configured local checkout, run `node scripts/jddm-io-report.cjs` for the latest complete hour, or pass `--since` and `--until` as UTC timestamps. The command uses the existing private credentials, queries only JDDM, paginates the cloud counters, and prints JSON with separate read/write/total rankings plus per-collection details and project monitoring totals. It does not change data or send messages. Local worker counters remain on stderr so their existing JSON output stays usable.

A rollout check also invokes the actual Firestore event adapter without an injected project environment; merely loading its export is insufficient. The source pins the SDK project explicitly. Type-changing map merges are checked against native Firestore behavior. Historical rollout startup errors are retained in logs; acceptance uses a clean interval after the corrected recovery handler is active.
