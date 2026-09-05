// Read the damage line the lot tech typed in the Ready-to-Sell group and hand
// back SmartAuction damage rows.
//
//   POST /api/parse-damages
//   x-listing-secret: <LISTING_UPLOAD_SECRET>
//   { "vin": "627672" }            → the newest ready/seller message for that car
//   { "vin": "627672", "refresh": true }  → re-read it, ignoring the cache
//   { "text": "Scratch on ..." }   → parse this text, no cache (for trying wording)
//
//   → { vin6, damages: [{ panel, type, description }], text, cached, model }
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
// Env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_KEY, LISTING_UPLOAD_SECRET,
//               ANTHROPIC_API_KEY

import { createClient } from '@supabase/supabase-js';
import { readDamages } from './_lib/damageText.js';

export const config = { runtime: 'edge' };

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

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

async function sha256Hex(s) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The message the damage line lives in. Not `parsed->>'notes'`: that field is
// derived, and until 2026-09-05 it was sliced to 100 characters, so every note
// in the queue is cut mid-word. `body` is what the tech actually sent.
//
// Newest first, and only messages long enough to be a damage report — a bare
// "086793" or a photo caption is the same car and carries nothing to read.
async function latestDamageText(db, vin6) {
  const { data, error } = await db.from('wa_inbound_messages')
    .select('body, received_at')
    .eq('vin6', vin6)
    .in('station', ['ready', 'seller'])
    .not('body', 'is', null)
    .order('received_at', { ascending: false })
    .limit(25);
  if (error) throw new Error(`wa_inbound_messages: ${error.message}`);
  const hit = (data || []).find((r) => String(r.body || '').trim().length >= 40);
  return hit ? hit.body.trim() : null;
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Fail closed — this endpoint spends the Anthropic key.
  const secret = process.env.LISTING_UPLOAD_SECRET;
  if (!secret) return json({ error: 'LISTING_UPLOAD_SECRET is not configured' }, 503);
  if (request.headers.get('x-listing-secret') !== secret) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad JSON' }, 400); }

  // Ad-hoc: parse the text we were handed and return. Nothing is read or
  // written, so this is the safe way to try a wording without touching a car.
  if (body?.text && !body?.vin) {
    const damages = await readDamages(String(body.text));
    if (damages === null) return json({ error: 'damage read failed' }, 502);
    return json({ vin6: null, damages, text: String(body.text), cached: false, model: MODEL });
  }

  const vinRaw = String(body?.vin || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (vinRaw.length < 6) return json({ error: 'vin must be at least the last 6' }, 400);
  const vin6 = vinRaw.slice(-6);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'server not configured' }, 503);
  }
  const db = admin();

  let text;
  try { text = await latestDamageText(db, vin6); }
  catch (e) { return json({ error: String(e.message || e) }, 500); }
  if (!text) return json({ vin6, damages: [], text: null, cached: false, model: MODEL });

  const sourceSha = await sha256Hex(text);

  if (!body?.refresh) {
    const { data: hit } = await db.from('intake_damages')
      .select('damages, model').eq('vin6', vin6).eq('source_sha', sourceSha).maybeSingle();
    if (hit) return json({ vin6, damages: hit.damages || [], text, cached: true, model: hit.model });
  }

  const damages = await readDamages(text);
  if (damages === null) return json({ error: 'damage read failed' }, 502);

  // Best-effort cache. A write failure costs one re-parse next time, which is
  // not a reason to fail a read the caller already has an answer for.
  await db.from('intake_damages').upsert(
    { vin6, source_sha: sourceSha, damages, model: MODEL, updated_at: new Date().toISOString() },
    { onConflict: 'vin6' },
  ).then(() => {}, (e) => console.error('intake_damages cache write:', e?.message || e));

  return json({ vin6, damages, text, cached: false, model: MODEL });
}
