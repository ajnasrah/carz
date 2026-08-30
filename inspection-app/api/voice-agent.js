// The voice agent — say it, don't type it, and don't post it in a group chat.
//
// This replaces the Telegram station groups for the one thing they were
// genuinely good at: standing next to a car and telling somebody where it is
// going. "Dropping 123456 back to body shop for the front bumper." In Telegram
// that sentence had to be read by a person, matched to a car by a bot with a
// keyword table, and hoped over. Here it comes back as a card naming the actual
// car, and nothing moves until somebody taps Confirm.
//
// TWO RULES SHAPE THIS FILE.
//
// 1. THE AGENT NEVER WRITES. Same rule as api/inspect-agent.js. It proposes; the
//    phone applies the proposal through the same services the tap-driven screens
//    use, which carry the RLS and the offline queue. An agent with its own write
//    path bypasses both, and the first misheard stock number moves the wrong car
//    with nobody watching.
//
// 2. READS RUN AS THE CALLER. Every query below goes through PostgREST with the
//    USER'S token, never the service key. So the agent can see exactly what that
//    person could see by opening the app — cost and profit included for an
//    owner, excluded for anyone the role grants exclude — and there is no path
//    where asking a question out loud shows a tech something the app wouldn't.
//    (cost/profit is revoked at ROLE level and read through inventory_costs();
//    that gating applies here for free precisely because we don't bypass it.)
//
// Env: ANTHROPIC_API_KEY, SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY

import { employeeFromToken, bearer } from './_lib/employee.js'

const API = 'https://api.anthropic.com/v1/messages'

// Judgement plus latency. The man is standing in the lot holding a key.
const MODEL = 'claude-opus-5'

export const config = { runtime: 'nodejs' }

// How many tool round-trips before we stop. A location move needs one lookup;
// a question about the shop might need three. Ten is a runaway, not a question.
const MAX_TURNS = 10

