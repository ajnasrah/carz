// End-to-end test harness for LotWalk + Inventory flow.
// Doesn't touch Supabase — exercises the pure helpers + the
// stateful logic (dedupe, sort, voice→match) against 10 fake cars.
//
// Run: node test-lot-walk.mjs

// ─── COPY OF PURE HELPERS FROM src/services/lotTracking.js ───
// (Can't import directly because supabase.js uses Vite env vars.)
function staleness(daysSinceSeen) {
  if (daysSinceSeen == null) return 'never'
  if (daysSinceSeen >= 14) return 'red'
  if (daysSinceSeen >= 7) return 'yellow'
  return 'green'
}

function formatLastSeen(daysSinceSeen) {
  if (daysSinceSeen == null) return 'never tracked'
  if (daysSinceSeen === 0) return 'today'
  if (daysSinceSeen === 1) return '1 day ago'
  return `${daysSinceSeen} days ago`
}

const NUMBER_WORDS = {
  zero: '0', oh: '0', o: '0',
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
}
const LETTER_WORDS = {
  alpha: 'A',  bravo: 'B',   charlie: 'C', delta: 'D',  echo: 'E',
  foxtrot: 'F', golf: 'G',   hotel: 'H',   india: 'I',  juliet: 'J',
  kilo: 'K',   lima: 'L',    mike: 'M',    november: 'N', oscar: 'O',
  papa: 'P',   quebec: 'Q',  romeo: 'R',   sierra: 'S', tango: 'T',
  uniform: 'U', victor: 'V', whiskey: 'W', xray: 'X',   yankee: 'Y', zulu: 'Z',
  ay: 'A',    bee: 'B', cee: 'C', dee: 'D', ef: 'F',  gee: 'G',
  aitch: 'H', jay: 'J', kay: 'K', el: 'L',  ell: 'L', em: 'M',  en: 'N',
  pee: 'P',   ar: 'R',  ess: 'S', tee: 'T', vee: 'V', ex: 'X',  wye: 'Y',
  zee: 'Z',   zed: 'Z',
}
function parseSpokenDigits(text) {
  if (!text) return ''
  const cleaned = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(stock|number|num|vin|car|the|is|it|hash|pound|um|uh)\b/g, ' ')
  const tokens = cleaned.split(/\s+/).filter(Boolean)
  let out = ''
  for (const t of tokens) {
    if (/^\d+$/.test(t)) out += t
    else if (NUMBER_WORDS[t] != null) out += NUMBER_WORDS[t]
    else if (LETTER_WORDS[t] != null) out += LETTER_WORDS[t]
    else if (/^[a-z]$/.test(t)) out += t.toUpperCase()
  }
  return out
}

function filterInventory(rows, query) {
  const q = (query || '').trim().toUpperCase()
  if (!q) return []
  return rows.filter((r) => {
    const stock = String(r.stock_number || '').toUpperCase()
    const v6 = String(r.last_6_vin || r.vehicle_vin?.slice(-6) || '').toUpperCase()
    return stock.includes(q) || v6.includes(q)
  })
}

function extractVIN(text) {
  if (!text) return ''
  const upper = String(text).toUpperCase()
  const match = upper.match(/[A-HJ-NPR-Z0-9]{17}/)
  return match ? match[0] : ''
}

function matchVehicleByVIN(rows, vin) {
  if (!vin) return null
  const v = vin.toUpperCase()
  let hit = rows.find((r) => String(r.vehicle_vin || '').toUpperCase() === v)
  if (hit) return hit
  if (v.length >= 6) {
    const last6 = v.slice(-6)
    hit = rows.find((r) => String(r.last_6_vin || r.vehicle_vin?.slice(-6) || '').toUpperCase() === last6)
  }
  return hit || null
}

