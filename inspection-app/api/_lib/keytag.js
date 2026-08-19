// Read a car off a photographed KEY TAG.
//
// The wash line never types a VIN — a worker photographs the paper key tag
// hanging off the car's keys. So the picture IS the message, and this is what
// turns it back into a car.
//
// What's actually on the tag (learned from the first real one, not assumed):
// a preprinted Donkey Key Tag filled in BY HAND in marker — a number across the
// top, then YEAR, MAKE, MODEL, BODY, COLOR. The number is however much of the
// VIN the writer felt like writing: the first real tag read `B066195`, the last
// SEVEN of KL79MPSL0NB066195.
//
// Handwriting is why this can't just trust what it reads. `B` and `3` are the
// same shape in a hurry, and a single wrong character is a different real car.
// So the model reads the characters, and INVENTORY decides: the number is
// right-aligned to the last 6 the way the team writes VINs everywhere else,
// looked up, and then cross-checked against the year/make/model on the same
// tag. A number that matches no car, or matches a car that isn't the one
// described beside it, is not accepted — the bot asks the group instead. A
// wrong VIN here marks the WRONG car finished and sends it out to be sold.
//
// Called over plain HTTP rather than through @anthropic-ai/sdk: this webhook runs
// on Vercel's EDGE runtime, and the SDK statically imports node:fs and node:path,
// which edge refuses to bundle (the deploy fails outright). One fetch keeps the
// webhook on the runtime the rest of the pipeline is built for.
//
// Env: ANTHROPIC_API_KEY

import { downloadTelegramPhoto } from './photos.js';

const API = 'https://api.anthropic.com/v1/messages';

// Characters that trade places in handwriting, both directions. Used only to
// generate ALTERNATIVE candidates when the number as read matches no car —
// never to silently rewrite a number that already matched one.
const LOOKALIKES = {
  B: ['8', '3'], 8: ['B', '3'], 3: ['B', '8'],
  0: ['O', 'D'], O: ['0', 'D'], D: ['0', 'O'], Q: ['0'],
  1: ['I', '7', 'L'], 7: ['1'], I: ['1'], L: ['1'],
  5: ['S'], S: ['5'], 2: ['Z'], Z: ['2'],
  6: ['G'], G: ['6'], 4: ['9'], 9: ['4'],
};

const SCHEMA = {
  type: 'object',
  properties: {
    number: {
      type: ['string', 'null'],
      description: 'The number handwritten across the top of the tag, exactly as written. Null if no number is legible.',
    },
    year:  { type: ['string', 'null'], description: 'The YEAR field, 4 digits.' },
    make:  { type: ['string', 'null'], description: 'The MAKE field as written.' },
    model: { type: ['string', 'null'], description: 'The MODEL field as written.' },
    color: { type: ['string', 'null'], description: 'The COLOR field as written.' },
  },
  required: ['number', 'year', 'make', 'model', 'color'],
  additionalProperties: false,
};

const PROMPT =
  'This is a photo of a dealership key tag. It is a preprinted card filled in ' +
  'BY HAND with a marker.\n\n' +
  'Across the top is the car\'s number — part of its VIN, usually the last 6, 7 ' +
  'or 8 characters, occasionally the whole thing. Below it are YEAR, MAKE, ' +
  'MODEL, BODY and COLOR, also handwritten.\n\n' +
  'Read each field exactly as written. For the number, give the raw characters ' +
  'only — no spaces, no dashes, and do not "correct" it into something that ' +
  'looks more like a VIN.\n\n' +
  'Handwriting is ambiguous, and that is expected: read what is most likely and ' +
  'let the number stand even if a character is uncertain — it is checked against ' +
  'our inventory afterwards. Only use null for a field that is missing, blank, ' +
  'or completely illegible.';

// The VIN-last-6 the rest of the pipeline speaks, or null if it isn't
// VIN-shaped. Same rule as typed VINs in parse.js: the team right-aligns to the
// VIN's last digit, so any 5-8 char fragment or full 15-17 char VIN resolves to
// its rightmost 6. The 9-14 band stays rejected — that's a phone number or an
// invoice, not a car.
export function normalizeTagVin(raw) {
  if (!raw) return null;
  const v = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!(v.length >= 5 && v.length <= 8) && !(v.length >= 15 && v.length <= 17)) return null;
  if (!/\d/.test(v)) return null;
  return v.length >= 6 ? v.slice(-6) : v.padStart(6, '0');
}

