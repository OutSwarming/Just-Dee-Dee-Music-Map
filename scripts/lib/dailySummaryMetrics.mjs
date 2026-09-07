import digestDates from '../../functions/followUpDigest.js';
import venueFields from '../../functions/venueFields.js';
const {dateKey,plusDays}=digestDates;
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function calculateMetrics({rows=[],conversations=[],today=dateKey(),previousGigKeys=null}){
 const day=new Date(today+'T12:00:00Z').getUTCDay();const weekStart=plusDays(today,-((day+6)%7)),weekEnd=plusDays(weekStart,6);
 const inWeek=d=>d&&d>=weekStart&&d<=weekEnd;
 const active=rows.filter(r=>!/^(Booked|Played in the Past|Open Microphone|Told No)/i.test(r.Status||''));
 const dates=active.map(r=>venueFields.calendarDate(r['Next Follow Up']));
 const gigs=new Map();let invalidGigRows=0;
 for(const r of rows){const raw=String(r['Future Gigs']||'');const found=[...new Set(raw.match(/\b\d{4}-\d{2}-\d{2}\b/g)||[])].filter(d=>venueFields.calendarDate(d)===d&&d>=today);if(raw&&!found.length&&Number(r['Future Gig Count'])>0)invalidGigRows++;const venue=normalize(r['Place ID']||r['Place Name']);for(const date of found)gigs.set(venue+'|'+date,{venue,name:r['Place Name'],date});}
 const keys=[...gigs.keys()].sort(),values=[...gigs.values()];const followEmails=conversations.filter(c=>!c.venueId&&c.status==='followup');
 const result={today,weekStart,weekEnd,waitingOnDeeDee:conversations.filter(c=>c.status==='deedee').length,waitingOnVenue:conversations.filter(c=>c.status==='venue').length,venueRowsWaitingOnReply:rows.filter(r=>/Contacted.*Waiting on Reply/i.test(r.Status||'')).length,followUpPlacesThisWeek:dates.filter(inWeek).length,followUpEmailsThisWeek:followEmails.filter(c=>inWeek(c.followUpDate)).length,overduePlaces:dates.filter(d=>d&&d<today).length,overdueEmails:followEmails.filter(c=>c.followUpDate&&c.followUpDate<today).length,totalBookedGigs:keys.length,bookedLocations:new Set(values.map(v=>v.venue)).size,totalVenueLocations:new Set(rows.map(r=>normalize(r['Place ID']||r['Place Name']))).size,lastBookedDate:values.map(v=>v.date).sort().at(-1)||null,gigsThisWeek:values.filter(v=>inWeek(v.date)).length,newRecordedGigs:previousGigKeys===null?null:keys.filter(k=>!previousGigKeys.includes(k)).length,newGigs:previousGigKeys===null?[]:values.filter(v=>!previousGigKeys.includes(v.venue+'|'+v.date)),gigKeys:keys,invalidGigRows,upcomingGigs:values.sort((a,b)=>a.date.localeCompare(b.date)).slice(0,12)};
 return result;
}
export function renderMetrics(m){return '**Today’s numbers**\n'+[
 `Email conversations waiting on Dee Dee: **${m.waitingOnDeeDee}**; waiting on venue: **${m.waitingOnVenue}**.`,
 `Venue rows marked waiting on reply: **${m.venueRowsWaitingOnReply}**.`,
 `Follow-ups this week (${m.weekStart}–${m.weekEnd}): **${m.followUpPlacesThisWeek} places + ${m.followUpEmailsThisWeek} email ${m.followUpEmailsThisWeek===1?'conversation':'conversations'}**.`,
 `Overdue: **${m.overduePlaces} places + ${m.overdueEmails} email ${m.overdueEmails===1?'conversation':'conversations'}**.`,
 `Booked venue gigs remaining: **${m.totalBookedGigs}** across **${m.bookedLocations} locations**${m.lastBookedDate?' through '+m.lastBookedDate:''}; **${m.gigsThisWeek}** this week.`,
 m.newRecordedGigs===null?'New gigs since last recap: tracking starts with today’s baseline.':`New gig dates recorded since last recap: **${m.newRecordedGigs}**.`,
 `Total venue locations in the spreadsheet: **${m.totalVenueLocations}**.`
 ].map(x=>'• '+x).join('\n')+'\nWaiting counts are conversations, not confirmed gigs. Booking totals use the spreadsheet’s saved venue/date entries; calendar-only or unnamed events are separate. New dates can include newly synced records, not necessarily bookings made today.';}
