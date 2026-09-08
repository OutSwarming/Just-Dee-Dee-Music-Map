# JDDM efficiency release — verified September 8, 2026

**Deployed to Just Dee Dee Music: reads reduced 94.4% and writes reduced 96.3% in the clean production measurement.** Five-minute polling remains active. No Bark deployment, schedule, database, credential, or route behavior was changed.

## Measured result

The clean observation covers **1:25–1:35 PM Eastern (17:25–17:35 UTC)**, September 8. Every frequent worker completed twice with no errors. The comparison uses the pre-change full-hour rate measured approximately 11:06–12:06 PM Eastern, normalized to the same duration.

| Measure | Before: full-hour baseline | After: hourly equivalent of the 10-minute measurement | Reduction |
|---|---:|---:|---:|
| Firestore reads | 24,650 | 1,374 | **94.4%** |
| Firestore writes | 7,202 | 270 | **96.3%** |

Actual Cloud Monitoring totals in the new ten-minute interval: **229 reads and 45 writes**. Its two complete five-minute buckets were 115 / 22 and 114 / 23 reads / writes. Monitoring was re-read after ingestion delay; the first retrieval was incomplete.

Application logs independently recorded **230 reads and 45 confirmed writes**, with zero failed invocations and no malformed counters. The one-read difference reinforces that application counters and monitoring are separate measurements; the reductions above use Monitoring consistently for the before/after comparison. The conservative logged-read comparison also exceeds 94%.

This measures current steady polling across two cycles, not a guarantee that every future interval or today's accumulated totals will fall by the same percentage. Real incoming messages, edits, retries, six-hour snapshot reconciliation and growth still create necessary work. One-time rollout and record-by-record verification reads occurred outside the clean interval. Earlier usage remains in today's totals.

## Current process ranking

Rows are ordered by current reads. New values are observed **per run**; the booking write value is the average of the two runs. Previous values are the audit's approximate quiet-run model, not separately metered historical process totals.

| Read rank now | Process | Previous reads / writes | Current reads / writes | What changed |
|---:|---|---:|---:|---|
| 1 | Messenger | 258 / 112 | **50 / 5** | Read the conversation snapshot once; reuse identity/configuration reads; skip unchanged saves and per-conversation locks. |
| 2 | Email conversations | 213 / 55 | **24 / 4** | Reuse fetched records, avoid unchanged automatic-link writes and timestamp-only saves; reuse identity data. |
| 3 | 2027 booking tracker | 973 / 40 | **13 / 5.5** | Replace large collection scans with compact snapshots; preserve Gmail history/draft checks while skipping unchanged mail writes. |
| 4 | Google Voice | 86 / 45 | **9 / 4** | Skip locks and saves for unchanged matches; retain card/date reconciliation. |
| 5 | Linking Review, including its calendar-list call | 462 / 325 | **8 / 1** | Fingerprint source/directory changes before locking; stop rewriting unchanged reviews and obsolete retry flags. |
| 6 | Instagram | 10 / 7 | **7 / 3** | Retain the poll/health safeguards; use shared reads and skip unnecessary saved-record work. |
| 7 | Venue worklist refresh | 8 / 0 | **2 / 0** | Read the compact worklist snapshot. |

Write ranking: booking tracker 5.5; Messenger 5; Email and Voice 4 each; Instagram 3; Linking Review 1; worklist 0. The 90% target applies to aggregate usage; small workflows retain a necessary minimum and do not individually achieve 90% on every measure.

The function report lists Linking Review as 6 reads and the separate calendar-list handler as 2. The table combines them to match the earlier workflow attribution; do not add the calendar reads twice. The cached notification digest additionally used 2 reads and no writes per request. The spreadsheet bridge reported 22 invocations during the interval with no Firestore operations. The recovery handler processed 45 events with no Firestore operations because these events concerned uncached checkpoints/locks; earlier live canonical-change checks also succeeded.

The local booking status command now reads its 435 task records and five jobs using **six document reads total**, including configuration/health, versus approximately 442 before. Its usual JSON output remains intact; counters go to stderr.

## Operations inside the frequent workers

This register shows the measured components of a typical unchanged run, including snapshots, controls and locks. It supplements the original audit's broader inventory of user actions, jobs, hourly/daily work and inactive legacy exports.

