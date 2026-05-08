import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TODAY = '2026-05-08';
const OUTPUT_PATH = path.join(ROOT, 'data/staged/jddm-unified-gig-source-audit.csv');
const SUMMARY_PATH = path.join(ROOT, 'data/staged/jddm-unified-gig-source-audit-summary.csv');

const SOURCE_PATHS = {
  facebook: path.join(ROOT, 'data/staged/JustDeeDeeMusic Chronological Events V2.csv'),
  calendar: path.join(ROOT, 'data/staged/jddm-calendar-gigs.csv'),
  appVenues: path.join(ROOT, 'assets/data/jddm-venues.csv'),
  legacyMaster: path.join(ROOT, 'JustDeeDee Music Sheet.csv')
};

const OUTPUT_HEADERS = [
  'match_group_id',
  'match_group_size',
  'match_group_sources',
  'duplicate_status',
  'exact_duplicate_size',
  'recommended_action',
  'is_real_gig_guess',
  'needs_review',
  'review_reason',
  'normalized_date',
  'normalized_time',
  'normalized_venue_key',
  'source_family',
  'source_file',
  'source_row',
  'source_segment',
  'source_status',
  'source_calendar',
  'calendar_event_id',
  'gig_bucket',
  'venue_name',
  'event_name',
  'address_or_location',
  'place_id',
  'original_date',
  'original_time',
  'raw_text'
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (character !== '\r') {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift() || [];
  return rows
    .filter(nextRow => nextRow.some(value => clean(value)))
    .map((nextRow, rowIndex) => ({
      rowNumber: rowIndex + 2,
      data: Object.fromEntries(headers.map((header, columnIndex) => [clean(header), nextRow[columnIndex] || '']))
    }));
}

function readCsv(filePath) {
  return parseCsv(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function clean(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function escapeCsv(value) {
  const text = clean(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(filePath, rows, headers) {
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(header => escapeCsv(row[header])).join(','))
  ];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function parseDate(value) {
  const text = clean(value);
  if (!text) return '';

  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (slash) {
    const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    return toIsoDate(year, Number(slash[1]), Number(slash[2]));
  }

  const month = text.match(/\b(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (month) {
    const monthNumber = {
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      may: 5,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      sept: 9,
      oct: 10,
      nov: 11,
      dec: 12
    }[month[1].toLowerCase()];
    return toIsoDate(Number(month[3]), monthNumber, Number(month[2]));
  }

  return '';
}

function toIsoDate(year, month, day) {
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return '';
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0')
  ].join('-');
}

function normalizeTime(value) {
  const text = clean(value).toLowerCase();
  if (!text || text === 'not listed' || text === 'n/a' || text === 'na') return '';
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!match) return '';

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const marker = match[3].toLowerCase();
  if (marker === 'pm' && hour !== 12) hour += 12;
  if (marker === 'am' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const STOPWORDS = new Set([
  'just',
  'dee',
  'deedee',
  'deedeemusic',
  'jddm',
  'music',
  'live',
  'at',
  'the',
  'open',
  'mic',
  'microphone',
  'new',
  'event',
  'returns',
  'return',
  'to',
  'and',
  'with',
  'originals',
  'cover',
  'public',
  'scheduled',
  'oh',
  'ohio',
  'usa',
  'llc',
  'company',
  'co',
  'inc',
  'restaurant',
  'winery',
  'brewery',
  'brewing',
  'tavern',
  'market',
  'farmers',
  'farm',
  'street',
  'st',
  'road',
  'rd',
  'ave',
  'avenue',
  'north',
  'south',
  'east',
  'west'
]);

function normalizeVenueKey(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(token => token && token.length > 1 && !/^\d+$/.test(token) && !STOPWORDS.has(token))
    .join(' ');
}

function tokenSimilarity(left, right) {
  if (left === right) return 1;
  const distance = levenshtein(left, right);
  return 1 - (distance / Math.max(left.length, right.length, 1));
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array(right.length + 1).fill(0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + cost
      );
    }
    for (let index = 0; index < current.length; index += 1) previous[index] = current[index];
  }

  return previous[right.length];
}

function venueSimilarity(left, right) {
  const leftTokens = normalizeVenueKey(left).split(/\s+/).filter(Boolean);
  const rightTokens = normalizeVenueKey(right).split(/\s+/).filter(Boolean);
  if (!leftTokens.length || !rightTokens.length) return 0;

  const used = new Set();
  let hits = 0;
  leftTokens.forEach(leftToken => {
    let bestIndex = -1;
    let bestScore = 0;
    rightTokens.forEach((rightToken, index) => {
      if (used.has(index)) return;
      const score = tokenSimilarity(leftToken, rightToken);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestScore >= 0.82) {
      hits += bestScore;
      used.add(bestIndex);
    }
  });

  return hits / Math.max(1, Math.min(leftTokens.length, rightTokens.length));
}

function isCalendarRealGig(row) {
  const data = row.data;
  const text = [
    data.venueName,
    data.summary,
    data.location,
    data.status
  ].join(' ').toLowerCase();
  if (clean(data.isPrivateEvent).toLowerCase() === 'true' || text.includes('private event')) return false;
  if (clean(data.status).toUpperCase() === 'PROPOSED') return false;
  if (clean(data.isAllDay).toLowerCase() === 'true' && !clean(data.eventTime)) return false;
  return !/\b(tour|flight|camping|birthday|easter|return from vegas|hold|tentative|proposed|cancel)\b/i.test(text);
}

function baseRecord(overrides) {
  return {
    match_group_id: '',
    match_group_size: '',
    match_group_sources: '',
    duplicate_status: '',
    exact_duplicate_size: '',
    recommended_action: '',
    is_real_gig_guess: '',
    needs_review: '',
    review_reason: '',
    normalized_date: '',
    normalized_time: '',
    normalized_venue_key: '',
    source_family: '',
    source_file: '',
    source_row: '',
    source_segment: '',
    source_status: '',
    source_calendar: '',
    calendar_event_id: '',
    gig_bucket: '',
    venue_name: '',
    event_name: '',
    address_or_location: '',
    place_id: '',
    original_date: '',
    original_time: '',
    raw_text: '',
    ...overrides
  };
}

function buildFacebookRecords() {
  return readCsv(SOURCE_PATHS.facebook).map(row => {
    const data = row.data;
    const normalizedDate = parseDate(data.Date);
    const venueText = [data['Event Name'], data.Address].filter(Boolean).join(' ');
    return baseRecord({
      is_real_gig_guess: normalizedDate ? 'yes' : 'review',
      needs_review: normalizedDate ? '' : 'yes',
      review_reason: normalizedDate ? '' : 'Facebook row has no parseable date',
      normalized_date: normalizedDate,
      normalized_time: normalizeTime(data.Time),
      normalized_venue_key: normalizeVenueKey(venueText),
      source_family: 'facebook_chronological',
      source_file: path.relative(ROOT, SOURCE_PATHS.facebook),
      source_row: row.rowNumber,
      source_status: 'COMPLETED',
      gig_bucket: normalizedDate >= TODAY ? 'future_or_today' : 'past',
      venue_name: data.Address || data['Event Name'],
      event_name: data['Event Name'],
      address_or_location: data.Address,
      original_date: data.Date,
      original_time: data.Time,
      raw_text: [data.Date, data.Time, data['Event Name'], data.Address].filter(Boolean).join(' | ')
    });
  });
}

function buildCalendarRecords() {
  return readCsv(SOURCE_PATHS.calendar).map(row => {
    const data = row.data;
    const normalizedDate = parseDate(data.eventDate);
    const realGigGuess = isCalendarRealGig(row);
    const venueText = [data.venueName, data.summary, data.location].filter(Boolean).join(' ');
    const reviewReasons = [];
    if (!normalizedDate) reviewReasons.push('Calendar row has no parseable date');
    if (!realGigGuess) reviewReasons.push('Calendar row looks private, proposed, all-day tour, travel, or placeholder');
    return baseRecord({
      is_real_gig_guess: realGigGuess ? 'yes' : 'no',
      needs_review: reviewReasons.length ? 'yes' : '',
      review_reason: reviewReasons.join('; '),
      normalized_date: normalizedDate,
      normalized_time: normalizeTime(data.eventTime),
      normalized_venue_key: normalizeVenueKey(venueText),
      source_family: 'google_calendar_export',
      source_file: path.relative(ROOT, SOURCE_PATHS.calendar),
      source_row: row.rowNumber,
      source_status: data.status,
      source_calendar: data.sourceCalendarName,
      calendar_event_id: data.calendarEventId,
      gig_bucket: data.status === 'BOOKED' || normalizedDate >= TODAY ? 'future_or_today' : 'past',
      venue_name: data.venueName,
      event_name: data.summary,
      address_or_location: data.location,
      original_date: data.eventDate,
      original_time: data.eventTime,
      raw_text: [
        data.eventDate,
        data.eventTime,
        data.status,
        data.venueName,
        data.summary,
        data.location
      ].filter(Boolean).join(' | ')
    });
  });
}

function buildCurrentSheetRecords() {
  const records = [];
  readCsv(SOURCE_PATHS.appVenues).forEach(row => {
    const data = row.data;
    [
      ['past', 'Past Gigs'],
      ['future_or_today', 'Future Gigs']
    ].forEach(([bucket, column]) => {
      clean(data[column])
        .split(/[;\n]+/)
        .map(segment => clean(segment))
        .filter(Boolean)
        .forEach((segment, segmentIndex) => {
          const normalizedDate = parseDate(segment);
          const normalizedTime = normalizeTime(segment);
          const segmentStartsWithDate = Boolean(segment.match(/^\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i));
          const reviewReasons = [];
          if (!normalizedDate) reviewReasons.push('Current sheet gig fragment has no explicit date');
          if ((/historical-/i.test(segment) && !segmentStartsWithDate) || /\blast played\s*=/i.test(segment)) {
            reviewReasons.push('Looks like metadata from the source cell, not a separate gig');
          }
          records.push(baseRecord({
            is_real_gig_guess: reviewReasons.length ? 'review' : 'yes',
            needs_review: reviewReasons.length ? 'yes' : '',
            review_reason: reviewReasons.join('; '),
            normalized_date: normalizedDate,
            normalized_time: normalizedTime,
            normalized_venue_key: normalizeVenueKey([data['Place Name'], data.Address, data.City].filter(Boolean).join(' ')),
            source_family: `current_sheet_${column.toLowerCase().replace(/\s+/g, '_')}`,
            source_file: path.relative(ROOT, SOURCE_PATHS.appVenues),
            source_row: row.rowNumber,
            source_segment: segmentIndex + 1,
            source_status: data.Status,
            gig_bucket: bucket,
            venue_name: data['Place Name'],
            event_name: segment,
            address_or_location: [data.Address, data.City, data.State, data.Zip].filter(Boolean).join(', '),
            place_id: data['Place ID'],
            original_date: segment,
            original_time: segment,
            raw_text: segment
          }));
        });
    });
  });
  return records;
}

function buildLegacyPlayedRecords() {
  return readCsv(SOURCE_PATHS.legacyMaster)
    .filter(row => clean(row.data.Played).toLowerCase() === 'yes')
    .map(row => {
      const data = row.data;
      return baseRecord({
        is_real_gig_guess: 'review',
        needs_review: 'yes',
        review_reason: 'Old master says Played=Yes but has no gig date',
        normalized_venue_key: normalizeVenueKey(data.Place),
        source_family: 'legacy_master_played_yes',
        source_file: path.relative(ROOT, SOURCE_PATHS.legacyMaster),
        source_row: row.rowNumber,
        source_status: data.Status,
        gig_bucket: 'undated_played_venue',
        venue_name: data.Place,
        event_name: data.Status,
        address_or_location: data.Place,
        raw_text: [
          data.Place,
          `Played=${data.Played}`,
          data.Status,
          data.Notes
        ].filter(Boolean).join(' | ')
      });
    });
}

function groupRecords(records) {
  const groups = [];
  records
    .filter(record => record.normalized_date && record.normalized_venue_key)
    .forEach(record => {
      const matchingGroup = groups.find(group => {
        if (group.date !== record.normalized_date) return false;
        return venueSimilarity(group.venueKey, record.normalized_venue_key) >= 0.42;
      });

      if (matchingGroup) {
        matchingGroup.records.push(record);
        const shortest = [matchingGroup.venueKey, record.normalized_venue_key].sort((a, b) => a.length - b.length)[0];
        matchingGroup.venueKey = shortest || matchingGroup.venueKey;
      } else {
        groups.push({
          id: `G${String(groups.length + 1).padStart(4, '0')}`,
          date: record.normalized_date,
          venueKey: record.normalized_venue_key,
          records: [record]
        });
      }
    });

  const exactCounts = new Map();
  records.forEach(record => {
    const exactKey = [
      record.normalized_date,
      record.normalized_time,
      record.normalized_venue_key
    ].join('|');
    exactCounts.set(exactKey, (exactCounts.get(exactKey) || 0) + 1);
  });

  groups.forEach(group => {
    const sourceFamilies = Array.from(new Set(group.records.map(record => record.source_family))).sort();
    const sourceRoots = Array.from(new Set(group.records.map(record => record.source_family.split('_')[0]))).sort();
    group.records.forEach(record => {
      const exactKey = [
        record.normalized_date,
        record.normalized_time,
        record.normalized_venue_key
      ].join('|');
      record.match_group_id = group.id;
      record.match_group_size = group.records.length;
      record.match_group_sources = sourceFamilies.join('; ');
      record.exact_duplicate_size = exactCounts.get(exactKey) || 1;
      if (group.records.length > 1 && sourceRoots.length > 1) record.duplicate_status = 'cross_source_match_or_duplicate';
      else if (group.records.length > 1) record.duplicate_status = 'duplicate_within_same_source_family';
      else record.duplicate_status = 'unique_single_source';
    });
  });

  records.forEach(record => {
    if (!record.match_group_id) {
      record.duplicate_status = record.normalized_date ? 'unique_unmatched' : 'undated_review';
      record.exact_duplicate_size = 1;
    }
    record.recommended_action = getRecommendedAction(record);
  });

  return groups;
}

function getRecommendedAction(record) {
  if (record.source_family === 'legacy_master_played_yes') return 'Use as played venue history; do not count as a dated gig until date is known';
  if (record.is_real_gig_guess === 'no') return 'Exclude from gig count unless manually confirmed';
  if (/metadata from the source cell/i.test(record.review_reason)) return 'Ignore metadata fragment; it points back to the same historical gig';
  if (!record.normalized_date) return 'Review or ignore undated/non-date fragment';
  if (record.duplicate_status === 'cross_source_match_or_duplicate') return 'Same likely gig appears in multiple sources; keep one canonical event';
  if (record.duplicate_status === 'duplicate_within_same_source_family') return 'Deduplicate repeated source fragments';
  if (record.source_family === 'facebook_chronological') return 'Facebook-only dated gig; keep as historical source unless disproven';
  if (record.source_family === 'google_calendar_export' && record.source_status === 'BOOKED') return 'Calendar future booking; keep as active booked gig';
  if (record.source_family === 'google_calendar_export') return 'Calendar-only completed gig; review against Facebook/history';
  return 'Current sheet-only gig entry; review source cell if it affects totals';
}

function buildSummaryRows(records, groups) {
  const rows = [];
  function add(metric, value, notes = '') {
    rows.push({ metric, value, notes });
  }

  add('total_audit_rows', records.length, 'Every source row/fragment included in the unified list');
  add('dated_rows', records.filter(record => record.normalized_date).length);
  add('undated_review_rows', records.filter(record => !record.normalized_date).length);
  add('match_groups', groups.length, 'Fuzzy grouped by normalized date + venue');
  add('cross_source_groups', groups.filter(group => new Set(group.records.map(record => record.source_family.split('_')[0])).size > 1).length);
  add('duplicate_or_match_rows', records.filter(record => Number(record.match_group_size) > 1).length);
  add('needs_review_rows', records.filter(record => record.needs_review === 'yes').length);

  const sourceCounts = countBy(records, record => record.source_family);
  Object.keys(sourceCounts).sort().forEach(source => add(`source_rows:${source}`, sourceCounts[source]));

  const statusCounts = countBy(records, record => record.duplicate_status);
  Object.keys(statusCounts).sort().forEach(status => add(`duplicate_status:${status}`, statusCounts[status]));

  const realGuessCounts = countBy(records, record => record.is_real_gig_guess || 'blank');
  Object.keys(realGuessCounts).sort().forEach(status => add(`real_gig_guess:${status}`, realGuessCounts[status]));

  return rows;
}

function countBy(values, getKey) {
  return values.reduce((counts, value) => {
    const key = getKey(value) || '(blank)';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

const records = [
  ...buildFacebookRecords(),
  ...buildCalendarRecords(),
  ...buildCurrentSheetRecords(),
  ...buildLegacyPlayedRecords()
];

const groups = groupRecords(records);
records.sort((left, right) => {
  const leftDate = clean(left.normalized_date) || '9999-99-99';
  const rightDate = clean(right.normalized_date) || '9999-99-99';
  const dateCompare = leftDate.localeCompare(rightDate);
  if (dateCompare) return dateCompare;
  const groupCompare = clean(left.match_group_id).localeCompare(clean(right.match_group_id));
  if (groupCompare) return groupCompare;
  return clean(left.source_family).localeCompare(clean(right.source_family));
});

writeCsv(OUTPUT_PATH, records, OUTPUT_HEADERS);
writeCsv(SUMMARY_PATH, buildSummaryRows(records, groups), ['metric', 'value', 'notes']);

console.log(`Wrote ${records.length} audit rows to ${path.relative(ROOT, OUTPUT_PATH)}`);
console.log(`Wrote summary to ${path.relative(ROOT, SUMMARY_PATH)}`);
