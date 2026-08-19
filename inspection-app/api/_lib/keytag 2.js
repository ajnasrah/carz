// Read a VIN off a photographed KEY TAG.
//
// The wash line never types a VIN — a worker photographs the paper key tag
// hanging off the car's keys, and the VIN runs across the top of it. So the
// picture IS the message, and this is what turns it back into a car.
//
// Claude reads the tag; we do the deciding. The model is asked for the raw
// characters and nothing else, and every answer is then checked against the
// shapes a VIN can actually take before it's allowed to move a car. A tag that
// is blurred, cropped, or simply isn't a key tag comes back null, and the
// webhook asks the group instead of guessing — a wrong VIN here marks the WRONG
// car done and sends it to the front line to be sold.
//
// Called over plain HTTP rather than through @anthropic-ai/sdk: this webhook runs
// on Vercel's EDGE runtime, and the SDK statically imports node:fs and node:path,
// which edge refuses to bundle (the deploy fails outright). One fetch keeps the
// webhook on the runtime the rest of the pipeline is built for.
//
// Env: ANTHROPIC_API_KEY

import { downloadTelegramPhoto } from './photos.js';

const API = 'https://api.anthropic.com/v1/messages';

// VIN alphabet: I, O and Q are never used, which is exactly what makes the
// common OCR confusions (I/1, O/0, Q/0) safe to correct rather than reject.
const CONFUSIONS = { I: '1', O: '0', Q: '0' };

const SCHEMA = {
  type: 'object',
  properties: {
    vin: {
      type: ['string', 'null'],
      description: 'The VIN exactly as printed on the tag, or null if it cannot be read with certainty.',
    },
    confident: {
      type: 'boolean',
      description: 'True only if every character was legible.',
    },
  },
  required: ['vin', 'confident'],
  additionalProperties: false,
};

const PROMPT =
  'This is a photo of a dealership key tag. The vehicle VIN is printed across ' +
  'the top of the tag.\n\n' +
  'Return the VIN exactly as printed — the raw characters, no spaces, no ' +
  'dashes, no interpretation. A full VIN is 17 characters; if the tag shows a ' +
  'shorter number (some tags print only the last 6 or 8), return exactly what ' +
  'is printed.\n\n' +
  'Return vin: null if the tag is blurred, cut off, obscured, or if this is ' +
  'not a key tag. A wrong VIN marks the wrong car finished, so an honest null ' +
  'is always better than a guess. Do not fill in characters you cannot see.';

// Normalize what the model read into the canonical VIN-last-6 the rest of the
// pipeline speaks, or null if it isn't VIN-shaped.
export function normalizeTagVin(raw) {
  if (!raw) return null;
  let v = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Correct the three letters a VIN can never contain. Anywhere else this would
  // be reckless; here it's the alphabet's own guarantee.
  v = v.replace(/[IOQ]/g, (c) => CONFUSIONS[c]);
  // A full VIN, or the 6/8-char tail some tags print. The middle band is
  // rejected: it's a partial read, and a partial read right-aligned to 6 is a
  // different car.
  if (!(v.length === 17 || v.length === 8 || v.length === 6)) return null;
  if (!/\d/.test(v)) return null;
  return v.slice(-6);
}

// Returns the VIN last 6, or null when the tag can't be read. Never throws —
// an OCR outage must not cost us the photo, which is stored either way.
export async function readKeyTagVin(fileId) {
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
        // Reading printed characters needs care, not deliberation, and the
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
    if (!out?.confident) return null;
    return normalizeTagVin(out.vin);
  } catch (e) {
    console.error('keytag read failed', e?.message || e);
    return null;
  }
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
