import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { clearAccountDeletedFlag, readAccountDeletedFlag } from '../services/account'

export default function Login() {
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState('phone') // 'phone' | 'verify'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // The last thing a deleted account sees. Read once, on the first render after
  // the sign-out that follows the deletion — the screen that could have said it
  // is gone by then, along with the session and the profile. Reading it in the
  // initializer (and clearing it there) means it shows once and never comes
  // back on a later visit to the login screen.
  const [justDeleted] = useState(readAccountDeletedFlag)
  // Cleared once it has been shown, so it doesn't reappear on the next visit to
  // the login screen.
  useEffect(() => { if (justDeleted) clearAccountDeletedFlag() }, [justDeleted])

  function formatPhone(value) {
    const digits = value.replace(/\D/g, '')
    if (digits.length <= 3) return digits
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`
  }

  function getE164(formatted) {
    const digits = formatted.replace(/\D/g, '')
    return `+1${digits}`
  }

  async function sendOtp(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10) {
      setError('Enter a valid 10-digit phone number')
      setLoading(false)
      return
    }

    const { error: authError } = await supabase.auth.signInWithOtp({
      phone: getE164(phone),
    })

    if (authError) {
      setError(authError.message)
    } else {
      setStep('verify')
    }
    setLoading(false)
  }

  async function verifyOtp(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: authError } = await supabase.auth.verifyOtp({
      phone: getE164(phone),
      token: otp,
      type: 'sms',
    })

    if (authError) {
      setError(authError.message)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-emerald-400 mb-2">CARZ INC</h1>
          <p className="text-slate-400">Inventory Management System</p>
        </div>

        {justDeleted && (
          <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
            <p className="font-bold text-emerald-400">Your account has been deleted</p>
            <p className="text-sm text-slate-300 mt-1">
              Your sign-in and personal details have been removed. Nothing here will get you back in —
              signing in again starts a brand new account.
            </p>
          </div>
        )}

        {step === 'phone' ? (
          <form onSubmit={sendOtp} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Phone Number</label>
              <input
                type="tel"
                placeholder="(555) 123-4567"
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                maxLength={14}
                autoFocus
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Sending...' : 'Send Verification Code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="space-y-4">
            <p className="text-slate-400 text-sm text-center">
              Code sent to {phone}
            </p>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Verification Code</label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                autoFocus
                className="text-center text-2xl tracking-[0.5em]"
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Verifying...' : 'Verify & Sign In'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('phone'); setOtp(''); setError('') }}
              className="btn-secondary"
            >
              Change Number
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
