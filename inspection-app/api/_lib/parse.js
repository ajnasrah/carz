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

      const condition = lines[2]?.trim() || 'Unknown';
      let tire_condition = '';
      if (lines[3]) {
        const tm = lines[3].match(/(\d+(?:\.\d+)?)/);
        if (tm) tire_condition = parseFloat(tm[1]);
      }
      const notes = lines.slice(4).join(' ').slice(0, 100);
      const entry = { vin6, condition, tire_condition, notes };
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

  const entry = { vin6, condition, tire_condition, notes: text.slice(0, 100) };
  if (miles != null) entry.miles = miles;
  return entry;
}