// ---------------------------------------------------------------- reading
//
// A thin PostgREST caller bound to the user's token. Everything the agent can
// see comes through here, which is what makes rule 2 true rather than aspirational.
function reader(token) {
  const base = process.env.SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  const headers = {
    apikey: anon,
    Authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  }
  return {
    async get(path) {
      const r = await fetch(`${base}/rest/v1/${path}`, { headers })
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`)
      return r.json()
    },
    async rpc(fn, args = {}) {
      const r = await fetch(`${base}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers, body: JSON.stringify(args),
      })
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`)
      return r.json()
    },
  }
}

const INV_COLS = 'stock_number,vehicle_vin,last_6_vin,vehicle_year,vehicle_make,vehicle_model,vehicle_color,mileage,days_on_lot'

const six = (s) => String(s || '').trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(-6)

// Resolve whatever was said into one car. People say the last six, sometimes
// the stock number, occasionally the whole VIN.
async function resolveCar(db, query) {
  const raw = String(query || '').trim()
  if (!raw) return null
  const isStock = /-/.test(raw)

  // NEVER select=*. Cost and profit are revoked at ROLE level, so a star select
  // asks for columns the caller may not hold and PostgREST fails the whole
  // query rather than omitting them. Same rule the app's own services follow.
  let inv = []
  if (isStock) {
    inv = await db.get(`inventory?stock_number=eq.${encodeURIComponent(raw)}&select=${INV_COLS}&limit=1`)
  } else {
    const tail = six(raw)
    if (tail.length < 4) return null
    inv = await db.get(
      `inventory?or=(last_6_vin.ilike.*${encodeURIComponent(tail)},vehicle_vin.ilike.*${encodeURIComponent(tail)})&select=${INV_COLS}&limit=6`)
  }
  if (!inv.length) return null
  return inv
}

// Everything worth knowing about one car, in the shape a person would ask it.
async function carCard(db, row) {
  const stock = row.stock_number
  const [loc, body, mech, hist] = await Promise.all([
    db.get(`vehicle_locations?stock_number=eq.${encodeURIComponent(stock)}&select=physical_location,physical_source,location_updated_at,notes&limit=1`).catch(() => []),
    db.get(`body_shop_board?stock_number=eq.${encodeURIComponent(stock)}&select=status,price,days_in_shop,days_owned,parts_total,parts_needed,parts_ordered&limit=3`).catch(() => []),
    db.get(`mechanic_board?stock_number=eq.${encodeURIComponent(stock)}&select=status,days_in_shop,days_owned,lines_open&limit=3`).catch(() => []),
    db.get(`vehicle_location_history?stock_number=eq.${encodeURIComponent(stock)}&event_type=in.(location_change,inventory_added,runlist_unconfirmed)&select=event_type,previous_location,new_location,event_at,created_by&order=event_at.desc&limit=8`).catch(() => []),
  ])
  return {
    stock_number: stock,
    vin: row.vehicle_vin,
    last6: six(row.vehicle_vin),
    vehicle: [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean).join(' '),
    mileage: row.mileage,
    days_on_lot: row.days_on_lot,
    location: loc[0] || null,
    body_shop: body[0] || null,
    mechanic: mech[0] || null,
    recent_moves: hist,
  }
}

const TOOLS = [
  {
    name: 'find_car',
    description:
      'Look up ONE car by its last 6 of the VIN, its stock number, or a full VIN. Returns the car, where it is right now, whether either shop has it open, and its recent moves. Use this before proposing any move — never propose a move for a car you have not looked up.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Last 6, stock number, or full VIN as the person said it' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_cars',
    description:
      'Cars at a place, or in a shop stage. Use for "what is at the body shop", "what is sitting at DAA", "what is waiting on parts". Returns a count and up to 40 cars.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'A location_code, e.g. body_shop, mechanic_section, front, daa, in_transit' },
        shop: { type: 'string', enum: ['body', 'mechanic'], description: 'Read a shop board instead of a physical location' },
        status: { type: 'string', description: 'Shop stage when shop is set, e.g. need_parts, waiting_parts, parts_in, in_progress, final_check, intake' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'lot_summary',
    description:
      'The whole picture at once: how many cars are at each location, and each shop board by stage. Use for "how are we looking", "what is in the shops", or when you need to know where things stand before answering.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'sold_lookup',
    description:
      'What sold, and for what. Optionally narrowed to one car. Only returns money if the caller is allowed to see money — if figures come back missing, say so rather than guessing.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Last 6 or stock number to look up one car; leave empty for recent sales' },
        days: { type: 'integer', description: 'How far back for recent sales. Default 30.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'propose_move',
    description:
      'Propose moving a car to a new location. THIS DOES NOT MOVE ANYTHING — it returns a card the person confirms with a tap. Call it once you know which car and which place. If you are not sure which car, ask instead of guessing.',
    input_schema: {
      type: 'object',
      properties: {
        stock_number: { type: 'string', description: 'The stock number from find_car. Required — never invent one.' },
        location: { type: 'string', description: 'The location_code to move it to, from the vocabulary in your instructions' },
        note: { type: 'string', description: 'Why, in the speaker\'s own words, cleaned up. e.g. "front bumper", "to be buffed". Empty if they gave no reason.' },
      },
      required: ['stock_number', 'location'],
      additionalProperties: false,
    },
  },
]

async function runTool(db, name, input, vocab) {
  if (name === 'find_car') {
    const rows = await resolveCar(db, input.query)
    if (!rows?.length) return { found: false, note: `Nothing in inventory matches "${input.query}".` }
    if (rows.length > 1) {
      return {
        found: true, ambiguous: true,
        cars: rows.map((r) => ({
          stock_number: r.stock_number, last6: six(r.vehicle_vin),
          vehicle: [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(' '),
        })),
      }
    }
    return { found: true, car: await carCard(db, rows[0]) }
  }

  if (name === 'list_cars') {
    if (input.shop) {
      const view = input.shop === 'body' ? 'body_shop_board' : 'mechanic_board'
      const q = input.status ? `&status=eq.${encodeURIComponent(input.status)}` : '&status=neq.done'
      const rows = await db.get(`${view}?select=stock_number,vin6,vehicle_year,vehicle_make,vehicle_model,status,days_owned,days_in_shop&order=days_owned.desc&limit=40${q}`)
      return { count: rows.length, cars: rows }
    }
    if (!input.location) return { error: 'Give a location or a shop.' }
    const rows = await db.get(`vehicle_locations?physical_location=eq.${encodeURIComponent(input.location)}&select=stock_number,vin,physical_location,location_updated_at&order=location_updated_at.asc&limit=40`)
    return { count: rows.length, cars: rows }
  }

  if (name === 'lot_summary') {
    const [locs, body, mech] = await Promise.all([
      db.get('vehicle_locations?select=physical_location&limit=5000'),
      db.get('body_shop_board?select=status&status=neq.done&limit=1000').catch(() => []),
      db.get('mechanic_board?select=status&status=neq.done&limit=1000').catch(() => []),
    ])
    const tally = (rows, key) => rows.reduce((m, r) => {
      const k = r[key] || 'unknown'; m[k] = (m[k] || 0) + 1; return m
    }, {})
    return {
      by_location: tally(locs, 'physical_location'),
      body_shop: tally(body, 'status'),
      mechanic: tally(mech, 'status'),
      location_labels: vocab.labels,
    }
  }

  if (name === 'sold_lookup') {
    // sold_rows() is the sanctioned path — reading the table directly is what
    // the cost/profit role grants exist to stop.
    const rows = await db.rpc('sold_rows').catch(() => null)
    if (!Array.isArray(rows)) return { allowed: false, note: 'This account cannot see sold figures.' }
    if (input.query) {
      const tail = six(input.query)
      const hit = rows.filter((r) =>
        (r.stock_number === input.query) ||
        (tail.length >= 4 && String(r.vehicle_vin || '').toUpperCase().endsWith(tail)))
      return { count: hit.length, sales: hit.slice(0, 5) }
    }
    const days = input.days || 30
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)
    const recent = rows.filter((r) => (r.sale_date || '') >= since)
    return { count: recent.length, since, sales: recent.slice(0, 40) }
  }

  if (name === 'propose_move') {
    const code = String(input.location || '').trim()
    if (!vocab.codes.has(code)) {
      return { ok: false, error: `"${code}" is not a place we track. Valid: ${[...vocab.codes].join(', ')}` }
    }
    const rows = await db.get(`inventory?stock_number=eq.${encodeURIComponent(input.stock_number)}&select=${INV_COLS}&limit=1`)
    if (!rows.length) return { ok: false, error: `No car with stock ${input.stock_number}.` }
    const card = await carCard(db, rows[0])
    // Handed back to the phone, which draws it and waits for a tap. Nothing is
    // written here — see rule 1 at the top of this file.
    return {
      ok: true,
      proposal: {
        kind: 'location_move',
        stock_number: card.stock_number,
        vin: card.vin,
        last6: card.last6,
        vehicle: card.vehicle,
        from: card.location?.physical_location || null,
        from_label: vocab.labels[card.location?.physical_location] || card.location?.physical_location || 'Unknown',
        to: code,
        to_label: vocab.labels[code] || code,
        note: String(input.note || '').trim() || null,
      },
    }
  }

  return { error: `unknown tool ${name}` }
}

// The place vocabulary, read live rather than hardcoded — this is the same
// table the Telegram bot matches against, so adding a shop there teaches the
// voice agent about it at the same moment. (The old history trigger's
// hardcoded list of nine shops is exactly the rot this avoids.)
async function loadVocab(db) {
  // Deliberately NOT caught. location_keywords is RLS'd to employees, so an
  // empty read means the caller's token didn't carry what it should — and a
  // silent empty vocabulary turns every move into "that is not a place we
  // track", which reads like the agent being stupid rather than the request
  // being unauthorised.
  const rows = await db.get('location_keywords?select=keyword,location_code,label&limit=500')
  const labels = {}
  const words = {}
  for (const r of rows) {
    const code = r.location_code
    if (r.label && !labels[code]) labels[code] = String(r.label).replace(/\s+/g, ' ').trim()
    ;(words[code] ||= []).push(r.keyword)
  }
  return { codes: new Set(Object.keys(words)), labels, words }
}

function vocabPrompt(vocab) {
  const lines = Object.keys(vocab.words).sort().map((code) =>
    `  ${code} — ${vocab.labels[code] || code} (heard as: ${vocab.words[code].join(', ')})`)
  return `\n\nPLACES YOU CAN MOVE A CAR TO. Use the code on the left, never invent one:\n${lines.join('\n')}`
}

const SYSTEM = `You are the voice of a used-car dealership's operations system. Somebody is talking to you out loud, usually standing next to a car, often with one hand full. Answer like a sharp yard manager who knows the lot: short, specific, no preamble.

WHAT YOU ARE FOR
Two things, and you switch between them without being told which:
  1. MOVING CARS. "Dropping 123456 back to body shop for the front bumper."
     Look the car up, then propose the move. The person taps to confirm.
  2. ANSWERING ANYTHING about the lot, the shops, the cars, what sold.
     Look it up. Never answer a factual question from memory.

HOW TO TALK
- Spoken answers. One or two sentences unless asked for a list.
- Numbers out loud the way a person says them: "the last six is 1-2-3-4-5-6".
- Never read a raw location code aloud. Say "Body Shop", not "body_shop".
- If a lookup comes back empty, say so plainly. Do not soften it into a maybe.

MOVING A CAR — THE RULES
- ALWAYS find_car first. Never propose a move for a car you have not looked up.
- If find_car comes back ambiguous, read back the choices and ask which. Do not pick.
- If you cannot tell WHERE they mean, ask. "Pat or Andy to be buffed" might be a
  detail shop or a body shop — ask which, rather than guessing between them.
- The note is what they said the reason was, cleaned up. "for the front bumper"
  becomes "front bumper". If they gave no reason, leave it empty.
- One car per proposal. Three cars named in one breath is three proposals.
- You are proposing, not doing. Never say a car HAS moved — say what you are
  about to do, and that they need to confirm it.

WHAT YOU NEVER DO
- Never invent a stock number, a VIN, a price, or a location.
- Never guess which car when more than one matches.
- If a figure comes back missing because this account cannot see money, say
  that — do not estimate it.`

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

  const token = bearer(req)
  const user = await employeeFromToken(token)
  if (!user) { res.status(401).json({ error: 'Sign in again' }); return }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : []
    if (!messages.length) { res.status(400).json({ error: 'Nothing to answer' }); return }

    const db = reader(token)
    let vocab
    try {
      vocab = await loadVocab(db)
    } catch (e) {
      res.status(502).json({ error: `Could not read the location list: ${String(e.message || e).slice(0, 120)}` })
      return
    }
    if (!vocab.codes.size) {
      res.status(502).json({ error: 'The location list came back empty — moves would all be rejected.' })
      return
    }

    const today = new Date().toISOString().slice(0, 10)
    const system = SYSTEM
      + `\n\nToday is ${today}. You are talking to ${user.profile?.name || 'a member of staff'}.`
      + vocabPrompt(vocab)

    const convo = [...messages]
    const proposals = []
    let say = ''

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const data = await callClaude({
        model: MODEL,
        max_tokens: 1200,
        output_config: { effort: 'low' },
        system,
        tools: TOOLS,
        messages: convo,
      }, apiKey)

      const blocks = data.content || []
      say = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
      const calls = blocks.filter((b) => b.type === 'tool_use')
      if (!calls.length) break

      convo.push({ role: 'assistant', content: blocks })
      const results = []
      for (const call of calls) {
        let out
        try {
          out = await runTool(db, call.name, call.input || {}, vocab)
        } catch (e) {
          out = { error: String(e.message || e).slice(0, 300) }
        }
        if (call.name === 'propose_move' && out?.ok) proposals.push(out.proposal)
        results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(out) })
      }
      convo.push({ role: 'user', content: results })
    }

    res.status(200).json({
      say,
      proposals,
      // Sent back so the phone can keep the thread without re-deriving it.
      messages: convo.slice(messages.length),
    })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e).slice(0, 300) })
  }
}
