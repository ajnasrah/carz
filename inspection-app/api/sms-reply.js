// Inbound SMS: whatever anyone texts back to the Carz Inc number goes straight
// to the owner's phone.
//
// The crew reply to these nudges — "picked it up", "that one's sold" — and
// without this those answers land in a Twilio log nobody reads. Twilio POSTs
// every inbound message to this URL (set it on the number in the console under
// Messaging → A message comes in).
//
// The reply is forwarded, not answered: the sender's number is put in the text
// so the owner can just call or text them back directly.
const FORWARD_TO = process.env.SMS_FORWARD_TO || '+19018319661'

function pretty(e164) {
  const d = String(e164 || '').replace(/\D/g, '').replace(/^1/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164
}

export default async function handler(req, res) {
  // Twilio posts form-encoded. Always answer 200 with empty TwiML — a non-2xx
  // makes Twilio retry, and an error page would be sent back to the crew member
  // as an auto-reply.
  const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
  res.setHeader('Content-Type', 'text/xml')

  try {
    const body = req.body || {}
    const from = body.From
    const text = body.Body
    if (!from || !text) return res.status(200).send(twiml)

    const sid = process.env.TWILIO_ACCOUNT_SID
    const token = process.env.TWILIO_AUTH_TOKEN
    const sender = process.env.TWILIO_FROM
    if (!sid || !token || !sender) return res.status(200).send(twiml)

    // Don't loop: if the owner texts the number himself, forwarding it back to
    // him would bounce forever.
    if (String(from).replace(/\D/g, '') === String(FORWARD_TO).replace(/\D/g, '')) {
      return res.status(200).send(twiml)
    }

    const route = sender.startsWith('MG')
      ? { MessagingServiceSid: sender }
      : { From: sender }

    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: FORWARD_TO,
        ...route,
        Body: `Reply from ${pretty(from)}:\n${text}`,
      }),
    })
  } catch {
    /* never fail the webhook — Twilio would retry and the crew would see it */
  }
  return res.status(200).send(twiml)
}
