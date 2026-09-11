// Parts ETA — the delivery date, read out of the note somebody actually typed.
//
// Nobody in a body shop fills in a date picker. When the counter says the
// bumper ships Monday, Jorge types "bumper eta monday" into the car's notes and
// moves on, and that sentence is the only record the date has ever had. The
// board could not read it, so Parts Ordered was 20-odd cars in no order at all:
// the one arriving tomorrow sat below the one nobody has heard about in three
// weeks, and the only way to tell them apart was to open all twenty.
//
// So this reads the sentence. A cue word — eta, due, arriving, coming in, by —
// followed by anything that looks like a date:
//
//   eta 9/15 · ETA: 9/15/26 · due friday · parts in by next tuesday
//   arriving sep 22 · expected end of week · eta in 3 days · coming tomorrow
//
// Every date in the note is picked up, not just the first: a car waiting on a
// fender Tuesday and a grille the following week is blocked until the LAST one
// lands, and the FIRST one is what gets chased first. Both are kept.
//
// What it deliberately does NOT do is guess from a bare number. "9/15" on its
// own in a note about a repair is not a promise from a vendor, and a board that
// invents delivery dates is worse than one that has none — so a date with no
// cue word in front of it is ignored.
//
// Relative words ("monday", "next week") are resolved against the moment the
// note was SAVED, not against today, which is why the answer is stored on the
// job (see partsEtaPatch) instead of re-read every time the board draws. A note
// typed three weeks ago saying "eta monday" means that Monday, and it is late.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}
const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