// Every VIN-last-6 worth trying for one handwritten number: what it says, then
// each single-character lookalike swap. One substitution only — two wrong
// characters is not a reading any more, it's a guess.
function candidates(vin6) {
  const out = [vin6];
  for (let i = 0; i < vin6.length; i++) {
    for (const alt of LOOKALIKES[vin6[i]] || []) {
      out.push(vin6.slice(0, i) + alt + vin6.slice(i + 1));
    }
  }
  return [...new Set(out)];
}

// Read the tag. Returns what it says — resolving that to a car is a separate
// job, done against inventory. Never throws: an OCR outage must not cost us the
// photo, which is stored either way.
export async function readKeyTag(fileId) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('keytag: ANTHROPIC_API_KEY not set, cannot read wash line photos');
    return null;
  }
  try {
    const { buf, mime } = await downloadTelegramPhoto(fileId);

    const httpRes = await fetch(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 1000,
        // Reading a few handwritten fields needs care, not deliberation, and the
        // webhook is holding a Telegram delivery open while this runs.
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: base64(buf) } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });
    if (!httpRes.ok) {
      console.error('keytag: anthropic', httpRes.status, (await httpRes.text()).slice(0, 200));
      return null;
    }
    const res = await httpRes.json();
    if (res.stop_reason === 'refusal') return null;
    const text = res.content?.find((b) => b.type === 'text')?.text;
    if (!text) return null;

    let out;
    try { out = JSON.parse(text); } catch { return null; }
    if (!out?.number) return null;
    return {
      raw: String(out.number).toUpperCase().replace(/[^A-Z0-9]/g, ''),
      vin6: normalizeTagVin(out.number),
      year: out.year || null,
      make: out.make || null,
      model: out.model || null,
      color: out.color || null,
    };
  } catch (e) {
    console.error('keytag read failed', e?.message || e);
    return null;
  }
}

// Turn what the tag says into a car we actually own, or null.
//
// Inventory is the judge, not the model. The number as read is tried first; only
// if nothing owns it do we try the lookalike swaps, and then only if EXACTLY one
// of them lands on a real car — two candidates matching two different cars is
// precisely the situation where guessing costs somebody the wrong car.
//
// Either way the car found has to be the car described on the rest of the tag.
export async function resolveTagCar(db, tag) {
  if (!tag?.vin6) return null;

  const direct = await lookupCar(db, tag.vin6);
  if (direct) return describes(tag, direct) ? { ...direct, vin6: tag.vin6 } : null;

  const hits = [];
  for (const cand of candidates(tag.vin6).slice(1)) {
    const car = await lookupCar(db, cand);
    if (car && describes(tag, car)) hits.push({ ...car, vin6: cand });
    if (hits.length > 1) break;
  }
  if (hits.length !== 1) return null;
  console.log('keytag: read', tag.raw, '→ matched', hits[0].vin6, hits[0].stock_number);
  return hits[0];
}

async function lookupCar(db, vin6) {
  const { data } = await db.rpc('lookup_vin_by_last6', { last6: vin6 });
  const car = Array.isArray(data) ? data[0] : data;
  return car?.stock_number ? car : null;
}

// Does the car we found match the car written on the tag? Make and model must
// not contradict — that's what catches a misread character landing on somebody
// else's car. Year is advisory: writers get it wrong on the tag more often than
// the VIN is wrong, so a year mismatch is logged, not fatal.
function describes(tag, car) {
  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const overlaps = (a, b) => {
    a = norm(a); b = norm(b);
    if (!a || !b) return true;                  // nothing written = nothing to contradict
    return a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4));
  };
  if (!overlaps(tag.make, car.vehicle_make)) return false;
  if (!overlaps(tag.model, car.vehicle_model)) return false;
  if (tag.year && car.vehicle_year && norm(tag.year) !== norm(car.vehicle_year)) {
    console.warn('keytag: year on tag', tag.year, 'but inventory says', car.vehicle_year,
      'for', car.stock_number, '— accepting on make/model');
  }
  return true;
}

// Edge runtime has no Buffer.
function base64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let s = '';
  // Chunked so a large photo can't blow the argument limit on spread.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
