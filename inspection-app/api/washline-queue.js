// The wash line's unreadable key tags — the pile nobody could see.
//
// At the wash line nobody types anything: they photograph the car's paper key
// tag and Claude reads the VIN off it. That read succeeds about seven times in
// ten. When it fails the bot asks the group "which car is this?" and waits for a
// reply, which is a fine idea and, in practice, a dead end — in three and a half
// weeks 57 photos were asked about and not one was ever answered. The question
// scrolls away in a busy group, and because a parked photo lives nowhere but a
// database row, nothing anywhere showed that those cars existed. 57 cars were
// washed, never identified, never finished, and never moved to the front line.
//
// This is the place they land instead. The photo is shown to a person, the
// person reads the tag, types the last 6, and the car finishes exactly as if the
// reader had got it right — same finishCar, shared with the webhook, so the app
// can never become a second slightly-different way to finish a car.
//
//   GET  /api/washline-queue           the pile, oldest first
//   GET  /api/washline-queue?photo=ID  that photo's bytes, fetched from Telegram
//   POST /api/washline-queue           { message_id, vin6 }  → finish the car
//                                      { message_id, action: 'dismiss' }
//
// The photo is NOT in our storage while it is parked: settleParked only stores a
// picture once it knows whose car it is, so all we hold is a Telegram file_id.
// That is why the photo endpoint proxies Telegram rather than serving a URL —
// and why an old one can come back 410: Telegram stops handing back files it has
// aged out, which no retry will fix. Those rows can still be dismissed, and a
// dismissed row leaves the queue without pretending the car got finished.
//
// Env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN

import { createClient } from '@supabase/supabase-js';
import { employeeFromToken, bearer } from './_lib/employee.js';
import { settleParked } from './_lib/intake.js';
import { finishCar, FINISH_STATIONS } from './_lib/finish.js';
import { downloadTelegramPhoto } from './_lib/photos.js';

export const config = { runtime: 'nodejs' };

// The native shell serves the bundle from capacitor://localhost, so every call
// from the app is cross-origin and the Authorization header forces a preflight.
// Allow-Origin '*' is safe here: the session token is the gate and it is sent
// explicitly, so no ambient credentials ride along.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const STATION = 'wash_line';
// A row taken out of the queue by hand. Parked rows carry no error otherwise,
// so this doubles as the marker and as the reason, and it is deliberately not a
// delete: the photo's row is the only evidence the car was ever at the wash line.
const DISMISSED = 'dismissed';

function send(res, status, body) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json(body);
}

function admin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

// Parked, unidentified, not dismissed. `pending_file_id` is what makes a row a
// photo we still hold; `vin6 is null` is what makes it unidentified.
function pendingQuery(db) {
  return db.from('wa_inbound_messages')
    .select('message_id, received_at, asked_at, pending_file_id, wa_from, error')
    .eq('station', STATION)
    .is('vin6', null)
    .not('pending_file_id', 'is', null);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    res.status(204).end();
    return;
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return send(res, 503, { error: 'Server is not configured' });
  }

  // Staff only. employeeFromToken rejects a signed-in BUYER as well as a bad
  // token — `TO authenticated` covers both, so the account type is checked.
  const user = await employeeFromToken(bearer(req));
  if (!user) return send(res, 401, { error: 'Sign in as staff first' });

  const db = admin();

  if (req.method === 'GET') {
    const photoId = String(req.query?.photo || '').trim();
    if (photoId) return servePhoto(req, res, db, photoId);

    // Dismissed rows are excluded in the QUERY, not after it. Filtering a page
    // of 200 in JS works until 200 dismissed rows exist, at which point they
    // fill the page and the real ones fall off the end — a queue that empties
    // itself by accident. `error.is.null` has to be spelled out alongside the
    // neq because in SQL a NULL error is not <> anything.
    const { data, error } = await pendingQuery(db)
      .or(`error.is.null,error.neq.${DISMISSED}`)
      .order('received_at', { ascending: true })
      .limit(200);
    if (error) return send(res, 502, { error: error.message });

    const items = (data || [])
      .map((r) => ({
        message_id: r.message_id,
        received_at: r.received_at,
        asked: !!r.asked_at,
      }));
    return send(res, 200, { items, count: items.length });
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST only' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body || {};
  const messageId = String(body?.message_id || '').trim();
  if (!messageId) return send(res, 400, { error: 'message_id is required' });

  // Read the row back rather than trusting the caller about what it is: this is
  // the only thing stopping a POST from finishing a car off some other station's
  // photo, or off a row that was already answered a second ago.
  const { data: row } = await pendingQuery(db).eq('message_id', messageId).maybeSingle();
  if (!row) return send(res, 404, { error: 'That photo is no longer waiting — someone may have just answered it' });

  if (body?.action === 'dismiss') {
    await db.from('wa_inbound_messages')
      .update({ error: DISMISSED, processed: true })
      .eq('message_id', messageId);
    return send(res, 200, { status: 'dismissed' });
  }

  // Last 6 only — that is what a key tag carries and what every other path here
  // binds on. A full VIN pasted in is accepted and trimmed to its last 6.
  const vin6 = String(body?.vin6 || '').trim().toUpperCase().slice(-6);
  if (!/^[A-Z0-9]{6}$/.test(vin6)) {
    return send(res, 400, { error: 'Enter the last 6 of the VIN' });
  }

  // The photo's own time, not now: a tag cleared a week late still means the car
  // came off the wash line when it was photographed, and the age clocks on both
  // shop boards measure the real stay.
  const eventIso = row.received_at || new Date().toISOString();

  // Same two steps the Telegram answer path takes, in the same order: bind the
  // photo to the car and file it, then finish the car.
  await db.from('wa_inbound_messages')
    .update({
      vin6,
      session_vin_at_receipt: vin6,
      vin_source: 'caption',
      parsed: { vin6, answered: true, answered_by: user.profile?.name || user.id, via: 'app' },
      processed: true,
      error: null,
    })
    .eq('message_id', messageId);

  // Downloads the Telegram file and stores it under the car. A failure here is
  // not fatal to finishing: knowing the car came off the wash line matters more
  // than keeping the picture of its key tag, and settleParked leaves the row
  // parked for the sweep to retry.
  let filed = false;
  try {
    const out = await settleParked(db, messageId);
    filed = !!out?.filed;
  } catch (e) {
    console.error('washline-queue: settleParked failed', e?.message || e);
  }

  const result = await finishCar(db, vin6, FINISH_STATIONS[STATION], eventIso);
  return send(res, 200, { status: 'finished', vin6, filed, ...result });
}

// The parked photo's bytes, straight from Telegram. Not cached by us on purpose:
// the moment somebody identifies it, settleParked stores it under the car for
// real, and a copy cached here would just be a second one to keep in step.
async function servePhoto(req, res, db, messageId) {
  const { data: row } = await pendingQuery(db).eq('message_id', messageId).maybeSingle();
  if (!row?.pending_file_id) return send(res, 404, { error: 'No photo waiting on that message' });

  try {
    const { buf, mime } = await downloadTelegramPhoto(row.pending_file_id);
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    res.setHeader('Content-Type', mime);
    // Private: the URL is only reachable with a staff token, and the bytes are
    // a picture of a customer's car. No shared cache may keep it.
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.status(200).send(Buffer.from(buf));
  } catch (e) {
    // Telegram ages files out. Say so plainly — the row can still be dismissed,
    // and a retry will never bring this one back.
    console.error('washline-queue: telegram file gone', messageId, e?.message || e);
    return send(res, 410, { error: 'Telegram no longer has this photo' });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
