import test from 'node:test';import assert from 'node:assert/strict';
import {calculateMetrics,renderMetrics} from '../scripts/lib/dailySummaryMetrics.mjs';
import {isDue,generateSummary,validateSummary,renderSummary,recentMessages} from '../scripts/jddm-ai-daily-summary.mjs';
import {notificationBody} from '../functions/discordNotifications.js';
test('only scheduled daily alerts ping; copied source mentions never ping',()=>{const a=notificationBody('hello @everyone <@123> @here',{alert:true,part:0});assert.equal((a.content.match(/@everyone/g)||[]).length,1);assert.deepEqual(a.allowed_mentions.parse,['everyone']);assert.deepEqual(notificationBody('normal',{alert:false}).allowed_mentions.parse,[]);assert.deepEqual(notificationBody('part two',{alert:true,part:1}).allowed_mentions.parse,[]);});
test('8:05 Eastern gate accounts for DST and never starts early',()=>{assert.equal(isDue(new Date('2026-09-07T12:04:59Z')),false);assert.equal(isDue(new Date('2026-09-07T12:05:00Z')),true);assert.equal(isDue(new Date('2026-12-07T13:04:59Z')),false);assert.equal(isDue(new Date('2026-12-07T13:05:00Z')),true);});
test('metrics deduplicate gigs, separate conversations, use Mon-Sun dates and exclude closed followups',()=>{const rows=[{'Place Name':'Venue A','Place ID':'id1','Future Gigs':'2026-09-08; 2026-09-08; 2026-09-13','Next Follow Up':'2026-09-09',Status:'Contacted - Waiting on Reply'},{'Place Name':'Venue A','Place ID':'id1','Future Gigs':'2026-09-08'},{'Place Name':'Venue B','Future Gigs':'2026-09-14; 2026-02-30','Next Follow Up':'2026-09-10',Status:'Told No / Closed / No Music'},{'Place Name':'Venue C','Next Follow Up':'2026-09-06',Status:'Needs Review'}];const conversations=[{status:'deedee'},{status:'venue'},{status:'followup',followUpDate:'2026-09-13'},{status:'followup',followUpDate:'2026-09-14'}];const m=calculateMetrics({rows,conversations,today:'2026-09-07'});assert.equal(m.totalBookedGigs,3);assert.equal(m.bookedLocations,2);assert.equal(m.totalVenueLocations,3);assert.equal(m.gigsThisWeek,2);assert.equal(m.followUpPlacesThisWeek,1);assert.equal(m.followUpEmailsThisWeek,1);assert.equal(m.overduePlaces,1);assert.equal(m.waitingOnDeeDee,1);assert.equal(m.newRecordedGigs,null);assert.equal(m.lastBookedDate,'2026-09-14');assert.match(renderMetrics(m),/tracking starts/);const next=calculateMetrics({rows,conversations,today:'2026-09-07',previousGigKeys:m.gigKeys.slice(1)});assert.equal(next.newRecordedGigs,1);});
test('AI generation uses loopback only, with no cloud fallback and constrained references',async()=>{const input={sources:[{id:'S1',text:'Venue A needs reply',url:'https://discord.com/'}],warnings:[]};let calls=0;const result=await generateSummary(input,{fetchImpl:async(url,req)=>{calls++;if(url.endsWith('/api/tags'))return {ok:true,json:async()=>({models:[{name:'qwen3.6:27b',details:{format:'gguf'},size:17420432739}]})};assert.equal(url,'http://127.0.0.1:11434/api/chat');assert.equal(JSON.parse(req.body).think,false);return {ok:true,json:async()=>({message:{content:JSON.stringify({bullets:[{text:'Reply to Venue A.',sources:['S1']}]})}})};}});assert.equal(calls,2);assert.equal(result.bullets.length,1);await assert.rejects(generateSummary(input,{fetchImpl:async()=>{throw Error('offline');}}),/offline/);assert.throws(()=>validateSummary({bullets:[{text:'bad',sources:['invented']}]},input),/unsupported/);});
test('recap rendering removes model mentions and arbitrary URLs; recent-source filter excludes stale posts',()=>{const input={today:'2026-09-07',sources:[{id:'S1',url:'https://discord.com/channels/1/2'}],warnings:['Calendar unavailable.']};const out=renderSummary({bullets:[{text:'@everyone check https://evil.example (S1)',sources:['S1']}]},input);assert.ok(!out.includes('@everyone'));assert.ok(!out.includes('evil.example'));assert.ok(!out.includes('(S1)'));assert.match(out,/Calendar unavailable/);assert.equal(recentMessages([{type:0,timestamp:'2026-09-05',content:'Old'},{type:0,timestamp:'2026-09-07T10:00:00Z',content:'New booking'},{type:0,timestamp:'2026-09-07T10:00:00Z',content:'HOLD - JDDM calendar monitor TEST changed'}],new Date('2026-09-07T12:00:00Z')).length,1);});

