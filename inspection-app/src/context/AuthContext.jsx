import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { AuthContext } from './useAuth'
// Removed automatic admin setup - handled by database migration instead
// import { ensurePrimaryAdmin } from '../services/adminSetup'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Primary admin is now handled by database migration
    // No need to call ensurePrimaryAdmin() from frontend
    
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
      else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(userId) {
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
