// Read what the mechanics actually wrote.
//
// The mechanic group is where problems get reported, and until now the webhook
// read one thing out of it: the VIN. A message saying
//
//     No A/C
//     Suspension squeaking.
//     114843
//
// opened a job card with nothing on it. Two real diagnoses, typed by the person
// who found them, thrown away — the same failure the inspection form had, in a
// different place.
//
// So the text becomes lines on the car's job. Same shape a finding takes, same
// board, so a problem reported in chat and a problem found on an inspection are
// one list rather than two.
//
// Called over plain HTTP rather than @anthropic-ai/sdk, same as photoSort.js
// and keytag.js: the SDK statically imports node:fs, which the edge runtime
// refuses to bundle.
//
// Env: ANTHROPIC_API_KEY

const API = 'https://api.anthropic.com/v1/messages'

// Cheap on purpose. This is extraction, not judgement — "which words name a
// problem" — and it runs on every message the shop sends.
const MODEL = 'claude-haiku-4-5'

const SYSTEM = `You read short messages from the mechanics' group chat at a used car dealership and pull out the problems reported with a vehicle.

These are typed fast, on a phone, by someone with their hands dirty. Expect no punctuation, misspellings, shorthand and Spanish mixed in.

Rules:
- One entry per DISTINCT problem. "No a/c and suspension squeaking" is TWO.
- Keep the mechanic's own words, tidied. "No A/C" stays "No A/C", not "HVAC system inoperative".
- A bare VIN, a greeting, "done", "ready", "picked up", a parts question, or chat with no fault in it yields NOTHING. Returning an empty list is a correct and common answer.
- Do not infer problems that were not stated. "Looking at 114843" is not a problem.
- system must be one of: engine, transmission, suspension, brakes, electrical, hvac, exhaust, cooling, fuel, other.
- severity: critical = unsafe or undriveable, severe = must fix before it sells, moderate = should fix, minor = note only. Most chat reports are moderate.

Reply with JSON only, no prose: {"problems":[{"description":"...","system":"...","severity":"..."}]}`

const SYSTEMS = ['engine', 'transmission', 'suspension', 'brakes', 'electrical',
                 'hvac', 'exhaust', 'cooling', 'fuel', 'other']
const SEVERITIES = ['critical', 'severe', 'moderate', 'minor']

// Worth asking about at all? A bare VIN or a one-word acknowledgement is most of
// this group's traffic, and paying for a model call on "ok" is waste.
export function looksLikeReport(text) {
  const stripped = String(text || '')
    .replace(/\b[A-HJ-NPR-Z0-9]{6,17}\b/gi, ' ')   // VINs and last-sixes
    .replace(/[^a-zA-ZÀ-ɏ\s]/g, ' ')
    .trim()
  // Two words of actual prose is the floor — "done", "ready", "ok" are not.
  //
  // Deliberately NOT also gating on length: "no ac" is five characters and is a
  // real report of a real fault. Erring toward asking costs one Haiku call that
  // comes back empty; erring the other way drops a problem, which is the exact
  // failure this whole feature exists to stop.
  return stripped.split(/\s+/).filter((w) => w.length > 1).length >= 2
}

export async function extractProblems(text, { apiKey, model = MODEL } = {}) {
  if (!apiKey || !looksLikeReport(text)) return []

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      system: SYSTEM,
      messages: [{ role: 'user', content: String(text).slice(0, 2000) }],
    }),
  })
  if (!res.ok) {
    throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }

  const data = await res.json()
  const out = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
  const m = out.match(/\{[\s\S]*\}/)
  if (!m) return []

  let parsed
  try { parsed = JSON.parse(m[0]) } catch { return [] }

  return (Array.isArray(parsed?.problems) ? parsed.problems : [])
    .map((p) => ({
      description: String(p?.description || '').trim().slice(0, 400),
      // Coerce rather than trust: an unknown system must land on the board as
      // 'other', never fail the insert on a CHECK constraint and lose the line.
      system: SYSTEMS.includes(p?.system) ? p.system : 'other',
      severity: SEVERITIES.includes(p?.severity) ? p.severity : 'moderate',
    }))
    .filter((p) => p.description.length > 2)
    .slice(0, 10)
}
