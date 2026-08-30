// The inspection agent — the thing that walks a car with you.
//
// An inspector says what he sees, out loud, while he is looking at it. The
// agent turns that into structured findings, asks the follow-up a good service
// writer would ask, tells him what this model is known to do, and keeps track
// of what he hasn't covered yet. He never types, and he never has to remember a
// list at the end — which is the whole failure this replaces.
//
// The agent DOES NOT WRITE TO THE DATABASE. It returns actions and the phone
// applies them through the same services the tap-driven screens use. That is
// deliberate: those services carry the RLS, the offline queue and the
// server-side merge that stops two people erasing each other. An agent with its
// own write path would quietly bypass all three, and the first time somebody
// inspected a car in a dead spot we'd lose the session.
//
// Called over plain HTTP rather than @anthropic-ai/sdk, same as
// api/_lib/photoSort.js and keytag.js: the SDK statically imports node:fs,
// which the edge runtime refuses to bundle.
//
// Env: ANTHROPIC_API_KEY

const API = 'https://api.anthropic.com/v1/messages'

// The conversation model. Judgement, not perception — it has to know that "it
// shakes at 60" is a different repair from "it shakes when I brake", and hold a
// checklist in its head while doing it. Low effort because each turn is one
// small decision and the inspector is standing there waiting: latency is the
// feature that decides whether this gets used.
const MODEL = 'claude-opus-5'

export const config = { runtime: 'nodejs' }

// What the agent can do. Every one of these maps onto something the tap-driven
// screens already do, so the agent is a second way in rather than a second
// system.
const TOOLS = [
  {
    name: 'record_problem',
    description:
      'Record ONE mechanical problem the inspector just described. Call this once per distinct problem — three things wrong is three calls, never one call describing all three. This is the whole point of the tool.',
    input_schema: {
      type: 'object',
      properties: {
        check: {
          type: 'string',
          description: 'Which check it belongs to',
          enum: ['dash_lights', 'accessories', 'engine', 'transmission', 'power',
                 'driveline', 'brakes', 'steering', 'suspension', 'tires', 'road_check', 'other'],
        },
        description: { type: 'string', description: 'The problem in the inspector\'s own words, cleaned up. e.g. "Whine from the rear under acceleration"' },
        severity: { type: 'string', enum: ['critical', 'severe', 'moderate', 'minor'] },
      },
      required: ['check', 'description', 'severity'],
      additionalProperties: false,
    },
  },
  {
    name: 'record_damage',
    description: 'Record ONE piece of body or interior damage. One call per damage.',
    input_schema: {
      type: 'object',
      properties: {
        area: { type: 'string', enum: ['exterior', 'interior'] },
        panel: { type: 'string', description: 'Panel or zone id, e.g. hood, left_quarter, driver_seat. Use the closest match.' },
        type: { type: 'string', description: 'Scratch, Dent, Crack, Rust, Tear, Stain, Broken, Missing…' },
        size: { type: 'string', description: 'Pin, Coin, Credit card, Hand, Forearm, Large, Multiple' },
        note: { type: 'string' },
      },
      required: ['area', 'panel', 'type'],
      additionalProperties: false,
    },
  },
  {
    name: 'mark_good',
    description: 'The inspector confirmed a check is fine. Only call this when he actually said so — never to fill in something you did not ask about.',
    input_schema: {
      type: 'object',
      properties: {
        checks: { type: 'array', items: { type: 'string' }, description: 'Check ids that are good' },
      },
      required: ['checks'],
      additionalProperties: false,
    },
  },
  {
    name: 'ask_for_photo',
    description: 'Ask the phone to open the camera for something worth seeing. Use sparingly — for damage and for anything a mechanic would want to look at.',
    input_schema: {
      type: 'object',
      properties: { of: { type: 'string', description: 'What to photograph' } },
      required: ['of'],
      additionalProperties: false,
    },
  },
]

const OUTBOUND = `
THIS IS AN OUTBOUND INSPECTION — a different job from an arrival walk.
The car is leaving: it is being consigned to auction or handed over. You are
building a CONDITION REPORT, and you are checking our own work.

Two things you do that an inbound walk does not:

1. THE CONDITION REPORT. Write down every panel and every damage he calls out,
   even small ones, because this is what gets announced and what we get
   arbitrated on. Be specific about which panel and how big. If he says "some
   scratches down the side", ask which panel and roughly how long before you
   record it — "the side" is not a disclosure.

2. VERIFY WHAT WE PAID FOR. You are given the repairs we already made on this
   car. On the drive and the walk, give him a SPECIFIC way to confirm each one
   actually holds. Not "check the brakes" — "we did front pads and rotors, so
   get it to 40 and brake hard once: no grinding, no pulsing through the pedal."
   If a repair cannot be verified from the seat, say so and tell him what to
   look at instead. If something we fixed is still wrong, that is the most
   important finding of the walk — record it and say plainly that it came back.
`

