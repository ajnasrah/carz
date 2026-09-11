// "Delete my account" — the real thing, not a deactivation.
//
// App Review rejected 1.0 (15) under guideline 5.1.1(v) because the app could
// create an account and not remove one. What Apple requires is that the user
// can start AND finish the deletion inside the app, without phoning anybody, so
// this endpoint has to actually destroy the login — not flag it, not hide it,
// not queue it for an admin.
//
// WHY A FUNCTION AND NOT A DELETE FROM THE APP
// The browser holds the public anon key, and no key it holds may be able to
// delete an auth user; if it could, it could delete somebody else's. So the
// caller proves who they are with their own session token, Supabase Auth
// resolves that token to a user id, and everything below runs against THAT id.
// The request body is ignored entirely — there is no user id here to forge.
//
// ORDER MATTERS, AND IT IS THIS WAY ROUND
//   1. purge_account_data(id) — the phone-keyed rows (staff roster, body shop
//      invite, checklist texts, message log) and any car still being held.
//      These have to go first because they are found BY the phone number on the
//      profile, and step 2 takes the profile with it.
//   2. DELETE the auth user through GoTrue's admin API, which invalidates the
//      sessions and refresh tokens as well as the row — deleting straight out
//      of auth.users over SQL would leave those behind. profiles,
//      buyer_billing_locations and sold_report_access_requests cascade from it;
//      every other record that named this person keeps the record and drops the
//      name (ON DELETE SET NULL, migration 20260912000001).
//
// If step 2 fails, step 1 has still applied and the account is still there to
// try again — recoverable, and the user is told to retry. The other order would
// delete the login and strand their phone number in the roster, where it would
// re-approve the number on its next sign-in.
//
// Env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_KEY
//               TELEGRAM_BOT_TOKEN + TELEGRAM_ADMIN_CHAT_ID (optional — the
//               owner gets told someone left; a failed ping never fails a
//               deletion that already happened)

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

function svcHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

// Resolve a session token to the user it belongs to. Supabase Auth does the
// verifying — signature, expiry, revocation — so an expired or forged token
// comes back 401 here rather than being trusted.
async function userFromToken(token) {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
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
    console.error('delete-account: telegram notify failed:', e?.message || e)
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
  if (!user) return send(res, 401, { error: 'Your session expired — sign in again and try once more' })

  // Read it before it's gone, purely so the owner's notification can say who
  // left. Nothing below depends on this succeeding.
  let who = null
  try {
    const pr = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=name,phone,role,account_type`,
      { headers: svcHeaders() },
    )
    if (pr.ok) who = (await pr.json())[0] || null
  } catch { /* the deletion doesn't wait on this */ }

  // Step 1 — the personal data no cascade reaches.
  const purge = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/purge_account_data`, {
    method: 'POST',
    headers: svcHeaders(),
    body: JSON.stringify({ p_user: user.id }),
  })
  if (!purge.ok) {
    const detail = await purge.text().catch(() => '')
    console.error('delete-account: purge failed', purge.status, detail.slice(0, 400))
    return send(res, 502, { error: "Couldn't clear your data — nothing was deleted. Try again." })
  }
  const summary = await purge.json().catch(() => null)

  // Step 2 — the login itself.
  const del = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: 'DELETE',
    headers: svcHeaders(),
  })
  if (!del.ok) {
    const detail = await del.text().catch(() => '')
    console.error('delete-account: auth delete failed', del.status, detail.slice(0, 400))
    return send(res, 502, {
      error: "Couldn't finish deleting your account. Nothing is lost — try again in a moment.",
    })
  }

  console.log('delete-account: deleted', user.id, JSON.stringify(summary))

  await notifyAdmin(
    [
      'Carz Inc — account deleted',
      `${who?.name || 'Someone'}${who?.phone ? ` (${who.phone})` : ''} deleted their own account from the app.`,
      who?.account_type === 'buyer' ? 'Buyer account.' : `Employee account${who?.role ? ` · ${who.role}` : ''}.`,
      summary?.reservations_released
        ? `${summary.reservations_released} held car(s) went back on the marketplace.`
        : null,
      summary?.reservations_kept
        ? `${summary.reservations_kept} confirmed reservation(s) kept as a record.`
        : null,
      summary?.roster_rows
        ? 'Their row on the staff roster went with it — re-add them in Admin → Add User if they come back.'
        : null,
    ]
      .filter(Boolean)
      .join('\n'),
  )

  return send(res, 200, { deleted: true, summary })
}
