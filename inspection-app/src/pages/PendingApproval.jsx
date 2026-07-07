import { useNavigate } from 'react-router-dom'
import { Clock, LogOut, RefreshCw } from 'lucide-react'
import { useAuth } from '../context/useAuth'

export default function PendingApproval() {
  const navigate = useNavigate()
  const { profile, signOut, refreshProfile } = useAuth()

  const rejected = profile?.approval_status === 'rejected'

  async function recheck() {
    if (refreshProfile) await refreshProfile()
    // If an admin just approved them, ProtectedRoute will let them through.
    navigate('/', { replace: true })
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <div className={`mx-auto mb-5 w-16 h-16 rounded-full flex items-center justify-center ${
          rejected ? 'bg-red-500/15' : 'bg-amber-500/15'
        }`}>
          <Clock size={32} className={rejected ? 'text-red-400' : 'text-amber-400'} />
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">
          {rejected ? 'Access Denied' : 'Pending Approval'}
        </h1>
        <p className="text-slate-400 mb-1">
          {rejected
            ? 'Your account request was not approved. Contact Carz Inc if you think this is a mistake.'
            : 'Thanks for signing up! An admin needs to approve your account before you can get in.'}
        </p>
        {profile?.name && (
          <p className="text-slate-500 text-sm mb-6">
            {profile.name} · {profile.account_type === 'buyer' ? 'Buyer' : 'Employee'} · {profile.phone}
          </p>
        )}

        <div className="space-y-3 mt-6">
          {!rejected && (
            <button
              onClick={recheck}
              className="w-full flex items-center justify-center gap-2 bg-emerald-500 text-slate-900 font-bold py-3 rounded-lg"
            >
              <RefreshCw size={18} />
              Check again
            </button>
          )}
          <button
            onClick={signOut}
            className="w-full flex items-center justify-center gap-2 bg-slate-800 text-slate-300 font-semibold py-3 rounded-lg border border-slate-700"
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
