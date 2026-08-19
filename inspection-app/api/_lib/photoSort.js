// What order a car's photos appear in on the marketplace, decided by looking at them.
//
// A listing's pictures arrive from three places that never agreed on an order:
// the crew's Telegram ready-to-sell shots (a walkaround, roughly right), the
// 'sa_' set scraped off a SmartAuction condition report (tire gauges and
// undercarriage shots interleaved with the hero angles), and the PWA
// inspection. So one car opens on its front three-quarter and the next opens on
// a tread-depth gauge, and a buyer scrolling the marketplace can't compare them.
//
// The model LABELS each photo; this file ORDERS them. That split is the whole
// point: asking a model to "put these in a good order" gives a different answer
// for two cars with the same set of pictures, which is the opposite of what we
// want. A label per photo plus one fixed sequence in code (SLOT_ORDER) means
// every car on the lot opens the same way, a new photo drops into its slot
// instead of landing at the back, and changing house style later is an edit to
// one array — no reclassifying, no API spend.
//
// Called over plain HTTP rather than through @anthropic-ai/sdk, same as
// api/_lib/keytag.js: the SDK statically imports node:fs and node:path, which
// the edge runtime refuses to bundle. Keeping one HTTP shape across both Claude
// calls in this repo means this can move to an edge route later (the Telegram
// webhook is edge, and is the natural place to sort a car when its photos land).
//
// Env: ANTHROPIC_API_KEY

const API = 'https://api.anthropic.com/v1/messages'

// Cheap on purpose. This is perception, not judgement — "which side of the car
// is this" — and it is paid per photo across the whole lot. Verified against
// hand-labelled sets from all three photo sources before it was picked; see
// docs/photo-sort-eval.md.
export const DEFAULT_MODEL = 'claude-haiku-4-5'

// Images per request. The labels are independent of each other, so the set can
// be split without losing anything, and a chunk that fails retries on its own
// instead of costing the whole car.
//
// Ten rather than thirty because the API fetches every URL in a request at
// once, and Supabase storage answers a burst that size with 429s — which
// surface here as a flat "Unable to download the file" 400 that names no photo,
// killing the whole chunk. Ten at a time, one chunk after another, stays under
// it. See RETRIES below for the other half of that fix.
const CHUNK = 10

// A 429 from storage is transient and uncorrelated with the photo, so the same
// chunk usually succeeds a moment later. Backing off beats dropping photos: a
// dropped photo is silently unlabelled, and unlabelled photos sink to the back
// of the gallery, which looks exactly like a sorting mistake.
const RETRIES = [1500, 4000]

// The gallery, top to bottom. A buyer wants to know what the car looks like
// before what is wrong with it, so the walkaround leads, the interior follows,
// and the close-up evidence — damage, tread, undercarriage — sits behind it
// where it is still there for anyone who scrolls. Paperwork and keys come last;
// they are proof for us, not a reason to buy.
export const SLOT_ORDER = [
  'exterior_front_quarter',
  'exterior_front',
  'exterior_side',
  'exterior_rear_quarter',
  'exterior_rear',
  'wheel',
  'engine',
  'interior_dash',
  'interior_cluster',
  'interior_screen',
  'interior_seats',
  'interior_cargo',
  'damage_closeup',
  'undercarriage',
  'tire_tread',
  'vin_or_label',
  'keys_or_docs',
  'junk',
]

// One line each, because this list IS the prompt — the model reads these
// definitions and nothing else about what the labels mean.
const LABEL_HELP = [
  ['exterior_front_quarter', 'the whole car from a front corner — front and one side both visible'],
  ['exterior_front', 'the whole car square from the front'],
  ['exterior_side', 'the whole car from the side, straight on'],
  ['exterior_rear_quarter', 'the whole car from a rear corner'],
  ['exterior_rear', 'the whole car square from the back'],
  ['wheel', 'a wheel and tyre, seen from outside the car'],
  ['engine', 'the engine bay, hood open'],
  ['interior_dash', 'the dashboard, steering wheel, or a wide shot of the front cabin'],
  ['interior_cluster', 'the instrument cluster or odometer — a mileage reading'],
  ['interior_screen', 'the infotainment or navigation screen'],
  ['interior_seats', 'seats, front or rear, or a door standing open showing the cabin'],
  ['interior_cargo', 'the boot, cargo area, or load floor'],
  ['damage_closeup', 'one spot on the car, filling the frame: a panel, bumper, grille, light, mirror, handle, roof, wheel arch or seat, whether or not you can make out any damage'],
  ['undercarriage', 'taken underneath the car'],
  ['tire_tread', 'tread depth — the tyre surface close up, usually with a dial gauge on it'],
  ['vin_or_label', 'a VIN plate, door-jamb sticker, emissions or tyre-pressure label, window sticker'],
  ['keys_or_docs', 'keys, key tags, paperwork, a screen or a printout'],
  ['junk', 'no part of the car at all: only a person, the ground, the sky, a wall or a building'],
]

