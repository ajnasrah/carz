// Read the damage line the lot tech typed in the Ready-to-Sell group and hand
// back SmartAuction damage rows.
//
//   POST /api/parse-damages
//   x-listing-secret: <LISTING_UPLOAD_SECRET>
//   { "vin": "627672" }            → the newest ready/seller message for that car
//   { "vin": "627672", "refresh": true }  → re-read it, ignoring the cache
//   { "text": "Scratch on ..." }   → parse this text, no cache (for trying wording)
//
//   → { vin6, damages: [{ panel, type, description }],
//       tires: { corners: { lf, rf, lr, rr } } | null, text, cached, model }
//
// The extension holds the anon key, and anon cannot read wa_inbound_messages
// (RLS) or spend the Anthropic key. So the read and the model call both happen
// here, behind the same x-listing-secret the photo upload already uses — the
// extension has that saved in Settings, so there is no new key to hand out.
//
// CACHED PER CAR, KEYED ON THE TEXT. Opening the popup should not re-bill a
// parse of a message that hasn't changed; re-shooting a car and typing a new
// damage line should. Hashing the source text gets both without a TTL to tune.
//
// NOT ON THE EDGE RUNTIME, deliberately. Edge caps the time to the first byte
// at 25 seconds, and a full walk-around — A54489 had ten, from the hood to a
// tear in the driver seat — is ten structured rows for the model to write and
// runs past that. The gateway then answered 504, a status this handler cannot
// itself return, so there was nothing in the response to explain it and the
// lister was told to type the line in by hand. Tires went with it: they ride
// home in the same answer, so one timeout cost both. Node/Fluid gives the read
// room, and readDamages() now stops itself short of maxDuration so a model that
// never comes back still lands as a clean 502 rather than a gateway timeout.
//
// Env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_KEY, LISTING_UPLOAD_SECRET,
//               ANTHROPIC_API_KEY

import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { readDamages } from './_lib/damageText.js';

export const config = { runtime: 'nodejs', maxDuration: 120 };

const MODEL = 'claude-opus-5';

function admin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-listing-secret',
  'Access-Control-Max-Age': '86400',
};

function json(res, body, status = 200) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json(body);
}

function sha256Hex(s) {
  return createHash('sha256').update(s).digest('hex');
}

// Vercel parses a JSON body for us, but only when the caller set the header —
// and the extension's own fetch does. Null means the bytes weren't JSON, which
// is a 400; an absent body is just {}.
function readJsonBody(req) {
  const b = req.body;
  if (b == null || b === '') return {};
  if (typeof b === 'string' || Buffer.isBuffer(b)) {
    try { return JSON.parse(b.toString()); } catch { return null; }
  }
  return b;
}

// The message the damage line lives in. Not `parsed->>'notes'`: that field is
// derived, and until 2026-09-05 it was sliced to 100 characters, so every note
// in the queue is cut mid-word. `body` is what the tech actually sent.
//
// Newest first, skipping messages that carry nothing to read — a bare "917397",
// a photo caption, an odometer on its own line.
//
// The test is WORDS, not length. A 40-character floor looked reasonable and
// would have thrown away "Front bumper scratched" (22) while keeping a stock
// number typed twice. So: at least three whitespace-separated tokens, and at
// least two of them mostly letters — that is the shape of a sentence about a
// car, and no shape a VIN or a mileage can take.
function readableDamageText(body) {
  const t = String(body || '').trim();
  if (!t) return false;
  const tokens = t.split(/\s+/);
  if (tokens.length < 3) return false;
  const wordy = tokens.filter((w) => (w.match(/[A-Za-z]/g) || []).length >= 3);
  return wordy.length >= 2;
}

async function latestDamageText(db, vin6) {
  const { data, error } = await db.from('wa_inbound_messages')
    .select('body, received_at')
    .eq('vin6', vin6)
    .in('station', ['ready', 'seller'])
    .not('body', 'is', null)
    // Not 25. A car's intake is one text message and forty photos, and the
    // photo rows are the NEWER ones — 917397 has 42 rows and its damage line
    // sat at position 26, so a 25-row window returned "nothing to read" for a
    // car whose damage sentence was sitting right there.
    .order('received_at', { ascending: false })
    .limit(250);
  if (error) throw new Error(`wa_inbound_messages: ${error.message}`);
  const hit = (data || []).find((r) => readableDamageText(r.body));
  return hit ? hit.body.trim() : null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  // Fail closed — this endpoint spends the Anthropic key.
  const secret = process.env.LISTING_UPLOAD_SECRET;
  if (!secret) return json(res, { error: 'LISTING_UPLOAD_SECRET is not configured' }, 503);
  if (req.headers['x-listing-secret'] !== secret) return json(res, { error: 'unauthorized' }, 401);

  const body = readJsonBody(req);
  if (body === null) return json(res, { error: 'bad JSON' }, 400);

  // Ad-hoc: parse the text we were handed and return. Nothing is read or
  // written, so this is the safe way to try a wording without touching a car.
  if (body?.text && !body?.vin) {
    const read = await readDamages(String(body.text));
    if (read === null) return json(res, { error: 'damage read failed' }, 502);
    return json(res, {
      vin6: null, damages: read.damages, tires: read.tires,
      text: String(body.text), cached: false, model: MODEL,
    });
  }

  const vinRaw = String(body?.vin || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (vinRaw.length < 6) return json(res, { error: 'vin must be at least the last 6' }, 400);
  const vin6 = vinRaw.slice(-6);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return json(res, { error: 'server not configured' }, 503);
  }
  const db = admin();

  let text;
  try { text = await latestDamageText(db, vin6); }
  catch (e) { return json(res, { error: String(e.message || e) }, 500); }
  if (!text) return json(res, { vin6, damages: [], tires: null, text: null, cached: false, model: MODEL });

  const sourceSha = sha256Hex(text);

  if (!body?.refresh) {
    const { data: hit } = await db.from('intake_damages')
      .select('damages, tires, model').eq('vin6', vin6).eq('source_sha', sourceSha).maybeSingle();
    if (hit) {
      return json(res, {
        vin6, damages: hit.damages || [], tires: hit.tires || null,
        text, cached: true, model: hit.model,
      });
    }
  }

  const read = await readDamages(text);
  if (read === null) return json(res, { error: 'damage read failed' }, 502);

  // Best-effort cache. A write failure costs one re-parse next time, which is
  // not a reason to fail a read the caller already has an answer for.
  await db.from('intake_damages').upsert(
    {
      vin6, source_sha: sourceSha, damages: read.damages, tires: read.tires,
      model: MODEL, updated_at: new Date().toISOString(),
    },
    { onConflict: 'vin6' },
  ).then(() => {}, (e) => console.error('intake_damages cache write:', e?.message || e));

  return json(res, { vin6, damages: read.damages, tires: read.tires, text, cached: false, model: MODEL });
}
