#!/usr/bin/env node
/**
 * Frazer → Supabase auto-uploader
 *
 * Watches ~/Downloads for new Frazer xlsx/csv exports. The moment one lands,
 * converts it to CSV (if xlsx) and POSTs it to the frazer-ingest edge function
 * which truncates + reloads the target table (inventory or sold) in Supabase.
 *
 * Modes:
 *   --watch     Keep running, auto-upload new files as they appear (default)
 *   --once      Upload the latest matching file once, then exit
 *   --file <f>  Upload a specific file
 *
 * Target detection:
 *   If the CSV has a "Sale Date" column → target=sold
 *   Otherwise → target=inventory
 *
 * Environment:
 *   FRAZER_INGEST_SECRET   Required. The shared secret for the edge function.
 *   SUPABASE_URL           Optional. Defaults to the Carz Inc project URL.
 *   WATCH_DIR              Optional. Defaults to ~/Downloads.
 *   FILE_PATTERN           Optional. Glob for matching Frazer files. Default: *.xlsx,*.csv
 *
 * Usage:
 *   FRAZER_INGEST_SECRET=xxx node scripts/frazer-refresh.mjs --watch
 *   FRAZER_INGEST_SECRET=xxx node scripts/frazer-refresh.mjs --once
 *   FRAZER_INGEST_SECRET=xxx node scripts/frazer-refresh.mjs --file ~/Downloads/sold.xlsx
 */

import { readFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { homedir } from 'os'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yprihgygmreibcuybwoy.supabase.co'
const SECRET = process.env.FRAZER_INGEST_SECRET
const WATCH_DIR = process.env.WATCH_DIR || join(homedir(), 'Downloads')
const INGEST_URL = `${SUPABASE_URL}/functions/v1/frazer-ingest`

if (!SECRET) {
  console.error('ERROR: FRAZER_INGEST_SECRET env var is required.')
  console.error('Set it:  export FRAZER_INGEST_SECRET=your-secret-here')
  console.error('Find it: Supabase Dashboard → Project Settings → Edge Functions → Secrets')
  process.exit(1)
}

// ── Parse xlsx to CSV ──
async function xlsxToCSV(filePath) {
  const XLSX = (await import('xlsx')).default
  const wb = XLSX.readFile(filePath)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_csv(sheet)
}

// ── Read a file (xlsx or csv) → CSV string ──
async function readAsCSV(filePath) {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.xlsx' || ext === '.xls') {
    return xlsxToCSV(filePath)
  }
  return readFileSync(filePath, 'utf-8')
}

// ── Detect target from CSV header row ──
function detectTarget(csv) {
  const firstLine = csv.split('\n')[0].toLowerCase()
  if (firstLine.includes('sale date') || firstLine.includes('profit_on_sale') || firstLine.includes('profit on sale')) {
    return 'sold'
  }
  return 'inventory'
}

// ── Upload CSV to frazer-ingest ──
async function upload(csv, target, fileName) {
  console.log(`Uploading ${fileName} → ${target} (${csv.length.toLocaleString()} bytes)...`)
  const resp = await fetch(`${INGEST_URL}?target=${target}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/csv',
      'x-frazer-secret': SECRET,
    },
    body: csv,
  })
  const body = await resp.json().catch((e) => ({ error: `Response parse failed: ${e.message}` }))
  if (!resp.ok) {
    console.error(`FAILED (${resp.status}):`, body.error || body.message || resp.statusText)
    return false
  }
  console.log(`SUCCESS: ${body.rows} rows uploaded to ${target}`)
  return true
}

// ── Process a single file ──
async function processFile(filePath) {
  const fileName = basename(filePath)
  console.log(`\nProcessing: ${fileName}`)
  try {
    const csv = await readAsCSV(filePath)
    const target = detectTarget(csv)
    console.log(`Detected target: ${target}`)
    return await upload(csv, target, fileName)
  } catch (err) {
    console.error(`Error processing ${fileName}:`, err.message)
    return false
  }
}

// ── Watch mode ──
async function watchMode() {
  const chokidar = (await import('chokidar')).default
  console.log(`\nWatching ${WATCH_DIR} for new Frazer files...`)
  console.log('Supported: *.xlsx, *.xls, *.csv')
  console.log('Press Ctrl+C to stop.\n')

  const processed = new Set()
  const watcher = chokidar.watch(WATCH_DIR, {
    ignored: /(^|[/\\])\../, // ignore dotfiles
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 },
  })

  watcher.on('add', async (filePath) => {
    const ext = extname(filePath).toLowerCase()
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) return
    if (processed.has(filePath)) return
    processed.add(filePath)
    await processFile(filePath)
  })
}

// ── One-shot mode: find latest matching file ──
async function onceMode() {
  const { readdirSync, statSync } = await import('fs')
  const files = readdirSync(WATCH_DIR)
    .filter((f) => ['.xlsx', '.xls', '.csv'].includes(extname(f).toLowerCase()))
    .map((f) => ({ name: f, path: join(WATCH_DIR, f), mtime: statSync(join(WATCH_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)

  if (files.length === 0) {
    console.error(`No .xlsx/.csv files found in ${WATCH_DIR}`)
    process.exit(1)
  }

  console.log(`Latest file: ${files[0].name} (modified ${new Date(files[0].mtime).toLocaleString()})`)
  const ok = await processFile(files[0].path)
  process.exit(ok ? 0 : 1)
}

// ── Main ──
const args = process.argv.slice(2)
if (args.includes('--file')) {
  const idx = args.indexOf('--file')
  const filePath = args[idx + 1]
  if (!filePath) { console.error('--file requires a path'); process.exit(1) }
  const { existsSync } = await import('fs')
  if (!existsSync(filePath)) { console.error(`File not found: ${filePath}`); process.exit(1) }
  processFile(filePath).then((ok) => process.exit(ok ? 0 : 1))
} else if (args.includes('--once')) {
  onceMode()
} else {
  watchMode()
}