export const LABELS = LABEL_HELP.map(([l]) => l)

const PROMPT =
  'These are photographs of one used car, taken by a dealership to list it for sale. ' +
  'Label each photograph with what it shows.\n\n' +
  'Labels:\n' +
  LABEL_HELP.map(([l, help]) => `- ${l}: ${help}`).join('\n') +
  '\n\nRules:\n' +
  '- An exterior_ label needs the WHOLE CAR in the frame — you can see it end to end and tell ' +
  'its shape. If one panel fills the frame, it is damage_closeup, however much paint is in shot. ' +
  'A close shot of a roof, bonnet, door or bumper is NOT exterior_side.\n' +
  '- Judge the exterior angle by where the camera is, not by which end of the car is nearest.\n' +
  '- Reflections, glare, trees and the photographer showing in the paint do not make a photograph ' +
  'junk. If it is a part of the car, label the part.\n' +
  '- Return one entry per photograph, in the order given, using the index printed above each one.\n\n' +
  'quality: "good" normally. "unusable" ONLY when the photograph cannot be shown to a buyer at ' +
  'all — a finger over the lens, motion blur, or so dark nothing is visible. A plain, dull or ' +
  'badly framed photograph of the car is still "good".'

const SCHEMA = {
  type: 'object',
  properties: {
    photos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer', description: 'The index printed above the photograph.' },
          label: { type: 'string', enum: LABELS },
          quality: { type: 'string', enum: ['good', 'unusable'] },
        },
        required: ['i', 'label', 'quality'],
        additionalProperties: false,
      },
    },
  },
  required: ['photos'],
  additionalProperties: false,
}

// Photos are passed to the API by URL — the storage bucket is public (the
// marketplace <img>s read straight from it), so nothing is downloaded, decoded
// or re-uploaded on our side.
function content(urls, offset) {
  const out = []
  urls.forEach((url, i) => {
    out.push({ type: 'text', text: `Photograph ${offset + i}:` })
    out.push({ type: 'image', source: { type: 'url', url } })
  })
  out.push({ type: 'text', text: PROMPT })
  return out
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// One call to Claude, retried through a rate-limited storage bucket or a busy
// API. Anything still failing after the last attempt is thrown to the caller.
async function ask(apiKey, body) {
  let last
  for (let attempt = 0; attempt <= RETRIES.length; attempt++) {
    if (attempt) await sleep(RETRIES[attempt - 1])
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })
    if (res.ok) return res.json()
    last = `anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`
  }
  throw new Error(last)
}

async function labelChunk(urls, offset, { apiKey, model }) {
  const body = await ask(apiKey, {
    model,
    max_tokens: 2000,
    messages: [{ role: 'user', content: content(urls, offset) }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  })
  const text = (body.content || []).find((b) => b.type === 'text')?.text
  if (!text) throw new Error(`no text in response (stop_reason ${body.stop_reason})`)

  const parsed = JSON.parse(text)
  return { rows: parsed.photos || [], usage: body.usage || {} }
}

// Second pass over the photos that claimed to be whole-car shots.
//
// The first pass is an eighteen-way question, and the one place it goes wrong
// often enough to matter is a close shot of a panel with the sky, the trees or
// the photographer reflected in it: enough context in the frame that it reads
// as a picture of the car. Those land in the first few slots, which is the only
// part of a gallery everybody sees.
//
// Asking again, alone, as a yes/no — "is the whole car in this frame" — is a far
// easier question than picking one of eighteen labels, and it is asked of six to
// nine photographs rather than thirty, so it costs a fraction of the first pass.
// A 'no' is demoted to damage_closeup, which is where a close-up of one panel
// belongs anyway.
const VERIFY_PROMPT =
  'Each photograph below is supposed to show a whole car — the complete vehicle in frame, ' +
  'end to end, so you could tell someone what shape it is.\n\n' +
  'For each one, answer whether that is true. Answer false if the frame is filled by one part ' +
  'of a car — a bonnet, roof, door, bumper, wing, window or wheel arch — even when reflections, ' +
  'sky or trees make it look like a wider shot, and false if there is no car in it at all.\n\n' +
  'Use the index printed above each photograph.'

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    photos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          whole_car: { type: 'boolean' },
        },
        required: ['i', 'whole_car'],
        additionalProperties: false,
      },
    },
  },
  required: ['photos'],
  additionalProperties: false,
}

