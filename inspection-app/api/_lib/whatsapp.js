// Shared helpers for the WhatsApp Cloud API webhook.
// EDGE-SAFE: no Node Buffer / node:crypto — uses Web Crypto + fetch only.
// (Files/dirs under /api starting with "_" are not routed by Vercel.)

export const GRAPH_VERSION = 'v21.0';
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

// Words that look like a VIN-last-6 (5-7 alnum w/ a digit) but aren't.
// Ported from scrapers/whatsapp_server.py exclude lists.
const EXCLUDE_WORDS = new Set([
  'DETAIL', 'PEELED', 'CLOSED', 'TRYING', 'WORKS', 'BRING', 'OSAMA', 'JORGE',
  'TODAY', 'PLEASE', 'BUMPER', 'PAINT', 'DOESNT', 'TOUCH', 'FINISH', 'ALREADY',
  'PULLED', 'PHOTOS', 'BLACK', 'AYHAM', 'GLUED', 'LISTED', 'READY', 'FRONT',
]);

// ---- Signature verification (Meta X-Hub-Signature-256) ----------------------

const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time string compare.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// rawBody must be the EXACT bytes Meta sent (request.text()). Returns bool.
export async function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !appSecret) return false;
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const expected = 'sha256=' + toHex(sig);
  return timingSafeEqual(expected, signatureHeader);
}

// ---- VIN helpers ------------------------------------------------------------

// Normalize to the canonical VIN last-6. The team always right-aligns to the
// VIN's LAST digit (the final char of what they type = the VIN's last digit),
// so take the rightmost 6. Anything shorter gets left-padded (dropped leading
// zeros). This also handles a full 17-char VIN pasted in — last 6 is correct.
function normalizeVin6(raw) {
  const v = raw.toUpperCase();
  return v.length >= 6 ? v.slice(-6) : v.padStart(6, '0');
}

// Find a plausible VIN-last-6 anywhere in free text (for location stations).
// Scans every 5-7 char token in reading order and returns the first that has a
// digit and isn't an excluded word — so a leading word like "detail" or
// "photos" before the VIN doesn't cause a miss.
export function extractVin6(text) {
  if (!text) return null;
  const tokens = text.toUpperCase().match(/\b[A-Z0-9]{5,7}\b/g) || [];
  for (const cand of tokens) {
    if (!/\d/.test(cand)) continue;            // must contain a digit
    if (EXCLUDE_WORDS.has(cand)) continue;
    return normalizeVin6(cand);
  }
  return null;
}

// Parse a seller/ready intake message into a vehicle entry, or null.
// Ported from parse_vehicle_entry() in whatsapp_server.py (structured first,
// then conversational fallback).
export function parseVehicleEntry(text) {
  if (!text) return null;
  const lines = text.trim().split('\n');

  // --- Structured: VIN \n miles \n condition \n tire \n notes ---
  if (lines.length >= 3) {
    const first = lines[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (/^[A-Z0-9]{5,7}$/.test(first) && /\d/.test(first) && !EXCLUDE_WORDS.has(first)) {
      const vin6 = normalizeVin6(first);

      // Second line must be a pure number (miles), else not a vehicle entry.
      const milesM = lines[1]?.replace(/,/g, '').trim().match(/^(\d{3,6})$/);
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

  // --- Conversational fallback ---
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

// ---- Graph media download ---------------------------------------------------

const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};
export function extFor(mime) { return MIME_EXT[(mime || '').toLowerCase()] || 'jpg'; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Two-step download: media_id -> short-lived URL -> bytes. Both require the token.
// Retries transient failures; the media URL expires in ~5 min so we re-fetch
// the meta (fresh URL) on each attempt rather than reusing a stale one.
export async function downloadMedia(mediaId, token, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!metaRes.ok) throw new Error(`media meta ${metaRes.status}`);
      const meta = await metaRes.json();
      if (!meta.url) throw new Error('media url missing');

      const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
      if (!binRes.ok) throw new Error(`media bin ${binRes.status}`);
      const buf = await binRes.arrayBuffer();
      const mime = meta.mime_type || binRes.headers.get('content-type') || 'image/jpeg';
      return { buf, mime };
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(400 * (i + 1));
    }
  }
  throw lastErr;
}
