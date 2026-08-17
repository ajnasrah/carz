// "Request access" on the Sold Reports lock screen lands here.
//
// WHY THIS IS A FUNCTION AND NOT A supabase.from(...).insert() IN THE APP
// The queue has no INSERT policy — the browser holds the public anon key, so any
// row it can write, anyone can write. If the app inserted directly it could file
// a request under someone else's user_id, or fill the admin's queue with names
// that never asked. Here the caller proves who they are with their own session
// token, this function resolves that token to a user id against Supabase Auth,
// and the row is written with the service key using the id the token proved —
// never an id the caller sent. The request body carries nothing but an optional
// note.
//
// Granting is not done here. An admin flips profiles.sold_reports_access from the
// Admin panel; the column guard (migration 20260817000001) makes that the only
// way it can be turned on.
//
// Env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_KEY
//               TELEGRAM_BOT_TOKEN + TELEGRAM_ADMIN_CHAT_ID (optional — if both
//               are set the owner gets a ping; a failed ping never fails the
//               request, the row in the queue is the real delivery)

// The native shell serves the bundle from capacitor://localhost, which is
// cross-origin to this host, and an Authorization header always triggers a
// preflight. Allow-Origin '*' is safe: the session token is the gate and it is
// sent explicitly, so no ambient credentials ride along.
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

// Resolve a session token to the user it belongs to. Supabase Auth does the
// verifying — signature, expiry, revocation — so an expired or forged token
// comes back 401 here rather than being trusted.
async function userFromToken(token) {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${token}`,
    },
  })
  if (!r.ok) return null
  const u = await r.json().catch(() => null)
  return u?.id ? u : null
}

async function notifyAdmin(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID
  if (!token || !chatId) return
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
  } catch (e) {
    console.error('sold-report-access: telegram notify failed:', e?.message || e)
  }
}

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
  if (!token) return send(res, 401, { error: 'Sign in first' })

  const user = await userFromToken(token)
  if (!user) return send(res, 401, { error: 'Your session expired — sign in again' })

  // Vercel parses a JSON body for us, but a string slips through when the
  // content type is off, so don't assume an object.
  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body || {}
  const note = String(body?.note || '').trim().slice(0, 500) || null

  // Who they are comes from the profile, not from the request body.
  const pr = await sb(
    `profiles?id=eq.${user.id}&select=name,phone,role,sold_reports_access`,
  )
  if (!pr.ok) return send(res, 502, { error: 'Could not read your account' })
  const profile = (await pr.json())[0]
  if (!profile) return send(res, 403, { error: 'No account found' })

  // Nothing to ask for — tell the app so it can just show the page.
  if (profile.role === 'admin' || profile.sold_reports_access === true) {
    return send(res, 200, { status: 'granted' })
  }

  // An open request already in the queue is the answer; re-pressing the button
  // shouldn't queue a second one or re-ping the owner.
  const existing = await sb(
    `sold_report_access_requests?user_id=eq.${user.id}&status=eq.pending&select=id,created_at`,
  )
  if (existing.ok) {
    const open = (await existing.json())[0]
    if (open) return send(res, 200, { status: 'pending', requestedAt: open.created_at })
  }

  const ins = await sb('sold_report_access_requests', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: user.id,
      name: profile.name || null,
      phone: profile.phone || null,
      note,
    }),
  })

  if (!ins.ok) {
    // 409 = the partial unique index fired, i.e. two taps raced each other.
    // Both callers wanted one open request and there is one, so that's a success.
    if (ins.status === 409) return send(res, 200, { status: 'pending' })
    const detail = await ins.text().catch(() => '')
    console.error('sold-report-access: insert failed', ins.status, detail)
    return send(res, 502, { error: 'Could not file your request' })
  }

  const row = (await ins.json().catch(() => []))[0] || null

  await notifyAdmin(
    [
      'Carz Inc — Sold Reports access request',
      `${profile.name || 'Someone'}${profile.phone ? ` (${profile.phone})` : ''} is asking for access.`,
      note ? `Note: ${note}` : null,
      'Approve it in the app: Admin Panel → Sold Reports Access.',
    ]
      .filter(Boolean)
      .join('\n'),
  )

  return send(res, 200, { status: 'pending', requestedAt: row?.created_at || null })
}

function safeParse(s) {
  try { return JSON.parse(s) } catch { return {} }
}
