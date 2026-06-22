// Telegram bot webhook — reads station groups and feeds the same Supabase
// pipeline the WhatsApp webhook does (wa_inbound_messages + wa-photos + queue).
//
// Telegram pushes every group message here (bot privacy mode OFF, or bot is a
// group admin). We trust messages from registered groups (tg_chats); the group
// itself is the allowlist.
//
// Env (Vercel):
//   TELEGRAM_BOT_TOKEN       — from BotFather
//   TELEGRAM_WEBHOOK_SECRET  — random string; set when registering the webhook,
//                              Telegram echoes it in X-Telegram-Bot-Api-Secret-Token
//   SUPABASE_URL, SUPABASE_SERVICE_KEY

import { createClient } from '@supabase/supabase-js';
import { parseVehicleEntry, extractVin6 } from './_lib/whatsapp.js';

export const config = { runtime: 'edge' };

const SESSION_TTL_MS = 10 * 60 * 1000;
const TG = 'https://api.telegram.org';

function admin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  // Telegram echoes the secret we set at registration time — reject anything else.
  const secret = request.headers.get('x-telegram-bot-api-secret-token');
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 401 });
  }

  let update;
  try { update = await request.json(); } catch { return new Response('ok', { status: 200 }); }

  try { await processUpdate(update); }
  catch (e) { console.error('telegram error:', e?.message || e); }
  return new Response('ok', { status: 200 });
}

async function processUpdate(update) {
  const msg = update.message || update.channel_post || update.edited_message;
  if (!msg || !msg.chat) return;

  const db = admin();
  const chatId = msg.chat.id;

  const { data: chat } = await db.from('tg_chats')
    .select('chat_id, station, location_code, active')
    .eq('chat_id', chatId).eq('active', true).maybeSingle();
  if (!chat) {
    // Record unknown groups so we can find their chat_id and wire them.
    await db.from('tg_unknown_chats').upsert({
      chat_id: chatId,
      title: msg.chat.title || msg.chat.type || '',
      last_text: (msg.text || msg.caption || '').slice(0, 60),
      last_seen: new Date().toISOString(),
    }, { onConflict: 'chat_id' });
    return;
  }

  const text = msg.text || msg.caption || '';
  const fromId = msg.from?.id != null ? `tg:${msg.from.id}` : 'tg:unknown';
  const msgKey = `tg_${chatId}_${msg.message_id}`;
  // Grab the image whether sent COMPRESSED (msg.photo) or "as file" (msg.document),
  // so it doesn't matter how a worker sends it.
  const photoFileId =
    (Array.isArray(msg.photo) && msg.photo.length) ? msg.photo[msg.photo.length - 1].file_id
    : (msg.document && (msg.document.mime_type || '').startsWith('image/')) ? msg.document.file_id
    : null;
  const isIntake = chat.station === 'seller' || chat.station === 'ready';

  // Idempotency claim — duplicate delivery returns no row.
  const { data: claimed } = await db.from('wa_inbound_messages')
    .upsert(
      {
        message_id: msgKey, wa_from: fromId, phone_number_id: String(chatId),
        station: chat.station, msg_type: photoFileId ? 'image' : 'text', body: text, processed: false,
      },
      { onConflict: 'message_id', ignoreDuplicates: true },
    )
    .select('message_id');
  if (!claimed || claimed.length === 0) return;

  const eventIso = msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString();
  let vin6 = null, mediaPath = null, parsed = null;

  if (chat.station === 'transport') {
    // Destination is in the message ("086793 pro auto", "086793 back").
    vin6 = extractVin6(text);
    const dest = vin6 ? await matchDestination(db, text) : null;
    if (vin6 && dest) {
      await updateLocation(db, vin6, dest, eventIso);
      await setSession(db, fromId, vin6, chat.station);
    } else if (vin6) {
      console.warn('transport: no destination matched in', JSON.stringify(text).slice(0, 60));
    }
  } else if (chat.station === 'body_shop' || chat.station === 'mechanic') {
    vin6 = extractVin6(text);
    if (vin6 && chat.location_code) {
      await updateLocation(db, vin6, chat.location_code, eventIso);
      await setSession(db, fromId, vin6, chat.station);
    }
  } else {
    parsed = parseVehicleEntry(text);
    if (parsed?.vin6) {
      vin6 = parsed.vin6;
      await setSession(db, fromId, vin6, chat.station);
      // Intake groups can also set a location (e.g. ready-to-sell => front lot)
      // when location_code is configured on the group.
      if (chat.location_code) await updateLocation(db, vin6, chat.location_code, eventIso);
    }
  }

  // Photos. Intake (ready/seller) -> wa-photos, which feeds the SmartAuction
  // listing / marketplace. Location & transport groups -> car-history, a
  // separate bucket kept for backend reference ONLY (never shown on marketplace).
  if (photoFileId) {
    if (!vin6) vin6 = extractVin6(text) || (await getSessionVin(db, fromId));
    if (vin6) {
      const bucket = isIntake ? 'wa-photos' : 'car-history';
      const { buf, ext, mime } = await downloadTelegramPhoto(photoFileId);
      mediaPath = `${vin6}/${msgKey}.${ext}`;
      const up = await db.storage.from(bucket).upload(mediaPath, buf, { contentType: mime, upsert: true });
      if (up.error) throw new Error(`storage: ${up.error.message}`);
    } else {
      console.warn('telegram photo with no resolvable VIN in', chatId);
    }
  }

  await db.from('wa_inbound_messages').update({
    vin6, media_path: mediaPath, parsed, processed: true, error: null,
  }).eq('message_id', msgKey);
}

