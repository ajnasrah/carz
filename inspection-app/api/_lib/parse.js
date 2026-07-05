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

// Pull VIN-ish tokens out of free text. We accept a 5–7 char stock/last-6 OR a
// 15–17 char full VIN pasted whole (the team increasingly drops the full VIN,
// e.g. from a run list). A bare `{5,7}` never matched a 17-char run — the word
// boundaries can't land inside it — so full VINs were silently dropped. We skip
// the 8–14 char middle band so phone/order numbers don't masquerade as VINs.
function vinCandidates(text) {
  const tokens = text.toUpperCase().match(/\b[A-Z0-9]{5,17}\b/g) || [];
  return tokens.filter((t) => t.length <= 7 || t.length >= 15);
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

// Parse a seller/ready intake message into a vehicle entry, or null.
// Structured form first (VIN \n miles \n condition \n tire \n notes), then a
// conversational fallback.
export function parseVehicleEntry(text) {
  if (!text) return null;
  const lines = text.trim().split('\n');

  if (lines.length >= 3) {
    const first = lines[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (/^[A-Z0-9]{5,7}$/.test(first) && /\d/.test(first) && !EXCLUDE_WORDS.has(first)) {
      const vin6 = normalizeVin6(first);

      // Accept a decimal odometer ("81263.1") — use the whole-number part.
      const milesM = lines[1]?.replace(/,/g, '').trim().match(/^(\d{3,6})(?:\.\d+)?$/);
      if (!milesM) return null;
      const miles = parseInt(milesM[1], 10);

      const condition = lines[2]?.trim() || 'Unknown';
      let tire_condition = '';
      if (lines[3]) {
        const tm = lines[3].match(/(\d+(?:\.\d+)?)/);
        if (tm) tire_condition = parseFloat(tm[1]);
      }
      const notes = lines.slice(4).join(' ').slice(0, 100);
      return { vin6, miles, condition, tire_condition, notes };
    }
  }

  const vin6 = extractVin6(text);
  if (!vin6) return null;

  let miles = 0;
  for (const re of [
    /(\d{1,3},?\d{3})\s*(?:mi|miles|mileage)/i,
    /(?:mileage|miles|mi)[:=\s]+(\d{1,3},?\d{3})/i,
    /\b(\d{4,6})\s*(?:mi|miles)\b/i,
  ]) {
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      if (n >= 1000 && n <= 999999) { miles = n; break; }
    }
  }

  let condition = 'Unknown';
  if (/\b(good|excellent|great|clean)\b/i.test(text)) condition = 'Good';
  else if (/\b(okay|ok|fair|average)\b/i.test(text)) condition = 'Fair';
  else if (/\b(bad|poor|rough|damage)\b/i.test(text)) condition = 'Poor';

  let tire_condition = '';
  const tm = text.match(/tire[s]?\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  if (tm) tire_condition = parseFloat(tm[1]);

  return { vin6, miles, condition, tire_condition, notes: text.slice(0, 100) };
}
