import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, LogOut, Trash2, TriangleAlert } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { deleteMyAccount, markAccountDeleted } from '../services/account'
import { isAdminProfile } from '../services/adminSetup'

// Your account, and the way out of it.
//
// This screen exists because App Review rejected 1.0 (15) under guideline
// 5.1.1(v): an app that can create an account has to be able to delete one from
// inside itself. So the rules it is built to are Apple's, not ours —
//
//   · deleting has to be reachable, not buried. It is one tap from the
//     dashboard, from the marketplace a buyer is locked to, and from the
//     pending screen someone waiting on approval is stuck on. Those are the
//     three places an account can be sitting.
//   · it may not be a deactivation, and it may not end in "call us". Pressing
//     the button here destroys the login before this screen is done with it.
//   · a confirmation step is allowed, and is the right call for something
//     irreversible — hence the second panel and typing the word out. What is
//     NOT allowed is making that step a phone call or an email.
//
// The list of what goes and what stays is written out in full before the
// button, because "delete my account" means different things in different apps
// and a person is entitled to know which one this is before they press it.
export default function Account() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile, signOut } = useAuth()

  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const phone = profile?.phone || user?.phone || ''
  const isBuyer = profile?.account_type === 'buyer'
  const accountLabel = isBuyer ? 'Buyer' : 'Employee'
  const roleLabel = isAdminProfile(profile) ? 'Admin' : (profile?.role || '').replace(/_/g, ' ')
  const armed = typed.trim().toUpperCase() === 'DELETE'

  // 'default' is react-router's key for the entry a tab opened on, i.e. nothing
  // behind us to go back to. The native shell has no browser back button, so
  // landing there with a dead arrow would be a corner with no way out.
  const canGoBack = location.key !== 'default'

  async function onDelete() {
    if (!armed || busy) return
    setBusy(true)
    setError('')
    try {
      await deleteMyAccount()
      // Order matters: the flag is set before the sign-out, because the
      // sign-out is what unmounts this screen — the login page reads it and
      // shows the confirmation.
      markAccountDeleted()
      await signOut()
      navigate('/login', { replace: true })
    } catch (e) {
      // Every throw from deleteMyAccount means nothing was deleted, so saying
      // "try again" is honest rather than hopeful.
      setError(e?.message || 'Could not delete your account. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="page pb-24">
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => (canGoBack ? navigate(-1) : navigate('/', { replace: true }))}
          className="p-2 -ml-2 rounded-lg bg-slate-800 text-slate-300"
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-emerald-400">Account</h1>
      </div>

      <div className="card mb-4">
        <p className="text-lg font-bold text-white">{profile?.name || 'Your account'}</p>
        <p className="text-sm text-slate-400 mt-0.5">{phone || '—'}</p>
        {/* Nothing is asserted about an account whose profile didn't load —
            this screen is reachable with profile===null (requireSetup={false})
            precisely so a broken account can still be deleted, and labelling
            that one "Employee" would be a guess. */}
        <div className="flex flex-wrap gap-2 mt-3">
          {profile && (
            <span className="text-[11px] uppercase tracking-wide bg-slate-900 text-slate-400 border border-slate-700 rounded-full px-2.5 py-1">
              {accountLabel}
            </span>
          )}
          {roleLabel && (
            <span className="text-[11px] uppercase tracking-wide bg-slate-900 text-slate-400 border border-slate-700 rounded-full px-2.5 py-1">
              {roleLabel}
            </span>
          )}
          {profile?.approval_status && profile.approval_status !== 'approved' && (
            <span className="text-[11px] uppercase tracking-wide bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-full px-2.5 py-1">
              {profile.approval_status}
            </span>
          )}
        </div>
      </div>

      <button onClick={signOut} className="btn-secondary flex items-center justify-center gap-2 mb-8">
        <LogOut size={18} />
        Sign out
      </button>

      {/* ------------------------------------------------------------------ */}
      <h2 className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Delete account</h2>

      {!confirming ? (
        <div className="card border-red-500/30">
          <p className="text-sm text-slate-300">
            Deleting your account removes your sign-in and your personal details from
            Carz Inc for good. It happens straight away and it cannot be undone.
          </p>
          <button
            onClick={() => setConfirming(true)}
            className="mt-4 w-full flex items-center justify-center gap-2 bg-red-500/10 text-red-400 border border-red-500/40 font-semibold py-3 rounded-lg active:bg-red-500/20"
          >
            <Trash2 size={18} />
            Delete my account
          </button>
        </div>
      ) : (
        <div className="card border-red-500/40">
          <div className="flex items-start gap-2 mb-3">
            <TriangleAlert size={18} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm font-bold text-white">
              This deletes your account permanently. There is no undo.
            </p>
          </div>

          <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">What gets deleted</p>
          <ul className="text-sm text-slate-300 space-y-1.5 mb-4 list-disc pl-5">
            <li>
              Your sign-in. {phone ? <span className="text-slate-400">{phone}</span> : 'Your phone number'} will no
              longer get you in, here or on the website.
            </li>
            <li>Your name, phone, and any contact or billing details on your profile.</li>
            {isBuyer ? (
              <li>Your billing locations, and any car you have on hold — it goes back on the market.</li>
            ) : (
              <li>
                Your place on the staff roster, any invite waiting for your number, your daily checklist
                texts, and the record of texts to and from your number.
              </li>
            )}
          </ul>

          <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">What stays</p>
          <ul className="text-sm text-slate-300 space-y-1.5 mb-4 list-disc pl-5">
            {isBuyer ? (
              <li>Cars already confirmed to you. Those are deals we have to keep a record of.</li>
            ) : (
              <li>
                Work already recorded — inspections, repairs, lot scans, cars pulled — stays as a record of
                the car, with your name taken off it.
              </li>
            )}
          </ul>

          <label className="block text-sm text-slate-400 mb-1">
            Type <span className="font-bold text-slate-200">DELETE</span> to confirm
          </label>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="DELETE"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="mb-3"
          />

          {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

          <button
            onClick={onDelete}
            disabled={!armed || busy}
            className="btn-danger flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Trash2 size={18} />
            {busy ? 'Deleting…' : 'Delete my account permanently'}
          </button>
          <button
            onClick={() => { setConfirming(false); setTyped(''); setError('') }}
            disabled={busy}
            className="mt-2 w-full text-sm font-semibold text-slate-400 py-2"
          >
            Keep my account
          </button>
        </div>
      )}

      <p className="text-xs text-slate-500 mt-6">
        Questions about your data? <a className="text-emerald-400" href="mailto:support@carzinc.ai">support@carzinc.ai</a>
      </p>
    </div>
  )
}
