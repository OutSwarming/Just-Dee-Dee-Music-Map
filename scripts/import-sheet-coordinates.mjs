import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const DEFAULT_CSV_PATH = path.join(ROOT, 'assets/data/jddm-venues.csv');
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'config/firebaseConfig.example.js');

function parseArgs(argv) {
  return argv.reduce((args, arg) => {
    if (arg === '--dry-run') {
      args.dryRun = true;
      return args;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
    return args;
  }, {});
}

function clean(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = (rows.shift() || []).map(clean);
  return rows
    .filter(values => values.some(clean))
    .map(values => headers.reduce((record, header, index) => {
      if (header) record[header] = clean(values[index]);
      return record;
    }, {}));
}

function getValue(row, names) {
  const keys = Object.keys(row);
  for (const name of names) {
    const exact = row[name];
    if (clean(exact)) return clean(exact);
    const normalized = name.toLowerCase();
    const key = keys.find(candidate => clean(candidate).toLowerCase() === normalized);
    if (key && clean(row[key])) return clean(row[key]);
  }
  return '';
}

async function readApiUrl(configPath) {
  if (process.env.JDDM_SPREADSHEET_API_URL) return process.env.JDDM_SPREADSHEET_API_URL;
  const configText = await fs.readFile(configPath, 'utf8');
  const match = configText.match(/JDDM_SPREADSHEET_API_URL\s*=\s*["']([^"']+)["']/);
  if (!match) throw new Error('JDDM_SPREADSHEET_API_URL was not found in config or environment.');
  return match[1];
}

const args = parseArgs(process.argv.slice(2));
const csvPath = path.resolve(args.csv || DEFAULT_CSV_PATH);
const configPath = path.resolve(args.config || DEFAULT_CONFIG_PATH);
const limit = args.limit ? Number(args.limit) : undefined;
const apiUrl = await readApiUrl(configPath);
const csvText = await fs.readFile(csvPath, 'utf8');
const records = parseCsv(csvText);
const rows = records
  .map(row => ({
    id: getValue(row, ['id', 'Site ID', 'site id']),
    longitude: getValue(row, ['longitude', 'lng', 'long']),
    latitude: getValue(row, ['latitude', 'lat'])
  }))
  .filter(row => row.id && row.longitude && row.latitude);

const selectedRows = Number.isFinite(limit) ? rows.slice(0, Math.max(0, limit)) : rows;

if (args.dryRun) {
  console.log(JSON.stringify({
    dryRun: true,
    apiUrl,
    csvPath,
    availableRows: rows.length,
    selectedRows: selectedRows.length,
    sample: selectedRows.slice(0, 5)
  }, null, 2));
  process.exit(0);
}

const response = await fetch(apiUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({
    action: 'importCoordinates',
    rows: selectedRows,
    limit: selectedRows.length
  }),
  redirect: 'follow'
});

const text = await response.text();
let parsed;
try {
  parsed = JSON.parse(text);
} catch (error) {
  throw new Error(`Spreadsheet bridge returned non-JSON response: ${text.slice(0, 500)}`);
}

if (!response.ok || !parsed.ok) {
  throw new Error(`Coordinate import failed: ${JSON.stringify(parsed)}`);
}

console.log(JSON.stringify({
  apiUrl,
  csvPath,
  sentRows: selectedRows.length,
  result: parsed
}, null, 2));
