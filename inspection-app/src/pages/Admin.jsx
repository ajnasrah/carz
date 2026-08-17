import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, UserPlus, Trash2, Shield, User, AlertTriangle, Clock, Check, X, FileSpreadsheet } from 'lucide-react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/useAuth'
import { isPrimaryAdmin } from '../services/adminSetup'
import { BODY_SHOP_ROLES } from '../services/bodyShop'
import {
  canSeeSoldReports, setSoldReportsAccess,
  fetchPendingAccessRequests, decideAccessRequest,
} from '../services/soldReportAccess'

export default function Admin() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', phone: '', role: 'inspector' })
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  // People who pressed "Request access" on the Sold Reports lock screen.
  const [soldRequests, setSoldRequests] = useState([])

  async function loadUsers() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: true })
    setUsers(data || [])
    setLoading(false)
  }

  // Kept separate from loadUsers so a failure here (or an unmigrated database)
  // leaves the rest of the panel working rather than blanking the user list.
  async function loadSoldRequests() {
    try {
      setSoldRequests(await fetchPendingAccessRequests())
    } catch (e) {
      console.error('Could not load sold-report access requests', e)
    }
  }

  useEffect(() => {
    if (profile?.role !== 'admin' && !isPrimaryAdmin(profile?.phone)) {
      navigate('/')
      return
    }
    let cancelled = false
    async function load() {
      const [{ data }, requests] = await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: true }),
        fetchPendingAccessRequests().catch(() => []),
      ])
      if (!cancelled) {
        setUsers(data || [])
        setSoldRequests(requests)
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [profile, navigate])

  async function addUser(e) {
    e.preventDefault()
    setError('')

    if (!newUser.name || !newUser.phone) {
      setError('Name and phone are required')
      return
    }

    const digits = newUser.phone.replace(/\D/g, '')
    if (digits.length !== 10) {
      setError('Enter a valid 10-digit phone number')
      return
    }

    // Add to allowed_users table (whitelist)
    const { error: dbError } = await supabase
      .from('allowed_users')
      .insert({
        phone: `+1${digits}`,
        name: newUser.name,
        role: newUser.role,
      })

    if (dbError) {
      setError(dbError.message)
      return
    }

    setNewUser({ name: '', phone: '', role: 'inspector' })
    setShowAdd(false)
    loadUsers()
  }

  // Body shop crew. The granular job roles live in profiles.roles[]; `role` is
  // the coarse admin/inspector flag and is left alone. Setting a shop role is all
  // it takes to scope someone: ProtectedRoute reads isBodyShopOnly() and lands
  // them on /body-shop at sign-in and on every app open.
  async function setShopRole(user, shopRole) {
    const kept = (user.roles || []).filter((r) => !BODY_SHOP_ROLES.includes(r))
    const roles = shopRole ? [...kept, shopRole] : kept
    const { error } = await supabase.from('profiles').update({ roles }).eq('id', user.id)
    if (error) {
      setError('Could not set the shop role: ' + error.message)
      setTimeout(() => setError(''), 3000)
      return
    }
    loadUsers()
  }

  // Sold Reports = cost, sale price and profit per car. The tick controls VIEWING
  // only; exporting the spreadsheet stays admin-only and has no per-user override
  // (see services/soldReportAccess). Admins already have it by being admins, so
  // their box is ticked and locked rather than tracked separately.
  async function toggleSoldAccess(user, allowed) {
    try {
      await setSoldReportsAccess(user.id, allowed)
    } catch (e) {
      setError('Could not change Sold Reports access: ' + e.message)
      setTimeout(() => setError(''), 3000)
      return
    }
    // Granting from here answers an open request too — otherwise the queue would
    // keep showing someone who already has what they asked for.
    const open = soldRequests.find((r) => r.user_id === user.id)
    if (open && allowed) {
      try {
        await decideAccessRequest(open, true, profile?.id)
      } catch (e) {
        console.error('Could not close the access request', e)
      }
    }
    await Promise.all([loadUsers(), loadSoldRequests()])
  }

  async function decideSoldRequest(request, granted) {
    try {
      await decideAccessRequest(request, granted, profile?.id)
    } catch (e) {
      setError('Could not answer the request: ' + e.message)
      setTimeout(() => setError(''), 3000)
      return
    }
    await Promise.all([loadUsers(), loadSoldRequests()])
  }

  async function toggleRole(userId, currentRole) {
    const newRole = currentRole === 'admin' ? 'inspector' : 'admin'
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId)
    loadUsers()
  }

  async function setApproval(userId, status) {
    const { error } = await supabase
      .from('profiles')
      .update({ approval_status: status })
      .eq('id', userId)
    if (error) {
      setError('Failed to update approval: ' + error.message)
      setTimeout(() => setError(''), 3000)
    } else {
      loadUsers()
    }
  }

  async function removeUser(user) {
    if (isPrimaryAdmin(user.phone)) {
      setError('Cannot remove the primary admin user')
      setTimeout(() => setError(''), 3000)
      return
    }
    
    const { error } = await supabase.from('profiles').delete().eq('id', user.id)
    
    if (error) {
      setError('Failed to remove user: ' + error.message)
      setTimeout(() => setError(''), 3000)
    } else {
      setConfirmDelete(null)
      loadUsers()
    }
  }

  if (profile?.role !== 'admin' && !isPrimaryAdmin(profile?.phone)) return null

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <h1 className="page-title mb-0">Admin Panel</h1>
      </div>

      {/* Stats — based on account_type/role (granular job roles live in roles[]) */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="card text-center">
          <p className="text-2xl font-bold text-emerald-400">
            {users.filter((u) => u.role === 'admin').length}
          </p>
          <p className="text-sm text-slate-400">Admins</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-emerald-400">
            {users.filter((u) => u.account_type === 'employee' && u.role !== 'admin').length}
          </p>
          <p className="text-sm text-slate-400">Employees</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-emerald-400">
            {users.filter((u) => u.account_type === 'buyer').length}
          </p>
          <p className="text-sm text-slate-400">Buyers</p>
        </div>
      </div>

      {/* Pending Approval — new signups waiting for admin review */}
      {(() => {
        const pending = users.filter((u) => u.approval_status === 'pending')
        if (pending.length === 0) return null
        return (
          <div className="mb-6">
            <h2 className="text-lg font-bold text-amber-400 mb-3 flex items-center gap-2">
              <Clock size={18} /> Pending Approval ({pending.length})
            </h2>
            <div className="space-y-2">
              {pending.map((u) => (
                <div key={u.id} className="card border border-amber-500/40 bg-amber-500/5">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-white">{u.name || 'Unnamed'}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      u.account_type === 'buyer'
                        ? 'bg-blue-500/20 text-blue-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}>
                      {u.account_type === 'buyer' ? '🤝 Buyer' : '🏢 Employee'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-400 mb-3">{u.phone || 'No phone'}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setApproval(u.id, 'approved')}
                      className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-emerald-500 text-slate-900 font-semibold text-sm"
                    >
                      <Check size={16} /> Approve
                    </button>
                    <button
                      onClick={() => setApproval(u.id, 'rejected')}
                      className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-red-500/20 text-red-400 font-semibold text-sm"
                    >
                      <X size={16} /> Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Sold Reports access requests — filed from the lock screen on that page
          via /api/sold-report-access. Granting here ticks the same box as the
          checkbox in the user list below; there's no second flag. */}
      {soldRequests.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-bold text-sky-300 mb-3 flex items-center gap-2">
            <FileSpreadsheet size={18} /> Sold Reports Access ({soldRequests.length})
          </h2>
          <div className="space-y-2">
            {soldRequests.map((r) => (
              <div key={r.id} className="card border border-sky-500/40 bg-sky-500/5">
                <p className="font-semibold text-white">{r.name || 'Unnamed'}</p>
                <p className="text-sm text-slate-400">{r.phone || 'No phone'}</p>
                {r.note && <p className="text-xs text-slate-300 mt-1 italic">“{r.note}”</p>}
                <p className="text-[11px] text-slate-500 mt-1">
                  asked {new Date(r.created_at).toLocaleDateString()}
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => decideSoldRequest(r, true)}
                    className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-emerald-500 text-slate-900 font-semibold text-sm"
                  >
                    <Check size={16} /> Give access
                  </button>
                  <button
                    onClick={() => decideSoldRequest(r, false)}
                    className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-red-500/20 text-red-400 font-semibold text-sm"
                  >
                    <X size={16} /> Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search Bar */}
      <input
        type="text"
        placeholder="Search users by name or phone..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="w-full mb-4 px-4 py-2 bg-slate-800 text-white rounded-lg"
      />

      {/* Add User */}
      <button
        onClick={() => setShowAdd(!showAdd)}
        className="btn-primary flex items-center justify-center gap-2 mb-4"
      >
        <UserPlus size={20} />
        Add Inspector
      </button>

      {showAdd && (
        <form onSubmit={addUser} className="card mb-4 space-y-3">
          <input
            type="text"
            placeholder="Name"
            value={newUser.name}
            onChange={(e) => setNewUser((p) => ({ ...p, name: e.target.value }))}
          />
          <input
            type="tel"
            placeholder="Phone (10 digits)"
            value={newUser.phone}
            onChange={(e) => setNewUser((p) => ({ ...p, phone: e.target.value }))}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setNewUser((p) => ({ ...p, role: 'inspector' }))}
              className={`flex-1 py-2 rounded-lg font-semibold text-sm ${
                newUser.role === 'inspector' ? 'bg-emerald-500 text-slate-900' : 'bg-slate-700 text-slate-400'
              }`}
            >
              Inspector
            </button>
            <button
              type="button"
              onClick={() => setNewUser((p) => ({ ...p, role: 'admin' }))}
              className={`flex-1 py-2 rounded-lg font-semibold text-sm ${
                newUser.role === 'admin' ? 'bg-emerald-500 text-slate-900' : 'bg-slate-700 text-slate-400'
              }`}
            >
              Admin
            </button>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button type="submit" className="btn-primary">Add User</button>
        </form>
      )}

      {/* Users List — excludes pending users (they live in the Pending Approval section
          above); showing them here would duplicate them and let an admin "Promote" a
          not-yet-approved user straight to admin, bypassing the approval decision. */}
      <h2 className="text-lg font-bold text-white mb-3">Users ({users.filter(u =>
        u.approval_status !== 'pending' && (
          u.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          u.phone?.includes(searchTerm)
        )
      ).length})</h2>
      {loading ? (
        <p className="text-slate-400">Loading...</p>
      ) : (
        <div className="space-y-2">
          {users
            .filter(u =>
              u.approval_status !== 'pending' && (
                u.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                u.phone?.includes(searchTerm)
              )
            )
            .map((u) => (
            <div key={u.id} className="card flex items-center gap-3">
              <div className={`p-2 rounded-lg ${u.role === 'admin' ? 'bg-yellow-500/20' : 'bg-slate-700'}`}>
                {u.role === 'admin' ? <Shield size={20} className="text-yellow-400" /> : <User size={20} className="text-slate-400" />}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-white">{u.name || 'Unnamed'}</p>
                  {isPrimaryAdmin(u.phone) && (
                    <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded-full">
                      Primary
                    </span>
                  )}
                  {u.account_type === 'buyer' && (
                    <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded-full">
                      Buyer
                    </span>
                  )}
                  {u.approval_status === 'rejected' && (
                    <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-400 rounded-full">
                      Rejected
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-400">{u.phone || 'No phone'}</p>
                {(() => {
                  // A shop role only scopes someone if it's ALL they have — say
                  // which it is, so a role that looks set but isn't taking effect
                  // explains itself instead of looking broken.
                  const shop = (u.roles || []).filter((r) => BODY_SHOP_ROLES.includes(r))
                  const other = (u.roles || []).filter((r) => !BODY_SHOP_ROLES.includes(r))
                  if (!shop.length) return null
                  const scoped = !other.length && u.role !== 'admin' && !isPrimaryAdmin(u.phone)
                  return (
                    <p className={`text-[11px] mt-0.5 ${scoped ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {scoped
                        ? '🎨 Lands on Body Shop — shop only'
                        : `Also ${u.role === 'admin' ? 'an admin' : other.join(', ')} — keeps the whole app`}
                    </p>
                  )
                })()}
              </div>
              <div className="flex items-center gap-2">
                {(() => {
                  // Admins pass on being admins, and buyers never reach an internal
                  // page at all — in both cases the tick would be a lie if it were
                  // editable, so show the true state and lock it.
                  const isAdminRow = u.role === 'admin' || isPrimaryAdmin(u.phone)
                  const isBuyer = u.account_type === 'buyer'
                  return (
                    <label
                      className={`flex items-center gap-1.5 text-xs ${
                        isAdminRow || isBuyer ? 'text-slate-500' : 'text-slate-300 cursor-pointer'
                      }`}
                      title={
                        isAdminRow
                          ? 'Admins always see Sold Reports'
                          : isBuyer
                          ? 'Buyers only see the marketplace'
                          : 'Can view Sold Reports (cost + profit). Exporting stays admin-only.'
                      }
                    >
                      <input
                        type="checkbox"
                        checked={canSeeSoldReports(u)}
                        disabled={isAdminRow || isBuyer}
                        onChange={(e) => toggleSoldAccess(u, e.target.checked)}
                        className="w-4 h-4 accent-emerald-500"
                      />
                      Sold
                    </label>
                  )
                })()}
                <select
                  value={(u.roles || []).find((r) => BODY_SHOP_ROLES.includes(r)) || ''}
                  onChange={(e) => setShopRole(u, e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200"
                  title="Body shop role"
                >
                  <option value="">No shop role</option>
                  <option value="body_shop_tech">Shop Tech</option>
                  <option value="body_shop_manager">Shop Manager</option>
                </select>
                {u.approval_status === 'rejected' && (
                  <button
                    onClick={() => setApproval(u.id, 'approved')}
                    className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs"
                  >
                    Approve
                  </button>
                )}
                <button
                  onClick={() => toggleRole(u.id, u.role)}
                  className="p-2 rounded-lg bg-slate-700 text-slate-400 text-xs"
                >
                  {u.role === 'admin' ? 'Demote' : 'Promote'}
                </button>
                <button
                  onClick={() => setConfirmDelete(u)}
                  className="p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                  disabled={isPrimaryAdmin(u.phone)}
                  title={isPrimaryAdmin(u.phone) ? 'Cannot remove primary admin' : 'Remove user'}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 rounded-xl p-6 max-w-sm w-full">
            <h3 className="text-xl font-bold text-white mb-4">Confirm Delete</h3>
            <p className="text-slate-300 mb-6">
              Are you sure you want to remove <strong>{confirmDelete.name || 'this user'}</strong>?
              <br/>
              <span className="text-sm text-slate-400">{confirmDelete.phone}</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={() => removeUser(confirmDelete)}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
              >
                Delete User
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Toast */}
      {error && (
        <div className="fixed bottom-20 left-4 right-4 bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg z-50">
          {error}
        </div>
      )}
    </div>
  )
}
