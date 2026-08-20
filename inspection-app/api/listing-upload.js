// Drop photos onto a listing from the app.
//
// The sibling endpoint, /api/listing-photos, does this for the SmartAuction
// extension and is gated by a shared secret the extension carries. The app can't
// use it: it has no secret, it must not have one (the bundle is public), and its
// caller is a person with a session rather than a machine with a key. So this is
// the same job with the other kind of proof — a signed-in admin.
//
// Everything else is deliberately the same shape as the extension's path, for
// the same reasons written there: bytes come here rather than going straight to
// storage, because anon is RLS-blocked from writing and widening that policy
// would hand the public bundle the ability to put pictures on any car. The
// service key lives only on this side.
//
//   POST /api/listing-upload
//   Authorization: Bearer <supabase session token>   (must be an admin)
//   { vin, photos: ["<base64 jpeg>", ...], done?: true }
//
// Photos land in their own namespace — storage listing/<vin6>/manual/, checklist
// keys 'man_<hash>' — which a condition-report re-scrape neither wipes nor
// rebuilds. See 20260820000061 for why that matters.
//
// Env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_KEY, CRON_SECRET (for the sort).

import { createClient } from '@supabase/supabase-js';
import { sortCarPhotos } from './_lib/sortTrigger.js';

export const config = { runtime: 'edge' };

const BUCKET = 'inspection-photos';
const PREFIX = 'listing';
const MAX_PHOTOS_PER_REQUEST = 12;
const MAX_BYTES_PER_PHOTO = 8 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

function admin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

// Same check as every other admin-gated endpoint: the token proves who you are,
// the profile row decides what you may do. A buyer's token is a perfectly valid
// token and buyers do not add photos to our cars.
async function isAdmin(token) {
  if (!token) return false;
  const u = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!u.ok) return false;
  const user = await u.json().catch(() => null);
  if (!user?.id) return false;
  const p = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  const [profile] = p.ok ? await p.json().catch(() => []) : [];
  return profile?.role === 'admin';
}

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function decodeBase64(b64) {
  const clean = String(b64 || '').replace(/^data:[^;]+;base64,/, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Trust the bytes, not the caller's word for it.
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

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'server not configured' }, 503);
  }

  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!(await isAdmin(token))) return json({ error: 'Only admins can add photos' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad JSON' }, 400); }

  const vinRaw = String(body?.vin || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (vinRaw.length < 6) return json({ error: 'vin must be at least the last 6' }, 400);
  const vin6 = vinRaw.slice(-6);

  const photos = Array.isArray(body?.photos) ? body.photos : [];
  if (!photos.length) return json({ error: 'no photos' }, 400);
  if (photos.length > MAX_PHOTOS_PER_REQUEST) {
    return json({ error: `at most ${MAX_PHOTOS_PER_REQUEST} photos per request` }, 400);
  }

  const db = admin();
  const dir = `${PREFIX}/${vin6}/manual`;

  // Named by content hash, so the same picture dropped twice is one file and one
  // key rather than a duplicate in the gallery — and so a retry after a flaky
  // upload converges instead of piling up.
  const uploaded = [];
  for (let i = 0; i < photos.length; i++) {
    let bytes;
    try { bytes = decodeBase64(photos[i]); } catch { return json({ error: `photo ${i} is not base64` }, 400); }
    if (!bytes.length) continue;
    if (bytes.length > MAX_BYTES_PER_PHOTO) return json({ error: `photo ${i} is too large` }, 413);

    const kind = sniff(bytes);
    if (!kind) return json({ error: `photo ${i} is not a JPEG or PNG` }, 415);

    const hash = (await sha256Hex(bytes)).slice(0, 16);
    const path = `${dir}/${hash}.${kind.ext}`;
    const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
      contentType: kind.mime,
      upsert: true,
    });
    if (error) return json({ error: `upload failed: ${error.message}` }, 502);
    uploaded.push({ hash, path });
  }

  if (!uploaded.length) return json({ error: 'nothing decoded' }, 400);

  const base = `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}`;
  const map = {};
  for (const u of uploaded) map[`man_${u.hash}`] = { url: `${base}/${u.path}`, path: u.path };

  const { data: outcome, error: rpcErr } = await db.rpc('add_listing_photos', {
    p_vin: vinRaw, p_photos: map,
  });
  if (rpcErr) return json({ error: `save failed: ${rpcErr.message}` }, 502);

  // Same rule as the extension's upload: sort once the caller says it's done,
  // never per batch, or several sorts fetch the gallery back out of the bucket
  // this is still writing to.
  if (body?.done) sortCarPhotos(vin6, { waitUntil: context?.waitUntil?.bind(context) });

  // The URLs come back so the editor can show what it just added without
  // waiting for a round trip through the marketplace RPC.
  return json({
    ok: true, vin6, added: uploaded.length, outcome,
    urls: Object.values(map).map((m) => m.url),
  });
}