import {advanceRecap,fingerprint} from '../scripts/lib/summarySchedule.mjs';
import {buildTodayPlan,renderTodayPlan} from '../scripts/lib/todayGigPlan.mjs';
test('6 AM generation stays quiet; 7:45 refresh and 8:05 delivery reuse the unchanged draft',async()=>{
 const state={},calls=[];let input={today:'2026-09-07',metrics:{gigKeys:['a']},todayPlan:{calendarAvailable:true},sources:[{id:'S1',label:'x',text:'same',url:'u'}],warnings:[]};
 const run=at=>advanceRecap({state,now:new Date(at),loadSources:async()=>{calls.push('load');return input;},generate:async()=>{calls.push('ai');return{};},render:()=>({body:'Discord recap',smsBody:'Text recap'}),sendDiscord:async()=>calls.push('discord'),sendText:async p=>calls.push(p)});
 assert.equal((await run('2026-09-07T09:59:00Z')).waiting,'6 AM preparation');assert.deepEqual(calls,[]);
 assert.equal((await run('2026-09-07T10:00:00Z')).prepared,true);assert.deepEqual(calls,['load','ai']);
 await run('2026-09-07T11:00:00Z');assert.equal(calls.length,2);
 await run('2026-09-07T11:45:00Z');assert.equal(calls.filter(x=>x==='ai').length,1);
 assert.equal((await run('2026-09-07T12:05:00Z')).complete,true);assert.equal(calls.filter(x=>x==='ai').length,1);assert.equal(calls.filter(x=>x==='discord').length,1);assert.ok(calls.includes('+14403054062'));assert.ok(calls.includes('+12168499292'));
 await run('2026-09-07T12:10:00Z');assert.equal(calls.filter(x=>x==='discord').length,1);
});
test('changed early draft regenerates; failed text retries only that person with the same recap',async()=>{
 const state={},sent=[];let changed=false,fail=true,generated=0;
 const run=at=>advanceRecap({state,now:new Date(at),loadSources:async()=>({today:'2026-09-07',metrics:{gigKeys:[]},todayPlan:{calendarAvailable:true},sources:[{id:'S1',label:'x',text:changed?'changed':'old',url:'u'}],warnings:[]}),generate:async()=>{generated++;return{};},render:()=>({body:'D'+generated,smsBody:'T'+generated}),sendDiscord:async b=>sent.push(b),sendText:async(p,b)=>{if(p==='+12168499292'&&fail){fail=false;throw Error('temporarily offline');}sent.push(p+b);}});
 await run('2026-09-07T10:00:00Z');changed=true;await run('2026-09-07T11:45:00Z');assert.equal(generated,2);assert.equal(sent.length,0);
 assert.equal((await run('2026-09-07T12:05:00Z')).complete,false);assert.equal(sent.length,2);
 assert.equal((await run('2026-09-07T12:10:00Z')).complete,true);assert.equal(sent.length,3);assert.equal(generated,2);assert.ok(sent.every(x=>x.endsWith('2')));
});
test('calendar outage prevents a misleading gig recap; volatile check timestamps do not trigger AI again',async()=>{
 const base={today:'2026-09-07',metrics:{},todayPlan:{calendarAvailable:true},sources:[{id:'S1',label:'x',text:'a',url:'u'}],warnings:[]};assert.equal(fingerprint({...base,generatedAt:'first'}),fingerprint({...base,generatedAt:'later',sources:[{...base.sources[0],id:'S2'}]}));
 await assert.rejects(advanceRecap({state:{},now:new Date('2026-09-07T10:00:00Z'),loadSources:async()=>({...base,todayPlan:{calendarAvailable:false}}),generate:async()=>assert.fail('Must wait for calendar')}),/Waiting for current/);
});
test('today gig prominently includes recorded venue, Eastern time and address, deduplicated across calendars',()=>{
 const event={title:'Venue A',start:'2026-09-07T22:00:00Z',end:'2026-09-08T01:00:00Z',location:'123 Main St',allDay:false};
 const rows=[{'Place Name':'Venue A','Future Gigs':'2026-09-07',Address:'123 Main St',City:'Cleveland'}];const plan=buildTodayPlan({rows,calendar:{calendars:[{events:[event]},{events:[event]}]},today:'2026-09-07'});
 assert.equal(plan.gigs.length,1);assert.equal(plan.other.length,0);assert.match(renderTodayPlan(plan),/Venue A/);assert.match(renderTodayPlan(plan),/6:00 PM–9:00 PM Eastern/);assert.match(renderTodayPlan(plan),/123 Main St/);
 const stale=buildTodayPlan({rows:[],today:'2026-09-07'});assert.match(renderTodayPlan(stale),/could not be checked/);
 const empty=buildTodayPlan({rows:[],calendar:{calendars:[]},today:'2026-09-07'});assert.match(renderTodayPlan(empty),/No venue gig is recorded/);
});
test('all-day calendar ranges use an exclusive end, and holds are not invented as confirmed gigs',()=>{
 const e={title:'HOLD for music',start:'2026-09-06T04:00:00Z',end:'2026-09-08T04:00:00Z',allDay:true};const calendar={calendars:[{events:[e]}]};const m=buildTodayPlan({rows:[],calendar,today:'2026-09-07'});assert.equal(m.gigs.length,0);assert.equal(m.other.length,1);assert.equal(m.other[0].blocked,true);assert.equal(buildTodayPlan({rows:[],calendar,today:'2026-09-08'}).other.length,0);
});
test('local AI refuses a hosted alias even when it uses the expected model name',async()=>{
 let calls=0;await assert.rejects(generateSummary({sources:[]},{fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({models:[{name:'qwen3.6:27b',details:{format:'gguf'},size:17420432739,remote_host:'https://ollama.com'}]})};}}),/cloud inference is disabled/);assert.equal(calls,1);
});
test('a change at delivery time regenerates, and a generation crossing midnight cannot send yesterday',async()=>{
 const state={};let text='original',generated=0,sent=0;let finish;
 const run=at=>advanceRecap({state,now:new Date(at),clock:()=>finish||new Date(at),loadSources:async()=>({today:'2026-09-07',metrics:{gigKeys:[]},todayPlan:{calendarAvailable:true},sources:[{label:'current',text}],warnings:[]}),generate:async()=>{generated++;return{};},render:()=>({body:text,smsBody:text}),sendDiscord:async()=>sent++,sendText:async()=>sent++});
 await run('2026-09-07T10:00:00Z');await run('2026-09-07T11:45:00Z');text='venue moved';assert.equal((await run('2026-09-07T12:05:00Z')).complete,true);assert.equal(generated,2);assert.equal(sent,3);
 const late=await advanceRecap({state:{},now:new Date('2026-09-08T03:59:00Z'),clock:()=>new Date('2026-09-08T04:01:00Z'),loadSources:async()=>({today:'2026-09-07',metrics:{},todayPlan:{calendarAvailable:true},sources:[],warnings:[]}),generate:async()=>({}),render:()=>({body:'old day',smsBody:'old day'}),sendDiscord:async()=>assert.fail('Yesterday cannot send'),sendText:async()=>assert.fail('Yesterday cannot send')});assert.equal(late.waiting,'next day');
});
