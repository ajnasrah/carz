// The one place that talks to Twilio, and the one place that writes the message
// log.
//
// Lifted out of sms-nudge.js when the checklist cron became a second sender —
// the MG-SID rule below is the kind of thing that must not exist in two copies,
// because the second copy is the one that doesn't get the fix.

export function twilioConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM,
  )
}

// Every send and every reply, appended to sms_messages so the Messages screen
// can show a thread. Deliberately swallows its own errors: a log write that
// fails must never turn a delivered text into a reported failure, nor make the
// Twilio webhook retry. The text going out is the job; recording it is bookkeeping.
export async function logSms(row) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/sms_messages`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        direction: row.direction,
        phone: row.phone,
        name: row.name || null,
        body: String(row.body || '').slice(0, 4000),
        status: row.status,
        error: row.error ? String(row.error).slice(0, 500) : null,
        source: row.source || null,
        twilio_sid: row.sid || null,
      }),
    })
  } catch {
    /* bookkeeping only — never fail a send or a webhook over it */
  }
}

// Sends, then logs. `meta` carries who this is and which cron sent it, so the
// thread can be labelled without a second lookup.
export async function sendSms(to, body, meta = {}) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM
  if (!sid || !token || !from) return { sent: false, reason: 'twilio_not_configured' }

  // TWILIO_FROM takes either a plain number or a Messaging Service SID. An
  // A2P-10DLC-registered account (the BN… bundle) usually sends through a
  // Messaging Service, and that goes in a different field — passing an MG SID
  // as From is rejected outright, with an error that doesn't say why.
  const route = from.startsWith('MG') ? { MessagingServiceSid: from } : { From: from }

  let out
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, ...route, Body: body }),
    })
    if (!res.ok) {
      out = { sent: false, reason: (await res.text()).slice(0, 300) }
    } else {
      // Twilio's message SID, kept so a delivery can be chased in their console
      // later. A body that won't parse doesn't make the send a failure.
      const json = await res.json().catch(() => null)
      out = { sent: true, sid: json?.sid || null }
    }
  } catch (err) {
    // A network failure reaching Twilio is a failed send, not a crash that
    // takes the rest of the crew's texts down with it.
    out = { sent: false, reason: `network: ${err.message}` }
  }

  if (meta.log !== false) {
    await logSms({
      direction: 'out',
      phone: to,
      name: meta.name,
      body,
      status: out.sent ? 'sent' : 'failed',
      error: out.sent ? null : out.reason,
      source: meta.source,
      sid: out.sid,
    })
  }
  return out
}
