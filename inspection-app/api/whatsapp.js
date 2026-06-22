// WhatsApp Cloud API webhook — official API, replaces the whatsapp-web.js scraper.
//
// Edge runtime is REQUIRED: it gives us the exact raw request bytes via
// request.text(), which Meta's X-Hub-Signature-256 HMAC is computed over.
// The Node serverless runtime pre-parses the body and breaks signature checks.
//
// Env (set in Vercel):
//   WHATSAPP_VERIFY_TOKEN   — your webhook verify token
//   WHATSAPP_APP_SECRET     — Meta App secret (for signature verification)
//   WHATSAPP_ACCESS_TOKEN   — permanent System User token (media download)
//   SUPABASE_URL            — project URL
//   SUPABASE_SERVICE_KEY    — service_role key (bypasses RLS)

import { createClient } from '@supabase/supabase-js';
import {
  verifySignature, parseVehicleEntry, extractVin6, downloadMedia, extFor,
} from './_lib/whatsapp.js';

export const config = { runtime: 'edge' };

const SESSION_TTL_MS = 10 * 60 * 1000; // attach photos to a VIN within 10 min

function admin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

export default async function handler(request) {
  const url = new URL(request.url);

  // ---- GET: webhook verification handshake --------------------------------
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, POST' } });
  }

  // ---- POST: verify signature over the RAW body ---------------------------
  const raw = await request.text();
  const sig = request.headers.get('x-hub-signature-256');
  const ok = await verifySignature(raw, sig, process.env.WHATSAPP_APP_SECRET);
  if (!ok) {
    // Reject forged/unsigned payloads. Anyone could otherwise inject "car sold".
    return new Response('Bad signature', { status: 401 });
  }

  let body;
  try { body = JSON.parse(raw); } catch { return new Response('ok', { status: 200 }); }

  // Process best-effort; always 200 so Meta doesn't hammer us. Idempotency on
  // message_id makes any retry a safe no-op.
  try {
    await processWebhook(body);
  } catch (e) {
    console.error('webhook processing error:', e?.message || e);
  }
  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

async function processWebhook(body) {
  const db = admin();
  const stationCache = new Map();

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      // Ignore delivery/read receipts and errors — not inbound content.
      const messages = value.messages || [];
      if (messages.length === 0) continue;

      const phoneNumberId = value.metadata?.phone_number_id;
      const station = await loadStation(db, phoneNumberId, stationCache);
      if (!station) {
        console.warn('unknown phone_number_id:', phoneNumberId);
        continue;
      }

      for (const msg of messages) {
        try {
          await handleMessage(db, station, msg);
        } catch (e) {
          console.error('message error', msg?.id, e?.message || e);
          await db.from('wa_inbound_messages')
            .update({ error: String(e?.message || e), processed: false })
            .eq('message_id', msg.id);
        }
      }
    }
  }
}

async function loadStation(db, phoneNumberId, cache) {
  if (!phoneNumberId) return null;
  if (cache.has(phoneNumberId)) return cache.get(phoneNumberId);
  const { data } = await db.from('wa_station_numbers')
    .select('phone_number_id, station, location_code, active')
    .eq('phone_number_id', phoneNumberId)
    .eq('active', true)
    .maybeSingle();
  cache.set(phoneNumberId, data || null);
  return data || null;
}

async function isAllowed(db, from) {
  const { data } = await db.from('wa_allowed_senders')
    .select('wa_phone').eq('wa_phone', from).eq('active', true).maybeSingle();
  return !!data;
}

