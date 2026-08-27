// Target Buy List engine — cross-check an auction run list against cars we've sold.
//
// A run-list car is a TARGET when the cars we've actually sold like it (matched
// on year / make / model / odometer) averaged more than $800 net profit and moved
// in under 30 days.
//
// This is the ESM mirror of the extension's lib/target-buy-list.js. The scoring
// constants, cohort tiers and cleaning rules are deliberately identical — change
// one, change the other, or the sale-day list and the dashboard will disagree.
//
// Sold book source:
//   sold — the full wholesale book, ~6,200 sales over 19 months, fed by the
//          frazer-ingest edge function. Read via the list_all_sold() RPC because
//          the table itself is RLS-protected against the anon key.

import { supabase } from './supabase'

// ── Buy criteria ─────────────────────────────────────────────────────────────
export const TARGET_PROFIT = 800
export const TARGET_DAYS = 30
const TARGET_MEDIAN_FLOOR = 500 // one lucky car must not carry a cohort
const WATCH_PROFIT = 400
const WATCH_DAYS = 40

// THE definition of "the same car": same make, same model, within a model year,
// and an odometer within this band. Only this cohort can make something a TARGET.
//
// Widened from ±0yr/±15k after testing against the full 6,216-sale book. On the
// 57-day book the tight window appeared to carry signal — it read 2.5-3x higher
// than looser cohorts — but that was small-sample noise. Across the real book,
// the 189 cars that qualify under both windows average $663 on the wider cohort
// versus $598 on the tighter one, with an identical loss rate (27% vs 28%). The
// wider window doubles coverage (272 -> 374 matched, 32 -> 66 HIGH confidence)
// and roughly doubles cohort size (11 -> 26) at no cost in accuracy.
export const EXACT = { years: 1, miles: 20000, min: 2 }

// Looser cohorts exist only for context when there's no exact match. They are
// always capped at WATCH and always labelled, because a loose match is not
// evidence about this car.
//
// An earlier model-name-only tier matched on nameplate alone, with no mileage
// limit at all: a 200k-mile 2011 Acadia inherited the numbers of 80k-mile 2022
// Acadias, and three completely different cars all reported the same n=8,
// $2,260 avg. Every tier now constrains both year and mileage.
const TIERS = [
  { id: 'exact', label: 'exact', years: EXACT.years, miles: EXACT.miles, min: EXACT.min },
  { id: 'close', label: 'close', years: 1, miles: 20000, min: 3, cap: 'WATCH' },
  { id: 'broad', label: 'broad', years: 3, miles: 40000, min: 5, cap: 'WATCH' },
]

const SAME_YEAR_VETO_N = 5 // model-years with this many sales can veto a target
const MIN_VALID_ODO = 100 // below this the run list's mileage is a data error
const OUTLIER_GAP = 500 // median consecutive profit gap is ~$5; $500 is a real break

// ── CSV parsing ──────────────────────────────────────────────────────────────
export function parseCSV(text) {
  const rows = []
  let i = 0, f = '', row = [], q = false
  const pushF = () => { row.push(f); f = '' }
  const pushR = () => { rows.push(row); row = [] }
  while (i < text.length) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false }
      else f += c
    } else {
      if (c === '"') q = true
      else if (c === ',') pushF()
      else if (c === '\n') { pushF(); pushR() }
      // Manheim exports terminate rows with a bare CR. Treat a lone CR as a row
      // break; in CRLF the following LF closes the row instead.
      else if (c === '\r') { if (text[i + 1] !== '\n') { pushF(); pushR() } }
      else f += c
    }
    i++
  }
  if (f.length || row.length) { pushF(); pushR() }
  // ADESA exports lead with a UTF-8 BOM, which would corrupt the first header.
  // Written as the \uFEFF escape, not the literal character: a bare BOM in
  // source is invisible, and any editor or tool that strips it silently turns
  // this into `/^/` — a regex that matches everything and replaces nothing, so
  // the first column header keeps its BOM and every lookup on it misses.
  const header = (rows.shift() || []).map((h) => h.replace(/^\uFEFF/, '').trim())
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, j) => [h, r[j]])))
}