// Telegram media: file_id -> getFile -> download from the file endpoint.
async function downloadTelegramPhoto(fileId, attempts = 3) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const metaRes = await fetch(`${TG}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
      const meta = await metaRes.json();
      if (!meta.ok || !meta.result?.file_path) throw new Error('getFile failed');
      const path = meta.result.file_path;
      const binRes = await fetch(`${TG}/file/bot${token}/${path}`);
      if (!binRes.ok) throw new Error(`file ${binRes.status}`);
      const buf = await binRes.arrayBuffer();
      const ext = (path.split('.').pop() || 'jpg').toLowerCase() === 'png' ? 'png' : 'jpg';
      return { buf, ext, mime: ext === 'png' ? 'image/png' : 'image/jpeg' };
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

// Match a destination keyword anywhere in the message → location_code.
// Longest keyword wins (so "proauto" beats a stray "uax"-like substring).
async function matchDestination(db, text) {
  const norm = (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!norm) return null;
  const { data } = await db.from('location_keywords').select('keyword, location_code');
  if (!data) return null;
  let best = null;
  for (const k of data) {
    if (norm.includes(k.keyword) && (!best || k.keyword.length > best.keyword.length)) best = k;
  }
  return best ? best.location_code : null;
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

// Newest-event-time wins; never moves a car backward; doesn't bump unchanged status.
async function updateLocation(db, vin6, locationCode, eventIso) {
  const { data: rows } = await db.rpc('lookup_vin_by_last6', { last6: vin6 });
  const v = Array.isArray(rows) ? rows[0] : rows;
  if (!v?.stock_number) { console.warn('no inventory match for', vin6); return; }

  const { data: existing } = await db.from('vehicle_locations')
    .select('physical_location, location_updated_at').eq('stock_number', v.stock_number).maybeSingle();
  if (existing?.location_updated_at && new Date(existing.location_updated_at) >= new Date(eventIso)) return;
  if (existing?.physical_location === locationCode) return;

  await db.from('vehicle_locations').upsert({
    stock_number: v.stock_number,
    vin: v.vehicle_vin || null,
    physical_location: locationCode,
    physical_source: 'telegram',
    location_updated_at: eventIso,
  }, { onConflict: 'stock_number' });
}
