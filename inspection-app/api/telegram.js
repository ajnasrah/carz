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
import {
  sendTelegramMessage, nearestVin, albumVin, settleParked,
  sweepParkedPhotos, rebindGuessedPhotos,
} from './_lib/intake.js';
import { readKeyTag, resolveTagCar } from './_lib/keytag.js';

// NOT the edge runtime. This imports _lib/keytag.js, which uses the Anthropic
// SDK to read a key tag out of a photo, and that SDK pulls in node:fs and
// node:path — unavailable on Edge. Vercel refuses the whole deployment for it,
// and reports the error against api/listing-og, which imports nothing at all, so
// the message points at the wrong file entirely.
//
// The handler below is already written in the Web style (a Request in, a
// Response out), which the Node runtime supports, so nothing else changes.
export const config = { runtime: 'nodejs' };

// Transport destinations only ("back pro", then a list of VINs). Photo binding
// used to hang off this expiry too and lost 524 pictures to it; it now reads the
// message log instead — see nearestVin().
const SESSION_TTL_MS = 10 * 60 * 1000;
// How long a photo with no VIN of its own waits for its album's caption before
// falling back to inference. Telegram delivers album members within about a
// second of each other; this is the in-request wait, so it buys correctness at
// the cost of a slower 200 back.
const PARK_SETTLE_MS = 3000;
// Groups that mark work FINISHED rather than started: the car's body shop job
// closes and it moves on to the next place. body_shop_out is typed VINs; the
// wash line photographs the key tag instead — same meaning, different medium.
const FINISH_STATIONS = {
  body_shop_out: 'wash_line',   // out of Jorge's, on to be washed
  wash_line: 'front',           // washed — it's a front line car now
};
function admin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

// Vercel's Node runtime calls handlers with (req, res) — Express style — and
// ignores a returned Response. The body of this webhook is written Web-style
// (a Request in, a Response out), which is how it ran on Edge, so it is wrapped
// rather than rewritten: same logic, adapted at the boundary.
//
// Returning a Response from a Node handler doesn't error, it just never sends
// anything, so the symptom is a 504 timeout on GET and a 500 on POST rather
// than a stack trace pointing at the cause.
export default async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'carzinc.ai';
  const url = `https://${host}${req.url || '/api/telegram'}`;

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (v == null) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  }

  // Vercel has already parsed a JSON body into req.body; handleWeb calls
  // request.json(), so it has to be handed back a string to re-parse.
  let body;
  if (req.method && !['GET', 'HEAD'].includes(req.method)) {
    body = typeof req.body === 'string' ? req.body
      : req.body == null ? '' : JSON.stringify(req.body);
  }

  const out = await handleWeb(new Request(url, { method: req.method, headers, body }));
  res.status(out.status);
  out.headers.forEach((value, key) => {
    // Content-Length would be wrong once Node re-encodes the body.
    if (key.toLowerCase() !== 'content-length') res.setHeader(key, value);
  });
  res.send(await out.text());
}

