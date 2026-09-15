// Read one picture of an auction's inventory — a screenshot of the seller
// dashboard, a photo of a printed run list, a monitor at the auction office —
// and hand back every car on it.
//
// READ ONLY, same as api/voice-agent.js and api/inspect-agent.js. This never
// touches the database: it returns what the picture says, and the phone decides
// which of those cars are ours (src/services/auctionListUpload.js) and writes
// the locations only after the walker taps Update. A model misreading one VIN
// character must not be able to move a car by itself.
//
// One image per request, so a stack of ten screenshots runs ten reads in
// parallel instead of one long request that times out on the lot's signal.
//
// Env: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

import { employeeFromToken, bearer } from './_lib/employee.js'

const API = 'https://api.anthropic.com/v1/messages'

// A misread VIN character is a different car. Accuracy over speed.
const MODEL = 'claude-opus-5'

export const config = { runtime: 'nodejs' }

const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const SCHEMA = {
  type: 'object',
  properties: {
    vehicles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          vin: {
            type: ['string', 'null'],
            description: 'The VIN or VIN fragment exactly as shown (full 17, or last 6/8 if that is all the list shows). No spaces. Null if the row shows no VIN.',
          },
          stock_number: { type: ['string', 'null'], description: 'Stock number / seller stock # if a column shows one.' },
          year:  { type: ['string', 'null'] },
          make:  { type: ['string', 'null'] },
          model: { type: ['string', 'null'] },
          color: { type: ['string', 'null'] },
        },
        required: ['vin', 'stock_number', 'year', 'make', 'model', 'color'],
        additionalProperties: false,
      },
    },
    note: {
      type: ['string', 'null'],
      description: 'Only if something stopped you reading the list: blurry, cut off, not a vehicle list. Otherwise null.',
    },
  },
  required: ['vehicles', 'note'],
  additionalProperties: false,
}

const PROMPT = (auction) =>
  `This is a picture of vehicle inventory at ${auction || 'an auto auction'} — ` +
  'a screenshot or photo of an inventory list, run list, or seller dashboard.\n\n' +
  'List EVERY vehicle visible, one entry per vehicle, top to bottom. For each, ' +
  'read the VIN character by character exactly as printed. VINs never contain ' +
  'the letters I, O or Q — if you see one, it is 1 or 0. Do not invent characters ' +
  'that are cut off or hidden; if only part of the VIN is visible, give only the ' +
  'visible part.\n\n' +
  'Include the stock number if the list has a stock column, and year, make, model ' +
  'and color when shown. Skip header rows, totals and anything that is not a vehicle. ' +
  'If the same vehicle appears twice, list it once.'

async function callClaude(body, apiKey) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' }); return }

  // Every call spends money and reads nothing public — staff only.
  const user = await employeeFromToken(bearer(req))
  if (!user) { res.status(401).json({ error: 'Sign in again' }); return }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const mediaType = String(body.media_type || '')
    const data = String(body.image || '')
    if (!MEDIA_TYPES.has(mediaType) || !data) {
      res.status(400).json({ error: 'Send one image (jpeg, png, webp)' })
      return
    }

    const out = await callClaude({
      model: MODEL,
      // A full screen of run list is 40+ rows at ~60 tokens each.
      max_tokens: 16000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: PROMPT(String(body.auction || '').slice(0, 80)) },
        ],
      }],
    }, apiKey)

    if (out.stop_reason === 'refusal') {
      res.status(422).json({ error: 'Could not read this picture' })
      return
    }
    const text = out.content?.find((b) => b.type === 'text')?.text
    let parsed
    try { parsed = JSON.parse(text) } catch { parsed = null }
    if (!parsed) {
      // max_tokens mid-JSON is the likely cause — a list too long for one shot.
      res.status(502).json({ error: out.stop_reason === 'max_tokens'
        ? 'Too many cars in one picture — split the screenshot'
        : 'Could not read this picture' })
      return
    }

    res.status(200).json({
      vehicles: Array.isArray(parsed.vehicles) ? parsed.vehicles : [],
      note: parsed.note || null,
    })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e).slice(0, 300) })
  }
}
