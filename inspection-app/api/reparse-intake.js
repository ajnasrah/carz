// Re-read every stored Ready-to-Sell message with the current parser.
//
//   POST /api/reparse-intake
//   x-listing-secret: <LISTING_UPLOAD_SECRET>
//   {}                      → DRY RUN over the LAST 7 DAYS, writes nothing
//   { "apply": true }       → writes the corrected `parsed` back
//   { "days": 30 }          → widen the window; 0 means everything ever stored
//   { "vin": "917397" }     → just that car, whatever its age
//
// WHY. Two parser bugs are baked into the stored rows:
//
//   * notes were sliced to 100 characters, so every damage line in the queue is
//     cut mid-word ("...Scratch o", "...and fr"). The damage reader works off
//     `body` and never saw this, but the queue card, the exports and the
//     odometer/condition columns all read `parsed`.
//   * lines 3 and 4 were read positionally, so a message written
//     "Tires Good on Rear Front Poor" / "9/10" filed the tire sentence as the
//     condition grade and 9 as the tire score.
//
// `body` is untouched and complete, so both are recoverable by re-running
// parseVehicleEntry over what is already stored. No re-scraping of Telegram —
// the messages never left.
//
// WHAT THIS DELIBERATELY DOES NOT DO: it never rewrites `vin6`. The parser also
// picks the VIN, and re-deriving it would MOVE PHOTOS BETWEEN CARS. 917397's own
// damage message is the example — its first line is "7" rather than the VIN, so
// the parser reads the odometer, 113322, as the car. Refiling on that basis
// would take a car's whole gallery and hand it to a number that is nobody.
// Corrections of that kind go through rebind_intake_vin6(), one car at a time,
// with a human naming both sides.
//
// Env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_KEY, LISTING_UPLOAD_SECRET

import { createClient } from '@supabase/supabase-js';
import { parseVehicleEntry } from './_lib/parse.js';

export const config = { runtime: 'nodejs' };

const PAGE = 1000;   // PostgREST caps an unbounded select here

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

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = process.env.LISTING_UPLOAD_SECRET;
  if (!secret) return res.status(503).json({ error: 'LISTING_UPLOAD_SECRET is not configured' });
  if (req.headers['x-listing-secret'] !== secret) return res.status(401).json({ error: 'unauthorized' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const apply = body.apply === true;
  // Last 7 days by default. The cars still moving through the lot are the ones
  // worth correcting; a message from June describes a car that has long since
  // sold, and rewriting thousands of those to fix a display field nobody will
  // look at is a lot of writes for nothing.
  const days = Number.isFinite(body.days) ? Math.max(0, body.days) : 7;
  const since = days > 0 ? new Date(Date.now() - days * 864e5).toISOString() : null;
  const onlyVin = body.vin
    ? String(body.vin).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-6)
    : null;

  const db = admin();

  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = db.from('wa_inbound_messages')
      .select('message_id, body, parsed, vin6, received_at')
      .in('station', ['ready', 'seller'])
      .not('body', 'is', null)
      .not('vin6', 'is', null)
      .order('received_at', { ascending: false })
      .range(offset, offset + PAGE - 1);
    // A named car is fetched whatever its age — asking for one by VIN is a
    // deliberate act, and the window exists to bound the sweep, not to hide it.
    if (onlyVin) q = q.eq('vin6', onlyVin);
    else if (since) q = q.gte('received_at', since);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }

  const changes = [];
  for (const r of rows) {
    const fresh = parseVehicleEntry(r.body);
    if (!fresh) continue;
    const old = r.parsed || {};

    // Keep the row's own vin6 — see the note at the top. Everything else comes
    // from the re-read.
    const next = { ...fresh, vin6: r.vin6 };

    const notesGrew = (next.notes || '').length > (old.notes || '').length;
    const condMoved = (old.condition || '') !== (next.condition || '');
    const tiresFound = !!next.tires && !old.tires;
    if (!notesGrew && !condMoved && !tiresFound) continue;

    changes.push({
      message_id: r.message_id, vin6: r.vin6,
      notes: notesGrew ? { from: (old.notes || '').length, to: (next.notes || '').length } : undefined,
      condition: condMoved ? { from: old.condition || null, to: next.condition } : undefined,
      tires: tiresFound ? next.tires : undefined,
      next,
    });
  }

  let written = 0;
  if (apply) {
    for (const c of changes) {
      const { error } = await db.from('wa_inbound_messages')
        .update({ parsed: c.next }).eq('message_id', c.message_id);
      if (error) console.error('reparse write', c.message_id, error.message);
      else written++;
    }
  }

  return res.status(200).json({
    window: onlyVin ? `vin ${onlyVin}` : (since ? `since ${since.slice(0, 10)}` : 'all time'),
    scanned: rows.length,
    wouldChange: changes.length,
    applied: apply,
    written,
    truncatedNotesRecovered: changes.filter((c) => c.notes).length,
    conditionCorrected: changes.filter((c) => c.condition).length,
    tireLineRecovered: changes.filter((c) => c.tires).length,
    sample: changes.slice(0, 15).map(({ next, ...rest }) => rest),
  });
}
