import { useEffect, useState, useRef } from 'react'
import { supabase } from '../services/supabase'
import { AuthContext } from './useAuth'
// Removed automatic admin setup - handled by database migration instead
// import { ensurePrimaryAdmin } from '../services/adminSetup'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    function hydrate(session) {
      if (cancelled) return
      setUser(session?.user ?? null)
      if (session?.user) {
        // Back to loading while the profile is fetched. Without this, signing
        // in flashed "Couldn't load your account": the initial getSession()
        // found no session and set loading=false, so by the time the auth
        // listener set `user`, ProtectedRoute saw user + null profile + not
        // loading — which is its fail-closed state — and rendered the error for
        // the duration of the profile query before correcting itself.
        //
        // That gate means "the profile genuinely failed to load", not "it
        // hasn't arrived yet". Only the query settling may clear this.
        setLoading(true)
        // Clear from HERE, not only from doLoadProfile's finally.
        //
        // loadProfile hands back the in-flight promise when one exists, and that
        // promise may ALREADY be settled: doLoadProfile clears loading inside its
        // own finally, and the outer .finally() that removes it from the map runs
        // a microtask later. A hydrate landing in that gap set loading=true and
        // then got a settled promise back, so nothing was ever going to clear it
        // again — the app sat on the loading screen forever. Both hydrates run on
        // a fresh sign-in (getSession and onAuthStateChange), so the gap is hit
        // often enough to be the "it just loads" report. Attaching here works
        // either way: .finally() on a settled promise still fires.
        loadProfile(session.user.id)
          .catch(() => {})
          .finally(() => { if (!cancelled) setLoading(false) })
      } else {
        setProfile(null)
        setLoading(false)
      }
    }

    // No catch here meant a failed getSession (offline, DNS, Supabase blip) left
    // loading=true with nothing to clear it — a permanent loading screen for a
    // problem that has nothing to do with being signed in.
    supabase.auth.getSession()
      .then(({ data: { session } }) => hydrate(session))
      .catch((e) => {
        console.error('getSession failed:', e?.message || e)
        if (cancelled) return
        setUser(null); setProfile(null); setLoading(false)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Supabase runs this callback while holding its internal auth lock, and
      // loadProfile calls supabase.from(...) / supabase.auth.getUser(). Calling
      // back into the client from inside the callback deadlocks until the lock
      // times out, so the profile query never resolved and the first login
      // landed on "Couldn't load your account" — while a refresh worked, because
      // that path comes through getSession() with no lock held.
      //
      // Deferring to the next tick lets the callback return and release the
      // lock before we touch the client again.
      setTimeout(() => hydrate(session), 0)
    })

    // Last resort. Whatever else goes wrong, an app that shows a login screen is
    // recoverable and one that spins is not — you cannot even sign out of it.
    const backstop = setTimeout(() => {
      if (!cancelled) {
        setLoading((wasLoading) => {
          if (wasLoading) console.error('auth bootstrap timed out — showing signed-out state')
          return false
        })
      }
    }, 15000)

    return () => {
      cancelled = true
      clearTimeout(backstop)
      subscription.unsubscribe()
    }
  }, [])

  // getSession() and onAuthStateChange both fire on a fresh login, so without a
  // guard the first login runs two concurrent profile loads — and for a brand
  // new user, two concurrent upserts of the same row. Collapse to one in-flight
  // load per user id.
  const inFlight = useRef(new Map())

  function loadProfile(userId) {
    const existing = inFlight.current.get(userId)
    if (existing) return existing
    const p = doLoadProfile(userId).finally(() => inFlight.current.delete(userId))
    inFlight.current.set(userId, p)
    return p
  }

  async function doLoadProfile(userId) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()

      if (error) {
        console.error('Error loading profile:', error.message)
        setProfile(null)
        return
      }

      if (data) {
        setProfile(await claimPendingInvites(data))
        return
      }

      const { data: { user: authUser } } = await supabase.auth.getUser()
      const { data: inserted, error: insertError } = await supabase
        .from('profiles')
        .upsert({
          id: userId,
          phone: authUser?.phone || null,
          name: '',
          role: 'inspector',
          // Explicit so a new user is always routed through Setup + approval, even if the
          // DB column default ever changes. (approval_status defaults to 'pending' in DB.)
          setup_complete: false,
        })
        .select()
        .single()

      if (insertError) {
        console.error('Profile provision failed:', insertError.message)
        setProfile(null)
      } else {
        setProfile(await claimPendingInvites(inserted))
      }
    } finally {
      setLoading(false)
    }
  }

  // Someone an admin added by phone number is already approved — they just
  // hadn't logged in yet. Their first sign-in claims that invite, so they land on
  // the dashboard (or their cars) instead of the Setup screen and the pending
  // queue. That queue is a dead end for a crew onboarding off a download link:
  // nothing tells them when they're approved and nothing brings them back.
  //
  // Both claims are attempted, because they grant different things and a body
  // shop tech may also be on the staff roster: claim_staff_invite reads
  // allowed_users (the Admin panel's "Add User" form) and settles name, role and
  // approval; claim_body_shop_tech_invite adds the body_shop_tech role.
  //
  // Only ever asked for an account that isn't finished: both RPCs match the phone
  // on the caller's own auth record, so a settled user has nothing to claim and
  // the round trip would be dead weight on every load.
  async function claimPendingInvites(row) {
    if (!row || (row.setup_complete && row.approval_status === 'approved')) return row
    try {
      // Sequential, not Promise.all — both UPDATE the same profiles row, and
      // running them concurrently makes the second read a row the first has
      // already changed, so whichever lands last wins on the shared columns.
      const staff = await supabase.rpc('claim_staff_invite')
      const tech = await supabase.rpc('claim_body_shop_tech_invite')
      if (!staff.data && !tech.data) return row
      const { data: fresh } = await supabase
        .from('profiles').select('*').eq('id', row.id).maybeSingle()
      return fresh || row
    } catch {
      return row   // never block a sign-in on this
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }

  async function refreshProfile() {
    if (user?.id) await loadProfile(user.id)
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut, loadProfile, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}
