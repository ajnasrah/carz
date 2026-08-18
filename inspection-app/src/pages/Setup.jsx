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
  { key: 'body_shop_tech',     label: 'Body Shop Tech',          emoji: '🔨' },
  { key: 'detail_manager',     label: 'Detail Manager',          emoji: '✨' },
  { key: 'accounting',         label: 'Accounting',              emoji: '🧾' },
  { key: 'owner_admin',        label: 'Owner / Admin',           emoji: '👑' },
]

export default function Setup() {
  const navigate = useNavigate()
  const { user, profile, refreshProfile } = useAuth()
  const [accountType, setAccountType] = useState(null) // 'buyer' | 'employee'
  const [name, setName] = useState('')
  const [roles, setRoles] = useState([])
  // Buyer accounts only. A reserved car is inventory off the market, so we need
  // the dealership, someone to call, and someone to invoice before that can
  // happen — see api/reserve-car.js, which refuses without them.
  const [biz, setBiz] = useState({
    dealer_name: '', contact_phone: '', contact_email: '',
    billing_name: '', billing_phone: '', billing_email: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Prefill if the user had partial data
  useEffect(() => {
    if (profile?.name) setName(profile.name)
    if (profile?.account_type) setAccountType(profile.account_type)
    if (profile?.roles?.length) setRoles(profile.roles)
    else if (profile?.role) setRoles([profile.role])
    setBiz((b) => ({
      dealer_name: profile?.dealer_name ?? b.dealer_name,
      // The phone they signed in with is the obvious default for the contact
      // number; they can change it if the desk line is different.
      contact_phone: profile?.contact_phone ?? profile?.phone ?? b.contact_phone,
      contact_email: profile?.contact_email ?? b.contact_email,
      billing_name: profile?.billing_name ?? b.billing_name,
      billing_phone: profile?.billing_phone ?? b.billing_phone,
      billing_email: profile?.billing_email ?? b.billing_email,
    }))
  }, [profile])

  // If already set up, kick to home (ProtectedRoute handles the approval gate)
  useEffect(() => {
    if (profile?.setup_complete) navigate('/', { replace: true })
  }, [profile, navigate])

  function toggleRole(key) {
    setRoles((prev) => prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key])
  }

  async function save(e) {
    e.preventDefault()
    setError('')
    if (!accountType) { setError('Please pick Buyer or Employee'); return }
    const trimmed = name.trim()
    if (!trimmed) { setError('Please enter your name'); return }
    if (accountType === 'employee' && roles.length === 0) {
      setError('Pick at least one role'); return
    }
    if (accountType === 'buyer') {
      if (!biz.dealer_name.trim()) { setError('Dealership name is required'); return }
      if (!biz.contact_phone.trim()) { setError('A contact phone is required'); return }
      // Either is enough to raise an invoice against; demanding both stalls signup
      // for a buyer whose billing desk only gave them one of them.
      if (!biz.billing_phone.trim() && !biz.billing_email.trim()) {
        setError('Add a billing phone or a billing email'); return
      }
    }
    setSaving(true)
    try {
      // Buyers have no internal role; employees keep their selected roles in roles[].
      const finalRoles = accountType === 'buyer' ? [] : roles
      // NOTE: the legacy `role` column has a CHECK constraint (admin | inspector), so we
      // must NOT write granular labels like 'lot_manager'/'buyer' into it — that would
      // fail the update and block signup. The real role(s) live in roles[]; buyer vs
      // employee is tracked by account_type. Admin is only ever granted from the Admin
      // panel (and the DB guard trigger blocks self-promotion anyway), so we don't touch
      // `role` here — new rows already default to 'inspector'.
      const { error: err } = await supabase
        .from('profiles')
        .update({
          name: trimmed,
          account_type: accountType,
          roles: finalRoles,
          setup_complete: true,
          // Buyers are approved by the DB guard on the NULL -> 'buyer' transition
          // (migration 20260818000007) because a buyer only ever reaches the
          // public marketplace. Employees still land pending for an admin.
          ...(accountType === 'buyer' ? {
            dealer_name: biz.dealer_name.trim(),
            contact_name: trimmed,
            contact_phone: biz.contact_phone.trim(),
            contact_email: biz.contact_email.trim() || null,
            billing_name: biz.billing_name.trim() || null,
            billing_phone: biz.billing_phone.trim() || null,
            billing_email: biz.billing_email.trim() || null,
          } : {}),
        })
        .eq('id', user.id)
      if (err) throw err
      if (refreshProfile) await refreshProfile()
      // A buyer who got here by pressing Reserve on a car should land back on
      // that car, not on a generic marketplace they then have to search.
      const pending = accountType === 'buyer' ? sessionStorage.getItem('reserveAfterSignup') : null
      if (pending) {
        sessionStorage.removeItem('reserveAfterSignup')
        navigate(pending, { replace: true })
      } else {
        navigate('/', { replace: true })
      }
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
        {/* Account type — buyer vs employee */}
        <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">
          I am a…
        </label>
        <div className="grid grid-cols-2 gap-3 mb-5">
          {[
            { key: 'buyer',    label: 'Buyer',    emoji: '🤝', sub: 'Shop the marketplace' },
            { key: 'employee', label: 'Employee', emoji: '🏢', sub: 'Carz Inc staff' },
          ].map((opt) => {
            const active = accountType === opt.key
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setAccountType(opt.key)}
                className={`flex flex-col items-center gap-1 p-4 rounded-xl border text-center transition-colors ${
                  active
                    ? 'bg-emerald-500/15 border-emerald-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-300'
                }`}
              >
                <span className="text-3xl">{opt.emoji}</span>
                <span className="font-bold text-sm">{opt.label}</span>
                <span className="text-[11px] text-slate-400">{opt.sub}</span>
              </button>
            )
          })}
        </div>

        <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">Your Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          placeholder="First + Last"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-3 text-base text-white focus:outline-none focus:border-emerald-500 mb-5"
        />

        {/* Buyers: the business behind the account. Required before a car can be
            reserved, so it is collected once here rather than interrupting later. */}
        {accountType === 'buyer' && (
          <>
            <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">Dealership</label>
            <input
              type="text" value={biz.dealer_name}
              onChange={(e) => setBiz((b) => ({ ...b, dealer_name: e.target.value }))}
              autoComplete="organization" placeholder="Dealership name"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-3 text-base text-white focus:outline-none focus:border-emerald-500 mb-4"
            />
            <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">How we reach you</label>
            <input
              type="tel" value={biz.contact_phone}
              onChange={(e) => setBiz((b) => ({ ...b, contact_phone: e.target.value }))}
              autoComplete="tel" placeholder="Phone"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-3 text-base text-white focus:outline-none focus:border-emerald-500 mb-2"
            />
            <input
              type="email" value={biz.contact_email}
              onChange={(e) => setBiz((b) => ({ ...b, contact_email: e.target.value }))}
              autoComplete="email" placeholder="Email (optional)"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-3 text-base text-white focus:outline-none focus:border-emerald-500 mb-4"
            />
            <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">
              Billing department <span className="text-slate-500 normal-case">(who we invoice)</span>
            </label>
            <input
              type="text" value={biz.billing_name}
              onChange={(e) => setBiz((b) => ({ ...b, billing_name: e.target.value }))}
              placeholder="Contact name"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-3 text-base text-white focus:outline-none focus:border-emerald-500 mb-2"
            />
            <input
              type="tel" value={biz.billing_phone}
              onChange={(e) => setBiz((b) => ({ ...b, billing_phone: e.target.value }))}
              placeholder="Billing phone"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-3 text-base text-white focus:outline-none focus:border-emerald-500 mb-2"
            />
            <input
              type="email" value={biz.billing_email}
              onChange={(e) => setBiz((b) => ({ ...b, billing_email: e.target.value }))}
              placeholder="Billing email"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-3 text-base text-white focus:outline-none focus:border-emerald-500 mb-5"
            />
          </>
        )}

        {/* Roles only apply to employees */}
        {accountType === 'employee' && (
          <>
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
          </>
        )}

        {accountType === 'employee' && (
          <p className="text-xs text-slate-500 mb-3">
            After you continue, an admin will review and approve your account before you get access.
          </p>
        )}
        {accountType === 'buyer' && (
          <p className="text-xs text-slate-500 mb-3">
            You'll go straight to the marketplace. Reserving a car takes it off the
            market and texts our team, so we ask for billing details up front.
          </p>
        )}

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
