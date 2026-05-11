import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, UserPlus, Trash2, Shield, User } from 'lucide-react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/useAuth'

export default function Admin() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', phone: '', role: 'inspector' })
  const [error, setError] = useState('')

  async function loadUsers() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: true })
    setUsers(data || [])
    setLoading(false)
  }

  useEffect(() => {
    if (profile?.role !== 'admin') {
      navigate('/')
      return
    }
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: true })
      if (!cancelled) {
        setUsers(data || [])
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

  async function toggleRole(userId, currentRole) {
    const newRole = currentRole === 'admin' ? 'inspector' : 'admin'
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId)
    loadUsers()
  }

  async function removeUser(userId) {
    await supabase.from('profiles').delete().eq('id', userId)
    loadUsers()
  }

  if (profile?.role !== 'admin') return null

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <h1 className="page-title mb-0">Admin Panel</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="card text-center">
          <p className="text-2xl font-bold text-emerald-400">{users.length}</p>
          <p className="text-sm text-slate-400">Total Users</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-emerald-400">
            {users.filter((u) => u.role === 'admin').length}
          </p>
          <p className="text-sm text-slate-400">Admins</p>
        </div>
      </div>

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

      {/* Users List */}
      <h2 className="text-lg font-bold text-white mb-3">Users</h2>
      {loading ? (
        <p className="text-slate-400">Loading...</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="card flex items-center gap-3">
              <div className={`p-2 rounded-lg ${u.role === 'admin' ? 'bg-yellow-500/20' : 'bg-slate-700'}`}>
                {u.role === 'admin' ? <Shield size={20} className="text-yellow-400" /> : <User size={20} className="text-slate-400" />}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-white">{u.name || 'Unnamed'}</p>
                <p className="text-sm text-slate-400">{u.phone || 'No phone'}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => toggleRole(u.id, u.role)}
                  className="p-2 rounded-lg bg-slate-700 text-slate-400 text-xs"
                >
                  {u.role === 'admin' ? 'Demote' : 'Promote'}
                </button>
                <button
                  onClick={() => removeUser(u.id)}
                  className="p-2 rounded-lg bg-red-500/20 text-red-400"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