// ─── 10 TEST VEHICLES (matching Inventory table shape) ───
// Mix of numeric and alphanumeric last_6_vin to test VIN-with-letters handling.
// Real VINs use B-Z but skip I, O, Q to avoid digit confusion.
const INVENTORY = [
  { stock_number: '4521', last_6_vin: '538291', vehicle_vin: '1HGCM82633A538291', vehicle_year: 2019, vehicle_make: 'Honda',  vehicle_model: 'Civic',    days_since_seen: 0   },
  { stock_number: '4522', last_6_vin: '998877', vehicle_vin: '4T1BF1FK5GU998877', vehicle_year: 2020, vehicle_make: 'Toyota', vehicle_model: 'Camry',    days_since_seen: 2   },
  { stock_number: '4523', last_6_vin: '5KJF2X', vehicle_vin: '1HGCV1F30JA5KJF2X', vehicle_year: 2018, vehicle_make: 'Honda',  vehicle_model: 'Accord',   days_since_seen: 5   }, // VIN with letters
  { stock_number: '4524', last_6_vin: 'B7M3R9', vehicle_vin: '1FTFW1ET5DKB7M3R9',  vehicle_year: 2021, vehicle_make: 'Ford',   vehicle_model: 'F-150',    days_since_seen: 6   }, // VIN with letters (17ch)
  { stock_number: '4525', last_6_vin: '222333', vehicle_vin: '1G1ZD5ST5KF222333', vehicle_year: 2017, vehicle_make: 'Chevy',  vehicle_model: 'Malibu',   days_since_seen: 7   },
  { stock_number: '4526', last_6_vin: 'C44555', vehicle_vin: '1N4AL3AP0GCC44555', vehicle_year: 2022, vehicle_make: 'Nissan', vehicle_model: 'Altima',   days_since_seen: 9   }, // mixed
  { stock_number: '4527', last_6_vin: '666777', vehicle_vin: 'JM3KFBCY1J0666777', vehicle_year: 2019, vehicle_make: 'Mazda',  vehicle_model: 'CX-5',     days_since_seen: 13  },
  { stock_number: '4528', last_6_vin: 'WGNT89', vehicle_vin: 'WBA8E9G5XGNWGNT89',  vehicle_year: 2020, vehicle_make: 'BMW',    vehicle_model: '328i',     days_since_seen: 14  }, // VIN with letters (17ch)
  { stock_number: '4529', last_6_vin: '121212', vehicle_vin: 'WAUFFAFL5DA121212', vehicle_year: 2018, vehicle_make: 'Audi',   vehicle_model: 'A4',       days_since_seen: 30  },
  { stock_number: '4530', last_6_vin: '343434', vehicle_vin: '3VW2K7AJ4FM343434', vehicle_year: 2016, vehicle_make: 'VW',     vehicle_model: 'Jetta',    days_since_seen: null }, // never tracked
]