const MON_RE = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`
const DOW_RE = String.raw`(?:sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?|r)?|fri(?:day)?|sat(?:urday)?)`

// The words that mark what follows as a delivery date. Anything not introduced
// by one of these is not an ETA — see the note above about bare numbers.
const CUE_RE = String.raw`(?:e\.?\s?t\.?\s?a\.?|est(?:imated)?\.?\s*(?:delivery|arrival|del)|arriv\w*|expect\w*|deliver\w*|due|coming(?:\s+in)?|comes?\s+in|lands?|landing|shows?\s+up|should\s+be\s+(?:here|in)|(?:in|here|back|done|ready)\s+by|by|says?|said|told\s+\w+|quoted|promised?)`

// Filler between the cue and the date: punctuation and the small words people
// put there. Bounded so a cue can't reach across half a sentence and grab a
// date that belongs to something else.
const FILL = String.raw`(?:[\s:=~,–—-]|\b(?:is|was|will|be|should|to|on|the|for|about|abt|approx(?:imately)?|around|prob(?:ably)?|maybe|roughly|of|at|it|they|arrive|arriving|arrival|delivery|date)\b){0,8}`

const DATE_RE = [
  String.raw`(?<today>today|tonight)`,
  String.raw`(?<tomorrow>tomorrow|tmrw|tmr|2morrow)`,
  String.raw`in\s+(?<inN>\d{1,2})\s*(?<inU>business\s+days?|days?|d\b|weeks?|wks?|w\b|months?|mos?\b)`,
  String.raw`(?<nN>\d{1,2})\s*(?<nU>business\s+days?|days?|weeks?|wks?|months?)\b`,
  String.raw`(?<eow>end\s+of\s+(?:the\s+)?(?:week|wk)|eow)`,
  String.raw`(?<eom>end\s+of\s+(?:the\s+)?(?:month|mo)|eom)`,
  String.raw`(?<nweek>next\s+(?:week|wk))`,
  String.raw`(?<nmonth>next\s+month)`,
  String.raw`(?<iso>\d{4}-\d{1,2}-\d{1,2})`,
  String.raw`(?<na>\d{1,2})\s*[/\-.]\s*(?<nb>\d{1,2})(?:\s*[/\-.]\s*(?<ny>\d{2,4}))?`,
  String.raw`(?<mon>${MON_RE})\s*(?<monD>\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(?<monY>\d{4}))?`,
  String.raw`(?<rmonD>\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(?<rmon>${MON_RE})`,
  String.raw`(?:(?<dowMod>this|next|coming)\s+)?(?<dow>${DOW_RE})\b`,
  String.raw`(?:the\s+)?(?<dom>\d{1,2})(?:st|nd|rd|th)\b`,
].join('|')

const SCAN = new RegExp(String.raw`\b${CUE_RE}\b${FILL}(?:${DATE_RE})`, 'gi')

// A second date hung off the first: "monday or tuesday", "9/15 - 9/20",
// "thursday/friday". The counter hedges like this constantly, and reading only
// the near half of a hedge is how a car looks on time right up until it isn't.
// Both go in — the early one is what gets chased, the late one is when the car
// can actually start.
const CONT = new RegExp(String.raw`^\s*(?:or|to|and|thru|through|[-–/,])\s*(?:${DATE_RE})`, 'i')

// What turns a date into something that already happened.
const AGO = /^\s*ago\b/i

// ---------------------------------------------------------------- date helpers

const DAY = 86400000
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

export function toISO(d) {
  if (!d) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 'YYYY-MM-DD' as a LOCAL midnight. new Date('2026-09-15') is UTC midnight,
// which is the previous day west of Greenwich — that one character of sloppiness
// would report every part as arriving a day early.
export function fromISO(s) {
  if (!s) return null
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s))
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

// Whole days from today to the date. Negative means the date has passed.
export function daysUntil(iso, now = new Date()) {
  const d = fromISO(iso)
  if (!d) return null
  return Math.round((d - startOfDay(now)) / DAY)
}

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

// The next time that weekday comes round — always ahead, never today, because
// "due friday" said on a Friday means the one coming.
//
// "next friday" resolves the same as "friday": the one coming up. Half the
// shop means "the Friday after this one" by it and half means the same Friday,
// and a date that is a week wrong in the optimistic direction is the expensive
// mistake. The near read chases it sooner; the far read just means it shows as
// a few days late.
function nextDow(anchor, dow) {
  const delta = ((dow - anchor.getDay()) + 7) % 7 || 7
  return addDays(anchor, delta)
}

// A month and a day with no year: pick the year that puts it nearest the note.
// "1/5" typed in December is next January, not eleven months ago — but a date
// a few weeks behind the note is a real (and late) one, so the window reaches
// back before it reaches forward.
function inferYear(anchor, month, day) {
  for (const y of [anchor.getFullYear(), anchor.getFullYear() + 1, anchor.getFullYear() - 1]) {
    const d = new Date(y, month, day)
    if (d.getMonth() !== month) continue          // 2/30 and friends
    const off = Math.round((d - startOfDay(anchor)) / DAY)
    if (off >= -60 && off <= 300) return d
  }
  return null
}

function monthIndex(word) {
  return MONTHS[String(word || '').slice(0, 3).toLowerCase()]
}

function resolve(g, anchor) {
  const base = startOfDay(anchor)

  if (g.today) return base
  if (g.tomorrow) return addDays(base, 1)

  if (g.inN || g.nN) {
    const n = Number(g.inN || g.nN)
    const unit = String(g.inU || g.nU || 'd').toLowerCase()
    if (!n || n > 60) return null
    if (unit.startsWith('w')) return addDays(base, n * 7)
    if (unit.startsWith('mo') || unit.startsWith('month')) return addDays(base, n * 30)
    // Business days are counted as business days — "3 business days" on a
    // Thursday is the following Tuesday, and rounding that to Sunday is how a
    // part shows up two days "late" that was never late.
    if (unit.includes('business')) {
      let d = base
      for (let i = 0; i < n; i++) {
        do { d = addDays(d, 1) } while (d.getDay() === 0 || d.getDay() === 6)
      }
      return d
    }
    return addDays(base, n)
  }

  if (g.eow) return nextDow(base, DOW.fri)
  if (g.eom) return new Date(base.getFullYear(), base.getMonth() + 1, 0)
  if (g.nweek) return addDays(base, 7)
  if (g.nmonth) return new Date(base.getFullYear(), base.getMonth() + 1, base.getDate())

  if (g.iso) {
    const [y, m, d] = g.iso.split('-').map(Number)
    return new Date(y, m - 1, d)
  }

  if (g.na) {
    let a = Number(g.na)
    let b = Number(g.nb)
    // 15/9 is somebody writing it the other way round, not the 15th month.
    if (a > 12 && b <= 12) [a, b] = [b, a]
    if (a < 1 || a > 12 || b < 1 || b > 31) return null
    if (g.ny) {
      const y = Number(g.ny)
      const full = y < 100 ? 2000 + y : y
      const d = new Date(full, a - 1, b)
      return d.getMonth() === a - 1 ? d : null
    }
    return inferYear(base, a - 1, b)
  }

  if (g.mon || g.rmon) {
    const m = monthIndex(g.mon || g.rmon)
    const day = Number(g.monD || g.rmonD)
    if (m == null || !day || day > 31) return null
    if (g.monY) {
      const d = new Date(Number(g.monY), m, day)
      return d.getMonth() === m ? d : null
    }
    return inferYear(base, m, day)
  }

  if (g.dow) {
    const d = DOW[g.dow.slice(0, 3).toLowerCase()]
    if (d == null) return null
    return nextDow(base, d)
  }

  if (g.dom) {
    const day = Number(g.dom)
    if (!day || day > 31) return null
    // "due the 20th" — this month if it hasn't gone by, otherwise next.
    const here = new Date(base.getFullYear(), base.getMonth(), day)
    if (here.getDate() === day && here >= base) return here
    const next = new Date(base.getFullYear(), base.getMonth() + 1, day)
    return next.getDate() === day ? next : null
  }

  return null
}

// ---------------------------------------------------------------- the read

// Every delivery date in a note, earliest first.
//
//   [{ date: '2026-09-15', text: 'eta 9/15' }, …]
//
// `anchor` is when the note was written — what "monday" was said relative to.
export function findEtas(notes, anchor = new Date()) {
  const text = String(notes || '')
  if (!text.trim()) return []

  const out = []
  const seen = new Set()
  SCAN.lastIndex = 0
  let m
  while ((m = SCAN.exec(text)) !== null) {
    // A cue with nothing date-shaped after it still advances the scan; without
    // this an empty match would spin on the same index forever.
    if (m[0].length === 0) { SCAN.lastIndex += 1; continue }
    const d = resolve(m.groups || {}, anchor)
    if (!d) continue
    // "delivered 2 days ago" is a report, not a promise, and reading it as a
    // date two days out would put a car that has its parts at the front of the
    // queue for parts it is still waiting on.
    if (AGO.test(text.slice(SCAN.lastIndex))) continue

    // The first date, then anything hedged onto it.
    let at = SCAN.lastIndex
    const hits = [{ date: toISO(d), text: m[0] }]
    for (;;) {
      const more = CONT.exec(text.slice(at))
      if (!more) break
      const nd = resolve(more.groups || {}, anchor)
      if (!nd) break
      if (AGO.test(text.slice(at + more[0].length))) break
      hits.push({ date: toISO(nd), text: `${m[0]}${more[0]}` })
      at += more[0].length
    }
    SCAN.lastIndex = at

    for (const hit of hits) {
      if (seen.has(hit.date)) continue
      seen.add(hit.date)
      out.push({ date: hit.date, text: hit.text.replace(/\s+/g, ' ').trim() })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

// The one answer the board wants: when the first part lands, when the last one
// does, and the words that said so.
export function parsePartsEta(notes, anchor = new Date()) {
  const found = findEtas(notes, anchor)
  if (!found.length) return null
  const first = found[0]
  const last = found[found.length - 1]
  return {
    soonest: first.date,
    latest: last.date,
    text: first.text,
    count: found.length,
  }
}

// A cheap fingerprint of the note we read, stored beside the answer so the
// board can tell whether the sentence has changed since — FNV-1a, because this
// only has to detect an edit, not resist one.
export function notesKey(notes) {
  const s = String(notes || '').trim()
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${s.length}:${h.toString(36)}`
}

