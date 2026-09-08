#!/usr/bin/env node
'use strict';
// Read-only reporting. Uses the same private local credentials as the tracker CLI.
const PROJECT = 'just-dee-dee-music-map';
const assert = require('node:assert/strict');

function summarize(entries) {
  const processes = new Map(), seen = new Set();
  let malformedCounters = 0;
  for (const entry of entries) {
    if (!entry.textPayload?.startsWith('[jddm-io] ')) continue;
    const identity = entry.insertId && `${entry.logName || ''}:${entry.insertId}`;
    if (identity && seen.has(identity)) continue;
    if (identity) seen.add(identity);
    let value;
    try { value = JSON.parse(entry.textPayload.slice(10)); }
    catch { malformedCounters++; continue; }
    if (!value.process || !value.collections || value.version !== 1) { malformedCounters++; continue; }
    const row = processes.get(value.process) || {process: value.process, invocations: 0, failedInvocations: 0, reads: 0, writes: 0, deletes: 0, writesAttempted: 0, transactionAttempts: 0, snapshotHits: 0, recordsDelivered: 0, collections: {}};
    row.invocations++;
    if (value.status === 'error') row.failedInvocations++;
    for (const [collection, counts] of Object.entries(value.collections)) {
      const item = row.collections[collection] ||= {};
      for (const [key, n] of Object.entries(counts)) if (Number.isFinite(n) && n >= 0) item[key] = (item[key] || 0) + n;
      for (const [target, source] of [['reads','documentReads'], ['writes','writesConfirmed'], ['deletes','deletesConfirmed'], ['writesAttempted','writesAttempted'], ['snapshotHits','snapshotHits'], ['recordsDelivered','recordsDelivered']]) row[target] += Number.isFinite(counts[source]) && counts[source] >= 0 ? counts[source] : 0;
      if (collection === '_transactions') row.transactionAttempts += counts.attempts || 0;
      else row.transactionAttempts += counts.transactionAttempts || 0;
    }
    processes.set(value.process, row);
  }
  const rows = [...processes.values()];
  for (const [rank, metric] of [['readRank', r => r.reads], ['writeRank', r => r.writes + r.deletes], ['totalRank', r => r.reads + r.writes + r.deletes]]) {
    [...rows].sort((a,b) => metric(b) - metric(a) || a.process.localeCompare(b.process)).forEach((row,i) => row[rank] = i + 1);
  }
  rows.sort((a,b) => a.totalRank - b.totalRank);
  return {malformedCounters, processes: rows};
}

async function report({since, until}) {
  const start = new Date(since), end = new Date(until);
  assert.ok(Number.isFinite(+start) && Number.isFinite(+end) && start < end, 'Provide a valid increasing time interval');
  assert.ok(end - start <= 48 * 3600000, 'Use an interval of at most 48 hours');
  require('./check-firebase-project.cjs').assertProject(PROJECT);
  const {token} = require('../work/conversations/runtime.cjs');
  async function api(url, method = 'GET', body) {
    const t = await token();
    const response = await fetch(url, {method, headers: {Authorization: 'Bearer ' + t.access_token, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT}, body: body ? JSON.stringify(body) : undefined});
    const data = await response.json();
    if (!response.ok) throw Error(data.error?.message || `Reporting API ${response.status}`);
    return data;
  }
  let entries = [], pageToken;
  do {
    const page = await api('https://logging.googleapis.com/v2/entries:list', 'POST', {
      resourceNames: ['projects/' + PROJECT],
      filter: `resource.type="cloud_function" AND timestamp>="${start.toISOString()}" AND timestamp<="${end.toISOString()}" AND textPayload:"[jddm-io]"`,
      orderBy: 'timestamp asc', pageSize: 1000, ...(pageToken ? {pageToken} : {})
    });
    entries.push(...page.entries || []);
    pageToken = page.nextPageToken;
  } while (pageToken);
  const result = {project: PROJECT, since: start.toISOString(), until: end.toISOString(), ...summarize(entries), monitoring: {}};
  for (const kind of ['read', 'write']) {
    const params = new URLSearchParams({
      filter: `metric.type="firestore.googleapis.com/document/${kind}_ops_count" AND resource.type="firestore.googleapis.com/Database" AND resource.labels.database_id="(default)"`,
      'interval.startTime': result.since, 'interval.endTime': result.until,
      'aggregation.alignmentPeriod': '300s', 'aggregation.perSeriesAligner': 'ALIGN_SUM',
      'aggregation.crossSeriesReducer': 'REDUCE_SUM', pageSize: '100000'
    });
    const data = await api(`https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?${params}`);
    const points = (data.timeSeries || []).flatMap(series => series.points || []).map(point => ({start: point.interval.startTime, end: point.interval.endTime, count: Number(point.value.int64Value || point.value.doubleValue || 0)})).sort((a,b) => a.end.localeCompare(b.end));
    result.monitoring[kind] = {total: points.reduce((n,p) => n + p.count, 0), points};
  }
  result.notes = [
    'Process counters cover instrumented cloud code. Local CLI counters are emitted separately to stderr.',
    'Writes use confirmed commits; retry attempts are separate. Collection details identify the actual database work.',
    'Monitoring totals include database traffic outside instrumented cloud code, such as browsers and local tools. Recent metrics can arrive late; leave several minutes after the interval before drawing conclusions.',
    'Use complete five-minute boundaries when comparing rates. Document counters do not separately price index-entry reads or other services.'
  ];
  return result;
}

module.exports = {summarize, report};
if (require.main === module) {
  const args = process.argv.slice(2), at = flag => args[args.indexOf(flag) + 1];
  const until = args.includes('--until') ? at('--until') : new Date(Math.floor((Date.now() - 300000) / 300000) * 300000).toISOString();
  const since = args.includes('--since') ? at('--since') : new Date(Date.parse(until) - 3600000).toISOString();
  report({since, until}).then(value => console.log(JSON.stringify(value, null, 2))).catch(error => {console.error(error.message); process.exitCode = 1;});
}
