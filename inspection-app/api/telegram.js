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
import { storePhoto, bucketForStation } from './_lib/photos.js';

export const config = { runtime: 'edge' };

const SESSION_TTL_MS = 10 * 60 * 1000;
// How long a photo with no VIN of its own waits for its album's caption before
// falling back to what the sender's session said when it landed. Telegram
// delivers album members within about a second of each other; this is the
// in-request wait, so it buys correctness at the cost of a slower 200 back.
const PARK_SETTLE_MS = 3000;
// The backstop sweep waits far longer, so it only ever picks up photos that
// genuinely fell through — never one whose caption is still in flight in
// somebody else's request.
const PARK_SWEEP_MS = 60 * 1000;
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
    if (vins.length) {
      if (chat.location_code) {
        for (const v of vins) await updateLocation(db, v, chat.location_code, eventIso);
      }
      vin6 = vins[0];
      await setSession(db, fromId, vin6, chat.station);
      // Open a body shop job for every car mentioned, so the manager's board
      // fills itself. Idempotent — an already-open job comes back untouched, so
      // re-posting the same car never resets its age clock or doubles the card.
      if (chat.station === 'body_shop') {
        for (const v of vins) await ensureBodyShopJob(db, v, eventIso);
      }
      // Claim photos this sender parked before sending the VIN. The intake
      // branch has always done this; the shop groups never did, so a photo that
      // landed ahead of its VIN text could be orphaned here.
      await resolvePendingForSender(db, fromId, vin6, chat.station, mediaGroupId);
    }
  } else {
    parsed = parseVehicleEntry(text);
    if (parsed?.vin6) {
      vin6 = parsed.vin6;
      await setSession(db, fromId, vin6, chat.station);
      // Claim any photos this sender already posted before sending the VIN.
      await resolvePendingForSender(db, fromId, vin6, chat.station, mediaGroupId);
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
  let parkedSessionVin = null;
  if (photoFileId) {
    // Evidence carried by the photo itself, best first: a VIN in its own
    // caption, then a VIN on a sibling of the same album. Both are facts.
    if (!vin6) vin6 = extractVin6(text);
    if (!vin6 && mediaGroupId) vin6 = await albumVin(db, mediaGroupId);

    // Nothing on the photo says which car it is. The sender's session is a
    // GUESS — correct for "type the VIN, then send a burst", wrong the second a
    // worker shoots the next car before naming it, and once stored under the
    // wrong prefix nothing ever moves it back. So we only guess for a LONE
    // photo. An album never guesses: its caption rides on one member and that
    // member's webhook can land after this one, so guessing here would file a
    // properly captioned album under the previous car for good. Park it and let
    // the caption — or, seconds later, the settle below — decide.
    if (!vin6 && !mediaGroupId) vin6 = await getSessionVin(db, fromId);

    const bucket = bucketForStation(chat.station);
    if (vin6) {
      try {
        mediaPath = await storePhoto(db, bucket, vin6, photoFileId);
      } catch (e) {
        // Transient download/upload failure — common when a worker fires 40
        // photos at once and Supabase storage throttles. DON'T drop it: park
        // the file_id so the post-commit recheck and later sweeps retry it.
        // This is the "random cars lose a few photos" failure mode.
        console.error('store failed, parking for retry', vin6, e?.message || e);
        pendingFileId = photoFileId;
        mediaPath = null;
      }
      // VIN now known — claim any photos this sender parked earlier.
      await resolvePendingForSender(db, fromId, vin6, chat.station, mediaGroupId);
    } else {
      // Parked. Remember what the session would have said: it settles this
      // photo if no caption ever shows up, and it marks the photo as already
      // spoken for so the NEXT car's VIN can't sweep it up.
      pendingFileId = photoFileId;
      parkedSessionVin = await getSessionVin(db, fromId);
    }
  }

  await db.from('wa_inbound_messages').update({
    vin6, media_path: mediaPath, parsed, media_group_id: mediaGroupId,
    pending_file_id: pendingFileId, session_vin_at_receipt: parkedSessionVin,
    processed: true, error: null,
  }).eq('message_id', msgKey);

  // Closes the simultaneous-burst race. Workers fire the VIN text and every
  // photo at once, so each lands as a concurrent webhook with no ordering
  // guarantee. A photo can park (no VIN visible yet) the instant AFTER the VIN
  // message already ran its sweep — leaving it orphaned. So once our own parked
  // row is committed above, re-check for its album's caption. Whichever of
  // {this photo, the captioning message} commits last sees the other and claims
  // the pile. No background job, no drops.
  if (pendingFileId) {
    // If we already know this car's VIN (the store failed and we parked for
    // retry), use it directly. Otherwise the album's caption may have committed
    // while we were writing — that sibling is the only thing allowed to speak
    // for an album here.
    const lateVin = vin6 || (mediaGroupId ? await albumVin(db, mediaGroupId) : null);
    if (lateVin) await resolvePendingForSender(db, fromId, lateVin, chat.station, mediaGroupId);
    else {
      // Still nothing. Give the album's caption a couple of seconds to land —
      // Telegram delivers album members within about a second of each other, so
      // if it isn't here by now it isn't coming — then settle this photo
      // ourselves. Doing it in-request matters: a burst of photos is often the
      // LAST thing said in the group, and waiting for the next update to sweep
      // could leave it invisible in the app for hours.
      await new Promise((r) => setTimeout(r, PARK_SETTLE_MS));
      await settleParked(db, msgKey);
    }
  }

  // Backstop for anything that raced or whose upload was still failing. Runs
  // inline on every update rather than on a cron, like the rest of this pipeline.
  await sweepParkedPhotos(db);
}

// The VIN carried by any member of an album, once one of them has committed.
async function albumVin(db, mediaGroupId) {
  const { data } = await db.from('wa_inbound_messages')
    .select('vin6').eq('media_group_id', mediaGroupId)
    .not('vin6', 'is', null).limit(1).maybeSingle();
  return data?.vin6 || null;
}

// Download and file a parked photo, in the same order of evidence used
// everywhere else: the photo's own VIN (a store that failed and is being
// retried), then its album's caption, then — last — what the sender's session
// said at the moment it landed. That snapshot is the only guess we make, and we
// make it against the car that was in flight THEN, never against whatever car
// has been named since. Idempotent: re-reads the row and no-ops if something
// already claimed it.
async function settleParked(db, messageId) {
  const { data: p } = await db.from('wa_inbound_messages')
    .select('message_id, station, vin6, media_group_id, session_vin_at_receipt, pending_file_id, media_path')
    .eq('message_id', messageId).maybeSingle();
  if (!p || p.media_path || !p.pending_file_id) return;

  const vin6 = p.vin6
    || (p.media_group_id ? await albumVin(db, p.media_group_id) : null)
    || p.session_vin_at_receipt;
  if (!vin6) return;                 // nothing can identify it; leave it parked

  try {
    const path = await storePhoto(db, bucketForStation(p.station), vin6, p.pending_file_id);
    await db.from('wa_inbound_messages')
      .update({ vin6, media_path: path, pending_file_id: null })
      .eq('message_id', p.message_id);
  } catch (e) {
    // Still failing — leave it parked for a later sweep to retry.
    console.error('settle parked photo failed', p.message_id, e?.message || e);
  }
}

// Bounded per call so one webhook never stalls behind a backlog, and floored at
// 6h so a photo nothing can ever identify stops being rescanned forever.
async function sweepParkedPhotos(db) {
  const now = Date.now();
  const settled = new Date(now - PARK_SWEEP_MS).toISOString();
  const floor = new Date(now - 6 * 60 * 60 * 1000).toISOString();
  const { data: parked } = await db.from('wa_inbound_messages')
    .select('message_id')
    .not('pending_file_id', 'is', null).is('media_path', null)
    .lte('received_at', settled).gte('received_at', floor)
    .or('vin6.not.is.null,session_vin_at_receipt.not.is.null,media_group_id.not.is.null')
    .order('received_at', { ascending: true })
    .limit(10);

  for (const p of parked || []) await settleParked(db, p.message_id);
}

// Open (or find) this car's body shop job. The RPC is SECURITY DEFINER and
// idempotent; a car that isn't in inventory returns null and is skipped. Never
// throws into the webhook — a body shop job failing must not cost us the
// location update or the photos.
async function ensureBodyShopJob(db, vin6, eventIso) {
  const { error } = await db.rpc('ensure_body_shop_job', { p_vin6: vin6, p_event: eventIso });
  if (error) console.error('ensure_body_shop_job failed for', vin6, error.message || error);
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

// Download + store any photos this sender PARKED (sent before the VIN was known
// — individual photos or albums, any order). Scoped to the same station and a
// 10-min window. Idempotent.
//
// A VIN does NOT get to claim every parked photo in that window: a worker who
// shoots one car without ever naming it and then posts the next car's VIN would
// hand the first car's photos to the second. So a photo is only claimed when
// nothing else already speaks for it — with one exception that matters most,
// the album this very message captions, whose siblings parked precisely because
// they were waiting for it.
async function resolvePendingForSender(db, fromId, vin6, station, mediaGroupId = null) {
  const bucket = bucketForStation(station);
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: pend } = await db.from('wa_inbound_messages')
    .select('message_id, pending_file_id, media_group_id, vin6, session_vin_at_receipt')
    .eq('wa_from', fromId).eq('station', station)
    .is('media_path', null).not('pending_file_id', 'is', null)
    .gte('received_at', cutoff);
  for (const p of pend || []) {
    const sameAlbum = mediaGroupId && p.media_group_id === mediaGroupId;
    // Already belongs to a car (a store that failed and is being retried), or
    // was shot while a different car was in flight — either way, not ours.
    if (!sameAlbum && (p.vin6 || (p.session_vin_at_receipt && p.session_vin_at_receipt !== vin6))) continue;
    try {
      const path = await storePhoto(db, bucket, vin6, p.pending_file_id);
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
