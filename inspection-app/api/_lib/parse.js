// Channel-agnostic parsing helpers for inbound intake messages.
// VIN-last-6 extraction + vehicle-entry parsing, shared by the messaging
// webhooks (currently Telegram). No channel/transport-specific code here.

// Words that look like a VIN-last-6 (5-7 alnum w/ a digit) but aren't.
const EXCLUDE_WORDS = new Set([
  'DETAIL', 'PEELED', 'CLOSED', 'TRYING', 'WORKS', 'BRING', 'OSAMA', 'JORGE',
  'TODAY', 'PLEASE', 'BUMPER', 'PAINT', 'DOESNT', 'TOUCH', 'FINISH', 'ALREADY',
  'PULLED', 'PHOTOS', 'BLACK', 'AYHAM', 'GLUED', 'LISTED', 'READY', 'FRONT',
]);

// Normalize to the canonical VIN last-6. The team always right-aligns to the
// VIN's LAST digit, so take the rightmost 6. Shorter gets left-padded; a full
// 17-char VIN pasted in resolves to its correct last 6.
function normalizeVin6(raw) {
  const v = raw.toUpperCase();
  return v.length >= 6 ? v.slice(-6) : v.padStart(6, '0');
}

// Pull VIN-ish tokens out of free text. The team sends a car's VIN three ways:
// last 6, last 8, or the whole 17-char VIN (e.g. pasted from a run list). So we
// accept 5–8 char fragments OR 15–17 char full VINs. We still skip the 9–14 char
// middle band so phone/order numbers don't masquerade as VINs. (normalizeVin6
// right-aligns any of these to the canonical last 6.)
function vinCandidates(text) {
  const tokens = text.toUpperCase().match(/\b[A-Z0-9]{5,17}\b/g) || [];
  return tokens.filter((t) => t.length <= 8 || t.length >= 15);
}

// Find the first plausible VIN-last-6 anywhere in free text.
export function extractVin6(text) {
  if (!text) return null;
  for (const cand of vinCandidates(text)) {
    if (!/\d/.test(cand)) continue;
    if (EXCLUDE_WORDS.has(cand)) continue;
    return normalizeVin6(cand);
  }
  return null;
}

// Extract EVERY plausible VIN-last-6 (one message, many cars).
export function extractAllVin6(text) {
  if (!text) return [];
  const out = [], seen = new Set();
  for (const cand of vinCandidates(text)) {
    if (!/\d/.test(cand) || EXCLUDE_WORDS.has(cand)) continue;
    const v = normalizeVin6(cand);
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

// Parse a single mileage token/line into an integer, or null if it isn't
// miles-shaped. Tolerant of the ways the team actually types odometers:
// commas ("81,263"), a decimal odometer ("81263.1"), a "k" shorthand
// ("125k" -> 125000), and a trailing mi/miles/mileage unit. 7-digit odometers
// are accepted too (the old /^\d{3,6}$/ rule silently dropped those).
export function parseMilesToken(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/,/g, '').trim();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(k)?\s*(?:mi|miles|mileage)?\.?$/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2]) n *= 1000; // "125k" -> 125000
  n = Math.round(n);
  return n >= 100 && n <= 1500000 ? n : null;
}

// Find a mileage anywhere in free text, but ONLY when it's explicitly tagged
// with a mi/miles/mileage keyword — so we never mistake a tire score, year, or
// condition number for the odometer.
export function scanMilesKeyworded(text) {
  if (!text) return null;
  for (const re of [
    /(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:mi|miles|mileage)\b/i,
    /(?:mileage|miles|mi)[:=\s]+(\d[\d,]*(?:\.\d+)?)\s*(k)?/i,
  ]) {
    const m = text.match(re);
    if (m) {
      let n = parseFloat(m[1].replace(/,/g, ''));
      if (m[2]) n *= 1000;
      n = Math.round(n);
      if (n >= 100 && n <= 1500000) return n;
    }
  }
  return null;
}

// A condition grade as the team writes it: "9/10", "9.5/10", "10/10", or a bare
// number up to 10. Deliberately not "73128" — the odometer is a number too.
function looksLikeGrade(line) {
  const s = String(line || '').trim();
  if (/^\d{1,2}(\.\d+)?\s*\/\s*10\b/.test(s)) return true;
  return /^\d{1,2}(\.\d+)?$/.test(s) && parseFloat(s) <= 10;
}
function mentionsTires(line) {
  return /\btire?s?\b/i.test(String(line || ''));
}

