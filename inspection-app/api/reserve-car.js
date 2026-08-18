// A buyer reserves a car: it comes off the marketplace and the owner gets a text.
//
// WHY THIS IS A FUNCTION AND NOT A CLIENT WRITE
// Reserving pulls a car off the market. If the browser could do it, any account
// holding the public anon key could take any car off the market, or reserve one
// in someone else's name. So the client sends a stock number and its own session
// token, and everything that matters is decided here: who the caller is (resolved
// from the token against Supabase Auth, never from the request body), whether the
// car is actually available, and only then the hide and the text.
//
// ORDER IS DELIBERATE — record, hide, then notify:
//   1. the reservation row is the source of truth and is written first
//   2. hiding it is what the buyer is promised, so it happens before the text
//   3. the text is best-effort; a Twilio outage must lose the notification and
//      never the car. Whether it went is stored on the row, so a missed text is
//      visible instead of silent.
//
// Env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_KEY,
//               TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM,
//               RESERVE_ALERT_PHONE (defaults to the owner's number below)

const OWNER_PHONE = process.env.RESERVE_ALERT_PHONE || '+19018319661'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}
function send(res, status, body) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  res.setHeader('Content-Type', 'application/json')
  res.status(status).json(body)
}

function sb(path, init = {}) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
}

// Supabase Auth does the verifying — signature, expiry, revocation — so a forged
// or expired token comes back 401 here rather than being trusted.
async function userFromToken(token) {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  })
  if (!r.ok) return null
  const u = await r.json().catch(() => null)
  return u?.id ? u : null
}

// Same routing rule as api/sms-nudge.js: TWILIO_FROM takes either a plain number
// or a Messaging Service SID, and an MG SID passed as From is rejected outright
// with an error that doesn't say why.
async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM
  if (!sid || !token || !from) return { sent: false, reason: 'twilio_not_configured' }
  const route = from.startsWith('MG') ? { MessagingServiceSid: from } : { From: from }
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, ...route, Body: body }),
    })
    if (!r.ok) return { sent: false, reason: (await r.text()).slice(0, 300) }
    return { sent: true }
  } catch (e) {
    return { sent: false, reason: String(e?.message || e).slice(0, 300) }
  }
}

const money = (v) => (v == null || v === '' ? 'no price listed' : `$${Number(v).toLocaleString()}`)

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return send(res, 503, { error: 'Server is not configured' })
  }

  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return send(res, 401, { error: 'Sign in to reserve a car' })
  const user = await userFromToken(token)
  if (!user) return send(res, 401, { error: 'Your session expired — sign in again' })

  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body || {}
  const stock = String(body?.stock_number || '').trim()
  if (!stock) return send(res, 400, { error: 'Which car?' })

  // Who they are comes from the profile, never from the request.
  const pr = await sb(`profiles?id=eq.${user.id}&select=name,phone,account_type,approval_status,` +
    `dealer_name,contact_name,contact_phone,contact_email,billing_name,billing_phone,billing_email`)
  if (!pr.ok) return send(res, 502, { error: 'Could not read your account' })
  const p = (await pr.json())[0]
  if (!p) return send(res, 403, { error: 'No account found' })
  if (p.approval_status !== 'approved') return send(res, 403, { error: 'Your account is not active yet' })

  // A reserved car is inventory off the market. Refuse until we know who to call
  // and who to invoice — the same fields the signup screen collects.
  const missing = []
  if (!p.dealer_name) missing.push('dealership name')
  if (!p.contact_phone && !p.phone) missing.push('contact phone')
  if (!p.billing_phone && !p.billing_email) missing.push('billing contact')
  if (missing.length) {
    return send(res, 400, { error: `Finish your account first — missing ${missing.join(', ')}`, needsProfile: missing })
  }

  // The car, and its asking price, from inventory.
  const ir = await sb(`inventory?stock_number=eq.${encodeURIComponent(stock)}&select=stock_number,vehicle_vin,vehicle_year,vehicle_make,vehicle_model,buy_now,total_cost`)
  if (!ir.ok) return send(res, 502, { error: 'Could not look up that car' })
  const car = (await ir.json())[0]
  if (!car) return send(res, 404, { error: 'That car is no longer in inventory' })

  // Already taken? The partial unique index below would reject the insert anyway;
  // checking first turns a 409 into a sentence the buyer can read.
  const ex = await sb(`car_reservations?stock_number=eq.${encodeURIComponent(stock)}&status=in.(reserved,confirmed)&select=id,buyer_id`)
  if (ex.ok) {
    const held = (await ex.json())[0]
    if (held) {
      return send(res, 409, {
        error: held.buyer_id === user.id ? 'You already reserved this car' : 'Someone just reserved this car',
        alreadyYours: held.buyer_id === user.id,
      })
    }
  }

  const price = car.buy_now ?? null
  const buyerName = p.contact_name || p.name || null

  // 1. record
  const ins = await sb('car_reservations', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      stock_number: car.stock_number,
      vin: car.vehicle_vin || null,
      buyer_id: user.id,
      buyer_name: buyerName,
      dealer_name: p.dealer_name,
      buyer_phone: p.contact_phone || p.phone || null,
      buyer_email: p.contact_email || null,
      billing_name: p.billing_name || null,
      billing_phone: p.billing_phone || null,
      billing_email: p.billing_email || null,
      price: price == null ? null : Number(String(price).replace(/[^0-9.-]/g, '')) || null,
    }),
  })
  if (!ins.ok) {
    if (ins.status === 409) return send(res, 409, { error: 'Someone just reserved this car' })
    console.error('reserve-car: insert failed', ins.status, (await ins.text()).slice(0, 300))
    return send(res, 502, { error: 'Could not record your reservation' })
  }
  const row = (await ins.json().catch(() => []))[0] || null

  // 2. off the market. Service key writes marketplace_hidden directly — the
  // hide_marketplace_car RPC requires the caller to be an admin, which a buyer
  // never is, and widening that check would let any signed-in account hide any car.
  const hide = await sb('marketplace_hidden', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ stock_number: car.stock_number, hidden_by: user.id }),
  })
  if (!hide.ok) {
    console.error('reserve-car: hide failed', hide.status, (await hide.text()).slice(0, 300))
    // The reservation stands and the text still goes out — better an owner who
    // knows about a car still showing than a silent half-reservation.
  }

  // 3. tell the owner
  const veh = [car.vehicle_year, car.vehicle_make, car.vehicle_model].filter(Boolean).join(' ')
  const text = [
    'CARZ INC — car reserved',
    `${veh || car.stock_number}`,
    `VIN ${car.vehicle_vin || '—'}`,
    `Price ${money(price)}`,
    `Buyer ${buyerName || 'unnamed'}${p.dealer_name ? ` — ${p.dealer_name}` : ''}`,
    p.contact_phone || p.phone ? `Call ${p.contact_phone || p.phone}` : null,
    `Stock ${car.stock_number}`,
  ].filter(Boolean).join('\n')
  const sms = await sendSms(OWNER_PHONE, text)
  if (row?.id) {
    await sb(`car_reservations?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ notified: sms.sent, notify_error: sms.sent ? null : String(sms.reason || '').slice(0, 300) }),
    }).catch(() => {})
  }
  if (!sms.sent) console.error('reserve-car: sms not sent —', sms.reason)

  return send(res, 200, {
    ok: true,
    reservationId: row?.id || null,
    hidden: hide.ok,
    notified: sms.sent,
    vehicle: veh || car.stock_number,
    price,
  })
}

function safeParse(s) { try { return JSON.parse(s) } catch { return {} } }
