import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/useAuth'

const ROLE_OPTIONS = [
  { key: 'inbound_inspector',  label: 'Inbound Inspector',       emoji: '📥' },
  { key: 'outbound_inspector', label: 'Outbound Inspector',      emoji: '📤' },
  { key: 'lot_manager',        label: 'Lot Manager',             emoji: '🚗' },
  { key: 'mechanic_manager',   label: 'Mechanic Shop Manager',   emoji: '🔧' },
  { key: 'body_shop_manager',  label: 'Body Shop Manager',       emoji: '🎨' },
  { key: 'detail_manager',     label: 'Detail Manager',          emoji: '✨' },
  { key: 'owner_admin',        label: 'Owner / Admin',           emoji: '👑' },
]

export default function Setup() {
  const navigate = useNavigate()
  const { user, profile, refreshProfile } = useAuth()
  const [name, setName] = useState('')
  const [roles, setRoles] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Prefill if the user had partial data
  useEffect(() => {
    if (profile?.name) setName(profile.name)
    if (profile?.roles?.length) setRoles(profile.roles)
    else if (profile?.role) setRoles([profile.role])
  }, [profile])

  // If already set up, kick to home
  useEffect(() => {
    if (profile?.setup_complete) navigate('/', { replace: true })
  }, [profile, navigate])

  function toggleRole(key) {
    setRoles((prev) => prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key])
  }

  async function save(e) {
    e.preventDefault()
    setError('')
    const trimmed = name.trim()
    if (!trimmed) { setError('Please enter your name'); return }
    if (roles.length === 0) { setError('Pick at least one role'); return }
    setSaving(true)
    try {
      const { error: err } = await supabase
        .from('profiles')
        .update({
          name: trimmed,
          roles,
          role: roles[0],        // keep legacy single role aligned with the first selection
          setup_complete: true,
        })
        .eq('id', user.id)
      if (err) throw err
      if (refreshProfile) await refreshProfile()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Could not save — try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page min-h-screen flex flex-col">
      <div className="text-center mb-6 mt-8">
        <h1 className="text-2xl font-bold text-emerald-400">Welcome</h1>
        <p className="text-sm text-slate-400 mt-1">Tell us who you are</p>
      </div>

      <form onSubmit={save} className="flex-1 flex flex-col">
        <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">Your Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          autoComplete="name"
          placeholder="First + Last"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-3 text-base text-white focus:outline-none focus:border-emerald-500 mb-5"
        />

        <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">
          What do you do? <span className="text-slate-500 normal-case">(pick all that apply)</span>
        </label>
        <div className="space-y-2 mb-5">
          {ROLE_OPTIONS.map((opt) => {
            const active = roles.includes(opt.key)
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => toggleRole(opt.key)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
                  active
                    ? 'bg-emerald-500/15 border-emerald-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-300'
                }`}
              >
                <span className="text-2xl">{opt.emoji}</span>
                <span className="flex-1 font-bold text-sm">{opt.label}</span>
                <span
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs ${
                    active ? 'bg-emerald-500 border-emerald-500 text-slate-900' : 'border-slate-600'
                  }`}
                >
                  {active ? '✓' : ''}
                </span>
              </button>
            )
          })}
        </div>

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-emerald-500 text-slate-900 font-bold py-3 rounded-lg disabled:opacity-40 mb-4"
        >
          {saving ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}