| Process | Remaining reads | Remaining writes |
|---|---|---|
| Messenger | 37 live privacy checks; 4 lock reads; 3 configuration reads; 3 snapshot reads; 2 canonical conversation reads; 1 efficiency control read = 50 | 4 lock writes and 1 health/configuration write = 5 |
| Email | 18 linked-conversation reads; 3 configuration/lock/checkpoint reads; 2 snapshots; 1 efficiency control = 24 | 4 lock/checkpoint/health writes |
| Booking | 8 snapshot reads; 2 lock reads; 2 configuration/checkpoint reads; 1 efficiency control = 13 | 2 lock writes; 2 checkpoint writes; 1 health write; one unmatched-draft update across the two observed runs |
| Voice | 3 configuration reads; 2 locks; 2 snapshots; 1 linked-conversation query; 1 efficiency control = 9 | 2 locks and 2 checkpoint/configuration writes |
| Linking Review | 5 snapshots and 1 control; calendar child call adds 1 snapshot and 1 control = 8 | 1 health/configuration write |
| Instagram | 2 locks; 1 configuration; 1 snapshot; 1 control; 1 empty linked-conversation query; 1 privacy check = 7 | 2 locks and 1 health/configuration write |
| Worklist | 1 snapshot and 1 control = 2 | None when unchanged |
| Cached digest | 1 digest and 1 calendar-health read = 2 | None on a cache hit |

Daily follow-ups, morning/nightly activity, hourly calendars, draft creation and interactive actions retain their existing behavior and emit operation counts when invoked; their unobserved costs are not presented as measured results here.

Actual changes additionally pay the existing delivery receipts and canonical writes, plus snapshot maintenance. Each registered write updates its snapshot in the same transaction. Recovery checks a current canonical record against its snapshot; a mismatch forces a rebuild. The counters include this overhead, transaction attempts, confirmed commits and cache delivery counts.

## Functionality and deployment checks

- **933 records across all 12 snapshot collections matched their canonical originals**, both at enablement and after live operation. No records were truncated or removed.
- **339 automated checks passed:** 323 application behavior tests, eight native Firestore emulator tests, five project/startup checks, and three usage-report tests. Coverage includes manual decisions, official dates, drafts without sending, duplicate/partial delivery recovery, transaction aborts/concurrency, special field updates and changing field types.
- The spreadsheet schema and health endpoints returned HTTP 200. The authenticated calendar list returned all 15 reviews. Snapshot access without authentication was denied.
- Updated 21 existing functions from their own deployed source archives, preserving historical module differences. Added one recovery function. The disabled route function stayed unchanged.
- Verified the existing function runtime identities, secret references, endpoint/trigger settings and all 11 Cloud Scheduler definitions remained unchanged. The seven frequent workers still check every five minutes. Existing hourly calendars and daily/AI schedules were preserved.
- Local workers use the same snapshot-aware writer and remain in the separate JDDM project. Existing unrelated local files were left intact.

Older deployment packages initially lacked the SDK project setting, and the new recovery adapter required it at invocation time. Those startup issues were corrected and regression-tested before this clean measurement. Historical error logs remain visible, but there were **zero errors in the acceptance interval**. Shared reads stayed off during correction while normal polling and unchanged-write savings continued.

## Keeping it efficient

Use `node scripts/jddm-io-report.cjs` in the configured local checkout for a repeatable ranked report, or specify `--since` and `--until` UTC times. It reports every instrumented cloud process and collection, document reads, confirmed writes/deletes, attempts, cache hits, failures and project totals. Local worker counts are emitted separately. Browser and other uninstrumented access still appear in project Monitoring totals.

The largest remaining read cost is live Messenger privacy checks. The next smaller opportunity is Email's 18-record linked-date query. Keep current safeguards while evaluating any further reduction. Monitor snapshot size/fallback counts as data grows; split materializations before their safe size limit. The current implementation already exceeds the aggregate target without changing refresh frequency.

The implementation and rollback procedure are documented in `docs/FIRESTORE_EFFICIENCY.md`. Setting `jddmEfficiency/config.enabled` to false returns new polls to canonical collection reads. Original data, normal polling and upgraded writers remain available. Private source archives, configuration checks, counters and canonical comparison hashes are retained in the efficiency release's `work/efficiency/` directory. The reusable report also runs from the main local checkout.
