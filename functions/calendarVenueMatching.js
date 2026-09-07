'use strict';
const crypto = require('node:crypto');
const normalize = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function venueName(title) {
    return String(title || '').replace(/^just\s*dee\s*dee\s*music\s+live\s*@\s*/i,'').replace(/^live\s+music\s+with\s+just\s*dee\s*dee\s*music\s+at\s+/i,'').replace(/\s+-\s*(proposed|hold)\s*$/i,'').replace(/\s+\((trial|proposed|hold)\)\s*$/i,'').trim();
}
const alias = s => normalize(String(s||'').replace(/,\s*the city of .*$/i,'')).replace(/\s+\d+\s+(?=.*\b(?:rd|road|st|street|ave|avenue|blvd|boulevard|dr|drive|ln|lane|way|pkwy|parkway|ct|court)\b).*$/, '').replace(/\s+(?:at|of)\s+/g,' ').replace(/^(?:the)\s+/, '').replace(/\s+(?:llc|inc|company|co)$/, '');
const generic = s => /\b(?:scheduled (?:public|private) event|office meetings?|holiday tour|private event|private party|google meet|online meeting|unavailable|vacation|hold|tentative)\b/i.test(s);
const keyFor = e => crypto.createHash('sha256').update(JSON.stringify([normalize(e.venueName || venueName(e.title)), normalize(e.location)])).digest('hex').slice(0,32);
// Compare complete streets, not just their house numbers. Do not infer missing geography.
function address(raw) {
    const value=normalize(raw), street=value.match(/\b(\d+[a-z]?)\s+(.+?\b(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|way|parkway|pkwy|court|ct|highway|hwy|trail|trl|route|rte)\b)(?:\s+(north|south|east|west|n|s|e|w)\b)?/);
    const short={street:'st',road:'rd',avenue:'ave',boulevard:'blvd',drive:'dr',lane:'ln',parkway:'pkwy',court:'ct',highway:'hwy',trail:'trl',route:'rte',north:'n',south:'s',east:'e',west:'w'};
    const canonical=v=>v.split(' ').map(w=>short[w]||w).join(' ');
    const region=value.match(/\b(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\s+(\d{5})(?:\s+\d{4})?\b/);
    const unit=value.match(/\b(?:suite|ste|unit)\s+(\w+)/);
    return {street:street?canonical(street[0]):'',state:region?.[1]||'',zip:region?.[2]||'',unit:unit?.[1]||''};
}
function matchEvent(rows, event) {
    const name=alias(event.venueName||venueName(event.title)), candidates=name?rows.filter(r=>alias(r['Place Name'])===name):[];
    const ids=new Map();for(const r of rows){const id=String(r['Place ID']||'').trim();ids.set(id,(ids.get(id)||0)+1);}
    const ea=address(event.location), assessed=candidates.map(r=>{const ra=address([r.Address,r.City,r.State,r.Zip,r['Place Name']].filter(Boolean).join(', '));
        const conflict=['street','state','zip','unit'].some(k=>ea[k]&&ra[k]&&ea[k]!==ra[k]);
        return {r,conflict,exactStreet:!!ea.street&&ea.street===ra.street};});
    const compatible=assessed.filter(x=>!x.conflict), precise=compatible.filter(x=>x.exactStreet);
    // A missing branch address is not evidence that it belongs at this location.
    const selected=candidates.length===1?compatible:precise.length===1&&compatible.every(x=>x.exactStreet||x.conflict)?precise:[];
    const v=selected.length===1?selected[0].r:null, vague=generic((event.venueName||event.title)+' '+(event.location||''));
    const unique=v&&String(v['Place ID']||'').trim()&&ids.get(String(v['Place ID']).trim())===1;
    return {venue:unique&&!vague?v:null,candidates,
        reason:vague?'This may be an event or meeting rather than a venue.':assessed.length&&!compatible.length?'The calendar address differs from the saved address.':candidates.length>1?'More than one spreadsheet row matches this venue; confirm its branch.':v&&!unique?'Matching venue has a missing or duplicate Place ID.':'No unique, reliable spreadsheet match.'};
}
module.exports = {normalize, venueName, alias, generic, keyFor, matchEvent, address};