const int = (x) => { const n = parseInt(String(x ?? '').replace(/[^0-9-]/g, ''), 10); return Number.isFinite(n) ? n : null }
const dec = (x) => { const n = parseFloat(String(x ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : null }

// A field is a list of spellings, not one. The same auction platform renames
// its columns between sites — see the Edge Pipeline note below — so reading
// r['Vin'] directly is how a run list from a new yard silently scores zero
// cars. `has` is the same idea for detection.
const pick = (r, ...names) => { for (const n of names) if (n in r) return r[n]; return '' }
const has = (r, ...names) => names.some((n) => n in r)
const str = (x) => String(x ?? '').trim()

function toISODate(v) {
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${yy}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

// ── CarMax: a run list that arrives as a PDF ─────────────────────────────────
// Every other auction hands over a CSV. CarMax publishes the run list as a
// laid-out PDF, so it has to be read back into rows before any of the machinery
// below can touch it.
//
// No PDF library. These files are DynamicPDF output: FlateDecode streams, no
// encryption, no object streams, and text drawn as `1 0 0 1 <x> <y> Tm` followed
// by `(text)Tj`. That's inflate — which the browser does natively via
// DecompressionStream — plus a regex. Adding pdf.js to a Chrome extension with a
// strict CSP, to read four pages of a table, is not a trade worth making.
//
// Reading the coordinates rather than the flattened text is what makes it
// reliable: columns are recovered from the x the header cells sit at, so a
// vehicle whose trim runs long can't shunt the VIN into the mileage column.
// Rows are grouped per page, because y restarts on every page and a global
// grouping silently merges page 1's row with page 3's.

// Makes CarMax writes as two words. Everything else is the token after the year.
const MULTIWORD_MAKES = ['Land Rover', 'Alfa Romeo', 'Aston Martin']

function unescapePdfString(s) {
  return String(s).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (m, g) => {
    if (g === 'n') return '\n'
    if (g === 'r') return '\r'
    if (g === 't') return '\t'
    if (g === 'b' || g === 'f') return ' '
    if (g === '(' || g === ')' || g === '\\') return g
    return String.fromCharCode(parseInt(g, 8))
  })
}

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate')
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer()
  return new TextDecoder('latin1').decode(buf)
}

// Every FlateDecode stream in the file, inflated. Non-flate or damaged streams
// (fonts, metadata) just fail to inflate and are skipped rather than fatal.
async function pdfContentStreams(bytes) {
  const head = new TextDecoder('latin1').decode(bytes)
  const out = []
  // The leading non-letter matters: a bare /stream/ also matches the one inside
  // "endstream", which would feed the closing marker back in as if it were a
  // stream of its own and double the work with garbage.
  const re = /(?:^|[^A-Za-z])stream\r?\n/g
  let m
  while ((m = re.exec(head)) !== null) {
    const start = m.index + m[0].length
    let end = head.indexOf('endstream', start)
    if (end === -1) continue
    // The EOL before "endstream" belongs to the PDF syntax, not the zlib data.
    // Python's zlib shrugs at the extra byte; DecompressionStream rejects the
    // whole stream as trailing junk.
    while (end > start && (head[end - 1] === '\n' || head[end - 1] === '\r')) end--
    try { out.push(await inflate(bytes.subarray(start, end))) } catch { /* not flate */ }
  }
  return out
}

// (x, y, text) for every string drawn on a page, in draw order.
function textCells(content) {
  const re = /1 0 0 1 ([\d.]+) ([\d.]+) Tm|\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|')/g
  const cells = []
  let x = 0, y = 0, m
  while ((m = re.exec(content)) !== null) {
    if (m[1] !== undefined) { x = parseFloat(m[1]); y = parseFloat(m[2]) }
    else cells.push({ x, y, text: unescapePdfString(m[3]).trim() })
  }
  return cells
}

export async function parseCarmaxPdf(arrayBuffer) {
  const pages = await pdfContentStreams(new Uint8Array(arrayBuffer))
  const rows = []

  for (const content of pages) {
    // Group into visual rows. Cells drawn at the same y are the same line.
    const byY = new Map()
    for (const c of textCells(content)) {
      if (!c.text) continue
      const key = Math.round(c.y * 10) / 10
      if (!byY.has(key)) byY.set(key, [])
      byY.get(key).push(c)
    }
    const lines = [...byY.entries()]
      .map(([y, cells]) => ({ y, cells: cells.sort((a, b) => a.x - b.x) }))
      .sort((a, b) => b.y - a.y) // top of the page down

    // The header names the columns and fixes the x each one starts at.
    const headerIdx = lines.findIndex((l) => {
      const t = l.cells.map((c) => c.text)
      return t.includes('VIN') && t.includes('Run')
    })
    if (headerIdx === -1) continue
    const columns = lines[headerIdx].cells.map((c) => ({ x: c.x, name: c.text }))
    const leftX = columns[0].x

    // Nearest column at or to the left of the cell — the layout is left-aligned,
    // so a long value grows right and still belongs to the column it starts in.
    const columnFor = (x) => {
      let best = columns[0]
      for (const col of columns) if (x >= col.x - 2) best = col
      return best.name
    }

    let current = null
    for (const line of lines.slice(headerIdx + 1)) {
      const rec = {}
      for (const c of line.cells) {
        const name = columnFor(c.x)
        rec[name] = rec[name] ? `${rec[name]} ${c.text}` : c.text
      }
      const vin = (rec.VIN || '').replace(/[^0-9A-Za-z]/g, '')
      if (vin.length === 17) {
        current = rec
        rows.push(rec)
      } else if (current && line.cells.length === 1 && line.cells[0].x <= leftX + 2) {
        // The disclosure line under a car: one cell, hard left. "No
        // announcement(s)" is CarMax's way of saying clean, and is worth keeping
        // as-is — it's the difference between "nothing declared" and "not read".
        current.Announcements = line.cells[0].text
      }
    }
  }
  return rows
}

// ── Run-list formats ─────────────────────────────────────────────────────────
export const FORMATS = [
  {
    id: 'edge_pipeline',
    label: 'Edge Pipeline',
    // Edge Pipeline ships two exports and both belong here: the pre-sale run
    // list (Run Number / Lane / Lot) and the vehicle search, which has no run
    // columns whatsoever because a timed sale has no lane to run in. Keying on
    // Run Number alone rejected every search export.
    //
    // Two header dialects, and they are the same report from the same platform.
    // One yard writes `Stock Number` / `Exterior Color` / `Mileage` / `Has
    // Condition Report` / `Vin`; Des Moines and DAAS Memphis write `Stock #` /
    // `Color` / `Odometer` / `CR` / `VIN` and add Lights + Announcements.
    // Reading only the first spelling meant a Des Moines run list failed
    // detection outright and reported nothing at all.
    //
    // `!('MMR' in r)` keeps Manheim out — the other feed with a 'Vin' header —
    // and `!('Lane / Run' in r)` keeps ADESA out, which is important now that
    // the all-caps 'VIN' this accepts is also ADESA's spelling. Both are
    // matched further down.
    detect: (r) => has(r, 'Vin', 'VIN') && !('MMR' in r) && !('Lane / Run' in r)
      && ('Run Number' in r
        || ('Picture Count' in r && has(r, 'Has Condition Report', 'CR'))),
    map: (r) => ({
      vin: str(pick(r, 'Vin', 'VIN')).toUpperCase(),
      stock: str(pick(r, 'Stock Number', 'Stock #')),
      run: str(r['Run Number']),
      lane: str(r['Lane']),
      lot: str(r['Lot']),
      saleDate: str(r['Sale Date']),
      year: int(r['Year']),
      make: str(r['Make']),
      model: str(r['Model']),
      style: str(r['Style']),
      color: str(pick(r, 'Exterior Color', 'Color')),
      odo: int(pick(r, 'Mileage', 'Odometer')),
      grade: str(r['Grade']),
      // 'true'/'false' in one dialect, 'Yes'/'No' in the other.
      hasCR: /^(true|yes)$/i.test(str(pick(r, 'Has Condition Report', 'CR'))),
      pics: int(r['Picture Count']),
      // Only the search export carries these, and they were being dropped into
      // an Announcements column that then exported blank.
      announcements: [r['Announcements'], r['Lights']]
        .map((x) => (x || '').trim()).filter(Boolean).join(' | '),
    }),
  },
  {
    id: 'adesa',
    label: 'ADESA',
    detect: (r) => 'VIN' in r && 'Lane / Run' in r,
    map: (r) => {
      const lr = String(r['Lane / Run'] || '').trim()
      const m = lr.match(/^([A-Za-z]*)\s*[-/]?\s*(\d+)$/)
      return {
        vin: (r['VIN'] || '').trim().toUpperCase(),
        stock: '',
        run: lr,
        lane: m ? m[1] : '',
        lot: m ? m[2] : '',
        // "Starts 08/04/2026 12:00 PM EDT" -> 2026-08-04
        saleDate: toISODate((String(r['Date'] || '').match(/(\d{1,2}\/\d{1,2}\/\d{4})/) || [])[1]) || '',
        year: int(r['Year']),
        make: (r['Make'] || '').trim(),
        model: (r['Model'] || '').trim(),
        style: (r['Trim'] || '').trim(),
        color: (r['Exterior Color'] || '').trim(),
        odo: int(r['Odometer']),
        grade: (r['Grade'] || '').trim(),
        hasCR: !!String(r['Grade'] || '').trim(),
        pics: null,
        drivetrain: (r['Drivetrain'] || '').trim(),
        engine: (r['Engine'] || '').trim(),
        transmission: (r['Transmission'] || '').trim(),
        fuel: (r['Fuel'] || '').trim(),
        seller: (r['Seller'] || '').trim(),
        announcements: [r['Announcements'], r['Notes'], r['Driveability'], r['Condition Guarantee']]
          .map((x) => (x || '').trim()).filter(Boolean).join(' | '),
        titleStatus: (r['Title Status'] || '').trim(),
        auctionValue: dec(r['CarValue']),
        location: (r['Location'] || '').trim(),
        channel: (r['Sale Channel'] || '').trim(),
      }
    },
  },
  {
    id: 'manheim',
    label: 'Manheim',
    detect: (r) => 'Vin' in r && 'MMR' in r && 'Auction House' in r,
    map: (r) => ({
      vin: (r['Vin'] || '').trim().toUpperCase(),
      stock: '',
      run: (r['Run'] || '').trim(),
      lane: (r['Lane'] || '').trim(),
      lot: '',
      saleDate: toISODate((String(r['Starts At'] || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1]) || '',
      year: int(r['Year']),
      make: (r['Make'] || '').trim(),
      model: (r['Model'] || '').trim(),
      style: (r['Trim'] || '').trim(),
      color: (r['Exterior Color'] || '').trim(),
      odo: int(r['Odometer Value']),
      grade: (r['Condition Report Grade'] || '').trim(),
      hasCR: !!String(r['Condition Report Grade'] || '').trim(),
      pics: null,
      drivetrain: (r['Drivetrain'] || '').trim(),
      engine: (r['Engine Type'] || '').trim(),
      transmission: (r['Transmission Type'] || '').trim(),
      fuel: '',
      seller: (r['Seller Name'] || '').trim(),
      // Manheim's "Status" is the listing state (Live/Sold), not a title status.
      announcements: [r['Status'], r['Seller Comments'], r['Notes']]
        .map((x) => (x || '').trim()).filter(Boolean).join(' | '),
      titleStatus: '',
      auctionValue: dec(r['MMR']), // the one feed carrying a market benchmark
      location: (r['Pickup Location'] || '').trim(),
      channel: (r['Inventory'] || '').trim(),
    }),
  },
  {
    id: 'carmax',
    label: 'CarMax',
    // Rows built by parseCarmaxPdf above, keyed by the PDF's own header names.
    // No overlap with Edge Pipeline: that one needs a Run Number or a Picture
    // Count column, and CarMax publishes neither.
    detect: (r) => 'VIN' in r && 'Year Make Model Trim' in r,
    map: (r) => {
      // "A/5" — lane A, run 5.
      const run = (r['Run'] || '').trim()
      const slash = run.split('/')
      // "2019 Audi A6 Premium Plus" → 2019 / Audi / "A6 Premium Plus".
      const ymm = (r['Year Make Model Trim'] || '').trim()
      const year = int((ymm.match(/^(\d{4})\b/) || [])[1])
      let rest = ymm.replace(/^\d{4}\s*/, '')
      const multi = MULTIWORD_MAKES.find((m) => rest.toUpperCase().startsWith(m.toUpperCase()))
      const make = multi || rest.split(/\s+/)[0] || ''
      // Model keeps the trim on the end deliberately. modelMatch() compares
      // nameplates by prefix, so "Grand Cherokee Trailhawk" still comps against
      // the book's "Grand Cherokee" — whereas guessing where the nameplate stops
      // would split "Grand Cherokee" itself on half the rows.
      const model = rest.slice(make.length).trim()
      return {
        vin: (r['VIN'] || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase(),
        stock: '',
        run,
        lane: slash.length > 1 ? slash[0].trim() : '',
        lot: slash.length > 1 ? slash[1].trim() : run,
        // "08/17/2026 9:00 am MT" — the time and zone aren't part of a sale date.
        saleDate: toISODate((String(r['Date'] || '').match(/\d{1,2}\/\d{1,2}\/\d{4}/) || [])[0]) || '',
        year,
        make,
        model,
        style: '',
        color: (r['Color'] || '').trim(),
        odo: int(r['Mileage']),
        // CarMax grades nothing and posts no condition report with the list.
        grade: '',
        hasCR: false,
        pics: null,
        drivetrain: (String(r['Drive  Transmission  Engine'] || '').split(/\s{2,}|/)[0] || '').trim(),
        engine: '',
        transmission: '',
        fuel: '',
        seller: 'CarMax',
        // The disclosure line, and the whole reason to read the second row:
        // "Major Engine Defect" or "Structural Damage" is the difference
        // between a bid and a pass.
        announcements: (r['Announcements'] || '').trim(),
        titleStatus: '',
        auctionValue: null,
        location: (r['Location'] || '').trim(),
        channel: '',
      }
    },
  },
]

export const detectFormat = (rows) => (rows.length ? FORMATS.find((f) => f.detect(rows[0])) || null : null)

// Both sites accept a VIN where they normally want their own internal listing
// id and redirect to the right car themselves — verified against live pages.
// That is what makes opening cars possible from here at all: no page to scrape
// and no extension needed, just a URL built from the run list.
//
// Keyed by the format the run list was recognised as, because that is what says
// which site the cars live on — but the format alone does not finish the job for
// Manheim, which runs two marketplaces and exports both from one report.
//
// Its `Inventory` column is the tell — but it is an OPEN vocabulary, and that is
// what keeps breaking this. It has read `OVE`, it has read `Simulcast`, and an
// export on 2026-08-26 read `Timed Sale` on all 303 rows. Every previous version
// of this matched one literal and sent everything else to the other site, so
// each new word Manheim invents silently misroutes a whole list: first every
// Simulcast car went to an OVE detail page for a car that was never in that
// marketplace, and then every Timed Sale car went to the lane search.
//
// So it is matched by MEANING, not by literal, and an unrecognised word is no
// longer a silent default — it warns, and falls back on structure.
//
// The lane route is Manheim's own: their legacy
// /members/powersearch/searchResults.do?vin= 301s to
// search.manheim.com/results?vin=<VIN>, and that route carries the VIN through
// the login redirect in its `state`, so it lands on the car from a cold browser.
//
// Edge Pipeline is deliberately absent: its detail route is an opaque 32-hex
// hash with no VIN form, so those cars can only be reached by reading the
// links off the results page, which the browser extension does and this can't.
//
// Takes the car, not the VIN — which site it opens on is a property of the
// listing. Keep in lockstep with DIRECT_URL in
// scrapers/smartauction-extension/lib/target-buy-list.js
const ONLINE_CHANNEL = /OVE|TIMED|BUY.?NOW|ONLINE|MARKETPLACE|EXCHANGE/i
const LANE_CHANNEL = /SIMULCAST|LANE|LIVE.?BLOCK/i

// True when the car sells online, so it opens on OVE rather than in the lane
// search. The channel word decides it; the lane/run columns are only the
// tiebreak for a word nobody has taught this yet.
//
// Note the two are NOT mutually exclusive in the export: that same 2026-08-26
// file had one car marked `Timed Sale` carrying Lane 8 / Run 52 — a car with a
// lane assignment being offered online ahead of the block. It sells online today,
// so it opens online today. Which is exactly why the channel outranks structure.
export function isOnlineListing(c) {
  const ch = String(c.channel || '').trim()
  if (ONLINE_CHANNEL.test(ch)) return true
  if (LANE_CHANNEL.test(ch)) return false
  if (ch) {
    console.warn(
      `[target buy list] Manheim channel "${ch}" is not one this knows. ` +
      'Falling back to the lane/run columns — add it to ONLINE_CHANNEL or ' +
      'LANE_CHANNEL in targetBuyList.js (and in the extension copy).')
  }
  // No word to go on: a car with a lane and a run number is a lane car; anything
  // else is online, because online is where a car with no lane sells.
  return !(String(c.lane || '').trim() || String(c.run || '').trim())
}

export const DIRECT_URL = {
  manheim: (c) => (isOnlineListing(c)
    ? `https://www.ove.com/search/results#/details/${c.vin}/OVE`
    : `https://search.manheim.com/results?vin=${c.vin}`),
  adesa: (c) => `https://marketplace.adesa.com/details/${c.vin}`,
}

// ── Normalisation ────────────────────────────────────────────────────────────
const normMake = (m) => String(m || '').toUpperCase().replace(/[^A-Z]/g, '')

function normModel(model, make) {
  let s = String(model || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const mk = normMake(make)
  if (mk && s.startsWith(mk) && s.length > mk.length) s = s.slice(mk.length)
  for (const p of ['CHEVROLET', 'FORD', 'RAM', 'GMC', 'JEEP', 'NISSAN', 'TOYOTA']) {
    if (s.startsWith(p) && s.length > p.length) { s = s.slice(p.length); break }
  }
  return s
}

// Tonnage is part of a vehicle's identity; trim and body style are not. A bare
// prefix match let a Sierra 3500HD draw the same 20 half-tons as a Sierra 1500 —
// a one-ton dually priced off half-tons is a different truck, different buyer,
// different market. Trim variants (Unlimited, Sport) DO comp against each other:
// all Wranglers are Wranglers.
const SERIES_RE = /(1500|2500|3500)/
const TRIM_RE = /UNLIMITED|UNLIMI|SPORT/

function modelParts(norm) {
  // The sold export truncates at 15 chars, so "WRANGLER UNLIMI" has to reduce to
  // the same nameplate as "WRANGLER".
  let base = norm.replace(TRIM_RE, '')

  let series = ''
  const stem = (base.match(/^[A-Z]+/) || [''])[0]
  // Only read digits as a series when the alphabetic stem is itself the
  // nameplate (SILVERADO 1500). For F150 / F250 the digits ARE the nameplate.
  if (stem.length >= 4) {
    const m = base.match(SERIES_RE)
    if (m) { series = m[1]; base = base.replace(SERIES_RE, '') }
  }
  return { base: base.replace(/HD$/, ''), series }
}

function modelMatch(a, b) {
  if (!a || !b) return false
  const A = modelParts(a), B = modelParts(b)
  // A heavy-duty truck must never borrow half-ton history. Where a side is
  // silent on series — the sold export usually is — treat it as a half-ton,
  // which is the dominant case: 1500 still matches, 2500 and 3500 cannot.
  if ((A.series || '1500') !== (B.series || '1500')) return false
  if (A.base === B.base) return true
  const [s, l] = A.base.length < B.base.length ? [A.base, B.base] : [B.base, A.base]
  return s.length >= 4 && l.startsWith(s)
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
function median(a) {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ── Sold book ────────────────────────────────────────────────────────────────
// The sold book: every wholesale sale we've made, with its economics.
//
// Read through the list_all_sold() RPC rather than the table directly — `sold`
// is RLS-protected, so an anon SELECT silently returns zero rows. The RPC is
// SECURITY DEFINER and granted to anon for exactly this reason. Reading the
// table straight was why this engine was previously scoring against a 57-day
// spreadsheet import instead of the full 19-month book.
//
// Frazer stores these columns as text, so dates and money need coercing.
const rpcNum = (x) => {
  if (x === null || x === undefined || x === '') return null
  const n = parseFloat(String(x).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

// Frazer writes sale_date as MM/DD/YY.
function frazerDate(v) {
  if (!v) return null
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return toISODate(v)
  const yy = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${yy}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

// One page of an RPC, paginated the only way this RPC honours.
//
// supabase-js has no offset(), and .range() sends a Range header that
// list_all_sold ignores — see the note in fetchSoldBook. So the request is made
// by hand against the same project, reusing the session token when there is one
// so RLS sees the signed-in user exactly as the client would.
async function rpcPage(fn, limit, offset) {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${url}/rest/v1/rpc/${fn}?limit=${limit}&offset=${offset}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${session?.access_token || key}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    if (!res.ok) return { data: null, error: new Error(`${res.status} ${await res.text()}`) }
    return { data: await res.json(), error: null }
  } catch (e) {
    return { data: null, error: e }
  }
}

export async function fetchSoldBook() {
  const rows = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    // limit/offset as PostgREST query params, NOT .range().
    //
    // .range() sets a Range header, and this RPC ignores it: every page came
    // back as the same first 1000 rows. Nothing detected that, because a full
    // page never trips the `data.length < PAGE` break — so the loop ran to its
    // safety stop and returned 102,000 rows that were 102 copies of the first
    // thousand. Scoring then ran on a book with every cohort inflated 102x and
    // the other 5,400 real sales missing entirely. Verified against the live
    // RPC: offset=0 and offset=1000 return different rows this way, identical
    // ones via Range. The extension's copy always used query params, which is
    // why only this side was wrong.
    const { data, error } = await rpcPage('list_all_sold', PAGE, offset)
    if (error) throw new Error(`list_all_sold failed: ${error.message}`)
    if (!data || !data.length) break
    rows.push(...data)
    if (data.length < PAGE) break
    if (offset > 100000) break // safety stop
  }

  const mapped = rows.map((r) => ({
    vin: String(r.vehicle_vin || '').trim().toUpperCase(),
    year: rpcNum(r.vehicle_year),
    make: r.vehicle_make,
    model: r.vehicle_model,
    odometer: rpcNum(r.mileage),
    sale_date: frazerDate(r.sale_date),
    sale_price: rpcNum(r.sales_price),
    total_cost: rpcNum(r.total_cost),
    added_costs: rpcNum(r.added_costs),
    net_profit: rpcNum(r.profit_on_sale),
    days_on_lot: rpcNum(r.days_on_lot),
    vendor: r.vendor,
    buyer: r.buyer,
  }))

  const dates = mapped.map((r) => r.sale_date).filter(Boolean).sort()
  return {
    rows: mapped,
    total: mapped.length,
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
  }
}

// ── Clean the book ───────────────────────────────────────────────────────────
// Buy-backs are deliberately KEPT. When we buy a car back and eat $2-3k
// disposing of it, that loss is part of what that year/make/model/odometer
// actually costs us — excluding it makes a cohort look better than it is. So
// no VIN de-duplication and no arbitration-vendor filter: the same car sold
// twice contributes both outcomes.
//
// Only two kinds of row are dropped:
//   1. Pass-through title transfers ($0 profit, $0 recon) — not wholesale deals.
//   2. Extreme outliers at either tail — the car that lost $8k because it was a
//      disaster, or made $7k because we got lucky. Neither repeats. A routine
//      $2-3k buy-back loss sits well inside the distribution and is retained.
export function cleanBook(rows) {
  const usable = rows.filter((r) => r.net_profit !== null && r.net_profit !== undefined)

  const removedPassthrough = usable.filter(
    (r) => Number(r.net_profit) === 0 && Number(r.added_costs || 0) === 0)
  const ptSet = new Set(removedPassthrough)
  let book = usable.filter((r) => !ptSet.has(r))

  book.sort((a, b) => Number(a.net_profit) - Number(b.net_profit))
  const p = book.map((r) => Number(r.net_profit))

  // Never let the walk eat the book: on a small or very spread-out set every gap
  // can exceed the threshold, which would trim everything to nothing.
  const maxTrim = Math.floor(p.length * 0.05)
  let lo = 0
  while (lo < maxTrim && p[lo + 1] - p[lo] > OUTLIER_GAP) lo++
  let hi = p.length - 1
  while (hi > p.length - 1 - maxTrim && p[hi] - p[hi - 1] > OUTLIER_GAP) hi--
  if (lo > hi) { lo = 0; hi = p.length - 1 }

  // Reported for visibility only — these rows stay in the book.
  const vinCounts = new Map()
  for (const r of book) if (r.vin) vinCounts.set(r.vin, (vinCounts.get(r.vin) || 0) + 1)
  const buyBacks = book.filter((r) => r.vin && vinCounts.get(r.vin) > 1)

  const removedOutliers = [...book.slice(0, lo), ...book.slice(hi + 1)]
  book = book.slice(lo, hi + 1)

  return { book, removedOutliers, removedPassthrough, buyBacks }
}

export function indexBook(book) {
  const byMake = new Map()
  for (const r of book) {
    const nmk = normMake(r.make)
    if (!nmk) continue
    if (!byMake.has(nmk)) byMake.set(nmk, [])
    byMake.get(nmk).push({
      year: r.year,
      odo: r.odometer,
      profit: Number(r.net_profit),
      days: r.days_on_lot == null ? null : Number(r.days_on_lot),
      price: r.sale_price == null ? null : Number(r.sale_price),
      nmodel: normModel(r.model, r.make),
      vin: r.vin,
      saleDate: r.sale_date,
    })
  }
  return byMake
}

// ── Scoring ──────────────────────────────────────────────────────────────────
function cohortStats(cohort) {
  if (!cohort.length) return { n: 0, meanProfit: null, medProfit: null, meanDays: null, hitRate: null, lossRate: null, medResale: null }
  const profits = cohort.map((s) => s.profit)
  const days = cohort.map((s) => s.days).filter((d) => d != null)
  const prices = cohort.map((s) => s.price).filter((v) => v != null)
  return {
    n: cohort.length,
    meanProfit: mean(profits),
    medProfit: median(profits),
    meanDays: days.length ? mean(days) : null,
    hitRate: (profits.filter((v) => v > 1000).length / profits.length) * 100,
    lossRate: (profits.filter((v) => v <= 0).length / profits.length) * 100,
    medResale: median(prices),
  }
}

// Cars of the same model within a tier's year and mileage band.
const inTier = (pool, car, tier) => pool.filter((s) =>
  s.year != null && Math.abs(s.year - car.year) <= tier.years &&
  s.odo != null && Math.abs(s.odo - car.odo) <= tier.miles)

const fmtMoney = (v) => (v == null ? '—' : `$${Math.round(v).toLocaleString()}`)

export function evaluateCar(car, byMake) {
  const nmk = normMake(car.make)
  const nmd = normModel(car.model, car.make)
  const pool = (byMake.get(nmk) || []).filter((s) => modelMatch(s.nmodel, nmd))

  const badOdo = car.odo == null || car.odo < MIN_VALID_ODO
  const base = {
    ...car, badOdo, tier: null, n: 0, meanProfit: null, medProfit: null,
    meanDays: null, hitRate: null, confidence: 'NONE', medResale: null,
    exactN: 0, exactProfit: null, exactMedProfit: null, exactDays: null,
    exactHit: null, exactLoss: null, sameYearN: 0, sameYearProfit: null,
    compPool: '', compShared: 1,
  }

  if (!pool.length) return { ...base, verdict: 'NO DATA', why: 'No record of us selling this model' }
  if (car.year == null) {
    return { ...base, n: pool.length, verdict: 'NO DATA', why: 'Run list has no year — cannot match on age' }
  }
  if (badOdo) {
    return {
      ...base, n: pool.length, verdict: 'NO DATA',
      why: `Run-list mileage looks wrong (${car.odo == null ? 'blank' : car.odo}) — can't match on miles`,
    }
  }

  // The exact car: same year, same model, odometer in range. This is the only
  // cohort allowed to produce a verdict.
  const exactCohort = inTier(pool, car, EXACT)
  const exact = cohortStats(exactCohort)
  // Two run-list cars close enough to draw the same sold cars are one bet, not
  // two. Stamp the cohort so shared evidence is visible instead of implied.
  const compPool = exactCohort.length
    ? exactCohort.map((s) => `${s.vin}|${s.saleDate}`).sort().join(',')
    : ''

  // Same year, any mileage. Used ONLY to veto — never to promote. It catches
  // model-years that are broadly bad (2022 F150: 7 sold, -$1,776 avg) which a
  // narrow mileage band can miss.
  const sameYearCohort = pool.filter((s) => s.year === car.year)
  const sameYear = cohortStats(sameYearCohort)

  // Looser cohorts are computed for context and shown in their own columns.
  // They never set the verdict and never drive the ranking.
  let context = null
  for (const tier of TIERS) {
    if (tier.id === 'exact') continue
    const cohort = inTier(pool, car, tier)
    if (cohort.length < tier.min) continue
    context = { tier, st: cohortStats(cohort) }
    break
  }

  const withStats = {
    ...base,
    compPool,
    exactN: exact.n, exactProfit: exact.meanProfit, exactMedProfit: exact.medProfit,
    exactDays: exact.meanDays, exactHit: exact.hitRate, exactLoss: exact.lossRate,
    sameYearN: sameYear.n, sameYearProfit: sameYear.meanProfit,
    tier: context ? context.tier.label : null,
    n: context ? context.st.n : 0,
    meanProfit: context ? context.st.meanProfit : null,
    medProfit: context ? context.st.medProfit : null,
    meanDays: context ? context.st.meanDays : null,
    hitRate: context ? context.st.hitRate : null,
    medResale: context ? context.st.medResale : exact.medResale,
  }

  const contextNote = context
    ? ` Context only: ${context.st.n} within ±${context.tier.years}yr/±${context.tier.miles / 1000}k, avg ${fmtMoney(context.st.meanProfit)}.`
    : ''

  if (exact.n < EXACT.min) {
    return {
      ...withStats, verdict: 'NO DATA', confidence: 'NONE',
      why: `Only ${exact.n} exact match${exact.n === 1 ? '' : 'es'} (same year, ±${EXACT.miles / 1000}k mi) — not enough to judge.${contextNote}`,
    }
  }

  let verdict = 'PASS'
  if (exact.meanDays != null && exact.meanProfit > TARGET_PROFIT &&
      exact.meanDays < TARGET_DAYS && exact.medProfit > TARGET_MEDIAN_FLOOR) {
    verdict = 'TARGET'
  } else if (exact.meanDays != null && exact.meanProfit > WATCH_PROFIT && exact.meanDays < WATCH_DAYS) {
    verdict = 'WATCH'
  }

  // Veto: this model-year loses money across the board, whatever the mileage.
  let veto = ''
  if (verdict !== 'PASS' && sameYear.n >= SAME_YEAR_VETO_N && sameYear.meanProfit < 0) {
    veto = ` VETO: all ${sameYear.n} ${car.year} ${car.model}s we sold average ${fmtMoney(sameYear.meanProfit)}.`
    verdict = 'PASS'
  }

  return {
    ...withStats, verdict,
    confidence: exact.n >= 5 ? 'HIGH' : exact.n >= 3 ? 'MEDIUM' : 'LOW',
    why: `${exact.n} sold same year, ±${EXACT.miles / 1000}k mi · avg ${fmtMoney(exact.meanProfit)}, ` +
         `median ${fmtMoney(exact.medProfit)} · ${exact.meanDays == null ? '—' : Math.round(exact.meanDays)}d on lot · ` +
         `${Math.round(exact.hitRate)}% cleared $1k, ${Math.round(exact.lossRate)}% lost money.${veto}${contextNote}`,
  }
}

// Run-order comparator. Lanes sort numerically where they're numbers ("4"
// before "15", not "15" before "4"), with the letter suffix breaking ties
// ("5" before "5E" before "5R"), then lot number.
function runOrder(c) {
  const lane = String(c.lane ?? '').trim()
  const lm = lane.match(/^(\d*)([A-Za-z]*)$/) || []
  const lotRaw = String(c.lot ?? '').trim() || (String(c.run ?? '').match(/(\d+)\s*$/) || [])[1] || ''
  return {
    laneNum: lm[1] ? parseInt(lm[1], 10) : Number.MAX_SAFE_INTEGER,
    laneAlpha: (lm[2] || '').toUpperCase(),
    lot: lotRaw ? parseInt(lotRaw, 10) : Number.MAX_SAFE_INTEGER,
  }
}

function byRunNumber(a, b) {
  const x = runOrder(a), y = runOrder(b)
  return x.laneNum - y.laneNum ||
    x.laneAlpha.localeCompare(y.laneAlpha) ||
    x.lot - y.lot ||
    String(a.run || '').localeCompare(String(b.run || ''))
}

// Does this list have run order at all? Manheim/OVE timed sales carry no run
// number, lane or lot — every car sorts to MAX_SAFE_INTEGER and the comparator
// says nothing. There, and only there, fall back to putting the cars worth
// bidding on at the top, since nothing else orders them.
export function hasRunOrder(cars) {
  return cars.some((c) => {
    const o = runOrder(c)
    return o.laneNum !== Number.MAX_SAFE_INTEGER || o.lot !== Number.MAX_SAFE_INTEGER
  })
}

const BAND_ORDER = { TARGET: 0, WATCH: 1, 'NO DATA': 2, PASS: 3 }

// One list in the order the cars cross the block — targets and watches
// interleaved, not stacked in two blocks.
//
// They used to be sorted by verdict band first, so "Targets + Watch" gave you
// every target in run order and then every watch in run order: run 42 above
// run 7, and you worked the lane by jumping between two halves of the table.
// The band is on the row already, as the badge and its colour, and the filter
// pills split them when splitting is what you want. Sorting by it as well only
// broke the one order the sale itself runs in.
export function sortScored(scored) {
  const runOrdered = hasRunOrder(scored)
  scored.sort(runOrdered
    ? byRunNumber
    : (a, b) => BAND_ORDER[a.verdict] - BAND_ORDER[b.verdict] || (b.exactProfit ?? -Infinity) - (a.exactProfit ?? -Infinity))
  scored.forEach((c, i) => { c.rank = i + 1 })
  return scored
}

// ── Whole-list run ───────────────────────────────────────────────────────────
export function scoreRunList(rawRows, fmt, byMake) {
  // ADESA exports repeat rows (~20 in a 134-row list), so collapse on VIN.
  const mapped = rawRows.map(fmt.map).filter((c) => c.vin || (c.year && c.make))
  const seen = new Set()
  const cars = mapped.filter((c) => {
    if (!c.vin) return true
    if (seen.has(c.vin)) return false
    seen.add(c.vin)
    return true
  })

  const scored = sortScored(cars.map((c) => evaluateCar(c, byMake)))

  // Flag rows whose verdict rests on the exact same sold cars.
  const poolCounts = new Map()
  for (const c of scored) if (c.compPool) poolCounts.set(c.compPool, (poolCounts.get(c.compPool) || 0) + 1)
  for (const c of scored) c.compShared = c.compPool ? poolCounts.get(c.compPool) : 1

  return { scored, duplicatesDropped: mapped.length - cars.length }
}