const SYSTEM = `You are walking a used-car inspector through a vehicle, out loud, while he stands next to it. He is holding a phone and cannot type. Everything he says reaches you as speech, so expect fragments, filler and mistranscription.

HOW YOU TALK
- Short. One or two sentences, then stop and let him work. You are talking, not writing.
- Never read a list back at him unless he asks what is left.
- Never say "I have recorded that" — just acknowledge and move on. "Got it, what else on that door?"
- No markdown, no bullet points, no emoji. Your words are spoken aloud by the phone.

HOW YOU LISTEN
- One problem per record_problem call. If he says "it slips and there's a whine from the rear", that is TWO calls. This is the single most important thing you do — the reason this system exists is that three problems used to arrive at the shop as one sentence.
- Mistranscriptions are normal. "Break" is brakes, "rotors" is brakes, "tranny" is transmission. If a word is genuinely ambiguous and it changes the repair, ask; otherwise take the obvious reading and keep going.
- If he describes something not on any checklist, record it with check "other". Never drop it because it doesn't fit.
- Severity is your judgement from what he said: anything unsafe or undriveable is critical, anything that must be right before the car sells is severe, most things are moderate, cosmetic notes are minor.

HOW YOU LEAD
- Work in the order he is moving, not the order of your list. If he is at the back of the car, ask about the back of the car.
- Ask the follow-up a good service writer asks. "Grinding — front or back?" "Does it pull when you brake, or all the time?" One question at a time.
- When you know what this model is commonly bad for, prompt him to check it specifically, and say why. "These eat coolant — pop the cap and tell me if there's oil in it." Only mention it once, and only if it is worth his time.
- Keep track of what has not been covered. When he goes quiet or says he is done, name what is still unchecked, briefly.

OPENING THE WALK
The first message you get is "[begin]". That is the phone telling you to start,
not something a person said. Greet him by saying what car it is, then give him
ONE instruction that puts him somewhere physical: where to stand and what to
look at first. Start at the driver's front corner and work around the car.
Example shape: "2016 Golf Sportwagen, 102 thousand miles. Start at the driver's
front corner — walk me down that side and tell me anything you see."

ASSUME HE IS NEW
He may have started this week and may never have inspected a car before.
- Use plain words. Say "the panel behind the front wheel" before you say
  "rocker". Name the part the way somebody would point at it.
- If he does not know what you are asking for, tell him where to stand and what
  it looks like when it is wrong. Two sentences, not a lecture.
- If he says he does not know, or gives you something vague like "it looks bad",
  ask one narrowing question rather than recording something you are unsure of.
- Never make him feel slow. He is doing the job right by asking.

LEADING, NOT WAITING
- After every answer, give him the next thing to do. Never end a turn without
  either a question or an instruction — a silence is a new employee standing
  there wondering if it broke.
- Work around the car in a fixed order so nothing is skipped: driver side, rear,
  passenger side, front, then inside, then start it, then the drive.
- When everything is covered, say so plainly and tell him he can finish.

TEACHING HIM HOW TO TEST
When a check needs a technique, give him the technique — briefly, as an
instruction he can follow standing there. He may never have done it.
- Transmission: "From a stop, get on it to about 45 and let it shift on its own.
  Every shift should be one clean move. Tell me if any of them slip, bang, or
  hang at high revs."
- Torque converter: "At about 40, steady throttle. A shudder that feels like
  driving over rumble strips is the converter."
- Engine: "Pop the hood, have it idling. Listen for a tick that speeds up with
  the revs. Then look at the exhaust — blue is oil, white that hangs around is
  coolant."
- Head gasket: "Engine cold, open the coolant cap. If it looks like chocolate
  milk, stop and tell me."
- Brakes: "Somewhere empty, 40 down to a stop, one firm push. It should stop
  straight, no grinding, no pulsing in the pedal."
- Wheel bearing: "At 50, gently weave left and right. A hum that changes with
  the direction is a bearing."
- Suspension: "Push down hard on each corner and let go. It should come back up
  once and settle, not keep bouncing."
- Alignment: "On a straight flat road, ease your hands off. Tell me if it walks
  left or right."
- A/C: "Max cold, fan high, five minutes. Put your hand at the vent — it should
  be genuinely cold, not just cool."
Give ONE at a time, when it is that check's turn. Never recite the list.

WHAT YOU NEVER DO
- Never invent a finding he did not describe.
- Never mark something good that he did not confirm.
- Never guess at a VIN, a mileage, or a part number.`

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
  if (!res.ok) {
    throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  return res.json()
}

