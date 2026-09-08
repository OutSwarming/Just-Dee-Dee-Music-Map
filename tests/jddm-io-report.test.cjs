'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {summarize, report} = require('../scripts/jddm-io-report.cjs');
const entry = (id, process, collections, status='ok') => ({insertId:id, logName:'test', textPayload:'[jddm-io] '+JSON.stringify({version:1, process, collections, status})});
test('reports confirmed work, retries and cached delivery separately, without duplicate log counting', () => {
  const first=entry('one','worker',{source:{documentReads:4,writesConfirmed:1,writesAttempted:3,snapshotHits:1,recordsDelivered:200},_transactions:{attempts:3}});
  const result=summarize([first,first,entry('two','worker',{source:{documentReads:2,deletesConfirmed:1}},'error'),entry('three','reader',{cache:{documentReads:20}})]);
  const row=result.processes.find(x=>x.process==='worker');
  assert.deepEqual([row.invocations,row.failedInvocations,row.reads,row.writes,row.deletes,row.writesAttempted,row.transactionAttempts,row.recordsDelivered],[2,1,6,1,1,3,3,200]);
  assert.equal(row.writeRank,1);assert.equal(result.processes[0].process,'reader');
});
test('malformed counters are visible and ordinary logs do not enter rankings',()=>{
  assert.equal(summarize([{textPayload:'ordinary'}, {textPayload:'[jddm-io] bad'}]).malformedCounters,1);
});
test('invalid reporting intervals fail before credentials or external reads',async()=>{
  await assert.rejects(report({since:'not a date',until:'2026-09-08'}),/valid increasing/);
  await assert.rejects(report({since:'2026-01-01',until:'2026-09-08'}),/48 hours/);
});
