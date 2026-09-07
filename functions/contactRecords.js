/* Shared browser/server contact format. Stored in the existing Booking Contact cell. */
(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.JDDMContacts = api;
})(typeof window === 'object' ? window : globalThis, function() {
    const PREFIX = 'JDDM_CONTACTS_V2\n';
    const clean = value => String(value ?? '').trim();
    const emailPattern = /[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    const empty = () => ({name:'', preferredMethod:'', notes:'', emails:[], phones:[], others:[]});
    function formatPhone(value) {
        const text = clean(value);
        const extension = text.match(/\s*(?:ext(?:ension)?\.?|x|#)\s*(\d+)$/i);
        const base = extension ? text.slice(0, extension.index).trim() : text;
        if (!/^[+\d\s().-]+$/.test(base)) return text;
        const digits = base.replace(/\D/g, '');
        if (base.startsWith('+') && !base.startsWith('+1')) return text;
        const national = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
        if (national.length !== 10 || (digits.length !== 10 && digits.length !== 11)) return text;
        return `(${national.slice(0,3)}) ${national.slice(3,6)}-${national.slice(6)}${extension ? ' ext. ' + extension[1] : ''}`;
    }
    function normalize(data) {
        if (!data || data.version !== 2 || !Array.isArray(data.contacts)) throw Error('Contact groups could not be read. Reload before saving.');
        const contacts = data.contacts.map(person => {
            if (!person || typeof person !== 'object') throw Error('Invalid contact.');
            const result = {name:clean(person.name), preferredMethod:clean(person.preferredMethod), notes:clean(person.notes)};
            for (const key of ['emails','phones','others']) {
                if (person[key] !== undefined && !Array.isArray(person[key])) throw Error('Invalid contact methods.');
                result[key] = (person[key] || []).map(item => ({value:clean(item.value),note:clean(item.note),...(key === 'others' ? {type:clean(item.type)} : {})})).filter(item=>item.value || item.note || item.type);
            }
            return result;
        }).filter(p=>p.name || p.preferredMethod || p.notes || p.emails.length || p.phones.length || p.others.length);
        return {version:2, contacts, legacyBookingContact:clean(data.legacyBookingContact), baseline:data.baseline && typeof data.baseline === 'object' ? data.baseline : {}};
    }
    function decode(value) {
        const text = clean(value);
        if (!text.startsWith(PREFIX)) return null;
        try { return normalize(JSON.parse(text.slice(PREFIX.length))); }
        catch (_) { throw Error('Saved contact groups could not be read. Reload before saving.'); }
    }
    function legacyList(key,value) {
        const text = clean(value);
        if (!text) return [];
        if (key === 'emails') {
            const emails = text.match(emailPattern) || [];
            if (emails.length === 1) return [{value:emails[0],note:text.replace(emails[0],'').replace(/^mailto:/i,'').replace(/^[\s,;<>]+|[\s,;<>]+$/g,'')}];
            if (emails.length > 1 && text.split(/[,;\n]+/).every(s=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()))) return emails.map(value=>({value,note:''}));
            return [];
        }
        return text.split(/[;\n]+/).map(value=>({value:clean(value),note:''})).filter(i=>i.value);
    }
    function read(fields) {
        const stored = decode(fields['Booking Contact']);
        if (stored) {
            // Keep direct edits to the main spreadsheet contact fields usable.
            for (const [header,key] of [['Contact Name','name'],['Contact Type','preferredMethod'],['Email/Contact','emails'],['Phone Number','phones']]) {
                if (!(header in fields) || !(header in stored.baseline) || clean(fields[header]) === clean(stored.baseline[header])) continue;
                if (!stored.contacts.length) stored.contacts.push(empty());
                if (key === 'name' || key === 'preferredMethod') stored.contacts[0][key] = clean(fields[header]);
                else {
                    const owner = stored.contacts.find(p=>p[key].some(i=>i.value)) || stored.contacts[0];
                    const index = Math.max(0,owner[key].findIndex(i=>i.value));
                    const previous = owner[key][index] || {note:''};
                    if (clean(fields[header]) || previous.note) owner[key][index] = {...previous,value:clean(fields[header])};
                    else owner[key].splice(index,1);
                }
            }
            return stored;
        }
        const person = empty();
        person.name = clean(fields['Contact Name']);
        person.preferredMethod = clean(fields['Contact Type']);
        let old = {};
        if (clean(fields['Contact Details'])) {
            try { old = JSON.parse(fields['Contact Details']); }
            catch (_) { throw Error('Existing contact notes could not be read. Reload before saving.'); }
            if (old.version !== 1) throw Error('Unrecognized saved contact format.');
        }
        for (const [key,header] of [['emails','Email/Contact'],['phones','Phone Number']]) {
            person[key] = Array.isArray(old[key]) ? old[key].map(i=>({value:clean(i.value),note:clean(i.note)})) : legacyList(key, fields[header]);
            if (person[key].length && old[key] && clean(fields[header]) && person[key][0].value !== clean(fields[header])) person[key][0].value = clean(fields[header]);
        }
        // Free text and websites from the old email column remain editable as Other.
        person.emails = person.emails.filter(item=>{
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.value)) return true;
            if (item.value || item.note) person.others.push({...item,type:'Previous email/contact'});
            return false;
        });
        if (!old.emails && !person.emails.length && clean(fields['Email/Contact'])) person.others.push({type:'Previous email/contact',value:clean(fields['Email/Contact']),note:''});
        return normalize({version:2,contacts:[person],legacyBookingContact:clean(fields['Booking Contact'])});
    }
    function isWebsite(value) {
        return /^(?:https?:\/\/|www\.)[^\s@]+$/i.test(value) || /^(?:[a-z0-9-]+\.)+(?:com|org|net|us|co|io|music)(?:\/[^\s]*)?$/i.test(value);
    }
    function emailList(value) {
        const text = clean(value), found = text.match(emailPattern) || [];
        const rest = text.replace(emailPattern, '').replace(/[\s,;|&<>]+/g,'');
        return found.length && !rest ? found : null;
    }
    function phoneList(value) {
        const text = clean(value);
        const pattern = /(?<!\d)(?:\+?1[ .-]*)?(?:\(\d{3}\)|\d{3})[ .-]*\d{3}[ .-]*\d{4}(?:\s*(?:ext(?:ension)?\.?|x|#)\s*\d+)?(?!\d)/gi;
        const found = text.match(pattern) || [];
        const rest = text.replace(pattern,'').replace(/[\s,;/|&]+/g,'');
        return found.length && !rest ? found.map(formatPhone) : [formatPhone(text)];
    }
    function tidy(data) {
        const result = normalize(data);
        for (const person of result.contacts) {
            const notes = person.notes ? [person.notes] : [];
            const addNote = text => { if (text && !notes.includes(text)) notes.push(text); };
            const emails = [], phones = [], others = [];
            const add = (list,item) => { if (!list.some(i=>i.value.toLowerCase() === item.value.toLowerCase() && (i.type || '') === (item.type || ''))) list.push(item); };
            if (emailList(person.name)?.length === 1 && emailList(person.name)[0] === person.name) {
                add(emails,{value:person.name,note:''});
                person.name = '';
            }
            for (const key of ['emails','phones','others']) for (const item of person[key]) {
                const label = key === 'emails' ? 'Email' : key === 'phones' ? 'Phone' : item.type || 'Other contact';
                if (item.note) addNote(`${label}${item.value ? ' (' + item.value + ')' : ' (not known yet)'}: ${item.note}`);
                if (!item.value) { if (item.type) add(others,{type:item.type,value:'',note:''}); continue; }
                if (key === 'phones') phoneList(item.value).forEach(value=>add(phones,{value,note:''}));
                else if (isWebsite(item.value)) add(others,{type:key === 'others' && item.type && !/^(?:Previous email\/contact|Other)$/i.test(item.type) ? item.type : 'Website',value:item.value,note:''});
                else if (emailList(item.value) && (key === 'emails' || /^(?:Previous email\/contact|Email)?$/i.test(item.type || ''))) emailList(item.value).forEach(value=>add(emails,{value,note:''}));
                else add(others,{type:item.type || 'Other',value:item.value,note:''});
            }
            person.notes = notes.join('\n\n');
            person.emails = emails; person.phones = phones; person.others = others;
        }
        return result;
    }
    function summary(data) {
        const first = data.contacts[0] || empty();
        return {'Contact Name':first.name,'Contact Type':first.preferredMethod,
            'Email/Contact':data.contacts.flatMap(p=>p.emails).find(i=>i.value)?.value || '',
            'Phone Number':data.contacts.flatMap(p=>p.phones).find(i=>i.value)?.value || ''};
    }
    function encode(data, baseline) {
        const result = normalize(data);
        result.baseline = baseline || summary(result);
        const text = PREFIX + JSON.stringify(result);
        if (text.length > 45000) throw Error('Contact notes are too long for one spreadsheet cell.');
        return text;
    }
    function display(value) {
        const data = decode(value);
        if (!data) return clean(value);
        return [data.legacyBookingContact, ...data.contacts.map(p=>[p.name,p.preferredMethod,...p.emails.map(i=>i.value),...p.phones.map(i=>formatPhone(i.value)),...p.others.map(i=>`${i.type || 'Other'}: ${i.value}`)].filter(Boolean).join(' | '))].filter(Boolean).join('\n');
    }
    return {PREFIX,empty,normalize,decode,read,summary,encode,display,formatPhone,tidy,emailList,phoneList};
});
