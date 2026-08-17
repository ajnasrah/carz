// Who may look at the sold book, and who may take it out of the building.
//
// Two different questions, deliberately answered by two different rules:
//
//   viewing  — admins, plus anyone an admin ticked the box for. The sold book is
//              cost, sale price and profit per car; some people need to read it.
//   exporting — admins only, no exceptions and no per-user override. An export is
//              a spreadsheet of the whole margin structure that leaves the app and
//              can be forwarded anywhere, so it stays with the owner.
//
// The view flag is profiles.sold_reports_access. It is admin-writable only —
// guard_profile_privileges() pins it for everyone else (migration
// 20260817000001), so this is a real gate and not just a hidden button.

import { supabase } from './supabase'
import { isAdminProfile } from './adminSetup'
import { API_BASE_URL } from '../native/platform'

// Admins are never stamped with the flag — being an admin IS the grant. That way
// promoting or demoting somebody doesn't leave a stale tick behind.
export function canSeeSoldReports(profile) {
  if (!profile) return false
  return isAdminProfile(profile) || profile.sold_reports_access === true
}

export function canExportSoldReports(profile) {
  return isAdminProfile(profile)
}

// Ask for access. Goes through the API function rather than writing the row from
// here: the queue has no INSERT policy for the public keys, so the endpoint
// verifies the session token and stamps the user id itself. See
// api/sold-report-access.js.
//
// Resolves to 'pending' | 'granted' ('granted' means there was nothing to ask
// for — the flag is already on), throws with a readable message otherwise.
export async function requestSoldReportsAccess(note) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sign in again and retry')

  const res = await fetch(`${API_BASE_URL}/api/sold-report-access`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ note: note || undefined }),
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body.status || 'pending'
}

// The caller's own latest request, so the lock screen can say "waiting on an
// admin" after a reload instead of offering the button again. Readable directly:
// the select policy covers your own row.
export async function fetchMyAccessRequest(userId) {
  if (!userId) return null
  const { data, error } = await supabase
    .from('sold_report_access_requests')
    .select('id, status, note, created_at, decided_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0] || null
}

// The admin queue. Only pending rows — decided ones are history and would grow
// the panel forever.
export async function fetchPendingAccessRequests() {
  const { data, error } = await supabase
    .from('sold_report_access_requests')
    .select('id, user_id, name, phone, note, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Turn the flag on or off for one person. Separate from the request queue on
// purpose: an admin can tick the checkbox for somebody who never asked, and can
// untick it later, without a request row existing either time.
export async function setSoldReportsAccess(userId, allowed) {
  const { error } = await supabase
    .from('profiles')
    .update({ sold_reports_access: allowed })
    .eq('id', userId)
  if (error) throw error
}

// Answer a request. The flag write comes FIRST: if the second call fails the
// person has the access they asked for and the request stays in the queue, which
// an admin can see and clear. The other order would close the request and grant
// nothing, which looks handled and isn't.
export async function decideAccessRequest(request, granted, deciderId) {
  if (granted) await setSoldReportsAccess(request.user_id, true)
  const { error } = await supabase
    .from('sold_report_access_requests')
    .update({
      status: granted ? 'granted' : 'denied',
      decided_at: new Date().toISOString(),
      decided_by: deciderId || null,
    })
    .eq('id', request.id)
  if (error) throw error
}