// What to write on the job when its notes change. One place, so the save path
// and the catch-up pass can never disagree about what a sentence means.
export function partsEtaPatch(notes, anchor = new Date()) {
  const read = parsePartsEta(notes, anchor)
  return {
    parts_eta:      read?.soonest || null,
    parts_eta_last: read && read.latest !== read.soonest ? read.latest : null,
    parts_eta_text: read?.text || null,
    parts_eta_key:  notesKey(notes),
  }
}

// ---------------------------------------------------------------- the buckets

// Where a car waiting on parts belongs. The three piles the shop actually has,
// and the reason this whole file exists:
//
//   late    the date has gone by and the parts are still marked Ordered. Either
//           the vendor is sitting on it or it was dropped off and nobody
//           checked it in — the board cannot tell those apart, a person can,
//           and both start with somebody picking up the phone or walking the
//           parts room. This is the only pile with work in it.
//   today   landing today. Worth its own colour for one day.
//   coming  a date in the future. Nothing to do but wait, soonest first.
//   none    no date in the note at all. Not the same as "on time" — it's a car
//           nobody can chase, which is its own kind of bad, so it sorts last
//           rather than hiding among the ones that are fine.
export const ETA_BUCKETS = ['late', 'today', 'coming', 'none']

// Whether the date on this car is still about something that hasn't arrived.
//
// A finished car keeps whatever its notes said, and a car on the lift with
// every part checked in is not "late" — showing a red overdue banner on either
// is how a board teaches people to ignore red. The date speaks while a part is
// still outstanding, or while the car is in a stage that is ABOUT waiting for
// one (a car in Intake with "eta friday" written on it has been ordered for in
// everything but the checklist).
const ETA_STAGES = ['intake', 'need_parts', 'waiting_parts']

