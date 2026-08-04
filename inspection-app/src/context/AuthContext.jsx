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
        loadProfile(session.user.id)
      } else {
        setProfile(null)
        setLoading(false)
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => hydrate(session))

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

    return () => {
      cancelled = true
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
        setProfile(data)
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
        setProfile(inserted)
      }
    } finally {
      setLoading(false)
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