async function handleWeb(request) {
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
  const eventIso = msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString();
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

  let vin6 = null, mediaPath = null, parsed = null, vinSource = null;

  // An answer to the bot's "which car?" — the sender naming the car for a burst
  // of photos nothing could identify. Treated as the fact it is: it overrides
  // the inference rules that already gave up on those pictures.
  if (msg.reply_to_message?.from?.is_bot && /which car/i.test(msg.reply_to_message.text || '')) {
    const answer = extractVin6(text);
    if (answer) {
      // If this question was about ONE specific photo, the answer belongs to
      // that photo and nothing else. The wash line asks per key tag and every
      // tag is a different car, so sweeping up everything this sender parked
      // would file five cars' pictures under whichever one he answered about.
      const targeted = await bindAnsweredPhoto(db, msg.reply_to_message.message_id, answer);
      // In the intake groups the answer speaks for everything this sender has
      // parked: one car is shot at a time there, and that sweep is what makes
      // "answer once, file the whole burst" work.
      //
      // In a shop it speaks for the pile the bot pointed at and nothing else.
      // A worker posts car A, then car B, both uncaptioned; two questions are
      // now outstanding, and answering the second would hand car A's photos to
      // car B. Same reason the wash line never sweeps.
      const intakeGroup = chat.station === 'ready' || chat.station === 'seller';
      if (intakeGroup || (!targeted && chat.station !== 'wash_line')) {
        await resolvePendingForSender(db, fromId, answer, chat.station, null, { force: true });
        await adoptUnidentified(db, fromId, chat.station, answer);
      }
      // Filing the photos isn't enough on its own: the body shop shows pictures
      // on a car's job card, so a car nobody ever typed into the group has no
      // card for them to land on. Typing the VIN opens a job; answering the
      // bot's question is the same statement, so it opens one too.
      if (chat.station === 'body_shop') await ensureBodyShopJob(db, answer, eventIso);
      // In a finish group the question wasn't only "whose photo is this" — the
      // car is standing there waiting to be marked done. An unreadable key tag
      // must not cost the car its move just because a human had to answer.
      if (FINISH_STATIONS[chat.station]) {
        await finishCar(db, answer, FINISH_STATIONS[chat.station], eventIso);
      }
      // Record it as a car this sender NAMED, not just a row that happens to
      // carry a VIN — that is what makes it a candidate for the nearest-in-time
      // lookup, so any straggler photos after the answer bind to it too.
      await db.from('wa_inbound_messages').update({
        vin6: answer, parsed: { vin6: answer, answered: true },
        vin_source: 'caption', processed: true, error: null,
      }).eq('message_id', msgKey);
    }
    return;
  }

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
  } else if (FINISH_STATIONS[chat.station]) {
    // A car (or a list of them) coming out of a shop. Photos in these groups are
    // handled below — in the wash line the photo IS the message.
    const vins = extractAllVin6(text);
    for (const v of vins) await finishCar(db, v, FINISH_STATIONS[chat.station], eventIso);
    if (vins.length) {
      vin6 = vins[0];
      vinSource = 'caption';
      await resolvePendingForSender(db, fromId, vin6, chat.station, mediaGroupId);
    }
  } else if (chat.station === 'body_shop' || chat.station === 'mechanic') {
    const vins = extractAllVin6(text);
    if (vins.length) {
      if (chat.location_code) {
        for (const v of vins) await updateLocation(db, v, chat.location_code, eventIso);
      }
      vin6 = vins[0];
      vinSource = 'caption';
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
    parsed = await preferInventoryVin(db, parsed, text);
    if (parsed?.vin6) {
      vin6 = parsed.vin6;
      vinSource = 'caption';
      // Claim any photos this sender already posted before sending the VIN.
      await resolvePendingForSender(db, fromId, vin6, chat.station, mediaGroupId);
      // Somebody is re-shooting this car, so it belongs back in the extension's
      // ready-to-list view even if a SmartAuction upload once stamped it
      // hold/removed. Without this the new pictures land in the database and the
      // car still never appears — which is exactly what happened to 247722.
      await reopenQueueStatus(db, vin6, eventIso);
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
  let tagRead = null;
  if (photoFileId) {
    // Evidence carried by the photo itself, best first: a VIN in its own
    // caption, then a VIN on a sibling of the same album. Both are facts.
    if (!vin6) { vin6 = extractVin6(text); if (vin6) vinSource = 'caption'; }

    // The wash line is the one group where a picture identifies its own car: it
    // is a photo of the key tag, VIN across the top. So read it, and read it
    // per-photo — ten tags sent as one album are ten different cars, which is
    // exactly what the album and nearest-in-time rules below would get wrong.
    if (!vin6 && chat.station === 'wash_line') {
      tagRead = await readKeyTag(photoFileId);
      // Read by the model, confirmed by inventory — see resolveTagCar().
      const car = tagRead ? await resolveTagCar(db, tagRead) : null;
      if (car) {
        vin6 = car.vin6;
        vinSource = 'keytag';
        await finishCar(db, vin6, FINISH_STATIONS.wash_line, eventIso);
      }
    } else if (!vin6 && mediaGroupId) {
      vin6 = await albumVin(db, mediaGroupId); if (vin6) vinSource = 'album';
    }

    // Nothing on the photo says which car it is, so the nearest car this sender
    // named is a GUESS — right for "type the VIN, then send a burst", wrong the
    // second a worker shoots the next car before naming it. So we only guess for
    // a LONE photo. An album never guesses here: its caption rides on one member
    // and that member's webhook can land after this one, so guessing now would
    // file a properly captioned album under the previous car. Park it and let the
    // caption — or, seconds later, the settle below — decide.
    if (!vin6 && !mediaGroupId && chat.station !== 'wash_line') {
      vin6 = await nearestVin(db, fromId, chat.station, eventIso);
      if (vin6) vinSource = 'guess';
    }

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
      // Parked. Remember the nearest car this sender named: it settles this
      // photo if no caption ever shows up, and it marks the photo as already
      // spoken for so the NEXT car's VIN can't sweep it up.
      pendingFileId = photoFileId;
      // Not in the wash line: there is no "car in flight" there to fall back on,
      // and an unreadable tag borrowing the previous tag's VIN files a photo
      // under a car that was already finished ten minutes ago.
      parkedSessionVin = chat.station === 'wash_line'
        ? null
        : await nearestVin(db, fromId, chat.station, eventIso);
    }
  }

  await db.from('wa_inbound_messages').update({
    vin6, media_path: mediaPath, parsed, media_group_id: mediaGroupId,
    pending_file_id: pendingFileId, session_vin_at_receipt: parkedSessionVin,
    vin_source: vinSource, processed: true, error: null,
  }).eq('message_id', msgKey);

  // Deliberately NOT sorting here.
  //
  // A worker fires forty photos at once, so this line runs forty times inside a
  // few seconds — forty sorts, each pulling the car's whole gallery back out of
  // storage while forty uploads are still going into it. That is how you turn a
  // photo burst into a site-wide slowdown, and it is the same 429 pressure that
  // forced the sorter to fetch ten at a time in the first place.
  //
  // The cron picks these up within 15 minutes, which is the right trade for an
  // arrival pattern nothing tells us the end of. The SmartAuction path is
  // different — the extension knows when its upload is finished and says so.

  // Closes the simultaneous-burst race. Workers fire the VIN text and every
  // photo at once, so each lands as a concurrent webhook with no ordering
  // guarantee. A photo can park (no VIN visible yet) the instant AFTER the VIN
  // message already ran its sweep — leaving it orphaned. So once our own parked
  // row is committed above, re-check for its album's caption. Whichever of
  // {this photo, the captioning message} commits last sees the other and claims
  // the pile. No background job, no drops.
  if (pendingFileId && chat.station === 'wash_line' && !vin6) {
    // The tag couldn't be read. Nothing else in this group can identify the car,
    // and the washer is standing right there — so ask now rather than let a
    // sweep discover it an hour later. The wording matters: "which car" is what
    // the reply handler at the top of this file listens for.
    // Say what actually happened. "Couldn't read it" is misleading when the tag
    // read fine and simply matched no car we own — that's the sender's cue that
    // the number itself may be wrong, not the picture.
    const askedId = await sendTelegramMessage(chatId,
      (tagRead?.raw
        ? `❓ I read ${tagRead.raw} on that tag but couldn't match it to a car.\n`
        : '❓ Which car is this? I couldn\'t read the key tag.\n')
      + 'Reply to this message with the last 6 and I\'ll finish it.',
      msg.message_id);
    // Remember which question is about which picture, and stamp asked_at so the
    // sweep doesn't come back and ask the same thing an hour later.
    await db.from('wa_inbound_messages')
      .update({ asked_msg_id: askedId, asked_at: new Date().toISOString() })
      .eq('message_id', msgKey);
  } else if (pendingFileId) {
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
  // And correct any guess a later message has since contradicted.
  await rebindGuessedPhotos(db);
}

// Put a car back in the extension's ready-to-list view when the team re-shoots
// it. Never touches 'sold' or 'listed' — see the RPC for why.
async function reopenQueueStatus(db, vin6, eventIso) {
  const { data, error } = await db.rpc('sa_queue_reopen_on_intake', { p_vin6: vin6, p_event: eventIso });
  if (error) console.error('sa_queue_reopen_on_intake failed for', vin6, error.message || error);
  else if (data) console.log('reopened queue status for', vin6);
}

// Bind every still-unidentified photo this sender parked recently to the car
// they just named in answer to "which car?". Unlike the automatic paths this one
// is not a guess, so it overrides the snapshot guard.
async function adoptUnidentified(db, fromId, station, vin6) {
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await db.from('wa_inbound_messages')
    .select('message_id')
    .eq('wa_from', fromId).eq('station', station)
    .is('media_path', null).not('pending_file_id', 'is', null)
    .gte('received_at', cutoff);
  for (const r of rows || []) {
    await db.from('wa_inbound_messages')
      .update({ vin6, session_vin_at_receipt: vin6 }).eq('message_id', r.message_id);
    await settleParked(db, r.message_id);
  }
}

// Open (or find) this car's body shop job. The RPC is SECURITY DEFINER and
// idempotent; a car that isn't in inventory returns null and is skipped. Never
// throws into the webhook — a body shop job failing must not cost us the
// location update or the photos.
async function ensureBodyShopJob(db, vin6, eventIso) {
  const { error } = await db.rpc('ensure_body_shop_job', { p_vin6: vin6, p_event: eventIso });
  if (error) console.error('ensure_body_shop_job failed for', vin6, error.message || error);
}

// Bind a reply to the single photo the bot asked about, and file it. Returns
// false when the question wasn't about one particular picture, which is what
// sends the caller back to the broader intake rules.
// The wash line asks about one photo; the shops ask about a whole album, so
// every row carrying that question's id is part of the answer.
async function bindAnsweredPhoto(db, askedMsgId, vin6) {
  if (!askedMsgId) return false;
  const { data: rows } = await db.from('wa_inbound_messages')
    .select('message_id')
    .eq('asked_msg_id', askedMsgId)
    .is('media_path', null).not('pending_file_id', 'is', null);
  if (!rows || rows.length === 0) return false;
  for (const row of rows) {
    await db.from('wa_inbound_messages')
      .update({ vin6, session_vin_at_receipt: vin6 }).eq('message_id', row.message_id);
    await settleParked(db, row.message_id);
  }
  return true;
}

// A car finished at a shop: close whatever body shop job is open on it and move
// it to wherever finishing there sends it next.
//
// The two halves are independent on purpose. Most wash line cars never saw the
// body shop, so a null from the RPC is the normal case, not a failure — and a
// car that was never in inventory (a fresh buy) still gets its location, which
// is how anyone finds it on the lot.
async function finishCar(db, vin6, locationCode, eventIso) {
  await closeBodyShopJob(db, vin6, eventIso);
  await updateLocation(db, vin6, locationCode, eventIso);
}

// Close this car's open body shop job, stamped with the message time so the age
// clock measures the real stay. Never throws into the webhook.
async function closeBodyShopJob(db, vin6, eventIso) {
  const { data, error } = await db.rpc('close_body_shop_job', { p_vin6: vin6, p_event: eventIso });
  if (error) console.error('close_body_shop_job failed for', vin6, error.message || error);
  else if (data) console.log('closed body shop job for', vin6);
}

// Flatten a message the way keywords are stored: lowercase, letters+digits only,
// separators dropped. That's what lets one keyword span typed words — "j k chevy"
// and "Jk Chevy" both flatten to "jkchevy".
//
// Dropping the separators also destroys word boundaries, though, and a bare
// `includes()` on the result matches inside unrelated words: `otw` fired on "bot
// wont register", `otto` on "Not to Ryan", so a chat message could move a car to
// a shop nobody named. So we keep the boundaries alongside the flattened text —
// the offsets where each typed word begins and ends — and require a keyword to
// start on a word start and finish on a word end.
function flatten(text) {
  // "BackSantamaria" is typed without a space often enough to matter, and with
  // no separator the boundary rule below sees one long word and matches neither
  // half. The capital is the boundary the sender meant, so split on it first.
  const spaced = (text || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const words = spaced.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const starts = new Set(), ends = new Set();
  let norm = '';
  for (const w of words) { starts.add(norm.length); norm += w; ends.add(norm.length); }
  return { norm, starts, ends };
}

// Does `keyword` occur in the flattened text on whole-word boundaries?
function occursOnWordBoundary({ norm, starts, ends }, keyword) {
  let i = norm.indexOf(keyword);
  while (i !== -1) {
    if (starts.has(i) && ends.has(i + keyword.length)) return true;
    i = norm.indexOf(keyword, i + 1);
  }
  return false;
}

// Match a destination keyword in the message → location_code.
// Highest `priority` wins first, then the longest keyword.
//
// Priority exists for one case the "longest wins" rule gets backwards: "back".
// "Back summit" means the car came back FROM Summit and is on our lot now, but
// `summit` is longer than `back`, so the car got stamped at the shop it had just
// left. Marking `back` (and `onlot`) high-priority makes any return-to-lot word
// beat the shop named alongside it.
async function matchDestination(db, text) {
  const flat = flatten(text);
  if (!flat.norm) return null;
  const { data } = await db.from('location_keywords').select('keyword, location_code, priority');
  if (!data) return null;
  let best = null;
  for (const k of data) {
    if (!occursOnWordBoundary(flat, k.keyword)) continue;
    const better = !best
      || (k.priority || 0) > (best.priority || 0)
      || ((k.priority || 0) === (best.priority || 0) && k.keyword.length > best.keyword.length);
    if (better) best = k;
  }
  return best ? best.location_code : null;
}

// The parser reads; INVENTORY decides which car it was — the same rule the key
// tag reader follows, for the same reason.
//
// The intake convention is VIN on line 1, miles on line 2, and a worker who puts
// the VIN on line 2 gets both wrong at once: the slip on line 1 becomes the car
// and the VIN becomes the odometer. That happened with
//
//     73893 / 437541 / 9/10 / Tires are Great / Light abrasion
//
// which filed thirty photographs under 073893 — no such car — and gave it 437,541
// miles, while the Tesla those photos are of showed nothing anywhere.
//
// So when the VIN we read matches no car and another number in the same message
// does, the message is about that car. Deliberately narrow: it only moves when
// line 1 matches NOTHING, so a fresh buy that Frazer hasn't stocked yet still
// files under the number the worker typed, which is the whole point of the
// "not in inventory" flag in the extension.
//
// A miles reading equal to the VIN we just switched to was never a reading.
async function preferInventoryVin(db, parsed, text) {
  if (!parsed?.vin6) return parsed;

  const inInventory = async (v6) => {
    const { data } = await db.rpc('lookup_vin_by_last6', { last6: v6 });
    return Array.isArray(data) ? !!data[0]?.stock_number : !!data?.stock_number;
  };

  if (await inInventory(parsed.vin6)) return parsed;

  // Bounded: a chatty message can mention plenty of numbers, and each candidate
  // costs a round trip.
  const others = extractAllVin6(text).filter((v) => v !== parsed.vin6).slice(0, 4);
  for (const cand of others) {
    if (!(await inInventory(cand))) continue;
    const digits = (x) => String(x ?? '').replace(/\D/g, '').replace(/^0+/, '');
    const next = { ...parsed, vin6: cand };
    if (next.miles != null && digits(next.miles) === digits(cand)) delete next.miles;
    console.log(`intake: ${parsed.vin6} matches no car, using ${cand} from the same message`);
    return next;
  }
  return parsed;
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
async function resolvePendingForSender(db, fromId, vin6, station, mediaGroupId = null, { force = false } = {}) {
  // The wash line is exempt from all of this. Its photos are key tags, one car
  // each, so "this sender has a photo with no VIN and just named a car" is not
  // evidence there — it's the previous tag that couldn't be read, and claiming
  // it would file the unreadable car's picture under the readable one. Those
  // photos are only ever bound by their own tag or by a reply to the question
  // about that exact picture.
  if (station === 'wash_line') return;
  const bucket = bucketForStation(station);
  const cutoff = new Date(Date.now() - (force ? 6 * 60 : 10) * 60 * 1000).toISOString();
  const { data: pend } = await db.from('wa_inbound_messages')
    .select('message_id, pending_file_id, media_group_id, vin6, session_vin_at_receipt')
    .eq('wa_from', fromId).eq('station', station)
    .is('media_path', null).not('pending_file_id', 'is', null)
    .gte('received_at', cutoff);
  for (const p of pend || []) {
    const sameAlbum = mediaGroupId && p.media_group_id === mediaGroupId;
    // Already belongs to a car (a store that failed and is being retried), or
    // was shot while a different car was in flight — either way, not ours.
    // `force` is a person answering "which car?", which outranks both.
    if (!force && !sameAlbum
        && (p.vin6 || (p.session_vin_at_receipt && p.session_vin_at_receipt !== vin6))) continue;
    try {
      const path = await storePhoto(db, bucket, vin6, p.pending_file_id);
      await db.from('wa_inbound_messages')
        .update({ vin6, media_path: path, pending_file_id: null, vin_source: 'caption' })
        .eq('message_id', p.message_id);
    } catch (e) { console.error('resolve pending sender failed', p.message_id, e?.message || e); }
  }
}

// wa_sessions now carries transport destinations only. The VIN half of it is
// gone: photo binding reads the message log instead, which remembers further
// back than ten minutes and cannot expire mid-burst.
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