export function etaMatters(job) {
  if (!job?.parts_eta) return false
  if (job.status === 'done' || job.status === 'on_hold') return false
  const outstanding = Number(job.parts_needed || 0) + Number(job.parts_ordered || 0)
  return outstanding > 0 || ETA_STAGES.includes(job.status)
}

export function etaState(job, now = new Date()) {
  const iso = job?.parts_eta || null
  if (!iso) return { bucket: 'none', days: null, date: null, last: null }
  const days = daysUntil(iso, now)
  return {
    bucket: days < 0 ? 'late' : days === 0 ? 'today' : 'coming',
    days,
    date: iso,
    last: job.parts_eta_last || null,
  }
}

// Soonest first, and the ones with no date at the bottom. Inside a pile the
// ordering is the same rule read twice: the most overdue car is the oldest
// broken promise, and the next delivery is the next thing to happen.
export function byEta(a, b, now = new Date()) {
  const A = etaState(a, now)
  const B = etaState(b, now)
  if (!A.date && !B.date) return 0
  if (!A.date) return 1
  if (!B.date) return -1
  return A.date.localeCompare(B.date)
}

const FMT = { weekday: 'short', month: 'short', day: 'numeric' }

export function formatEta(iso) {
  const d = fromISO(iso)
  return d ? d.toLocaleDateString(undefined, FMT) : null
}

// "4d late" / "today" / "tomorrow" / "in 6d" — the part of the chip that says
// what to do about it without making anyone count on a calendar.
export function etaRelative(iso, now = new Date()) {
  const n = daysUntil(iso, now)
  if (n == null) return null
  if (n < 0) return `${-n}d late`
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  return `in ${n}d`
}

export const ETA_STYLES = {
  late:   'bg-red-500/15 text-red-300 border border-red-500/40',
  today:  'bg-amber-500/15 text-amber-300 border border-amber-500/40',
  coming: 'bg-sky-500/15 text-sky-300 border border-sky-500/40',
  none:   'bg-slate-800 text-slate-500 border border-slate-700',
}

export const ETA_TEXT_STYLES = {
  late:   'text-red-400',
  today:  'text-amber-400',
  coming: 'text-sky-400',
  none:   'text-slate-500',
}
