import dates from '../../functions/followUpDigest.js';
const normalize=s=>String(s||'').toLowerCase().replace(/just\s*dee\s*dee\s*music\s*(live)?\s*[@-]?/g,'').replace(/weather permitting/g,'').replace(/[^a-z0-9]/g,'');
const excluded=/\b(hold|proposed|cancelled|canceled|unavailable|test)\b/i;
const dayOf=e=>e.allDay?String(e.start).slice(0,10):dates.dateKey(new Date(e.start));
export function buildTodayPlan({rows=[],calendar=null,today=dates.dateKey(),metrics={}}){
 const events=calendar?.calendars.flatMap(c=>c.events)||[];const seen=new Set();
 const current=events.filter(e=>{const starts=dayOf(e),ends=e.allDay?String(e.end).slice(0,10):dates.dateKey(new Date(Date.parse(e.end)-1));const key=normalize(e.title)+'|'+e.start+'|'+e.end;if(starts>today||(e.allDay?ends<=today:ends<today)||seen.has(key))return false;seen.add(key);return true;});
 const matched=new Set(),gigs=[];
 const todayRows=rows.filter(r=>(String(r['Future Gigs']||'').match(/\b\d{4}-\d{2}-\d{2}\b/g)||[]).includes(today));
 const unique=new Set();
 for(const r of todayRows){const id=r['Place ID']||normalize(r['Place Name']);if(unique.has(id))continue;unique.add(id);const name=normalize(r['Place Name']);let candidates=current.filter(e=>!excluded.test(e.title)&&normalize(e.title)===name);if(!candidates.length)candidates=current.filter(e=>{const n=normalize(e.title);return !excluded.test(e.title)&&n.length>=8&&name.length>=8&&(n.startsWith(name)||name.startsWith(n));});
  const address=[r.Address,r.City,r.State,r.Zip].filter(Boolean).join(', ');
  if(candidates.length===1){const e=candidates[0];matched.add(e);gigs.push({name:r['Place Name'],location:e.location||address||'Location not recorded',time:e.allDay?'All day; set time needs confirmation':formatTime(e),confirmed:true});}
  else gigs.push({name:r['Place Name'],location:address||'Location not recorded',time:candidates.length>1?'Multiple calendar times — check calendar':'Time not recorded',confirmed:true});
 }
 const other=current.filter(e=>!matched.has(e)).map(e=>({name:e.title,location:e.location||'Location not recorded',time:e.allDay?'All day':formatTime(e),blocked:excluded.test(e.title)}));
 return {today,calendarAvailable:!!calendar,gigs,other,nextGig:metrics.upcomingGigs?.find(g=>g.date>today)||null};
}
function formatTime(e){const f=d=>new Date(d).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'});return f(e.start)+'–'+f(e.end)+' Eastern';}
export function renderTodayPlan(plan,{plain=false}={}){
 if(!plan)return 'Today’s gig information is unavailable.';
 const lines=[plain?'TODAY’S GIGS':'🎸 **Today’s gigs**'];
 if(plan.gigs.length)for(const g of plan.gigs)lines.push(`${plain?'':'**'}${g.name}${plain?'':'**'} — ${g.time}`,`📍 ${g.location}`);
 else lines.push(plan.calendarAvailable?'No venue gig is recorded for today.':'No venue gig is recorded in the spreadsheet; the calendar could not be checked.');
 if(plan.other.length){lines.push('Also on today’s calendar:');for(const e of plan.other)lines.push(`• ${e.name} — ${e.time}${e.location==='Location not recorded'?'':' · '+e.location}${e.blocked?' (hold/personal/unconfirmed)':' (not matched to a venue booking)'}`);}
 if(!plan.gigs.length&&plan.nextGig)lines.push(`Next recorded gig: ${plan.nextGig.name} — ${plan.nextGig.date}.`);
 return lines.join('\n');
}
