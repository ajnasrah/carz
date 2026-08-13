// Nudge texts: every few days, tell whoever owns a section which of his cars
// have sat longest.
//
// WHY THIS DOESN'T REUSE THE SIGN-IN TWILIO
// Sign-in is supabase.auth.signInWithOtp({ phone }) — the app asks Supabase for
// a code, and Supabase's own auth service calls Twilio with credentials stored
// in its dashboard. Our code never holds them, and that path only sends login
// codes: there is no "send this text" call in it. So the same Twilio ACCOUNT is
// reused here, but its SID/token have to exist where this function runs.
//
// Until they do, this endpoint runs in dry-run: it builds every message and
// returns them without sending, so the wiring can be checked first.
//
// The cron fires daily; who is actually due is decided in the database
// (sms_nudges.every_days + last_sent_at), which is what makes "every 3 days"
// hold even if a run is missed, and lets the schedule change without a deploy.

const BUCKETS = {
  mechanic: 'at the mechanic',
  body_shop: 'in the body shop',
  stuck21: 'stuck 21+ days',
}

function sb(path, init = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`
  return fetch(url, {
    ...init,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
}

function buildMessage(name, bucket, cars) {
  if (!cars.length) return null // nothing to chase — don't send a text saying so
  const lines = cars.map((c, i) => {
    const bits = [c.vehicle || c.stock_number || 'Vehicle']
    if (c.vin) bits.push(`…${String(c.vin).slice(-6)}`)
    const age = []
    if (c.days_here != null) age.push(`${c.days_here}d there`)
    if (c.days_owned != null) age.push(`${c.days_owned}d owned`)
    return `${i + 1}. ${bits.join(' ')}${age.length ? ` · ${age.join(', ')}` : ''}`
  })
  return [
    `Carz Inc — ${name}, your ${cars.length} oldest ${BUCKETS[bucket] || bucket}:`,
    ...lines,
  ].join('\n')
}

async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM
  if (!sid || !token || !from) return { sent: false, reason: 'twilio_not_configured' }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  })
  if (!res.ok) return { sent: false, reason: (await res.text()).slice(0, 300) }
  return { sent: true }
}

export default async function handler(req, res) {
  // Vercel cron sends the project's CRON_SECRET as a bearer token. A manual run
  // can pass ?secret= instead, so this can be tested without waiting a day.
  const secret = process.env.CRON_SECRET
  const auth = req.headers.authorization || ''
  const ok = !secret
    || auth === `Bearer ${secret}`
    || req.query?.secret === secret
  if (!ok) return res.status(401).json({ error: 'unauthorized' })

  const dryRun = req.query?.dry === '1' || !process.env.TWILIO_ACCOUNT_SID

  try {
    const due = await sb(
      'sms_nudges?select=*&active=eq.true&order=name',
    ).then((r) => r.json())

    const now = Date.now()
    const results = []

    for (const person of due) {
      const gapDays = person.last_sent_at
        ? (now - new Date(person.last_sent_at).getTime()) / 86400000
        : Infinity
      if (gapDays < person.every_days) {
        results.push({ name: person.name, skipped: `sent ${gapDays.toFixed(1)}d ago` })
        continue
      }

      const cars = await sb('rpc/nudge_cars', {
        method: 'POST',
        body: JSON.stringify({ p_bucket: person.bucket, p_limit: person.cars }),
      }).then((r) => r.json())

      const body = buildMessage(person.name, person.bucket, Array.isArray(cars) ? cars : [])
      if (!body) {
        results.push({ name: person.name, skipped: 'nothing sitting' })
        continue
      }

      if (dryRun) {
        results.push({ name: person.name, to: person.phone, dryRun: true, body })
        continue
      }

      const out = await sendSms(person.phone, body)
      results.push({ name: person.name, to: person.phone, ...out })
      await sb(`sms_nudges?id=eq.${person.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(
          out.sent
            ? { last_sent_at: new Date().toISOString(), last_error: null }
            : { last_error: String(out.reason).slice(0, 500) },
        ),
      })
    }

    return res.status(200).json({ dryRun, count: results.length, results })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
