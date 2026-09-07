import test from 'node:test';import assert from 'node:assert/strict';import {allowedRecipients,deliverDigest,RECIPIENTS} from '../scripts/send-due-follow-ups.mjs';
test('only Dee Dee and Carter can receive automated texts',()=>{assert.deepEqual(allowedRecipients(),RECIPIENTS);assert.throws(()=>allowedRecipients(false,'+15551234567'));});
test('partial failure retries only the unsuccessful recipient',async()=>{let calls=[],fail=true;const state={};const send=async(p)=>{calls.push(p);if(p===RECIPIENTS[1]&&fail)throw Error('temporary');};const digest={today:'2026-09-07',body:'Hi Dee Dee'};assert.equal((await deliverDigest({digest,state,send})).failures.length,1);fail=false;await deliverDigest({digest,state,send});await deliverDigest({digest,state,send});assert.deepEqual(calls,[RECIPIENTS[0],RECIPIENTS[1],RECIPIENTS[1]]);});
test('background permission timeouts persist a useful failure and never mark a text sent',async()=>{
 const saved=[];const r=await deliverDigest({digest:{today:'2026-09-07',body:'Hi'},recipients:[RECIPIENTS[0]],send:async()=>{throw Object.assign(new Error('Command failed'),{killed:true});},persist:async s=>saved.push(JSON.parse(JSON.stringify(s)))});
 assert.equal(r.failures.length,1);assert.equal(saved.length,1);assert.equal(saved[0]['2026-09-07'][RECIPIENTS[0]].sent,false);assert.match(r.failures[0].error,/Automation permission/);
});
import {notificationRuntime} from '../scripts/lib/notificationRuntime.mjs';
test('reinstall preserves the selected Messages runtime and fails if it disappears',async()=>{
 const checked=[];assert.equal(await notificationRuntime({loadConfig:async()=>({messagesNodePath:'/approved/node'}),current:'/different/node',check:async p=>checked.push(p)}),'/approved/node');assert.deepEqual(checked,['/approved/node']);
 await assert.rejects(notificationRuntime({loadConfig:async()=>({messagesNodePath:'/missing/node'}),check:async()=>{throw Error('Missing runtime');}}),/Missing runtime/);
});