async function handleMessage(db, station, msg) {
  const from = msg.from;
  const type = msg.type;

  // Allowlist: drop anything from an unknown number.
  if (!(await isAllowed(db, from))) {
    console.warn('sender not allowlisted:', from);
    return;
  }

  const text = type === 'text' ? (msg.text?.body || '')
    : type === 'image' ? (msg.image?.caption || '')
      : '';

  // Idempotency claim: insert the message row; duplicate delivery -> no row back.
  const { data: claimed } = await db.from('wa_inbound_messages')
    .upsert(
      {
        message_id: msg.id, wa_from: from, phone_number_id: station.phone_number_id,
        station: station.station, msg_type: type, body: text, processed: false,
      },
      { onConflict: 'message_id', ignoreDuplicates: true },
    )
    .select('message_id');
  if (!claimed || claimed.length === 0) return; // already handled

  let vin6 = null;
  let mediaPath = null;
  let parsed = null;
  const isIntake = station.station === 'seller' || station.station === 'ready';

  // True event time = when the worker actually sent the message, not "now".
  // Keeps the system-wide "newest wins" rule honest (a delayed delivery can't
  // masquerade as a fresher update than something that happened after it).
  const eventIso = msg.timestamp
    ? new Date(Number(msg.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  if (station.station === 'body_shop' || station.station === 'mechanic') {
    // Location stations: a VIN in the message moves the car.
    vin6 = extractVin6(text);
    if (vin6 && station.location_code) {
      await updateLocation(db, vin6, station.location_code, eventIso);
      await setSession(db, from, vin6, station.station);
    }
  } else {
    // Intake stations (seller / ready): parse the vehicle, remember the VIN.
    parsed = parseVehicleEntry(text);
    if (parsed?.vin6) {
      vin6 = parsed.vin6;
      await setSession(db, from, vin6, station.station);
    }
  }

  // Photos: only from intake stations (seller / ready) — those feed the
  // SmartAuction listing. Body-shop / mechanic photos are NOT stored so damage
  // shots never leak into a car's marketplace listing.
  if (isIntake && type === 'image' && msg.image?.id) {
    if (!vin6) vin6 = extractVin6(text) || (await getSessionVin(db, from));
    if (vin6) {
      const { buf, mime } = await downloadMedia(msg.image.id, process.env.WHATSAPP_ACCESS_TOKEN);
      // wamid is base64 (can contain '/' and '='); sanitize for a flat key.
      const safeId = String(msg.id).replace(/[^A-Za-z0-9]/g, '_');
      mediaPath = `${vin6}/${safeId}.${extFor(mime)}`;
      const up = await db.storage.from('wa-photos').upload(mediaPath, buf, {
        contentType: mime, upsert: true,
      });
      if (up.error) throw new Error(`storage: ${up.error.message}`);
    } else {
      console.warn('image with no resolvable VIN from', from);
    }
  }

  await db.from('wa_inbound_messages').update({
    vin6, media_path: mediaPath, parsed, processed: true, error: null,
  }).eq('message_id', msg.id);
}

async function setSession(db, from, vin6, station) {
  await db.from('wa_sessions').upsert({
    wa_from: from, last_vin6: vin6, station,
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'wa_from' });
}

async function getSessionVin(db, from) {
  const { data } = await db.from('wa_sessions')
    .select('last_vin6, expires_at').eq('wa_from', from).maybeSingle();
  if (!data?.last_vin6) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  return data.last_vin6;
}

// Update vehicle_locations via the deterministic last-6 RPC.
// Rule: NEWEST WINS (by true event time). We never override a location that
// already carries a newer timestamp, and we don't bump the timestamp when the
// status is unchanged (preserves the stuck-since-N-days signal).
// Manual edits are NOT special-cased — a newer real event overrides them.
async function updateLocation(db, vin6, locationCode, eventIso) {
  const { data: rows } = await db.rpc('lookup_vin_by_last6', { last6: vin6 });
  const v = Array.isArray(rows) ? rows[0] : rows;
  if (!v?.stock_number) { console.warn('no inventory match for', vin6); return; }

  const { data: existing } = await db.from('vehicle_locations')
    .select('physical_location, location_updated_at').eq('stock_number', v.stock_number).maybeSingle();

  // Something newer already won — don't move the car backward in time.
  if (existing?.location_updated_at && new Date(existing.location_updated_at) >= new Date(eventIso)) return;
  // Already here — don't bump the timestamp (keeps aging accurate).
  if (existing?.physical_location === locationCode) return;

  await db.from('vehicle_locations').upsert({
    stock_number: v.stock_number,
    vin: v.vehicle_vin || null,
    physical_location: locationCode,
    physical_source: 'whatsapp',
    location_updated_at: eventIso,
  }, { onConflict: 'stock_number' });
}
