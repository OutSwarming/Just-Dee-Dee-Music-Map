// Calendar dates are Eastern dates, never timestamps in the venue spreadsheet.
function calendarDate(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    let candidate = text;
    const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slash) candidate = `${slash[3].length === 2 ? '20' : ''}${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
        // Parse only timestamps with an explicit timezone, avoiding server-local dates.
        if (!/(?:GMT|[zZ]$|[+-]\d{2}:?\d{2}$)/.test(text)) return '';
        const date = new Date(text);
        if (!Number.isFinite(date.getTime())) return '';
        candidate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    }
    const date = new Date(candidate + 'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === candidate ? candidate : '';
}

function contactDetails(value) {
    let data;
    try { data = typeof value === 'string' ? JSON.parse(value || '{}') : value; }
    catch (_) { throw new Error('Contact details could not be read. Reload the place before saving.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid contact details.');
    const result = { version: 1, emails: [], phones: [] };
    for (const key of ['emails', 'phones']) {
        if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error('Invalid contact list.');
        result[key] = (data[key] || []).map(item => ({ value: String(item.value ?? '').trim(), note: String(item.note ?? '').trim() })).filter(item => item.value || item.note);
        if (result[key].some(item => !item.value)) throw new Error('Enter a contact value for each note.');
    }
    const json = JSON.stringify(result);
    if (json.length > 45000) throw new Error('Contact notes are too long for one spreadsheet cell.');
    return result;
}

function followUpMessage({ venue = {}, date, previousDate, addedAt = new Date() }) {
    const name = String(venue['Place Name'] || 'Place').replace(/([*_`~|\\])/g, '\\$1');
    const next = calendarDate(date);
    const previous = calendarDate(previousDate);
    const action = !next ? 'removed' : previous ? 'changed' : 'added';
    const lines = [`📅 **Follow-up ${action} — ${name}**`, `Place: ${name}`];
    if (next) lines.push(`Follow-up date: ${next} (Eastern)`);
    if (previous) lines.push(`Previous date: ${previous}`);
    lines.push(`Updated: ${new Date(addedAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} Eastern`);
    return lines.join('\n');
}

module.exports = { calendarDate, contactDetails, followUpMessage };
