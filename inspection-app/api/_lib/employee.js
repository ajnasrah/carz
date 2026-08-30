// Who is calling, and are they staff.
//
// Supabase Auth does the verifying — signature, expiry, revocation — so a
// forged or expired token comes back null rather than being trusted.
//
// Lifted out of api/inspect-agent.js when the voice agent needed the same
// check. Both endpoints spend money per call and both can read a signed-in
// user's data, so neither may be open to whoever finds the URL.

export async function employeeFromToken(token) {
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
    `${base}/rest/v1/profiles?id=eq.${user.id}&select=name,role,account_type,approval_status`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!p.ok) return null
  const [profile] = await p.json().catch(() => [])
  if (!profile) return null
  const isEmployee = profile.role === 'admin'
    || ((profile.account_type || 'employee') === 'employee' && profile.approval_status === 'approved')
  return isEmployee ? { ...user, profile } : null
}

// Bearer token off an incoming request.
export function bearer(req) {
  const auth = req.headers.authorization || ''
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
}
