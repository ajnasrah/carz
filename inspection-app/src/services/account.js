// Your own account: the one thing you can do to it that isn't reversible.
//
// Goes through /api/delete-account rather than deleting from here, for the same
// reason reserving a car does: this browser holds the public anon key, and no
// key a browser holds may be able to destroy an auth user — if it could, it
// could destroy somebody else's. The endpoint resolves the caller from their
// own session token and deletes that id and no other. Nothing is sent in the
// body; there is nothing to send.

import { supabase } from './supabase'
import { API_BASE_URL } from '../native/platform'

// Set on the way out and read once by the login screen, so the "your account
// was deleted" confirmation survives the sign-out that immediately follows —
// by then this component is gone and there is no navigation state left to carry
// it. sessionStorage rather than a query string because the native shell has no
// URL to put one in.
const DELETED_FLAG = 'accountDeleted'

export function markAccountDeleted() {
  try { sessionStorage.setItem(DELETED_FLAG, '1') } catch { /* private mode */ }
}

// Reading and clearing are separate on purpose. Doing both in one call, from a
// useState initializer, breaks under StrictMode: React deliberately invokes
// initializers twice in development, the first call eats the flag and the
// second returns false, so the confirmation never appears while you're working
// on it. Read is pure; the clearing happens in an effect, where running twice
// costs nothing.
export function readAccountDeletedFlag() {
  try { return sessionStorage.getItem(DELETED_FLAG) === '1' } catch { return false }
}

export function clearAccountDeletedFlag() {
  try { sessionStorage.removeItem(DELETED_FLAG) } catch { /* private mode */ }
}

// Deletes the account for good and resolves with what went (see
// purge_account_data). Throws with a readable message otherwise — and a throw
// here always means nothing was deleted, so retrying is safe.
export async function deleteMyAccount() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sign in again and retry')

  const res = await fetch(`${API_BASE_URL}/api/delete-account`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Could not delete your account (${res.status})`)
  return body?.summary || null
}