// What this model is known to do. Kept separate from the conversation and
// cached by the caller, because it is the same answer for every Escape we ever
// buy and it must not cost a web search per car.
async function knownIssues({ year, make, model }, apiKey) {
  const car = [year, make, model].filter(Boolean).join(' ')
  if (!car) return []

  const data = await callClaude({
    model: MODEL,
    max_tokens: 1200,
    output_config: { effort: 'low' },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
    system:
      'You brief a used-car inspector before he walks a specific model. Give only faults that are COMMON and CHEAP TO CHECK BY HAND in a few minutes. No recalls he cannot verify, no rare failures, no maintenance schedules.',
    messages: [{
      role: 'user',
      content: `${car}. List at most 5 things this model is known for. For each: the fault in under 8 words, and what to physically check, in under 15 words. Reply as JSON only: [{"fault":"...","check":"..."}]`,
    }],
  }, apiKey)

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
  const m = text.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const list = JSON.parse(m[0])
    return Array.isArray(list) ? list.slice(0, 5) : []
  } catch {
    return []
  }
}

// Who is calling. Supabase Auth does the verifying — signature, expiry,
// revocation — so a forged or expired token comes back 401 rather than being
// trusted. Same shape as api/sold-report-access.js.
//
// This endpoint spends money on every call, so it is gated on a real signed-in
// employee rather than being open to anyone who finds the URL.
async function employeeFromToken(token) {
  if (!token) return null
  const base = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!base || !key) return null

  const r = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  })
  if (!r.ok) return null
  const user = await r.json().catch(() => null)
  if (!user?.id) return null

  // A signed-in BUYER is not an employee. `TO authenticated` covers both, so
  // the account type has to be checked explicitly — the same trap the shop
  // views are gated against.
  const p = await fetch(
    `${base}/rest/v1/profiles?id=eq.${user.id}&select=role,account_type,approval_status`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!p.ok) return null
  const [profile] = await p.json().catch(() => [])
  if (!profile) return null
  const isEmployee = profile.role === 'admin'
    || ((profile.account_type || 'employee') === 'employee' && profile.approval_status === 'approved')
  return isEmployee ? user : null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' })
    return
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' })
    return
  }

  const auth = req.headers.authorization || ''
  const user = await employeeFromToken(auth.startsWith('Bearer ') ? auth.slice(7).trim() : '')
  if (!user) {
    res.status(401).json({ error: 'Sign in again' })
    return
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const {
      mode = 'turn', car = {}, messages = [], covered = [], remaining = [],
      issues = [], type = 'inbound', repairs = [], bodyShop = [],
    } = body

    if (mode === 'known_issues') {
      res.status(200).json({ issues: await knownIssues(car, apiKey) })
      return
    }

    const carLine = [car.year, car.make, car.model].filter(Boolean).join(' ') || 'an unknown vehicle'
    const brief = issues.length
      ? `\n\nWHAT THIS MODEL IS KNOWN FOR (mention only if it earns his time):\n${
          issues.map((i) => `- ${i.fault} — check: ${i.check}`).join('\n')}`
      : ''

    const state = `\n\nSTATE\nCar: ${carLine}${car.mileage ? `, ${car.mileage} miles` : ''}\nAlready covered: ${
      covered.length ? covered.join(', ') : 'nothing yet'}\nStill to cover: ${
      remaining.length ? remaining.join(', ') : 'nothing'}`

    // What we already fixed, so an outbound walk can check our own work.
    const history = (type === 'outbound' && (repairs.length || bodyShop.length))
      ? `\n\nWHAT WE ALREADY REPAIRED ON THIS CAR (verify each one):\n${
          repairs.map((r) => `- ${r.system}: ${r.description}${
            r.status === 'declined' ? ' [WE DECLINED THIS — it was never fixed]' : ''}`).join('\n')
        }${bodyShop.length ? `\n- Body shop: ${bodyShop.length} job(s), latest ${
            bodyShop[0]?.status}` : ''}`
      : ''

    const data = await callClaude({
      model: MODEL,
      max_tokens: 1500,
      output_config: { effort: 'low' },
      thinking: { type: 'adaptive' },
      system: SYSTEM + (type === 'outbound' ? OUTBOUND : '') + brief + state + history,
      tools: TOOLS,
      messages,
    }, apiKey)

    const say = (data.content || [])
      .filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim()
    const actions = (data.content || [])
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: b.input }))

    res.status(200).json({ say, actions, stop_reason: data.stop_reason })
  } catch (err) {
    console.error('[inspect-agent]', err)
    res.status(500).json({ error: err.message || 'agent failed' })
  }
}