// Lines 3 and 4 hold the grade and the tires, in either order, and sometimes
// only one of them is there at all. Return which is which, plus the line the
// damage notes start on — reading positionally is what filed "Tires Good on
// Rear Front Poor" as the condition and 9 as the tire score.
function readGradeAndTires(lines) {
  const a = (lines[2] || '').trim();
  const b = (lines[3] || '').trim();

  if (mentionsTires(a) && !mentionsTires(b)) {
    // Tires first. The grade is line 4 only if it actually reads as one —
    // otherwise line 4 is already the damage text.
    return looksLikeGrade(b)
      ? { condition: b, tires: a, notesFrom: 4 }
      : { condition: 'Unknown', tires: a, notesFrom: 3 };
  }
  if (mentionsTires(b)) return { condition: a || 'Unknown', tires: b, notesFrom: 4 };

  // Neither names tires. Keep the original convention (grade, then tires), but
  // don't swallow line 4 into the tire score when it's plainly the damage text.
  const bIsShort = b && b.split(/\s+/).length <= 4;
  return { condition: a || 'Unknown', tires: bIsShort ? b : '', notesFrom: bIsShort ? 4 : 3 };
}

// Parse a seller/ready intake message into a vehicle entry, or null.
// Structured form first (VIN \n miles \n condition \n tire \n notes), then a
// conversational fallback. Miles is OPTIONAL: when we can't read a clean
// odometer we still return the entry (VIN/condition/photos stay intact) and
// simply omit the `miles` key — dropping the whole car over a malformed miles
// line was leaving matched cars with a blank SmartAuction odometer.
export function parseVehicleEntry(text) {
  if (!text) return null;
  const lines = text.trim().split('\n');

  if (lines.length >= 3) {
    const first = lines[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (/^[A-Z0-9]{5,7}$/.test(first) && /\d/.test(first) && !EXCLUDE_WORDS.has(first)) {
      const vin6 = normalizeVin6(first);

      // Miles convention is line 2, but be tolerant of commas/decimals/"k"/units
      // and 7-digit odometers. If line 2 isn't miles-shaped, look for a
      // keyword-tagged value elsewhere. Still nothing? Keep the entry without a
      // `miles` key rather than dropping the whole car.
      const miles = parseMilesToken(lines[1]) ?? scanMilesKeyworded(text);

      // Lines 3 and 4 are the grade and the tires — in whichever order the
      // writer felt like. Both orders are in the group every day:
      //
      //   139156 / 73128 / Tires Good on Rear Front Poor / 9/10 / <damage>
      //   L14640 / 99281 / 8/10 / Tires Good / <damage>
      //
      // Reading them positionally filed "Tires Good on Rear Front Poor" as the
      // condition grade and 9 as the tire score. So identify them by shape
      // instead: the grade is the one that looks like a grade.
      const { condition, tires, notesFrom } = readGradeAndTires(lines);
      const tm = String(tires).match(/(\d+(?:\.\d+)?)/);
      const tire_condition = tm ? parseFloat(tm[1]) : '';
      const notes = lines.slice(notesFrom).join(' ').trim();
      const entry = { vin6, condition, tires, tire_condition, notes };
      if (miles != null) entry.miles = miles;
      return entry;
    }
  }

  const vin6 = extractVin6(text);
  if (!vin6) return null;

  // Only accept a keyword-tagged mileage here (free text is noisy). Omit the
  // key entirely when nothing matches — never default to 0, which would clobber
  // a real reading from another message in ready_to_sell_queue().
  const miles = scanMilesKeyworded(text);

  let condition = 'Unknown';
  if (/\b(good|excellent|great|clean)\b/i.test(text)) condition = 'Good';
  else if (/\b(okay|ok|fair|average)\b/i.test(text)) condition = 'Fair';
  else if (/\b(bad|poor|rough|damage)\b/i.test(text)) condition = 'Poor';

  let tire_condition = '';
  const tm = text.match(/tire[s]?\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  if (tm) tire_condition = parseFloat(tm[1]);

  // The whole message, not the first hundred characters of it. This slice was
  // amputating the damage report the guys type — every note in the queue came
  // back exactly 100 chars long, cut mid-word ("...Scratch o", "...and fr").
  // The damage autofill reads this field, so it has to arrive intact.
  const entry = { vin6, condition, tire_condition, notes: text.trim().slice(0, 2000) };
  if (miles != null) entry.miles = miles;
  return entry;
}
