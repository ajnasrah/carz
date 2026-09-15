// What the body shop group actually says, written down on the car's job.
//
// The body_shop Telegram group was read for one thing: a VIN, which moved the
// car to the body shop and opened a job. Everything else typed there was thrown
// away, and most of what is typed there is not an arrival at all:
//
//   "Kona / Rear bumper assembly - Tristate Thursday"            parts, by MODEL
//   "364318 altima ordered arrive 9/11 // 570609 ... arrive 9/14" two cars, two ETAs
//   "Being buffed should finish today 9/2 vw 607213 atlas"        progress
//   "Traverse as is no parts"                                     a decision
//   "I ask Amera n she told me to take it to Jorge"               which shop
//
// Worse, the VIN rule ran on those too: the parts coordinator listing what a car
// needs moved it to the body shop — 17 cars re-stamped from Jorge's onto the
// generic slug and one pulled off the front lot ("Front sensor part in 9/3 …
// 454760"). The owner, 2026-09-01: "AI will put the car back in body shop if you
// send here".
//
// So this file reads the words, deterministically. The formats are regular
// enough — "<model> / <part> - <when> <vendor>", "<tag> / <vin> / <year model> /
// <part>" — that a model call would buy little and cost on every message, and a
// rule that is wrong is at least wrong the same way twice and can be tested.
//
//   planMessage()            pure: text in, what it says, car by car.
//   actionsFor()             pure: one car's slice → the writes it implies.
//   captureBodyShopMessage() webhook/backfill: bind to a job, write, idempotently.
//   sweepUnboundBodyShopChat() a VIN just landed: claim what was said before it.
//
// Nothing here deletes. Every automated change leaves a body_shop_job_events row
// carrying the message key it came from, and each side effect runs only when
// that row is new — which is what makes a Telegram redelivery, or the backfill
// run twice, a no-op.

import { extractAllVin6 } from './parse.js';
import { findEtas, notesKey } from '../../src/services/partsEta.js';
import { WALK_VENDORS, isSamePlace } from '../../src/services/locationLabels.js';
import { updateLocation } from './finish.js';

// ------------------------------------------------------------------ vocabulary

// The two-character line the parts coordinator puts beside the VIN — MH, Jr, HE,
// SB, Pd, Pn, M5. Nobody has said what they mean (the same tag follows the same
// car, so perhaps a spot on the lot, perhaps initials). So they are stripped from
// what gets parsed, kept verbatim on the note, and never interpreted.
const TAG_LINE = /^[A-Za-z][A-Za-z0-9]$/;
const NOT_TAGS = new Set([
  'OK', 'NO', 'SO', 'GO', 'HI', 'YO', 'YA', 'US', 'IN', 'ON', 'AT', 'TO', 'IS',
  'IT', 'MY', 'ME', 'WE', 'UP', 'AS', 'OR', 'BY', 'DO', 'IF', 'OF', 'BE', 'AN',
  'AM', 'OH', 'TY',
]);
// "Parts***", "***part", "[Parts Ordered]" on a line of their own.
const MARKER_LINE = /^\**\s*\[?\s*parts?\s*(ordered|delivered)?\s*\]?\s*\**$/i;

// Words that make a line about a PART. Nouns only: a line with no part in it is
// not a parts line however many dates are on it.
const PART_WORDS = [
  'bumpers?', 'grill(?:e|s)?', 'grilles', 'head\\s?lights?', 'head\\s?lamps?', 'tail\\s?lights?',
  'tailights?', 'tail\\s?lamps?', 'fog\\s?lights?', 'lights?', 'lamps?', 'mirrors?',
  'fenders?', 'liners?', 'brackets?', 'trims?', 'moldings?', 'mouldings?', 'covers?',
  'sensors?', 'emblems?', 'handles?', 'doors?', 'hoods?', 'valences?', 'lips?',
  'reflectors?', 'skid\\s?plates?', 'tow\\s?hooks?', 'switch(?:es)?', 'screens?',
  'radios?', 'steps?', 'panels?', 'quarters?', 'inserts?', 'caps?', 'wheels?', 'tires?',
  'rims?', 'windshields?', 'glass', 'spoilers?', 'blinkers?', 'garnish(?:es)?',
  'arch(?:es)?', 'a/?c\\s+lines?', 'bolts?', 'housings?', 'clips?',
  'splash\\s+(?:shield|guard)s?', 'tailgates?', 'rockers?', 'key\\s+(?:hole|whole)',
  'mud\\s?flaps?', 'cameras?', 'airbags?', 'deflectors?', 'shields?', 'absorbers?',
  'reinforcements?', 'assembly', 'assemblies', 'visors?', 'badges?', 'nameplates?',
];
const PART_RE = new RegExp(`\\b(?:${PART_WORDS.join('|')})\\b`, 'i');

// Where parts come from, as typed. Canonical name on the right.
const VENDORS = [
  [/\bamazon\b/i, 'Amazon'],
  [/\be\s?bay\b/i, 'eBay'],
  [/\bgos+et+\b/i, 'Gossett'],
  [/\bjim\s?keras(?:\s+(?:chevy|nissan|chevrolet))?\b/i, 'Jim Keras'],
  [/\btri\s?-?\s?state\b/i, 'Tri State'],
  [/\blamberts?\b/i, 'Lamberts'],
  [/\bauto\s?nation(?:\s+ford)?\b/i, 'AutoNation'],
  [/\bfrom\s+mercedes\b/i, 'Mercedes'],
  [/\brock\s?auto\b/i, 'RockAuto'],
  [/\blkq\b/i, 'LKQ'],
  [/\bnapa\b/i, 'NAPA'],
  [/\bauto\s?zone\b/i, 'AutoZone'],
  [/\bo'?reill?y'?s?\b/i, "O'Reilly"],
  [/\bqasim\b/i, 'Qasim'],
];

// Makes as typed, including the misspellings actually in the group.
const MAKE_ALIASES = {
  chevy: 'chevrolet', chev: 'chevrolet', vw: 'volkswagen', hyandai: 'hyundai',
  hyundia: 'hyundai', merc: 'mercedes', benz: 'mercedes', caddy: 'cadillac',
  nisan: 'nissan',
};
const MAKES = new Set([
  'acura', 'alfa', 'audi', 'bmw', 'buick', 'cadillac', 'chevrolet', 'chrysler',
  'dodge', 'fiat', 'ford', 'genesis', 'gmc', 'honda', 'hyundai', 'infiniti',
  'jaguar', 'jeep', 'kia', 'lexus', 'lincoln', 'mazda', 'mercedes', 'mini',
  'mitsubishi', 'nissan', 'porsche', 'ram', 'subaru', 'tesla', 'toyota',
  'volkswagen', 'volvo', 'polestar', 'rivian',
]);
// Model misspellings seen in the group ("Nissan rouge", "Hyandai Sonota").
const MODEL_ALIASES = {
  rouge: 'rogue', sonota: 'sonata', tacome: 'tacoma', silverdo: 'silverado',
  camery: 'camry', altma: 'altima', escalde: 'escalade',
};
const COLORS = new Set([
  'white', 'black', 'blk', 'grey', 'gray', 'silver', 'red', 'blue', 'green',
  'gold', 'tan', 'brown', 'beige', 'orange', 'yellow', 'purple', 'maroon', 'wht',
]);

// ------------------------------------------------------------------ the signals