async function verifyWholeCar(urls, { apiKey, model }) {
  const body = []
  urls.forEach((url, i) => {
    body.push({ type: 'text', text: `Photograph ${i}:` })
    body.push({ type: 'image', source: { type: 'url', url } })
  })
  body.push({ type: 'text', text: VERIFY_PROMPT })

  const out = await ask(apiKey, {
    model,
    max_tokens: 1000,
    messages: [{ role: 'user', content: body }],
    output_config: { format: { type: 'json_schema', schema: VERIFY_SCHEMA } },
  })
  const text = (out.content || []).find((b) => b.type === 'text')?.text
  const rows = text ? JSON.parse(text).photos || [] : []
  const rejected = rows.filter((r) => r.whole_car === false).map((r) => urls[r.i]).filter(Boolean)
  return { rejected, usage: out.usage || {} }
}

// Label every photo. Returns a Map url -> {label, quality}; a photo the model
// skipped or mislabelled into something we don't recognise simply isn't in the
// map, and the caller leaves it where it already was rather than guessing.
export async function classifyPhotos(urls, { apiKey, model = DEFAULT_MODEL } = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  // One chunk at a time. Running them together was faster and cost the same,
  // but thirty simultaneous downloads out of one storage folder is what tips
  // Supabase into 429s in the first place — and the whole job is a background
  // sweep, so seconds are not the currency here.
  const results = []
  for (let i = 0; i < urls.length; i += CHUNK) {
    results.push(await labelChunk(urls.slice(i, i + CHUNK), i, { apiKey, model }))
  }

  const tags = new Map()
  const usage = { input_tokens: 0, output_tokens: 0 }
  const add = (u) => {
    usage.input_tokens += u.input_tokens || 0
    usage.output_tokens += u.output_tokens || 0
  }
  for (const r of results) {
    add(r.usage)
    for (const row of r.rows) {
      const url = urls[row.i]
      if (!url || !LABELS.includes(row.label)) continue
      tags.set(url, { label: row.label, quality: row.quality === 'unusable' ? 'unusable' : 'good' })
    }
  }

  const claimed = [...tags].filter(([, t]) => t.label.startsWith('exterior_')).map(([u]) => u)
  if (claimed.length) {
    // A failed check must not cost us the labels we already have — the gallery
    // is better off with one close-up too high than with no order at all.
    try {
      const v = await verifyWholeCar(claimed, { apiKey, model })
      add(v.usage)
      for (const url of v.rejected) tags.set(url, { ...tags.get(url), label: 'damage_closeup' })
    } catch (e) {
      console.warn('photo-sort: whole-car check failed, keeping first-pass labels:', e?.message || e)
    }
  }

  return { tags, usage, model }
}

// Labels in, gallery out.
//
// Stable within a slot: four wheel shots keep the order they were taken in, so
// a walkaround still reads like a walkaround. Photos we have no label for sit
// behind the labelled ones rather than being dropped or promoted — an unlabelled
// photo is a photo we didn't understand, not a bad photo.
export function sortPhotos(urls, tags) {
  const slot = (url) => {
    const i = SLOT_ORDER.indexOf(tags.get(url)?.label)
    return i === -1 ? SLOT_ORDER.length : i
  }
  const ordering = urls
    .map((url, i) => ({ url, i }))
    .sort((a, b) => slot(a.url) - slot(b.url) || a.i - b.i)
    .map((x) => x.url)

  // Nothing is hidden automatically, and that is a decision, not an omission.
  //
  // Hiding was tried and taken back out. On the Audi, four close shots of hazy,
  // sun-blown grey paint came back 'junk', quality 'unusable' — and on a grey
  // car, hazy paint IS the damage the photograph was taken to record. A sorter
  // that quietly drops those is deleting the evidence a wholesale buyer is owed,
  // and no one would notice it had happened.
  //
  // Sinking costs nothing by comparison: a misjudged photo ends up last instead
  // of gone, and it is still there for anyone who scrolls. So the labels decide
  // ORDER only. Removing a photo stays a person's call, in Edit Photos, where it
  // always was — and a car a person has touched is one this never revisits.
  const hidden = []

  // What it would have dropped, for the endpoint to report. Useful for spotting
  // a genuinely bad batch of photos; not acted on.
  const unusable = ordering.filter((url) => tags.get(url)?.quality === 'unusable')

  return { ordering, hidden, unusable }
}
