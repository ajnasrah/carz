// Inbound SMS: whatever anyone texts back to the Carz Inc number is written
// down, then sent straight to the owner's phone.
//
// The crew reply to the nudges and the daily checklists — "picked it up",
// "that one's sold", "inventory's done" — and without this those answers land
// in a Twilio log nobody reads. Twilio POSTs every inbound message to this URL
// (set it on the number in the console under Messaging → A message comes in).
//
// IT IS LOGGED BEFORE IT IS FORWARDED. Forwarding alone meant the crew's
// answers lived in one man's messages app and nowhere else, so "did Luis ever
// say he finished inventory?" had no answer the system could give. Now every
// reply is a row in sms_messages, which is what lets the Messages screen show
// it underneath the checklist it is answering.
//
// The forward itself is unchanged: not a reply, just a copy, with the sender's
// number in the text so the owner can call or text them back directly.

import { sendSms, logSms } from './_lib/sms.js'

// Buyer Outreach: a reply from a buyer who was texted a car pauses that car, a
// STOP opts them out. Returns what matched (car, buyer) or null for everyone
// else — the crew, the owner, a stranger. Never throws.
async function outreachReply(phone, text) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/outreach_record_reply`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_phone: phone, p_body: text }),
    })
    if (!r.ok) return null
    return await r.json().catch(() => null)
  } catch {
    return null
  }
}

const FORWARD_TO = process.env.SMS_FORWARD_TO || '+19018319661'

function pretty(e164) {
  const d = String(e164 || '').replace(/\D/g, '').replace(/^1/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164
}

// Put a name on the number. Twilio hands over a phone and nothing else, and a
// thread headed "Chris" beats one headed "(901) 555-0100".
async function nameFor(phone) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/sms_name_for`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_phone: phone }),
    })
    if (!r.ok) return null
    const name = await r.json().catch(() => null)
    return typeof name === 'string' ? name : null
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  // Twilio posts form-encoded. Always answer 200 with empty TwiML — a non-2xx
  // makes Twilio retry, and an error page would be sent back to the crew member
  // as an auto-reply.
  const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
  res.setHeader('Content-Type', 'text/xml')

  try {
    const form = req.body || {}
    const from = form.From
    const text = form.Body
    if (!from || !text) return res.status(200).send(twiml)

    // Logged first, and logged even when it came from the owner himself. If the
    // forward below fails — Twilio down, a bad number — the crew member's answer
    // still exists somewhere a person can read it.
    // Outreach first: it's one quick call, and pausing the car is the part a
    // buyer is waiting on. Its failure is swallowed, so the log below still runs.
    const outreach = await outreachReply(from, text)

    await logSms({
      direction: 'in',
      phone: from,
      name: await nameFor(from),
      body: text,
      status: 'received',
      source: 'reply',
      sid: form.MessageSid || null,
    })

    // Don't loop: if the owner texts the number himself, forwarding it back to
    // him would bounce forever.
    if (String(from).replace(/\D/g, '') === String(FORWARD_TO).replace(/\D/g, '')) {
      return res.status(200).send(twiml)
    }

    // log:false — this is a copy for the owner's phone, not a message to a crew
    // member. Logging it would put the owner in the middle of every thread.
    // A buyer answering an outreach text gets the car named in the copy, and
    // whether the queue paused on it, so the owner knows what he's replying about.
    let head = `Reply from ${pretty(from)}:`
    if (outreach?.opted_out) {
      head = `Buyer opted out - ${outreach.buyer_name || pretty(from)} (${pretty(from)}):`
    } else if (outreach?.car_id) {
      const state = outreach.paused ? 'PAUSED, waiting on you' : `car is ${outreach.car_status}`
      head = `Buyer reply - ${outreach.buyer_name || pretty(from)} (${pretty(from)})\n` +
        `Re: ${outreach.car} VIN ${outreach.vin}\n${state} - carzinc.ai/outreach`
    }
    await sendSms(FORWARD_TO, `${head}\n${text}`, { log: false })
  } catch {
    /* never fail the webhook — Twilio would retry and the crew would see it */
  }
  return res.status(200).send(twiml)
}