// Somebody reporting on a car rather than bringing it in. Must never move it.
const STATUS_RE = /\b(good\s+to\s+go|done|ready|parts?|order(?:ed|ing)?|arriv\w*|deliver\w*|eta|still\s+needs?|needs?|buff\w*|should\s+finish|finish\w*|missing|waiting|quote[ds]?|working\s+on|received)\b|\$\s?\d/i;
// "all parts in", "part in 9/3", "[PARTS DELIVERED INSIDE CAR]", "Taillight is in car".
const RECEIVED_RE = /\b(all\s+parts?\s+(?:are\s+)?in|parts?\s+(?:is\s+|are\s+)?in\b(?!\s+(?:white|the\s+white|passenger|this))|parts?\s+delivered|delivered|received|arrived|(?:is|are)\s+in\s+(?:the\s+)?(?:car|van|truck|trunk|bed)|in\s+the\s+back)\b/i;
// Ordered — unless the sentence asks for an order or says one is owed: "Need
// parts ordered :168164", "confirm if … ordered already", "still needs bumper
// ordered", "Talk to me before ordering", "I will / Order door Monday".
const ORDERED_RE = /\b(ordered|order|being\s+ordered)\b/i;
const NOT_ORDERED_RE = /\b(need|needs|confirm|if|before|will|to\s+be|should|calling|call|talk)\b[^.]{0,40}\border/i;
const PROGRESS_RE = /\b(bee?ing\s+buff\w*|buff(?:ed|ing)?|should\s+finish|finish(?:ed)?\s+today|working\s+on|getting\s+out|needs?\s+to\s+be\s+finished|redo)\b/i;
const WAITING_RE = /\b(waiting|wait\s+on|still\s+missing|missing|still\s+needs?|quote[ds]?|didn'?t\s+fit)\b|\$\s?\d/i;
// A decision that the car is not getting fixed: parks it in the On Hold lane.
const HOLD_RE = /\b(as[\s-]+is|no\s+parts|don['’]?t\s+fix|do\s+not\s+fix|going\s+to\s+copart|copart|acv|open\s?lane|just\s+pull\s+it)\b/i;
// How to fix it — a note, not a hold. "Touch up no paint" is still work to do.
const INSTRUCTION_RE = /\b(?:don['’]?t|do\s+not|no)\s+(?:paint|send|sent|fix)\b|\btouch\s*up\b|\bjust\s+paint\b|\bredo\b|\bdon['’]?t\s+want\b/i;
// A fault or a misfit, not a part to buy: "radio and control panel don't work".
const FAULT_RE = /\b(?:don['’]?t|doesn['’]?t|does\s+not|do\s+not|not|won['’]?t)\s+work|\bdidn['’]?t\s+fit\b|\bbent\b|\bbroken\b/i;
// body_shop_out: the car is NOT done. "78419 / Still missing the fender liner".
const FINISH_BLOCKER_RE = /\b(still|missing|waiting|not\s+(?:done|ready|finished)|isn['’]?t\s+(?:done|ready)|needs?)\b/i;
// "Back tri state", "back from Summit" — the car RETURNING. Not "back to George".
const BACK_FROM_RE = /(?<!\bthe\s)\bback\b(?!\s+(?:to|seat|of)\b)/i;
// Sending it somewhere, with the place after the phrase.
const SEND_TO_RE = /\b(?:back\s+to|take\s+(?:it\s+)?to|send\s+(?:it\s+)?to|bring\s+(?:it\s+)?to|move\s+(?:it\s+)?to|put\s+(?:it\s+)?(?:in|at)|park\s+(?:it\s+)?(?:in|at)|goes\s+to|is\s+at|at)\s+(.+)$/i;
// …unless it is conditional, future or negated: "Ionk if u want me to take it to
// Andy", "after take to Andy", "Don't send George".
const NOT_A_MOVE_RE = /\b(if|after|later|tomorrow|should|will|wanna|want|don['’]?t|dont|do\s+not|never)\b|\?/i;

// ------------------------------------------------------------------ small helpers

const clean = (s) => String(s || '').replace(/[ \t]+/g, ' ').trim();
const words = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean);
const alnum = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Strip the coordinator's tag lines and "Parts***" markers, keeping them. A tag
// only counts in a post that carries a VIN — "Q5 / Fog light covers" is an Audi.
export function stripTags(text) {
  const tags = [];
  const markers = [];
  const src = String(text || '');
  const lines = src.split(/\r?\n/);
  const nonEmpty = lines.filter((l) => l.trim()).length;
  const hasVin = extractAllVin6(src).length > 0;
  const kept = [];
  for (const line of lines) {
    const t = line.trim();
    if (nonEmpty > 1 && hasVin && TAG_LINE.test(t) && !NOT_TAGS.has(t.toUpperCase())) {
      tags.push(t);
      continue;
    }
    if (nonEmpty > 1 && t && MARKER_LINE.test(t)) { markers.push(t); continue; }
    kept.push(line);
  }
  return { tags, markers, body: kept.join('\n') };
}

// Cut the VIN tokens out of a line. Mirrors parse.js's candidate rule.
function removeVins(line, vins) {
  const set = new Set(vins);
  return line.replace(/\b[A-Za-z0-9]{5,17}\b/g, (tok) => {
    if (!/\d/.test(tok) || (tok.length > 8 && tok.length < 15)) return tok;
    const v = tok.toUpperCase();
    return set.has(v.length >= 6 ? v.slice(-6) : v.padStart(6, '0')) ? ' ' : tok;
  });
}

// 5-character tokens parse.js padded to 6 ("78419" → "078419"). The team drops a
// LEADING digit, not a zero, so a padded VIN that matches nothing is retried as a
// suffix against the cars actually in the shop.
export function shortTokens(text) {
  return (String(text || '').match(/\b[A-Za-z0-9]{5}\b/g) || [])
    .filter((t) => /\d/.test(t))
    .map((t) => ({ raw: t.toUpperCase(), vin6: t.toUpperCase().padStart(6, '0') }));
}

// One piece per car. A line carrying a VIN starts a car; the lines after it are
// that car's; lines before the first VIN belong to the first car ("Front sensor
// part in 9/3 / … / Palisade 454760"). "//" is a line break.
export function splitByCar(body) {
  const lines = String(body || '').replace(/\s*\/\/\s*/g, '\n').split(/\r?\n/);
  const segs = [];
  const pre = [];
  let group = null;
  for (const line of lines) {
    const vins = extractAllVin6(line);
    if (vins.length) {
      const own = removeVins(line, vins);
      group = vins.map((v) => ({ vin6: v, lines: [own] }));
      if (!segs.length && pre.length) for (const g of group) g.lines.unshift(...pre);
      segs.push(...group);
    } else if (group) {
      for (const g of group) g.lines.push(line);
    } else {
      pre.push(line);
    }
  }
  const out = segs.length ? segs : [{ vin6: null, lines: pre }];
  return out.map((s) => ({ vin6: s.vin6, text: s.lines.map(clean).filter(Boolean).join('\n') }));
}

export function isStatusNote(text) {
  const { tags, markers, body } = stripTags(text);
  if (tags.length || markers.length) return true;
  const t = removeVins(body, extractAllVin6(body));
  return STATUS_RE.test(t) || PART_RE.test(t) || HOLD_RE.test(t) || FAULT_RE.test(t);
}

export function isFinishBlocker(text) {
  return FINISH_BLOCKER_RE.test(String(text || ''));
}

function vendorOf(text) {
  for (const [re, name] of VENDORS) if (re.test(text)) return name;
  return null;
}
function stripVendors(text) {
  let t = String(text || '');
  for (const [re] of VENDORS) t = t.replace(new RegExp(re.source, 'gi'), ' ');
  return t;
}

// Dates in a delivery slot with no cue word: "Part - Monday Amazon", "ordered
// 9/14 latest". The POSITION is the cue there — partsEta refuses a bare date on
// purpose, so it is handed one.
function slotEtas(text, anchor) {
  const t = clean(stripVendors(text)
    .replace(/\b(from|with|now|latest|being|ordered|order|or|as\s+of)\b/gi, (w) => (/^or$/i.test(w) ? 'or' : ' ')));
  if (!t) return [];
  return findEtas(`eta ${t}`, anchor);
}

export function vehicleHints(text) {
  const w = words(text).map((x) => MODEL_ALIASES[x] || x);
  const year = (String(text || '').match(/\b(19[89]\d|20[0-3]\d)\b/) || [])[1] || null;
  const makes = [];
  for (const x of w) {
    const m = MAKE_ALIASES[x] || x;
    if (MAKES.has(m) && !makes.includes(m)) makes.push(m);
  }
  return { year: year ? Number(year) : null, makes, colors: w.filter((x) => COLORS.has(x)), words: w };
}

// What a car is called: model tokens and the model squashed ("rav4", "crv",
// "f150", "santafe").
const GENERIC_MODEL_WORDS = new Set(['model', 'grand', 'new', 'sport', 'limited', 'hybrid',
  'base', 'series', 'class', 'crew', 'cab', 'van', 'wagon', 'coupe', 'sedan', 'hd', 'ltd']);
function carNames(car) {
  const toks = String(car?.vehicle_model || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const names = new Set();
  const squashed = toks.join('');
  if (squashed.length >= 3 && !GENERIC_MODEL_WORDS.has(squashed)) names.add(squashed);
  for (const t of toks) {
    if (t.length < 3 || GENERIC_MODEL_WORDS.has(t)) continue;
    if (/^\d+$/.test(t) && t.length < 4) continue;
    names.add(t);
  }
  return [...names];
}
function makeOf(car) {
  const w = words(car?.vehicle_make)[0] || '';
  return MAKE_ALIASES[w] || (w === 'mercedesbenz' ? 'mercedes' : w);
}

function namesModel(textWords, car) {
  const names = carNames(car);
  if (!names.length) return false;
  const set = new Set(textWords);
  for (let i = 0; i + 1 < textWords.length; i++) set.add(textWords[i] + textWords[i + 1]);
  for (let i = 0; i + 2 < textWords.length; i++) set.add(textWords[i] + textWords[i + 1] + textWords[i + 2]);
  // A bare 4-digit model ("1500") must not be a year: "2023 1500" names a 1500,
  // "2021 Ford Mustang" does not name a Ram 2021.
  return names.some((n) => set.has(n) && !/^(19|20)\d\d$/.test(n));
}

// The ONE open job the text is about, by what the car is called — or nothing.
// Two open Camrys and a post that says "Camry" is not a guess worth writing a
// part onto; it waits for a VIN instead.
export function matchCarByName(text, cars) {
  const h = vehicleHints(text);
  if (!cars?.length || !h.words.length) return null;
  let pool = cars.filter((c) => namesModel(h.words, c));
  // Make alone ("Bmw / Tow hook cover") only when the make is ALL that names the
  // car and it is the only one of that make in. "Nissan Ariya" names a model we
  // don't have open, and must not become the one Nissan we do.
  if (!pool.length && h.makes.length && !unknownModelWords(text).length) {
    pool = cars.filter((c) => h.makes.includes(makeOf(c)));
  }
  if (pool.length > 1 && h.year) {
    const y = pool.filter((c) => Number(c.vehicle_year) === h.year);
    if (y.length) pool = y;
  }
  if (pool.length > 1 && h.makes.length) {
    const m = pool.filter((c) => h.makes.includes(makeOf(c)));
    if (m.length) pool = m;
  }
  if (pool.length > 1 && h.colors.length) {
    const want = h.colors.map((k) => ({ blk: 'black', wht: 'white', grey: 'gr', gray: 'gr' }[k] || k));
    const c2 = pool.filter((c) => want.some((k) => String(c.vehicle_color || '').toLowerCase().includes(k)));
    if (c2.length) pool = c2;
  }
  return pool.length === 1 ? pool[0] : null;
}

// Words left over once makes, colours, years, parts, statuses, vendors, dates and
// filler are gone — i.e. what might be a model name we don't recognise.
const FILLER = new Set(['a', 'c', 'an', 'the', 'and', 'or', 'for', 'of', 'to', 'in', 'on', 'at', 'is',
  'it', 'with', 'from', 'left', 'right', 'front', 'rear', 'driver', 'drivers', 'pass', 'passenger',
  'side', 'upper', 'lower', 'both', 'inner', 'outer', 'top', 'bottom', 'today', 'tomorrow', 'now',
  'coming', 'this', 'that', 'car', 'truck', 'van', 'suv', 'new', 'being', 'will', 'i', 'we',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'mon', 'tue',
  'wed', 'thu', 'fri', 'sat', 'sun', 'next', 'week', 'as', 'is', 'no', 'total', 'chrome']);
function unknownModelWords(text) {
  const t = stripVendors(text).replace(new RegExp(PART_RE.source, 'gi'), ' ');
  return words(t).filter((w) => !FILLER.has(w) && !MAKES.has(MAKE_ALIASES[w] || w)
    && !COLORS.has(w) && !/^\d+$/.test(w) && !STATUS_RE.test(w) && !HOLD_RE.test(w)
    && !PART_RE.test(w) && w.length > 1);
}

// Does the text look like it names a car at all? Used to refuse the "nearest VIN
// from the same sender" fallback for model-named posts: Omar types ten of those
// in a row, each for a different car.
export function namesAVehicle(text, cars = []) {
  const h = vehicleHints(text);
  if (h.makes.length || h.year) return true;
  if (cars.some((c) => namesModel(h.words, c))) return true;
  const first = clean(String(text || '').split('\n')[0]);
  const fw = words(first);
  return String(text || '').includes('\n') && fw.length >= 1 && fw.length <= 3
    && !PART_RE.test(first) && !STATUS_RE.test(first) && !HOLD_RE.test(first);
}

// Remove what names the car from a line, leaving the part.
function stripCar(line, car) {
  const kill = new Set([...COLORS, ...MAKES, ...Object.keys(MAKE_ALIASES), ...Object.keys(MODEL_ALIASES)]);
  if (car) for (const n of [...carNames(car), ...words(car.vehicle_model), ...words(car.vehicle_make)]) kill.add(n);
  return ` ${line} `
    .replace(/\b(19[89]\d|20[0-3]\d)\b/g, ' ')
    .replace(/^\s*\d{2}\s+(?=[A-Za-z])/, ' ')
    .replace(/[A-Za-z0-9]+/g, (w) => (kill.has(w.toLowerCase()) ? ' ' : w));
}

function partName(raw) {
  let t = clean(String(raw || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/^[\s\-•*.:]+/, '')
    .replace(/\s*[-–—:.]+\s*$/, '')
    .replace(/\.{2,}.*$/, ''));
  // "Omar ioniq needs a rear left parking sensor", "Still missing the fender
  // liner": the part is what comes after the need.
  const need = t.match(/\b(?:still\s+)?(?:needs?|missing)\s+(?:an?\s+|the\s+|new\s+)*(.+)$/i);
  if (need) t = need[1];
  t = t.replace(/(?:\s+\b(?:part|parts|with|from|for|in|at))+$/i, '');
  // Commas are sentences, not part lists — those use "/".
  if (!t || !PART_RE.test(t) || FAULT_RE.test(t) || /[?,]/.test(t)) return null;
  // A sentence about a part is not a part: "Wheels are hitting calipers".
  if (/\b(is|are|was|were|hitting|looks?|should|would|has|have|had)\b/i.test(t)) return null;
  if (t.length > 70 || t.split(/\s+/).length > 9) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// "headlight ordered 9/14 latest" → name "headlight", slot "ordered 9/14 latest".
const CUT_RE = /\b(ordered|order|being\s+ordered|eta|arriv\w*|parts?\s+in|all\s+parts|delivered|should\s+finish|needs?\s+touch|needs?\s+to\s+be|waiting|confirm|coming|in\s+the\s+back|(?:is|are)\s+in)\b/i;

// ------------------------------------------------------------------ parts

// The parts in one car's worth of text:
//   [{ name, vendor, eta, etaLast, status: 'needed'|'ordered'|'received' }]
export function readParts(text, { car = null, anchor = new Date(), markers = [] } = {}) {
  const orderedMarker = markers.some((m) => /order/i.test(m));
  const receivedMarker = markers.some((m) => /deliver/i.test(m));
  const lines = String(text || '')
    .replace(/^\s*need\s+parts?\s+ordered\s*:?/gim, '')
    .split(/\n|\s{3,}|\.{3,}|\.\s{2,}/)
    .map(clean).filter(Boolean);
  const out = [];
  let pending = [];

  const statusFor = (s, vendor, etas) => {
    if (receivedMarker || RECEIVED_RE.test(s)) return 'received';
    if (ORDERED_RE.test(s) && !NOT_ORDERED_RE.test(s)) return 'ordered';
    if (/\b(calling|need|needs|confirm)\b/i.test(s) || /\?/.test(s)) return 'needed';
    if (orderedMarker || etas.length || vendor) return 'ordered';
    return 'needed';
  };

  for (const line0 of lines) {
    if (FAULT_RE.test(line0) || /\?/.test(line0) || /\b(confirm|talk\s+to\s+me)\b/i.test(line0)) continue;
    const line = clean(stripCar(line0, car));
    const dash = line.match(/^(.*?\S)\s*[-–—]\s+(.*)$/) || line.match(/^(.*?[a-z])\s+[-–—]\s*(\S.*)$/i);
    let lhs = dash ? dash[1] : line;
    let rhs = dash ? dash[2] : '';
    if (!dash) {
      const cut = CUT_RE.exec(line);
      if (cut) { lhs = line.slice(0, cut.index); rhs = line.slice(cut.index); }
    }
    const lhsVendor = vendorOf(lhs);
    const names = stripVendors(lhs).split(/\s*\/\s*/).map(partName).filter(Boolean);

    const slot = names.length ? rhs : line;
    const vendor = vendorOf(slot) || lhsVendor;
    const received = RECEIVED_RE.test(line0);
    let etas = received ? [] : findEtas(slot, anchor);
    if (!etas.length && !received && slot && (dash || rhs || !PART_RE.test(line))) etas = slotEtas(slot, anchor);
    const status = statusFor(line0, vendor, etas);

    if (names.length) {
      const parts = names.map((name) => ({
        name,
        vendor: vendor || null,
        eta: status === 'received' ? null : etas[0]?.date || null,
        etaLast: status !== 'received' && etas.length > 1 ? etas[etas.length - 1].date : null,
        status,
      }));
      out.push(...parts);
      pending = (vendor || etas.length) ? [] : [...pending, ...parts];
    } else if (pending.length && (vendor || etas.length)) {
      // A slot line with no part on it ("Friday - Tuesday Ebay") speaks for the
      // parts listed above it.
      for (const p of pending) {
        p.vendor = p.vendor || vendor || null;
        p.eta = p.eta || etas[0]?.date || null;
        p.etaLast = p.etaLast || (etas.length > 1 ? etas[etas.length - 1].date : null);
        if (p.status === 'needed') p.status = statusFor(line0, vendor, etas);
      }
      pending = [];
    }
  }
  const seen = new Set();
  return out.filter((p) => {
    const k = alnum(p.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ------------------------------------------------------------------ the plan

// What one message says, car by car. Pure.
export function planMessage(text, { anchor = new Date() } = {}) {
  const { tags, markers, body } = stripTags(text);
  const segs = splitByCar(body);
  const anyNote = tags.length > 0 || markers.length > 0 || segs.some((s) => s.text && isStatusNote(s.text));
  const segments = segs.map((s, index) => {
    const t = s.text || '';
    const bare = !words(t).length;
    const received = RECEIVED_RE.test(t) || markers.some((m) => /deliver/i.test(m));
    const ordered = !received && ((ORDERED_RE.test(t) && !NOT_ORDERED_RE.test(t)) || markers.some((m) => /order/i.test(m)));
    let etas = received ? [] : findEtas(t, anchor);
    if (!etas.length && ordered) {
      const after = t.split(/\border(?:ed)?\b/i).slice(1).join(' ');
      etas = slotEtas(after.split(/\b(waiting|needs?)\b/i)[0], anchor);
    }
    const question = /\?/.test(t);
    const signals = {
      note: bare ? anyNote : (isStatusNote(t) || tags.length > 0 || markers.length > 0),
      received,
      ordered,
      progress: PROGRESS_RE.test(t),
      waiting: WAITING_RE.test(t),
      hold: HOLD_RE.test(t) && !question,
      instruction: INSTRUCTION_RE.test(t),
      fault: FAULT_RE.test(t),
      blocker: isFinishBlocker(t),
      partsWord: PART_RE.test(t) && !question,
      question,
      backFrom: BACK_FROM_RE.test(t),
    };
    return { index, vin6: s.vin6, text: t, bare, signals, etas, markers };
  });
  return { tags, markers, text: String(text || ''), segments };
}

// Anything worth writing on a job?
export function isActionable(seg) {
  const s = seg.signals;
  return !!(s.received || s.ordered || s.progress || s.waiting || s.hold || s.instruction
    || s.fault || s.partsWord || seg.etas.length || seg.dest);
}

// ------------------------------------------------------------------ places

// Places a car can be that say LESS than "at a shop": the lot, the road, an
// auction, the mechanic line, nowhere known. A VIN posted in the group may move a
// car from one of these into the body shop. Anything else — Jorge's, Andy's, Tri
// State, pat_jared, whatever vendor slug the next shop gets — is more specific
// than the generic 'body_shop' and is never overwritten by it.
const GENERIC_PLACES = new Set([
  'body_shop', 'front', 'front_lot', 'on_lot', 'gravel', 'gravel_front', 'gravel_front_lot',
  'unknown', 'in_transit', 'wash_line', 'ready_detail', 'arb_section', 'sold_lot', 'sold',
  'mechanic', 'mechanic_section', 'inside_mechanic_shop', 'waiting_on_parts', 'jackson',
  'jackson_confirmed', 'personal', 'seller_group', 'carz_inc', 'test_location',
]);
const AUCTION_RE = /^(manheim|adesa|daa|uax|copart|loveland|__loc)/;
export function isGenericPlace(slug) {
  return !slug || GENERIC_PLACES.has(slug) || AUCTION_RE.test(slug);
}

// Shops a message may SEND a car to: the lot walker's vendor list, Jorge's, and
// every location_keywords code that is not a generic place. Derived, so the next
// shop added to the keywords table is picked up without touching this file.
export function shopSlugs(keywordRows = []) {
  const out = new Set(['jorge', ...WALK_VENDORS.map((v) => v.location)]);
  for (const r of keywordRows || []) {
    if (r?.location_code && !isGenericPlace(r.location_code)) out.add(r.location_code);
  }
  return out;
}

// Which shop a slice of a message sends the car to, via the transport group's own
// keyword matcher (injected — telegram.js owns it). Deliberately narrow: that
// table has "front", "kia", "santa", "pro" and "state" in it, which a parts post
// ("Front bumper", "Kia forte", "Santa Fe", "ProMASTER") trips constantly.
//
//   "Back from tri state"            → back at the body shop (locationCode)
//   "take it to Jorge" / "Pro auto"  → that shop, if it is a shop
export async function destinationFor(db, seg, { matchDestination, shops, locationCode }) {
  if (!matchDestination || !seg.text) return null;
  const s = seg.signals;
  if (s.partsWord || s.received || s.ordered || seg.etas.length || s.question) return null;
  const t = clean(seg.text.replace(/\n/g, ' '));
  const w = words(t);
  if (!w.length || w.length > 12) return null;

  const send = t.match(SEND_TO_RE);
  if (send && !NOT_A_MOVE_RE.test(t)) {
    const slug = await matchDestination(db, send[1]);
    // "take it to Jorge" writes 'jorge' — the more specific of the two names.
    return slug && (shops.has(slug) || isSamePlace(slug, locationCode)) ? slug : null;
  }
  if (s.backFrom && !/\bback\s+to\b/i.test(t)) {
    const q = t.replace(/\b(came|back|from|the|car|is)\b/gi, ' ');
    const slug = words(q).length ? await matchDestination(db, q) : null;
    return slug && (shops.has(slug) || slug === 'front') ? locationCode : null;
  }
  // The whole message is a place: "Andy", "Pro auto". A place that is not a
  // shop ("365938 / Wash line") moves nothing here, but it does mean the VIN
  // was not an arrival, so the caller is told what was named.
  if (w.length <= 2 && !NOT_A_MOVE_RE.test(t)) {
    const slug = await matchDestination(db, t);
    if (slug && !shops.has(slug) && !isSamePlace(slug, locationCode)) seg.namedPlace = slug;
    return slug && shops.has(slug) ? slug : null;
  }
  return null;
}

// ------------------------------------------------------------------ actions

// One car's slice of a message → the writes it implies. Pure, so the backfill
// prints exactly what the webhook would do.
export function actionsFor(seg, car, { plan, messageId, at, binding }) {
  const s = seg.signals;
  const acts = [];
  const base = `bsc:${messageId}:${seg.index ?? 0}`;
  const anchor = new Date(at);

  const parts = readParts(seg.text, { car, anchor, markers: plan.markers });
  // "[Parts Ordered] / Delivery Date 8/31 / … LOWER BUMPER CHROME TRIM": the date
  // sits on its own line, and belongs to the part.
  if (seg.etas.length) {
    for (const p of parts) {
      if (p.status === 'received' || p.eta) continue;
      p.eta = seg.etas[0].date;
      if (seg.etas.length > 1) p.etaLast = seg.etas[seg.etas.length - 1].date;
      if (p.status === 'needed' && (s.ordered || /\beta\b|deliver/i.test(seg.text))) p.status = 'ordered';
    }
  }
  parts.forEach((p, i) => acts.push({ type: 'part', part: p, source_ref: `${base}:part:${i}` }));

  // "364318 altima ordered arrive 9/11" names no part, so it speaks for the
  // parts already on the job.
  if (!parts.length && s.received) acts.push({ type: 'mark_received', source_ref: `${base}:received` });
  else if (!parts.length && s.ordered) {
    acts.push({ type: 'mark_ordered', eta: seg.etas[0]?.date || null, source_ref: `${base}:ordered` });
  }

  const dates = seg.etas.length
    ? seg.etas.map((e) => e.date)
    : parts.filter((p) => p.status !== 'received').flatMap((p) => [p.eta, p.etaLast]).filter(Boolean).sort();
  if (dates.length && !s.received) {
    acts.push({
      type: 'job_eta', soonest: dates[0], latest: dates[dates.length - 1],
      text: clean(seg.text.replace(/\n/g, ' / ')).slice(0, 120), source_ref: `${base}:eta`,
    });
  }
  if (s.hold) acts.push({ type: 'hold', source_ref: `${base}:hold` });
  if (seg.dest) acts.push({ type: 'move', slug: seg.dest, source_ref: `${base}:move` });

  const kinds = [];
  if (parts.length) kinds.push('parts');
  if (s.received) kinds.push('parts_received');
  if (s.ordered) kinds.push('parts_ordered');
  if (s.hold) kinds.push('hold');
  if (seg.dest) kinds.push('moved');
  if (s.progress) kinds.push('progress');
  if (s.waiting) kinds.push('waiting');
  if (s.instruction) kinds.push('instruction');
  if (s.fault) kinds.push('fault');
  if (seg.etas.length) kinds.push('eta');
  if (kinds.length || acts.length) {
    // The note is the message VERBATIM — tags and all — so what the automation
    // did can always be checked against what was actually said.
    acts.unshift({
      type: 'note', kind: kinds[0] || 'note', kinds, note: plan.text, tags: plan.tags,
      binding, source_ref: `${base}:note`,
    });
  }
  return acts;
}

// Record an automated change. True only the FIRST time this source_ref is
// written — what makes every side effect below idempotent.
async function recordEvent(db, row) {
  const { data, error } = await db.from('body_shop_job_events')
    .upsert(row, { onConflict: 'source_ref', ignoreDuplicates: true })
    .select('id');
  if (error) { console.error('body shop event failed', row.source_ref, error.message || error); return false; }
  return !!(data && data.length);
}

// Same part, as typed by two different people: "Ac line" / "a/c line",
// "Front tow cover" / "Front tow hook cover", "Front sensor" / "Chrome front
// passenger grillle sensor". Compared on what the part IS — the side and
// position words, which people drop or reorder freely, are ignored — and one
// name's core must be contained in the other's.
const SIDE_WORDS = new Set(['front', 'rear', 'left', 'right', 'pass', 'passenger', 'driver', 'drivers',
  'side', 'both', 'upper', 'lower', 'inner', 'outer', 'top', 'bottom', 'chrome', 'black', 'grey',
  'gray', 'new', 'the', 'a', 'and', 'for', 'of', 'w', 'with', 'part', 'parts', 'ext', 'outside', 'inside']);
function partCore(name) {
  const t = String(name || '').toLowerCase()
    .replace(/\btail\s+lights?\b|\btailights?\b/g, 'taillight')
    .replace(/\bhead\s+lights?\b/g, 'headlight')
    .replace(/\bfog\s+lights?\b/g, 'foglight')
    .replace(/\ba\/?c\b/g, 'ac')
    .replace(/\bgrill\w*/g, 'grill');
  return words(t).map((w) => (w.length > 3 ? w.replace(/(es|s)$/, '') : w))
    .filter((w) => !SIDE_WORDS.has(w) && !/^\d+$/.test(w));
}
export function samePart(a, b) {
  const x = partCore(a);
  const y = partCore(b);
  if (!x.length || !y.length) return alnum(a) === alnum(b);
  // The last word is what the part IS: a bumper bracket is not a bumper.
  if (x[x.length - 1] !== y[y.length - 1]) return false;
  const within = (p, q) => p.every((w) => q.includes(w));
  return within(x, y) || within(y, x);
}

const RANK = { needed: 0, ordered: 1, received: 2 };

// Write one job's actions.
export async function applyActions(db, car, acts, { messageId, at, vin6, fromId = null }) {
  const done = [];
  const base = {
    job_id: car?.id || null, stock_number: car?.stock_number || null,
    vin6: vin6 || car?.vin6 || null, message_id: messageId, event_at: at, sender: fromId,
  };
  const event = (a, kind, detail = {}, extra = {}) => recordEvent(db, {
    ...base, kind, note: a.note ?? null, tags: a.tags?.length ? a.tags : null,
    detail: { ...detail, ...(a.binding ? { binding: a.binding } : {}) },
    source_ref: a.source_ref, ...extra,
  });

  let jobParts = null;
  const loadParts = async () => {
    if (jobParts) return jobParts;
    const { data } = await db.from('body_shop_parts').select('id, name, status').eq('job_id', car.id);
    jobParts = data || [];
    return jobParts;
  };

  for (const a of acts) {
    if (a.type === 'note') {
      if (await event(a, a.kind, { kinds: a.kinds })) done.push(a);
      continue;
    }
    if (!car?.id) continue;

    if (a.type === 'part') {
      const p = a.part;
      const existing = (await loadParts()).find((x) => samePart(x.name, p.name));
      if (existing) {
        // Already on the card. Move it forward if the message says it moved;
        // never backward, and never a second row for the same bumper.
        if (RANK[p.status] <= RANK[existing.status]) continue;
        if (!(await event(a, `part_${p.status}`, { part_id: existing.id, name: existing.name, eta: p.eta }))) continue;
        const patch = { status: p.status };
        if (p.eta) patch.eta = p.eta;
        if (p.vendor) patch.vendor = p.vendor;
        const { error } = await db.from('body_shop_parts').update(patch).eq('id', existing.id);
        if (error) console.error('chat part update failed', existing.id, error.message || error);
        existing.status = p.status;
        done.push(a);
        continue;
      }
      const row = {
        job_id: car.id, name: p.name, vendor: p.vendor, eta: p.eta, status: p.status,
        source_ref: a.source_ref,
        ordered_at: p.status !== 'needed' ? at : null,
        received_at: p.status === 'received' ? at : null,
      };
      const { data, error } = await db.from('body_shop_parts')
        .upsert(row, { onConflict: 'source_ref', ignoreDuplicates: true }).select('id');
      if (error) console.error('body shop chat part failed', a.source_ref, error.message || error);
      else if (data?.length) { jobParts?.push({ id: data[0].id, name: p.name, status: p.status }); done.push(a); }
    } else if (a.type === 'mark_ordered') {
      if (!(await event(a, 'parts_ordered', { eta: a.eta }))) continue;
      const patch = { status: 'ordered' };
      if (a.eta) patch.eta = a.eta;
      const { error } = await db.from('body_shop_parts').update(patch).eq('job_id', car.id).eq('status', 'needed');
      if (error) console.error('mark ordered failed', car.id, error.message || error);
      done.push(a);
    } else if (a.type === 'mark_received') {
      if (!(await event(a, 'parts_received'))) continue;
      const { error } = await db.from('body_shop_parts').update({ status: 'received' })
        .eq('job_id', car.id).in('status', ['needed', 'ordered']);
      if (error) console.error('mark received failed', car.id, error.message || error);
      done.push(a);
    } else if (a.type === 'job_eta') {
      // The board's ETA is read out of the manager's own notes. A date he typed
      // wins; a chat date only fills an empty slot or replaces an older chat
      // date. parts_eta_key is set to the fingerprint of the notes as they stand,
      // so the board's re-read leaves it alone until somebody edits the notes.
      if (car.status === 'done') continue;
      if (car.parts_eta && !String(car.parts_eta_text || '').startsWith('Telegram')) continue;
      if (!(await event(a, 'eta', { soonest: a.soonest, latest: a.latest }))) continue;
      const { error } = await db.from('body_shop_jobs').update({
        parts_eta: a.soonest,
        parts_eta_last: a.latest !== a.soonest ? a.latest : null,
        parts_eta_text: `Telegram: ${a.text}`.slice(0, 200),
        parts_eta_key: notesKey(car.notes),
      }).eq('id', car.id).neq('status', 'done');
      if (error) console.error('chat eta failed', car.id, error.message || error);
      done.push(a);
    } else if (a.type === 'hold') {
      if (car.status === 'done' || car.status === 'on_hold') continue;
      if (!(await event(a, 'hold'))) continue;
      const { error } = await db.from('body_shop_jobs')
        .update({ status: 'on_hold', held_at: at }).eq('id', car.id).not('status', 'in', '(done,on_hold)');
      if (error) console.error('chat hold failed', car.id, error.message || error);
      done.push(a);
    } else if (a.type === 'move') {
      const v = vin6 || car.vin6;
      if (!v) continue;
      // "take it to Jorge" about a car already at Jorge's is not a move, and
      // writing 'body_shop' over 'jorge' is exactly the re-stamp this file ends.
      const here = await currentPlace(db, v);
      if (here && isSamePlace(here, a.slug)) continue;
      if (!(await event(a, 'moved', { to: a.slug, from: here }))) continue;
      await updateLocation(db, v, a.slug, at);
      done.push(a);
    }
  }
  return done;
}

// ------------------------------------------------------------------ loading

// Body-shop jobs with the car's name on them. Named, non-cost columns only —
// never select('*') on inventory.
export async function loadJobCars(db, { at = null, jobIds = null } = {}) {
  let q = db.from('body_shop_jobs')
    .select('id, stock_number, vin6, status, entered_at, completed_at, parts_eta, parts_eta_text, notes');
  if (jobIds) q = q.in('id', jobIds);
  else q = q.or(`completed_at.is.null,completed_at.gte."${at || new Date().toISOString()}"`);
  const { data: jobs, error } = await q.limit(1000);
  if (error) { console.error('body shop jobs load failed', error.message || error); return []; }
  const stocks = [...new Set((jobs || []).map((j) => j.stock_number).filter(Boolean))];
  const inv = new Map();
  for (let i = 0; i < stocks.length; i += 200) {
    const { data } = await db.from('inventory')
      .select('stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_color')
      .in('stock_number', stocks.slice(i, i + 200));
    for (const r of data || []) inv.set(r.stock_number, r);
  }
  return (jobs || []).map((j) => ({ ...(inv.get(j.stock_number) || {}), ...j }));
}

// The jobs that were open at `at`. A job opened by a VIN a minute after a parts
// post still counts — the post is usually what prompted it.
export function openAt(cars, at) {
  const t = new Date(at).getTime();
  return (cars || []).filter((c) => new Date(c.entered_at).getTime() <= t + 10 * 60 * 1000
    && (!c.completed_at || new Date(c.completed_at).getTime() >= t));
}

// The job a VIN means, among the open ones — the 5-character slip included.
export function carForVin(vin6, cars, text = '') {
  if (!vin6) return null;
  const v = vin6.toUpperCase();
  const exact = (cars || []).filter((c) => String(c.vin6 || '').toUpperCase() === v);
  if (exact.length) return exact.sort((a, b) => String(b.entered_at).localeCompare(String(a.entered_at)))[0];
  const short = shortTokens(text).find((s) => s.vin6 === v);
  if (short) {
    const hit = (cars || []).filter((c) => String(c.vin6 || '').toUpperCase().endsWith(short.raw));
    if (hit.length === 1) return hit[0];
  }
  return null;
}

// "78419" matched no car as "078419". If exactly one open body-shop job ends in
// those five characters, that is the car that was meant. Returns the corrected
// list, in order.
//
// Returns a Map of what parse.js read → the VIN meant; unchanged VINs map to
// themselves.
export async function correctShortVins(db, text, vins, cars) {
  const shorts = shortTokens(text);
  const out = new Map();
  for (const v of vins) {
    out.set(v, v);
    if (!shorts.some((x) => x.vin6 === v)) continue;
    const { data: rows } = await db.rpc('lookup_vin_by_last6', { last6: v });
    const hit = Array.isArray(rows) ? rows[0] : rows;
    if (hit?.stock_number) continue;
    const car = carForVin(v, cars, text);
    if (car?.vin6) out.set(v, String(car.vin6).toUpperCase());
  }
  return out;
}

async function currentPlace(db, vin6) {
  const { data: rows } = await db.rpc('lookup_vin_by_last6', { last6: vin6 });
  const v = Array.isArray(rows) ? rows[0] : rows;
  if (!v?.stock_number) return null;
  const { data: loc } = await db.from('vehicle_locations')
    .select('physical_location').eq('stock_number', v.stock_number).maybeSingle();
  return loc?.physical_location || null;
}

async function keywordRows(db) {
  const { data } = await db.from('location_keywords').select('location_code');
  return data || [];
}

// Should a VIN posted in the group move the car into the body shop? Not when the
// message is a report about the car, and never over a place more specific than
// "body shop" — unless the words say it came BACK ("330897 / Back tri state").
export async function shouldMoveIn(db, vin6, seg, { locationCode }) {
  if (seg.dest && !isSamePlace(seg.dest, locationCode)) return { move: false, why: `names ${seg.dest}` };
  if (seg.namedPlace) return { move: false, why: `names ${seg.namedPlace}` };
  if (seg.signals.note && !seg.signals.backFrom) return { move: false, why: 'status note' };
  const here = await currentPlace(db, vin6);
  if (here && isSamePlace(here, locationCode)) return { move: false, why: `already at ${here}` };
  if (!isGenericPlace(here) && !seg.signals.backFrom) return { move: false, why: `at ${here}` };
  return { move: true };
}

// The last car this sender TYPED in the group, within `mins` before `at`.
async function senderNearestVin(db, fromId, at, mins = 15) {
  if (!fromId) return null;
  const from = new Date(new Date(at).getTime() - mins * 60 * 1000).toISOString();
  const { data } = await db.from('wa_inbound_messages')
    .select('vin6, body, received_at')
    .eq('station', 'body_shop').eq('wa_from', fromId)
    .not('vin6', 'is', null).gte('received_at', from).lte('received_at', at)
    .order('received_at', { ascending: false }).limit(20);
  const row = (data || []).find((r) => r.body && extractAllVin6(r.body).includes(String(r.vin6).toUpperCase()));
  return row ? String(row.vin6).toUpperCase() : null;
}

async function markRead(db, messageId, { vin6 = null, jobId = null, binding = null }) {
  const { error } = await db.from('body_shop_chat_reads')
    .upsert({ message_id: messageId, vin6, job_id: jobId, binding }, { onConflict: 'message_id', ignoreDuplicates: true });
  if (error) console.error('body_shop_chat_reads failed', messageId, error.message || error);
}

// ------------------------------------------------------------------ capture

// Read one body_shop message and write what it says onto the right job(s).
//
//   vins          the VINs parse.js found (already short-VIN corrected)
//   replyVin      the VIN of the message this one replies to, when it does
//   cars          preloaded jobs (backfill); loaded when omitted
//   dryRun        compute and return the plan, write nothing
//   forceCar      bind a VIN-less message to this job (the sweep)
//
// Returns { segments: [{ vin6, car, binding, actions, move? }], unbound, actionable }.
export async function captureBodyShopMessage(db, {
  text, messageId, fromId = null, at, vins = [], replyVin = null, locationCode = 'body_shop',
  matchDestination = null, cars = null, keywords = null, dryRun = false, forceCar = null,
  resolveSender = null, fixes = null, laterJobMs = 0,
}) {
  const plan = planMessage(text, { anchor: new Date(at) });
  const allCars = cars || await loadJobCars(db, { at });
  const open = openAt(allCars, at);
  const shops = shopSlugs(keywords || await keywordRows(db));
  const result = { messageId, plan, segments: [], unbound: false, actionable: false };

  for (const seg of plan.segments) {
    // parse.js padded a short VIN that correctShortVins has since fixed.
    if (seg.vin6 && fixes?.get(seg.vin6)) seg.vin6 = fixes.get(seg.vin6);
    else if (seg.vin6 && vins.length && !vins.includes(seg.vin6)) {
      const fixed = carForVin(seg.vin6, open, text);
      if (fixed?.vin6) seg.vin6 = String(fixed.vin6).toUpperCase();
    }
    seg.dest = await destinationFor(db, seg, { matchDestination, shops, locationCode });
    if (!isActionable(seg)) { result.segments.push({ vin6: seg.vin6, seg, car: null, actions: [] }); continue; }
    result.actionable = true;

    let car = null;
    let binding = null;
    if (seg.vin6) {
      car = carForVin(seg.vin6, open, text);
      binding = 'vin';
      // Replaying history: the job this VIN would have opened at the time may
      // have been opened later, by hand or by a later post.
      if (!car && laterJobMs) {
        const t = new Date(at).getTime();
        car = carForVin(seg.vin6, allCars.filter((c) => {
          const e = new Date(c.entered_at).getTime();
          return e > t && e <= t + laterJobMs;
        }), text);
      }
    } else if (forceCar) {
      car = forceCar; binding = 'next_vin';
    } else {
      if (replyVin) { car = carForVin(replyVin, open); binding = car ? 'reply' : null; }
      if (!car) { car = matchCarByName(seg.text, open); binding = car ? 'model' : null; }
      if (!car && !namesAVehicle(seg.text, open)) {
        const v = resolveSender ? await resolveSender(fromId, at) : await senderNearestVin(db, fromId, at);
        car = v ? carForVin(v, open) : null;
        binding = car ? 'sender' : null;
      }
    }

    if (!seg.vin6 && !car) {
      result.unbound = true;
      result.segments.push({ vin6: null, seg, car: null, actions: [] });
      continue;
    }
    const actions = actionsFor(seg, car, { plan, messageId, at, binding });
    const entry = { vin6: seg.vin6 || car?.vin6 || null, seg, car, binding, actions };
    result.segments.push(entry);
    if (!dryRun) {
      entry.done = await applyActions(db, car, actions, { messageId, at, vin6: entry.vin6, fromId });
    }
  }

  if (!dryRun && result.actionable && !result.unbound) {
    const first = result.segments.find((s) => s.car);
    await markRead(db, messageId, { vin6: first?.vin6 || null, jobId: first?.car?.id || null, binding: first?.binding || null });
  }
  return result;
}

// A VIN just landed in the group. Anything said in the last two hours that had
// no car to go to gets one more chance — but only on evidence:
//   * a post that names a car ("Silverado mirror eta 8/21") goes to this VIN
//     only if this VIN IS that car;
//   * a post that names none ("Back to George", "Ordered 9/18") goes to this
//     VIN only if the same person sent both, within 15 minutes.
// Everything else stays unbound — visible in the chat log, written nowhere.
export async function sweepUnboundBodyShopChat(db, {
  vin6, fromId, at, locationCode = 'body_shop', matchDestination = null, dryRun = false,
  rows = null, cars = null, keywords = null, reads = null, excludeId = null,
}) {
  if (!vin6) return [];
  const since = new Date(new Date(at).getTime() - 120 * 60 * 1000).toISOString();
  let backlog = rows;
  if (!backlog) {
    const { data } = await db.from('wa_inbound_messages')
      .select('message_id, body, wa_from, received_at, vin6')
      .eq('station', 'body_shop').is('vin6', null)
      .gte('received_at', since).lt('received_at', at)
      .not('body', 'is', null).neq('body', '')
      .order('received_at', { ascending: true }).limit(30);
    backlog = data || [];
  }
  if (!backlog.length) return [];

  let readSet = reads;
  if (!readSet) {
    const { data } = await db.from('body_shop_chat_reads')
      .select('message_id').in('message_id', backlog.map((r) => r.message_id));
    readSet = new Set((data || []).map((r) => r.message_id));
  }

  const allCars = cars || await loadJobCars(db, { at });
  const kw = keywords || await keywordRows(db);
  const out = [];
  for (const r of backlog) {
    if (readSet.has(r.message_id) || r.message_id === excludeId) continue;
    // A message with its own VIN is not waiting for one (it may simply not have
    // been filed yet — its webhook is still running).
    if (extractAllVin6(r.body).length) continue;
    const plan = planMessage(r.body, { anchor: new Date(r.received_at) });
    if (!plan.segments.some((s) => isActionable(s) || /\b(back|take|send|put|park)\b/i.test(s.text))) continue;
    const open = openAt(allCars, r.received_at);
    const car = carForVin(vin6, openAt(allCars, at)) || carForVin(vin6, open);
    if (!car) continue;
    const named = namesAVehicle(r.body, open);
    const near = new Date(at).getTime() - new Date(r.received_at).getTime() <= 15 * 60 * 1000;
    const ok = named ? !!matchCarByName(r.body, [car]) : (r.wa_from === fromId && near);
    if (!ok) continue;
    const res = await captureBodyShopMessage(db, {
      text: r.body, messageId: r.message_id, fromId: r.wa_from, at: r.received_at,
      locationCode, matchDestination, cars: allCars, keywords: kw, dryRun, forceCar: car,
    });
    out.push(res);
  }
  return out;
}

// ------------------------------------------------------------------ body_shop_out

// A body_shop_out message, car by car: which cars are finished and which are
// "still missing the fender liner" and must stay open. Pure.
export function planFinish(text, vins) {
  const { body } = stripTags(text);
  const segs = splitByCar(body);
  const anyBlock = segs.some((s) => s.text && isFinishBlocker(s.text));
  const finish = [];
  const blocked = [];
  for (const s of segs) {
    if (!s.vin6) continue;
    const v = vins.includes(s.vin6) ? s.vin6 : null;
    if (!v) continue;
    const bare = !words(s.text).length;
    if (isFinishBlocker(s.text) || (bare && anyBlock)) blocked.push({ vin6: v, text: s.text });
    else finish.push(v);
  }
  // Any VIN the segmenter didn't see (it shouldn't happen) finishes as before.
  for (const v of vins) if (!finish.includes(v) && !blocked.some((b) => b.vin6 === v)) finish.push(v);
  return { finish, blocked };
}

// Save a "not done yet" line as a note on the job instead of finishing it.
export async function recordFinishBlocked(db, { vin6, text, messageId, at, fromId = null, cars = null, dryRun = false }) {
  const open = openAt(cars || await loadJobCars(db, { at }), at);
  const car = carForVin(vin6, open, text);
  const row = {
    job_id: car?.id || null, stock_number: car?.stock_number || null, vin6: car?.vin6 || vin6,
    kind: 'finish_blocked', note: text, detail: { station: 'body_shop_out' },
    source_ref: `bso:${messageId}:${vin6}:blocked`, message_id: messageId, event_at: at, sender: fromId,
  };
  if (dryRun) return { car, row };
  await recordEvent(db, row);
  return { car, row };
}

// ------------------------------------------------------------------ entry points

// Everything the webhook does with a body_shop group message, in order:
//   1. read which cars it names (a 5-character slip corrected against the shop);
//   2. move each into the body shop — unless it is a report, names another
//      place, or the car is somewhere more specific already;
//   3. open a job for each (ensureJob — idempotent, owned by telegram.js);
//   4. write what the words say onto the job(s);
//   5. let a VIN claim what was said before it.
// Returns the corrected VINs, which is what the message row is filed under.
export async function handleBodyShopGroupMessage(db, {
  text, messageId, fromId, at, vins = [], replyVin = null, locationCode = null,
  matchDestination = null, ensureJob = async () => {},
}) {
  // A captionless photo — most of this group's traffic, forty at a time — has
  // nothing to read. Don't load the shop for it.
  if (!String(text || '').trim() && !vins.length) return { vins: [], moves: [], capture: null };
  const kw = await keywordRows(db);
  let cars = await loadJobCars(db, { at });
  const fixes = vins.length ? await correctShortVins(db, text, vins, openAt(cars, at)) : new Map();
  const fixed = [...new Set(vins.map((v) => fixes.get(v) || v))];
  const moves = [];

  if (fixed.length) {
    const plan = planMessage(text, { anchor: new Date(at) });
    const shops = shopSlugs(kw);
    for (const seg of plan.segments) {
      if (!seg.vin6) continue;
      const v = fixes.get(seg.vin6) || seg.vin6;
      seg.dest = await destinationFor(db, seg, { matchDestination, shops, locationCode });
      const d = locationCode ? await shouldMoveIn(db, v, seg, { locationCode }) : { move: false, why: 'no location' };
      // "003610 / At Jorge Redo" is filed under 'jorge', not the generic slug.
      if (d.move) await updateLocation(db, v, seg.dest && isSamePlace(seg.dest, locationCode) ? seg.dest : locationCode, at);
      else console.log(`body shop: not moving ${v} — ${d.why}`);
      moves.push({ vin6: v, ...d });
    }
    for (const v of fixed) await ensureJob(v);
    cars = await loadJobCars(db, { at });
  }

  if (!String(text || '').trim()) return { vins: fixed, moves, capture: null };
  const capture = await captureBodyShopMessage(db, {
    text, messageId, fromId, at, vins: fixed, replyVin, locationCode: locationCode || 'body_shop',
    matchDestination, cars, keywords: kw, fixes,
  });
  if (fixed.length) {
    await sweepUnboundBodyShopChat(db, {
      vin6: fixed[0], fromId, at, locationCode: locationCode || 'body_shop', matchDestination,
      cars, keywords: kw, excludeId: messageId,
    });
  }
  return { vins: fixed, moves, capture };
}

// body_shop_out: which cars are finished and which are "still missing the fender
// liner". The finishing itself stays with the caller (finishCar).
export async function handleBodyShopOutMessage(db, { text, messageId, fromId, at, vins, dryRun = false, cars = null }) {
  const all = cars || await loadJobCars(db, { at });
  const open = openAt(all, at);
  const fixes = await correctShortVins(db, text, vins, open);
  const fixed = [...new Set(vins.map((v) => fixes.get(v) || v))];
  const { finish, blocked } = planFinish(text, vins);
  const out = { vins: fixed, finish: [...new Set(finish.map((v) => fixes.get(v) || v))], blocked: [] };
  for (const b of blocked) {
    const v = fixes.get(b.vin6) || b.vin6;
    const r = await recordFinishBlocked(db, { vin6: v, text, messageId, at, fromId, cars: all, dryRun });
    out.blocked.push({ vin6: v, car: r.car, text: b.text });
  }
  return out;
}