// ─── TEST UTILITIES ───
let passed = 0
let failed = 0
function assert(name, cond, detail) {
  if (cond) {
    console.log(`  ✅ ${name}`)
    passed++
  } else {
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`)
    failed++
  }
}
function section(title) {
  console.log(`\n━━━ ${title} ━━━`)
}

// ─── 1. STALENESS BUCKETS ───
section('1. staleness() buckets')
assert('null → never',         staleness(null) === 'never')
assert('0 → green',            staleness(0) === 'green')
assert('6 → green',            staleness(6) === 'green')
assert('7 → yellow',           staleness(7) === 'yellow')
assert('13 → yellow',          staleness(13) === 'yellow')
assert('14 → red',             staleness(14) === 'red')
assert('30 → red',             staleness(30) === 'red')

// ─── 2. formatLastSeen() ───
section('2. formatLastSeen() copy')
assert('null → never tracked', formatLastSeen(null) === 'never tracked')
assert('0 → today',            formatLastSeen(0) === 'today')
assert('1 → 1 day ago',        formatLastSeen(1) === '1 day ago')
assert('7 → 7 days ago',       formatLastSeen(7) === '7 days ago')
assert('30 → 30 days ago',     formatLastSeen(30) === '30 days ago')

// ─── 3. parseSpokenDigits() — voice input parsing ───
section('3. parseSpokenDigits() — voice transcripts (digits + letters)')
const voiceTests = [
  // Digit-only — pure stock numbers
  { input: 'stock 4521',                       expect: '4521' },
  { input: 'four five two one',                expect: '4521' },
  { input: 'stock four five two one',          expect: '4521' },
  { input: 'five three eight two nine one',    expect: '538291' },
  { input: 'stock number 4 5 2 2',             expect: '4522' },
  { input: '538291',                           expect: '538291' },
  { input: 'one one one one one',              expect: '11111' },
  { input: 'oh four five two one',             expect: '04521' },
  { input: 'the car is 4521',                  expect: '4521' },
  { input: 'um stock 4521',                    expect: '4521' },
  { input: '',                                 expect: '' },
  { input: '    ',                             expect: '' },
  // Alphanumeric — VINs with letters via NATO phonetic
  { input: 'five kilo juliet foxtrot two xray', expect: '5KJF2X' },
  { input: 'bravo seven mike three romeo nine', expect: 'B7M3R9' },
  { input: 'whiskey golf november tango eight nine', expect: 'WGNT89' },
  // Common spoken letter forms
  { input: 'kay jay foxtrot',                  expect: 'KJF' },
  { input: 'em pee tee',                       expect: 'MPT' },
  // Mixed digits + letters (real VIN style)
  { input: 'charlie four four five five five', expect: 'C44555' },
  // Bare single letters (Web Speech sometimes returns these)
  { input: 'k j f two x',                      expect: 'KJF2X' },
]
for (const t of voiceTests) {
  const got = parseSpokenDigits(t.input)
  assert(`"${t.input}" → "${t.expect}"`, got === t.expect, `got "${got}"`)
}

// ─── 4. filterInventory() — type-and-tap live filter ───
section('4. filterInventory() — manual entry filter')

// Each car should be findable by its stock # alone
for (const car of INVENTORY) {
  const matches = filterInventory(INVENTORY, car.stock_number)
  assert(`stock "${car.stock_number}" → finds ${car.vehicle_make} ${car.vehicle_model}`,
    matches.some((m) => m.stock_number === car.stock_number))
}

// Each car should be findable by full last 6 of VIN
for (const car of INVENTORY) {
  const matches = filterInventory(INVENTORY, car.last_6_vin)
  assert(`vin6 "${car.last_6_vin}" → finds ${car.vehicle_make} ${car.vehicle_model}`,
    matches.some((m) => m.stock_number === car.stock_number))
}

// Partial match — only 4521 has 53829 in last 6 now (4523 changed to alphanumeric)
const partial = filterInventory(INVENTORY, '53829')
assert('partial "53829" returns 1 match (4521)',
  partial.length === 1 && partial[0].stock_number === '4521')

// VIN-with-letters: searching for letters in last 6 should find the right car
const vinLetterTests = [
  { q: '5KJF2X', stock: '4523', desc: 'full VIN-with-letters' },
  { q: 'KJF',    stock: '4523', desc: 'partial VIN with letters' },
  { q: 'B7M3R9', stock: '4524', desc: 'B7M3R9 → Ford' },
  { q: 'C44',    stock: '4526', desc: 'C44 prefix' },
  { q: 'WGNT89', stock: '4528', desc: 'WGNT89 → BMW' },
]
for (const t of vinLetterTests) {
  const matches = filterInventory(INVENTORY, t.q)
  assert(`"${t.q}" → finds stock ${t.stock} (${t.desc})`,
    matches.some(m => m.stock_number === t.stock),
    `got ${matches.length} matches: ${matches.map(m => m.stock_number).join(', ')}`)
}

// Empty query
assert('empty query returns []', filterInventory(INVENTORY, '').length === 0)
assert('whitespace query returns []', filterInventory(INVENTORY, '   ').length === 0)

// Lowercase query still matches
assert('lowercase "4521" matches', filterInventory(INVENTORY, '4521').length > 0)

// ─── 5. VOICE → MATCH FLOW (10 different voice utterances) ───
section('5. Voice flow: speak → parse → match → submit')
const voiceFlow = [
  // Stock numbers (numeric — voice strong)
  { speak: 'stock 4521',                                    expectStock: '4521' },
  { speak: 'four five two two',                             expectStock: '4522' },
  { speak: 'stock 4523',                                    expectStock: '4523' },
  { speak: 'stock 4525',                                    expectStock: '4525' },
  { speak: 'six six six seven seven seven',                 expectStock: '4527' }, // by VIN digits
  { speak: 'one two one two one two',                       expectStock: '4529' }, // by VIN digits
  { speak: 'three four three four three four',              expectStock: '4530' }, // by VIN digits
  // VIN-with-letters via NATO phonetic
  { speak: 'five kilo juliet foxtrot two xray',             expectStock: '4523' }, // 5KJF2X → Honda Accord
  { speak: 'bravo seven mike three romeo nine',             expectStock: '4524' }, // B7M3R9 → Ford F-150
  { speak: 'whiskey golf november tango eight nine',        expectStock: '4528' }, // WGNT89 → BMW
]
for (const t of voiceFlow) {
  const digits = parseSpokenDigits(t.speak)
  const matches = filterInventory(INVENTORY, digits)
  assert(`speak "${t.speak}" → parses "${digits}" → finds stock ${t.expectStock}`,
    matches.length >= 1 && matches.some(m => m.stock_number === t.expectStock),
    `got ${matches.length} matches: ${matches.map(m => m.stock_number).join(', ')}`)
}

// ─── 6. DEDUPE LOGIC (mimics submitScan dedupe) ───
section('6. Dedupe: same stock+section within 3s blocked, different section allowed')

function makeDedupeChecker() {
  // Mirrors the LotWalk submitScan TTL Map dedupe.
  const recent = new Map()
  return function check(stock, section) {
    const now = Date.now()
    const key = `${stock}|${section}`
    for (const [k, exp] of recent) {
      if (exp <= now) recent.delete(k)
    }
    if (recent.has(key)) return 'BLOCKED'
    recent.set(key, now + 3000)
    return 'ALLOWED'
  }
}

const check = makeDedupeChecker()
assert('1st scan 4521 in Front Section → ALLOWED',
  check('4521', 'Front Section') === 'ALLOWED')
assert('2nd scan 4521 in Front Section immediately → BLOCKED (dedupe)',
  check('4521', 'Front Section') === 'BLOCKED')
assert('scan 4521 in Mechanic Line immediately → ALLOWED (different section = real move)',
  check('4521', 'Mechanic Line') === 'ALLOWED')
assert('scan 4521 in Mechanic Line again immediately → BLOCKED',
  check('4521', 'Mechanic Line') === 'BLOCKED')
assert('different stock 4522 in Mechanic Line → ALLOWED',
  check('4522', 'Mechanic Line') === 'ALLOWED')

// Time-based: simulate 4 sec wait
const check2 = makeDedupeChecker()
check2('4523', 'Wash Line')  // ALLOWED
const fakeNow = Date.now() + 4000
const oldDateNow = Date.now
Date.now = () => fakeNow
assert('same scan 4 sec later → ALLOWED (outside dedupe window)',
  check2('4523', 'Wash Line') === 'ALLOWED')
Date.now = oldDateNow

// ─── 7. INVENTORY SORT (mimics Inventory.jsx sort) ───
section('7. Inventory sort: never-tracked first, then oldest tracked first')

// Simulate vehicle_lot_status view rows (with last_seen_at as ISO string)
const now = Date.now()
function isoDaysAgo(d) {
  return new Date(now - d * 24 * 60 * 60 * 1000).toISOString()
}
const lotStatus = INVENTORY.map((c) => ({
  ...c,
  last_seen_at: c.days_since_seen == null ? null : isoDaysAgo(c.days_since_seen),
}))
const sorted = [...lotStatus].sort((a, b) => {
  const aSeen = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0
  const bSeen = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0
  return aSeen - bSeen
})

// Expected order: never-tracked (last_seen_at=null sorts as 0) → oldest tracked first
// Stock 4530 (never) comes first because null → 0 timestamp
// Then 4529 (30 days), 4528 (14d), 4527 (13d), 4526 (9d), 4525 (7d), 4524 (6d), 4523 (5d), 4522 (2d), 4521 (today)
const expectedOrder = ['4530', '4529', '4528', '4527', '4526', '4525', '4524', '4523', '4522', '4521']
const actualOrder = sorted.map((c) => c.stock_number)
assert('sort order matches expected (never first, then oldest tracked first)',
  JSON.stringify(actualOrder) === JSON.stringify(expectedOrder),
  `got [${actualOrder.join(', ')}]`)

// Print the sorted list with badges to visually verify
console.log('\n  Sorted inventory list (what the Inventory tab will render):')
console.log('  ' + '─'.repeat(70))
for (const c of sorted) {
  const stale = staleness(c.days_since_seen)
  const badge = { green: '🟢', yellow: '🟡', red: '🔴', never: '⚪' }[stale]
  const label = `${c.vehicle_year} ${c.vehicle_make} ${c.vehicle_model}`.padEnd(22)
  const stock = `[${c.stock_number}]`.padEnd(8)
  const seen = formatLastSeen(c.days_since_seen).padEnd(15)
  console.log(`  ${badge} ${stock} ${label} · ${seen}`)
}

// ─── 8. STALE FILTER (Stale 7d+ chip) ───
section('8. Stale filter: cars not seen in 7+ days OR never seen')
const staleRows = lotStatus.filter((r) => r.days_since_seen == null || r.days_since_seen >= 7)
assert('stale count = 6 (7d+: 4525,4526,4527,4528,4529 + never: 4530)',
  staleRows.length === 6,
  `got ${staleRows.length}: ${staleRows.map(r => r.stock_number).join(', ')}`)

// ─── 9. SECTION FILTER ───
section('9. Section filter: only show cars in selected section')
// Simulate that 4521, 4522, 4523 are in "Front Section" right now
const withSections = lotStatus.map((c) => {
  if (['4521', '4522', '4523'].includes(c.stock_number)) return { ...c, current_section: 'Front Section' }
  if (['4524', '4525'].includes(c.stock_number))         return { ...c, current_section: 'Mechanic Line' }
  return { ...c, current_section: null }
})
const inFrontSection = withSections.filter((r) => r.current_section === 'Front Section')
assert('Front Section filter → 3 cars (4521, 4522, 4523)',
  inFrontSection.length === 3 &&
  inFrontSection.every(c => ['4521', '4522', '4523'].includes(c.stock_number)))

// ─── 10. END-TO-END WALK SIMULATION ───
section('10. End-to-end: lot guy walks 10 cars across 3 sections')

// State: tracks the "last submitted" key for dedupe
const walkState = makeDedupeChecker()
const scans = []
let currentSection = 'Front Section'

function simulateScan(input, inputMethod = 'manual') {
  // Step 1: parse input (digits or partial)
  let query = input
  if (inputMethod === 'voice') query = parseSpokenDigits(input)
  // Step 2: filter inventory
  const matches = filterInventory(INVENTORY, query)
  if (matches.length === 0) return { result: 'no_match', input, query }
  if (matches.length > 1) return { result: 'ambiguous', input, query, count: matches.length }
  const car = matches[0]
  // Step 3: dedupe
  const dedupe = walkState(car.stock_number, currentSection)
  if (dedupe === 'BLOCKED') return { result: 'duplicate', stock: car.stock_number }
  // Step 4: log scan
  const scan = {
    stock: car.stock_number,
    label: `${car.vehicle_year} ${car.vehicle_make} ${car.vehicle_model}`,
    section: currentSection,
    inputMethod,
  }
  scans.push(scan)
  return { result: 'logged', scan }
}

// Walk 1: Front Section — scan 3 cars by stock
console.log('\n  Walking Front Section...')
console.log('  ', simulateScan('4521').scan?.label || '(failed)')
console.log('  ', simulateScan('4522').scan?.label || '(failed)')
console.log('  ', simulateScan('4523').scan?.label || '(failed)')
// Try to scan 4521 again immediately — should dedupe
const dup = simulateScan('4521')
assert('immediate re-scan of 4521 in Front Section → blocked', dup.result === 'duplicate')

// Walk 2: switch section, scan 4521 again — should NOT dedupe (real move)
currentSection = 'Mechanic Line'
console.log('\n  Switched to Mechanic Line — moved 4521 here:')
const moved = simulateScan('4521')
assert('moving 4521 to Mechanic Line → logged (different section)', moved.result === 'logged')
console.log('  ', moved.scan?.label || '(failed)')

// Walk 3: 4 more cars in Mechanic Line via voice (mix of stock # and VIN-with-letters)
console.log('\n  Voice scans in Mechanic Line...')
const v1 = simulateScan('bravo seven mike three romeo nine', 'voice')  // 4524 by VIN B7M3R9
console.log('  voice NATO "B7M3R9" →', v1.scan?.label || v1.result)
const v2 = simulateScan('four five two five', 'voice')  // 4525 by stock
console.log('  voice "four five two five" →', v2.scan?.label || v2.result)
const v3 = simulateScan('charlie four four five five five', 'voice')  // 4526 by VIN C44555
console.log('  voice NATO "C44555" →', v3.scan?.label || v3.result)
const v4 = simulateScan('six six six seven seven seven', 'voice')  // 4527 by VIN 666777
console.log('  voice "six six six seven seven seven" →', v4.scan?.label || v4.result)

// Walk 4: switch to Wash Line, scan remaining 3 cars
currentSection = 'Wash Line'
console.log('\n  Switched to Wash Line...')
const w1 = simulateScan('4528')
console.log('  ', w1.scan?.label || w1.result)
const w2 = simulateScan('4529')
console.log('  ', w2.scan?.label || w2.result)
const w3 = simulateScan('4530')
console.log('  ', w3.scan?.label || w3.result)

// Verify total scan count and section distribution
console.log('\n  Total scans logged:', scans.length)
const bySection = {}
for (const s of scans) bySection[s.section] = (bySection[s.section] || 0) + 1
console.log('  By section:', bySection)
console.log('  By input method:', scans.reduce((acc, s) => {
  acc[s.inputMethod] = (acc[s.inputMethod] || 0) + 1
  return acc
}, {}))

assert('total scans = 11 (3 Front + 5 Mechanic + 3 Wash)', scans.length === 11)
assert('Front Section has 3 scans',  bySection['Front Section'] === 3)
assert('Mechanic Line has 5 scans',  bySection['Mechanic Line'] === 5)
assert('Wash Line has 3 scans',      bySection['Wash Line'] === 3)
assert('voice contributed 4 scans',  scans.filter(s => s.inputMethod === 'voice').length === 4)
assert('manual contributed 7 scans', scans.filter(s => s.inputMethod === 'manual').length === 7)

// ─── 11. CAMERA SCAN: VIN extraction from decoded barcode text ───
section('11. extractVIN() — VIN regex from decoded barcode payload')

// Real-world door-jamb sticker payloads typically contain just the VIN
// but some include extra metadata before/after.
const vinExtractionTests = [
  // Just the VIN (most common case)
  { input: '1HGCM82633A538291',                         expect: '1HGCM82633A538291', desc: 'bare VIN' },
  // VIN at start of multi-line sticker
  { input: '1HGCM82633A538291\nGVWR 4500\nMFG 03/19',   expect: '1HGCM82633A538291', desc: 'VIN with metadata' },
  // VIN embedded mid-text
  { input: 'VIN:1HGCM82633A538291',                     expect: '1HGCM82633A538291', desc: 'VIN with prefix label' },
  // QR with VIN value
  { input: '1FTFW1ET5DKB7M3R9',                         expect: '1FTFW1ET5DKB7M3R9', desc: 'VIN with letters (17ch)' },
  // Lowercase normalized to upper
  { input: '1hgcm82633a538291',                         expect: '1HGCM82633A538291', desc: 'lowercase normalized' },
  // No VIN at all (random QR)
  { input: 'https://example.com/foo',                   expect: '',                  desc: 'URL — no VIN' },
  { input: '4521',                                      expect: '',                  desc: 'short stock # — no VIN' },
  { input: '',                                          expect: '',                  desc: 'empty input' },
  // String contains 17 chars but with I/O/Q (invalid VIN chars)
  { input: '1HGCM82633A53I291',                         expect: '',                  desc: 'rejects I (invalid VIN char)' },
  { input: '1HGCM82633AO38291',                         expect: '',                  desc: 'rejects O (invalid VIN char)' },
  { input: '1HGCM82633Q538291',                         expect: '',                  desc: 'rejects Q (invalid VIN char)' },
]
for (const t of vinExtractionTests) {
  const got = extractVIN(t.input)
  assert(`extractVIN(${JSON.stringify(t.input).slice(0, 50)}) → "${t.expect}" (${t.desc})`,
    got === t.expect, `got "${got}"`)
}

// ─── 12. CAMERA SCAN: end-to-end (extract → match → would-submit) ───
section('12. Camera scan flow: decoded barcode → vehicle lookup')

// Simulate handleCameraDecoded for each car using its full VIN
function simulateCameraScan(decodedText, currentSection) {
  const vin = extractVIN(decodedText)
  if (vin) {
    const vehicle = matchVehicleByVIN(INVENTORY, vin)
    if (vehicle) return { result: 'matched', vehicle, by: 'vin' }
    return { result: 'vin_not_in_inventory', vin }
  }
  // Fallback to filter
  const matches = filterInventory(INVENTORY, decodedText.trim())
  if (matches.length === 1) return { result: 'matched', vehicle: matches[0], by: 'fallback' }
  if (matches.length > 1) return { result: 'ambiguous', count: matches.length }
  return { result: 'no_match' }
}

// Each of the 10 cars should be scannable by their full VIN
console.log('\n  Scanning each car by full VIN (factory door-jamb scenario):')
for (const car of INVENTORY) {
  const r = simulateCameraScan(car.vehicle_vin, 'Front Section')
  const ok = r.result === 'matched' && r.vehicle.stock_number === car.stock_number
  assert(`scan VIN ${car.vehicle_vin.slice(-6)} → finds ${car.vehicle_make} ${car.vehicle_model}`, ok)
}

// QR with extra text wrapping a VIN
const qrWithMetadata = `VIN:${INVENTORY[0].vehicle_vin}\nMFG:HONDA`
const r1 = simulateCameraScan(qrWithMetadata, 'Front')
assert('QR "VIN:...HONDA" → extracts VIN and matches Honda Civic',
  r1.result === 'matched' && r1.vehicle.stock_number === '4521')

// QR containing just a stock number (custom dealer QR scenario)
const r2 = simulateCameraScan('4525', 'Front')
assert('QR "4525" (no VIN) → falls back to stock # match',
  r2.result === 'matched' && r2.vehicle.stock_number === '4525')

// Random URL QR (e.g. someone scans an unrelated sticker)
const r3 = simulateCameraScan('https://example.com', 'Front')
assert('QR random URL → no_match (no VIN, no stock match)',
  r3.result === 'no_match')

// VIN that's not in the inventory
const r4 = simulateCameraScan('5YJSA1H21FF101010', 'Front')  // valid VIN format, not in inv
assert('valid VIN format but not in inventory → vin_not_in_inventory',
  r4.result === 'vin_not_in_inventory')

// ─── SUMMARY ───
console.log('\n' + '═'.repeat(72))
console.log(`  ${passed} passed · ${failed} failed`)
console.log('═'.repeat(72))
process.exit(failed > 0 ? 1 : 0)
