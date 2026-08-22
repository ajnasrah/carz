// Photo→car binding for the Telegram intake groups.
//
// Shared by the webhook (api/telegram.js), which runs this inline on every
// update, and the sweep endpoint (api/intake-sweep.js), which runs it on a
// schedule. The webhook alone was not enough: a burst of photos is very often
// the LAST thing said in the group, and with nothing arriving afterwards there
// was no update to carry the sweep, so those photos sat parked until somebody
// happened to post again. That is precisely when a stranded burst is most
// likely, so the one case the design could not cover was the common one.

import { storePhoto, bucketForStation } from './photos.js';

const TG = 'https://api.telegram.org';
// The sweep waits this long before touching a photo, so it only ever picks up
// ones that genuinely fell through — never one whose caption is still in flight
// in somebody else's request.
export const PARK_SWEEP_MS = 60 * 1000;
// A guess stays open to correction for this long. A VIN typed shortly AFTER an
// uncaptioned burst is better evidence than one typed before it, and it can only
// ever arrive once that burst has already been filed.
export const REBIND_WINDOW_MS = 30 * 60 * 1000;

// Send a message back into the Telegram group (bots can post anytime). Returns
// the id of the message we sent, so a caller can recognise a reply to THIS
// question later — or null if the send failed.
export async function sendTelegramMessage(chatId, text, replyTo) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const body = { chat_id: chatId, text };
  if (replyTo) body.reply_to_message_id = replyTo;
  try {
    const res = await fetch(`${TG}/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const out = await res.json();
    return out?.result?.message_id ?? null;
  } catch (e) { console.error('sendMessage failed:', e?.message || e); return null; }
}

// The car this sender named nearest in time to `atIso` — up to 2h before the
// photo, up to 15 min after it. "Nearest", not "last": follow-up damage shots 20
// minutes after a caption belong to the car that was captioned, while an
// uncaptioned burst named 30 seconds later belongs to the car it was named.
export async function nearestVin(db, fromId, station, atIso) {
  const { data, error } = await db.rpc('intake_nearest_vin', {
    p_from: fromId, p_station: station, p_at: atIso,
  });
  if (error) { console.error('intake_nearest_vin failed', error.message || error); return null; }
  return data || null;
}

// The VIN carried by any member of an album, once one of them has committed.
export async function albumVin(db, mediaGroupId) {
  const { data } = await db.from('wa_inbound_messages')
    .select('vin6').eq('media_group_id', mediaGroupId)
    .not('vin6', 'is', null).limit(1).maybeSingle();
  return data?.vin6 || null;
}

// Download and file a parked photo, in the same order of evidence used
// everywhere else: the photo's own VIN (a store that failed and is being
// retried), then its album's caption, then — last — the nearest car this sender
// named, recomputed now so a VIN typed after the burst counts too. Idempotent:
// re-reads the row and no-ops if something already claimed it.
//
// When nothing can identify it, ask the group rather than dropping it silently.
export async function settleParked(db, messageId, { ask = false } = {}) {
  const { data: p } = await db.from('wa_inbound_messages')
    .select('message_id, station, wa_from, received_at, vin6, media_group_id, '
          + 'session_vin_at_receipt, pending_file_id, media_path, pending_attempts')
    .eq('message_id', messageId).maybeSingle();
  if (!p || p.media_path || !p.pending_file_id) return { filed: false, reason: 'already settled' };

  let source = 'guess';
  let vin6 = p.vin6;
  if (vin6) source = 'caption';
  if (!vin6 && p.media_group_id) { vin6 = await albumVin(db, p.media_group_id); if (vin6) source = 'album'; }
  // A wash line photo is a picture of a key tag: it names its own car or nothing
  // does. Inferring one from what this sender sent earlier would file it under
  // the car before it — so that group's photos only ever settle on their own
  // evidence, and an unreadable tag is answered by a person instead.
  if (!vin6 && p.station !== 'wash_line') {
    vin6 = await nearestVin(db, p.wa_from, p.station, p.received_at) || p.session_vin_at_receipt;
  }
  if (!vin6) {
    // Nothing on the photo, nothing in the album, nothing this sender named for
    // two hours either side. A human is the only thing left that knows.
    if (ask) await askWhichCar(db, p);
    return { filed: false, reason: 'unidentified' };
  }

  try {
    const path = await storePhoto(db, bucketForStation(p.station), vin6, p.pending_file_id);
    await db.from('wa_inbound_messages')
      .update({ vin6, media_path: path, pending_file_id: null, vin_source: source })
      .eq('message_id', p.message_id);
    return { filed: true, reason: 'filed', vin6 };
  } catch (e) {
    // Still failing — count the attempt so a permanently broken file eventually
    // stops being retried, and leave it parked for the next sweep. The reason is
    // returned as well as logged: for old photos it is usually Telegram refusing
    // to hand the file back, which is not something a retry will ever fix.
    const reason = String(e?.message || e);
    console.error('settle parked photo failed', p.message_id, reason);
    await db.from('wa_inbound_messages')
      .update({ pending_attempts: (p.pending_attempts || 0) + 1, error: reason.slice(0, 200) })
      .eq('message_id', p.message_id);
    return { filed: false, reason };
  }
}

// Backstop for anything that raced or whose upload was still failing.
//
// There is no 6h floor any more. It was there to stop unidentifiable photos
// being rescanned forever, but it also threw away every picture that took longer
// than an afternoon to resolve — and because the scan was ordered oldest-first
// with a limit, a handful of permanently stuck rows could starve everything
// behind them anyway. The RPC now excludes rows nothing can identify and rows
// that have already failed eight downloads, and returns newest first.
export async function sweepParkedPhotos(db, limit = 25) {
  const settled = new Date(Date.now() - PARK_SWEEP_MS).toISOString();
  const { data: parked } = await db.rpc('parked_photos_to_retry', {
    p_before: settled, p_limit: limit,
  });
  let filed = 0;
  const reasons = {};
  const detail = [];
  // Asking happens here rather than in the 3s in-request settle: by now the
  // caption has had a full minute to arrive and so has any VIN typed after the
  // burst, so a question at this point is a real dead end, not impatience.
  for (const p of parked || []) {
    const r = await settleParked(db, p.message_id, { ask: true });
    if (r.filed) filed++;
    reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    detail.push({ id: p.message_id, ...r });
  }
  return { seen: (parked || []).length, filed, reasons, detail };
}

// Re-examine photos bound by inference while their evidence can still change. A
// VIN typed AFTER an uncaptioned burst only exists once the burst is already
// filed, so this is the only place that case can be caught. Facts are never
// revisited: rows whose vin_source is 'caption' or 'album' are not selected.
//
// Rebinding is only an UPDATE of vin6 — ready_to_sell_photos() selects on that
// column and builds the URL from media_path, so the car prefix in the stored
// path is cosmetic and no file has to move.
export async function rebindGuessedPhotos(db, limit = 25) {
  const since = new Date(Date.now() - REBIND_WINDOW_MS).toISOString();
  const { data: guesses } = await db.rpc('guessed_photos_to_recheck', { p_since: since, p_limit: limit });
  let moved = 0;
  for (const g of guesses || []) {
    const better = await nearestVin(db, g.wa_from, g.station, g.received_at);
    if (!better || better === g.vin6) continue;
    console.log('rebinding', g.message_id, g.vin6, '->', better);
    await db.from('wa_inbound_messages').update({ vin6: better }).eq('message_id', g.message_id);
    moved++;
  }
  return moved;
}

// Give up on a photo nothing can identify — and, when it is worth anyone's
// time, ask the group whose car it is first.
//
// The stamp is the important half and it is unconditional. `asked_at` is what
// takes a dead row out of parked_photos_to_retry, so a row that is never stamped
// is returned by every sweep forever and starves every newer photo behind it.
// The first version only stamped for the ready/seller groups, which left the
// body shop's and mechanic's un-VIN'd photos permanently at the head of the
// queue — the sweep saw the same three rows on every run and filed nothing.
async function askWhichCar(db, p) {
  const intake = p.station === 'ready' || p.station === 'seller';
  // The shop groups ask too. They used to stamp and stay silent, which is the
  // worst of both: the row leaves the retry queue and nobody is ever told the
  // picture was dropped — 53 body shop photos went that way, 31 of them albums
  // posted with no caption at all. A photo in these groups always means a car,
  // so somebody in the room knows which one; asking is the only way to find out.
  const shop = p.station === 'body_shop' || p.station === 'mechanic';
  const recent = Date.now() - new Date(p.received_at).getTime() < 6 * 60 * 60 * 1000;

  // Read before writing: our own stamp would otherwise look like a recent ask.
  //
  // Intake only. There a burst is one car and many albums, so a question per
  // album would be pure noise. In the shops the opposite holds — each album is
  // a different car — and the album-wide stamp below already guarantees exactly
  // one question per pile, so throttling by sender would silently skip cars.
  let asked = true;
  if (intake && recent) {
    const { data } = await db.from('wa_inbound_messages')
      .select('message_id')
      .eq('station', p.station).eq('wa_from', p.wa_from)
      .not('asked_at', 'is', null)
      .gte('asked_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .limit(1);
    asked = !!(data && data.length);
  } else if (shop && recent) {
    asked = false;
  }

  // Retire the whole album, not the one picture — a 40-photo burst is one
  // question and one give-up, not forty. This does not block recovery: if a
  // caption turns up later, the album branch of the RPC picks the pile back up.
  const scope = () => db.from('wa_inbound_messages')
    .update({ asked_at: new Date().toISOString() })
    .is('media_path', null).not('pending_file_id', 'is', null);
  const inScope = (q) => (p.media_group_id
    ? q.eq('media_group_id', p.media_group_id)
    : q.eq('message_id', p.message_id));
  const { error } = await inScope(scope());
  if (error) console.error('asked_at stamp failed', p.message_id, error.message || error);

  // Only actually ask about pictures somebody still remembers taking, in the
  // groups where a photo means a car. Asking about a July burst is noise.
  if ((!intake && !shop) || !recent || asked) return;
  const [, chatId, tgMsgId] = p.message_id.split('_');
  // Quote the picture in the shops. Intake asks one question about one car and
  // a free-floating question is clear enough there, but a shop group is several
  // cars deep by the time anyone reads it, and "which car is this?" with nothing
  // attached is unanswerable. Same reason the wash line quotes the key tag.
  const question = '❓ Which car are these photos for?\n'
    + 'Reply to this message with the last 6 of the VIN and I\'ll file them.';
  let askedId = await sendTelegramMessage(chatId, question, shop ? tgMsgId : undefined);
  // Telegram refuses the whole send if the quoted message is gone, and asked_at
  // is already stamped by now — so a deleted photo would retire its album having
  // asked nobody, which is the failure this function exists to end. Ask plainly.
  if (!askedId && shop) askedId = await sendTelegramMessage(chatId, question);
  // Remember which question is about which pile. Without this the answer can
  // only be applied by sweeping up everything the sender has parked, which is
  // right in intake (one car at a time) and wrong in a shop, where the next
  // car's photos are already in the queue behind these.
  if (!askedId) return;
  const { error: stampErr } = await inScope(
    db.from('wa_inbound_messages')
      .update({ asked_msg_id: askedId })
      .is('media_path', null).not('pending_file_id', 'is', null),
  );
  if (stampErr) console.error('asked_msg_id stamp failed', p.message_id, stampErr.message || stampErr);
}
