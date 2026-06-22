// Telegram bot webhook — reads station groups and feeds the Supabase intake
// pipeline (wa_inbound_messages + wa-photos + queue).
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
import { parseVehicleEntry, extractVin6, extractAllVin6 } from './_lib/parse.js';

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
  const senderName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ')
    || (msg.from?.username ? '@' + msg.from.username : 'whoever sent this');
  const msgKey = `tg_${chatId}_${msg.message_id}`;
  // Grab the image whether sent COMPRESSED (msg.photo) or "as file" (msg.document),
  // so it doesn't matter how a worker sends it.
  const photoFileId =
    (Array.isArray(msg.photo) && msg.photo.length) ? msg.photo[msg.photo.length - 1].file_id
    : (msg.document && (msg.document.mime_type || '').startsWith('image/')) ? msg.document.file_id
    : null;
  const mediaGroupId = msg.media_group_id || null; // album id (photos sent together)
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

  // Mileage correction: a reply to the bot's "confirm mileage" message with the
  // right number. Update the car's miles instead of treating it as a new car.
  if (msg.reply_to_message?.from?.is_bot && /confirm mileage/i.test(msg.reply_to_message.text || '')) {
    const cVin = extractVin6(msg.reply_to_message.text || '');
    const corrected = (text.match(/\d[\d,]*/g) || [])
      .map((s) => parseInt(s.replace(/,/g, ''), 10))
      .find((n) => n >= 1000 && n <= 999999);
    if (cVin && corrected) {
      await db.from('wa_inbound_messages').update({
        vin6: cVin, parsed: { vin6: cVin, miles: corrected, corrected: true }, processed: true, error: null,
      }).eq('message_id', msgKey);
    }
    return; // don't treat the correction as a new car
  }

  if (chat.station === 'transport') {
    // Destination may be in the message ("086793 pro auto") or sent once before a
    // list of VINs ("back pro" then 086047, 378249, ...). Handles many VINs too.
    const dest = await matchDestination(db, text);
    const vins = extractAllVin6(text);
    if (vins.length === 0 && dest) {
      // destination-only line → remember it for the VINs that follow
      await setDestSession(db, fromId, dest);
    } else if (vins.length) {
      const useDest = dest || (await getDestSession(db, fromId));
      if (useDest) {
        for (const v of vins) await updateLocation(db, v, useDest, eventIso);
        await setDestSession(db, fromId, useDest); // keep it for more VINs
        vin6 = vins[0];
      } else {
        console.warn('transport: VINs but no destination known for', fromId);
      }
    }
  } else if (chat.station === 'body_shop' || chat.station === 'mechanic') {
    const vins = extractAllVin6(text);
    if (vins.length && chat.location_code) {
      for (const v of vins) await updateLocation(db, v, chat.location_code, eventIso);
      vin6 = vins[0];
      await setSession(db, fromId, vin6, chat.station);
    }
  } else {
    parsed = parseVehicleEntry(text);
    if (parsed?.vin6) {
      vin6 = parsed.vin6;
      await setSession(db, fromId, vin6, chat.station);
      // Claim any photos this sender already posted before sending the VIN.
      await resolvePendingForSender(db, fromId, vin6, chat.station);
      // Intake groups can also set a location (e.g. ready-to-sell => front lot)
      // when location_code is configured on the group.
      if (chat.location_code) await updateLocation(db, vin6, chat.location_code, eventIso);
      // Sanity-check the odometer against Frazer; ask the team to confirm if it
      // isn't higher than what we have on record.
      if (parsed.miles) await checkMileage(db, chatId, msg.message_id, vin6, parsed.miles, senderName);
    }
  }

  // Photos. Intake (ready/seller) -> wa-photos, which feeds the SmartAuction
  // listing / marketplace. Location & transport groups -> car-history, a
  // separate bucket kept for backend reference ONLY (never shown on marketplace).
  let pendingFileId = null;
  if (photoFileId) {
    // Album photos share media_group_id; the caption can arrive in any order.
    // Resolve the VIN from a sibling that already carried it.
    if (!vin6 && mediaGroupId) {
      const { data: sib } = await db.from('wa_inbound_messages')
        .select('vin6').eq('media_group_id', mediaGroupId).not('vin6', 'is', null).limit(1).maybeSingle();
      if (sib?.vin6) vin6 = sib.vin6;
    }
    if (!vin6) vin6 = extractVin6(text) || (await getSessionVin(db, fromId));

    const bucket = isIntake ? 'wa-photos' : 'car-history';
    if (vin6) {
      const { buf, ext, mime } = await downloadTelegramPhoto(photoFileId);
      const hash = await sha256Hex(buf);
      mediaPath = `${vin6}/${hash}.${ext}`;
      const up = await db.storage.from(bucket).upload(mediaPath, buf, { contentType: mime, upsert: true });
      if (up.error) throw new Error(`storage: ${up.error.message}`);
      // VIN now known — claim any photos this sender parked earlier.
      await resolvePendingForSender(db, fromId, vin6, chat.station);
    } else {
      // No VIN yet — park this photo's file_id. A later VIN from this sender
      // (text or caption) will claim it, even if photos arrived first.
      pendingFileId = photoFileId;
    }
  }

  await db.from('wa_inbound_messages').update({
    vin6, media_path: mediaPath, parsed, media_group_id: mediaGroupId,
    pending_file_id: pendingFileId, processed: true, error: null,
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

// Send a message back into the Telegram group (bots can post anytime).
async function sendTelegramMessage(chatId, text, replyTo) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const body = { chat_id: chatId, text };
  if (replyTo) body.reply_to_message_id = replyTo;
  try {
    await fetch(`${TG}/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch (e) { console.error('sendMessage failed:', e?.message || e); }
}

// If posted mileage isn't higher than what's in inventory (Frazer), ask the
// team to confirm — naming who sent it, the system mileage, and what they sent.
async function checkMileage(db, chatId, replyTo, vin6, postedMiles, senderName) {
  const { data: rows } = await db.rpc('lookup_vin_by_last6', { last6: vin6 });
  const v = Array.isArray(rows) ? rows[0] : rows;
  if (!v?.stock_number) return;                      // not in inventory — handled elsewhere
  const stored = parseInt(String(v.mileage || '').replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(stored) || stored === 0) return;
  if (postedMiles > stored) return;                   // normal: higher, all good
  await sendTelegramMessage(chatId,
    `⚠️ ${senderName} — VIN ${vin6}\n` +
    `Mileage in system: ${stored.toLocaleString()}\n` +
    `Mileage you sent: ${postedMiles.toLocaleString()}\n` +
    `Please confirm mileage is correct.`,
    replyTo);
}

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Download + store any photos this sender PARKED (sent before the VIN was known
// — individual photos or albums, any order). Scoped to the same station and a
// 10-min window so it can't grab a different car's photos. Idempotent.
async function resolvePendingForSender(db, fromId, vin6, station) {
  const bucket = (station === 'ready' || station === 'seller') ? 'wa-photos' : 'car-history';
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: pend } = await db.from('wa_inbound_messages')
    .select('message_id, pending_file_id')
    .eq('wa_from', fromId).eq('station', station)
    .is('media_path', null).not('pending_file_id', 'is', null)
    .gte('received_at', cutoff);
  for (const p of pend || []) {
    try {
      const { buf, ext, mime } = await downloadTelegramPhoto(p.pending_file_id);
      const hash = await sha256Hex(buf);
      const path = `${vin6}/${hash}.${ext}`;
      const up = await db.storage.from(bucket).upload(path, buf, { contentType: mime, upsert: true });
      if (up.error) throw new Error(up.error.message);
      await db.from('wa_inbound_messages')
        .update({ vin6, media_path: path, pending_file_id: null })
        .eq('message_id', p.message_id);
    } catch (e) { console.error('resolve pending sender failed', p.message_id, e?.message || e); }
  }
}

async function setSession(db, from, vin6, station) {
  await db.from('wa_sessions').upsert({
    wa_from: from, last_vin6: vin6, station,
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'wa_from' });
}

async function setDestSession(db, from, dest) {
  await db.from('wa_sessions').upsert({
    wa_from: from, last_destination: dest,
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'wa_from' });
}

async function getDestSession(db, from) {
  const { data } = await db.from('wa_sessions')
    .select('last_destination, expires_at').eq('wa_from', from).maybeSingle();
  if (!data?.last_destination) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  return data.last_destination;
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
