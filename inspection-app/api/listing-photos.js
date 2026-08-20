// Condition-report photos from the SmartAuction extension → marketplace.
//
// The extension only carries the anon key, and anon is RLS-blocked from writing
// to storage (verified: 403 "new row violates row-level security policy"). The
// fix is NOT to widen that policy — the anon key ships inside the extension and
// inside the public web bundle, so anything it can do, anyone can do. Instead
// the bytes come here and this function writes them with the service key.
//
// Protocol — the extension sends the photos in chunks, because a Vercel
// function body is capped around 4.5MB and a CR carries 30-40 pictures:
//
//   POST /api/listing-photos
//   x-listing-secret: <LISTING_UPLOAD_SECRET>
//   { vin, startIndex, reset, photos: ["<base64 jpeg>", ...] }
//
// The caller is a Chrome extension popup, so its origin is chrome-extension://…
// — cross-origin to this host. A POST carrying x-listing-secret is never a
// "simple" request, so the browser preflights it, and a preflight that comes
// back without CORS headers kills the upload before a single byte is sent.
// Hence the OPTIONS branch and the headers on every response below.
// Allow-Origin is '*' safely: the secret header is the actual gate, and no
// credentials ride along, so a random page echoing this origin gains nothing.
//
// `reset: true` on the first chunk clears the car's previous set, so a re-scrape
// replaces rather than accumulates. After writing its own chunk, every request
// re-lists the whole prefix and rewrites checklist.photos from that — which
// makes the chunks order-independent and the whole thing safe to retry: a
// request that lands twice, or out of order, converges on the same answer.
//
// Env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_KEY, LISTING_UPLOAD_SECRET

import { createClient } from '@supabase/supabase-js';
import { sortCarPhotos } from './_lib/sortTrigger.js';

export const config = { runtime: 'edge' };

const BUCKET = 'inspection-photos';   // already public — the marketplace <img>s read from it
const PREFIX = 'listing';
const MAX_PHOTOS_PER_REQUEST = 12;
const MAX_BYTES_PER_PHOTO = 8 * 1024 * 1024;

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

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function decodeBase64(b64) {
  // Accepts a bare base64 payload or a full data: URL.
  const clean = String(b64 || '').replace(/^data:[^;]+;base64,/, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Trust the bytes, not the caller's word for it. A JPEG starts FF D8 FF, a PNG
// with the 8-byte signature — anything else is not going into a public bucket.
function sniff(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length > 8 && png.every((b, i) => bytes[i] === b)) {
    return { ext: 'png', mime: 'image/png' };
  }
  return null;
}

export default async function handler(request, context) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Fail closed: with no secret configured this is an open write endpoint into
  // your public storage, so refuse to run rather than run unprotected.
  const secret = process.env.LISTING_UPLOAD_SECRET;
  if (!secret) return json({ error: 'LISTING_UPLOAD_SECRET is not configured' }, 503);
  if (request.headers.get('x-listing-secret') !== secret) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad JSON' }, 400); }

  const vinRaw = String(body?.vin || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (vinRaw.length < 6) return json({ error: 'vin must be at least the last 6' }, 400);
  const vin6 = vinRaw.slice(-6);

  const photos = Array.isArray(body?.photos) ? body.photos : [];
  if (photos.length > MAX_PHOTOS_PER_REQUEST) {
    return json({ error: `at most ${MAX_PHOTOS_PER_REQUEST} photos per request` }, 400);
  }

  const startIndex = Number.isFinite(body?.startIndex) ? Math.max(0, Math.trunc(body.startIndex)) : 0;
  const db = admin();
  const dir = `${PREFIX}/${vin6}`;

  // First chunk of a fresh send clears the previous set.
  if (body?.reset) {
    const { data: existing } = await db.storage.from(BUCKET).list(dir, { limit: 1000 });
    const paths = (existing || []).map((f) => `${dir}/${f.name}`);
    if (paths.length) await db.storage.from(BUCKET).remove(paths);
  }

  // Index prefix keeps the CR's own running order — storage list() is
  // alphabetical, and "03_" sorting before "11_" is what preserves it.
  const uploaded = [];
  for (let i = 0; i < photos.length; i++) {
    let bytes;
    try { bytes = decodeBase64(photos[i]); } catch { return json({ error: `photo ${i} is not base64` }, 400); }
    if (!bytes.length) continue;
    if (bytes.length > MAX_BYTES_PER_PHOTO) return json({ error: `photo ${i} is too large` }, 413);

    const kind = sniff(bytes);
    if (!kind) return json({ error: `photo ${i} is not a JPEG or PNG` }, 415);

    const hash = (await sha256Hex(bytes)).slice(0, 12);
    const name = `${String(startIndex + i).padStart(3, '0')}_${hash}.${kind.ext}`;
    const path = `${dir}/${name}`;

    const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
      contentType: kind.mime,
      upsert: true,           // same index + same bytes = same object, so retries are free
    });
    if (error) return json({ error: `upload failed: ${error.message}` }, 502);
    uploaded.push(path);
  }

  // Rebuild the listing's photo set from what is actually in storage, not from
  // what this request happened to carry. That is what makes the chunks
  // order-independent and a partial retry harmless.
  const { data: all, error: listErr } = await db.storage.from(BUCKET).list(dir, {
    limit: 1000, sortBy: { column: 'name', order: 'asc' },
  });
  if (listErr) return json({ error: `list failed: ${listErr.message}` }, 502);

  const base = `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${dir}`;
  const map = {};
  (all || []).forEach((f, i) => {
    map[`sa_photo_${String(i).padStart(3, '0')}`] = { url: `${base}/${f.name}`, path: `${dir}/${f.name}` };
  });

  const { data: outcome, error: rpcErr } = await db.rpc('upsert_listing_photos', {
    p_vin: vinRaw, p_photos: map,
  });
  if (rpcErr) return json({ error: `save failed: ${rpcErr.message}` }, 502);

  // The car's pictures just changed, so its gallery order is stale. Fired here
  // rather than waited for by the 15-minute sweep, so a car scraped and listed
  // inside that window still reaches the marketplace in the house order.
  // Fire-and-forget: an upload must never fail because sorting did.
  sortCarPhotos(vin6, { waitUntil: context?.waitUntil?.bind(context) });

  return json({ ok: true, vin6, uploaded: uploaded.length, total: Object.keys(map).length, outcome });
}
