'use strict';
const crypto = require('node:crypto');
const normalize = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function venueName(title) {
    return String(title || '').replace(/^just\s*dee\s*dee\s*music\s+live\s*@\s*/i,'').replace(/^live\s+music\s+with\s+just\s*dee\s*dee\s*music\s+at\s+/i,'').replace(/\s+-\s*(proposed|hold)\s*$/i,'').replace(/\s+\((trial|proposed|hold)\)\s*$/i,'').trim();
}
const alias = s => normalize(String(s||'').replace(/,\s*the city of .*$/i,'')).replace(/\s+\d+\s+(?=.*\b(?:rd|road|st|street|ave|avenue|blvd|boulevard|dr|drive|ln|lane|way|pkwy|parkway|ct|court)\b).*$/, '').replace(/\s+(?:at|of)\s+/g,' ').replace(/^(?:the)\s+/, '').replace(/\s+(?:llc|inc|company|co)$/, '');
const generic = s => /\b(?:scheduled (?:public|private) event|office meetings?|holiday tour|private event|private party|google meet|online meeting|unavailable|vacation|hold|tentative)\b/i.test(s);
const keyFor = e => crypto.createHash('sha256').update(JSON.stringify([normalize(e.venueName || venueName(e.title)), normalize(e.location)])).digest('hex').slice(0,32);
function matchEvent(rows, event) {
    const name = alias(event.venueName || venueName(event.title));
    const candidates = name ? rows.filter(r => alias(r['Place Name']) === name) : [];
    const ids = new Map();
    for (const r of rows) { const id = String(r['Place ID'] || '').trim(); ids.set(id, (ids.get(id) || 0) + 1); }
    const v = candidates.length === 1 ? candidates[0] : null;
    // Street numbers distinguish branches even if the name is unique in the sheet.
    const eventStreet = String(event.location || '').match(/^\s*(\d+)\s/), rowStreet = String(v?.Address || '').match(/^\s*(\d+)\s/);
    const conflictingAddress = eventStreet && rowStreet && eventStreet[1] !== rowStreet[1];
    return {venue: v && v['Place ID'] && ids.get(v['Place ID']) === 1 && !conflictingAddress && !generic((event.venueName || event.title)+' '+(event.location || '')) ? v : null, candidates,
        reason: candidates.length > 1 ? 'More than one spreadsheet row matches this venue.' : conflictingAddress ? 'The calendar address differs from the saved address.' : generic((event.venueName || event.title)+' '+(event.location || '')) ? 'This may be an event or meeting rather than a venue.' : 'No unique, reliable spreadsheet match.'};
}
module.exports = {normalize, venueName, alias, generic, keyFor, matchEvent};
