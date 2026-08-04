// Body Shop board — every car in the shop, oldest first.
//
// Cars arrive here on their own: a worker posts the last 6 of the VIN in the
// Telegram body shop group and the webhook opens the job. The manager prices it,
// lists parts, and assigns a tech. Techs see only the cars assigned to them.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, RefreshCw, X } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import {
  fetchBoard, fetchRecentlyDone, createJobFromVin6,
  JOB_STATUSES, JOB_STATUS_STYLES, ageStyle, vehicleLabel,
  isBodyShopManager, isBodyShopTech,
} from '../services/bodyShop'

const money = (n) => (n == null ? null : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)

export default function BodyShop() {
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('open')  // 'open' | status key | 'done'
  const [adding, setAdding] = useState(false)

  const manager = isBodyShopManager(profile)
  const tech = isBodyShopTech(profile)
  // A tech who isn't also a manager only ever sees his own cars.
  const techOnly = tech && !manager

  const [doneJobs, setDoneJobs] = useState([])

  // The open board is always loaded, even while the Done tab is showing, because
  // the filter chips count against it. Loading only the done rows made every
  // other chip read zero.
  const load = useCallback(async () => {
    setError('')
    try {
      const [open, done] = await Promise.all([
        fetchBoard(),
        statusFilter === 'done' ? fetchRecentlyDone() : Promise.resolve(null),
      ])
      setJobs(open)
      if (done) setDoneJobs(done)
    } catch (e) {
      setError(e.message || 'Could not load the board')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { setLoading(true); load() }, [load])

  const visible = useMemo(() => {
    let rows = statusFilter === 'done' ? doneJobs : jobs
    if (techOnly && profile?.id) rows = rows.filter((j) => j.assigned_tech === profile.id)
    if (statusFilter !== 'open' && statusFilter !== 'done') {
      rows = rows.filter((j) => j.status === statusFilter)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter((j) =>
        [j.stock_number, j.vin6, j.vin, vehicleLabel(j), j.tech_name]
          .filter(Boolean).some((f) => String(f).toLowerCase().includes(q)))
    }
    return rows
  }, [jobs, doneJobs, techOnly, profile?.id, statusFilter, search])

  // Counts always reflect what this user is allowed to see.
  const scoped = useMemo(
    () => (techOnly && profile?.id ? jobs.filter((j) => j.assigned_tech === profile.id) : jobs),
    [jobs, techOnly, profile?.id])

  const stats = useMemo(() => {
    const open = scoped.filter((j) => j.status !== 'done')
    const waiting = open.filter((j) => j.status === 'waiting_parts').length
    const unpriced = open.filter((j) => j.price == null).length
    const oldest = open.length ? Math.max(...open.map((j) => j.days_in_shop || 0)) : null
    const pending = open.filter((j) => j.awaiting_inventory).length
    return { count: open.length, waiting, unpriced, oldest, pending }
  }, [scoped])

  return (
    <div className="page">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="page-title mb-0">🎨 Body Shop</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {techOnly ? 'Your cars — oldest first' : 'Oldest first'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setLoading(true); load() }}
            className="p-2 rounded-lg bg-slate-800 border border-slate-700 active:bg-slate-700"
            aria-label="Refresh">
            <RefreshCw size={16} className={loading ? 'animate-spin text-slate-500' : 'text-slate-300'} />
          </button>
          <button onClick={() => navigate('/body-shop/payout')}
            className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm font-semibold active:bg-slate-700"
            title="Saturday payout">💵</button>
          {manager && (
            <button onClick={() => setAdding(true)}
              className="flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-500 text-slate-900 font-bold text-sm active:bg-emerald-600">
              <Plus size={16} /> Car
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="card border-red-500/40 bg-red-500/10 text-red-300 text-sm mb-3">{error}</div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <Stat emoji="🚗" value={stats.count} label="In Shop" />
        <Stat emoji="📦" value={stats.waiting} label="Waiting" tone={stats.waiting ? 'text-orange-400' : undefined} />
        <Stat emoji="💵" value={stats.unpriced} label="No Price" tone={stats.unpriced ? 'text-yellow-400' : undefined} />
        <Stat emoji="⏰" value={stats.oldest == null ? '—' : `${stats.oldest}d`} label="Oldest"
          tone={ageStyle(stats.oldest)} />
      </div>

      {stats.pending > 0 && (
        <div className="mb-3 p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/40 text-[11px] text-sky-300">
          🆕 {stats.pending} fresh {stats.pending === 1 ? 'buy' : 'buys'} not in inventory yet —
          {' '}they link themselves once Frazer has them. Untouched ones are dropped after 7 days.
        </div>
      )}

      {/* Search + status filter */}
      <div className="relative mb-2">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Stock #, VIN, car, tech…"
          className="!pl-9"
        />
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3 -mx-4 px-4">
        <FilterChip active={statusFilter === 'open'} onClick={() => setStatusFilter('open')}
          label="All Open" count={scoped.filter((j) => j.status !== 'done').length} />
        {JOB_STATUSES.filter((s) => s.key !== 'done').map((s) => (
          <FilterChip key={s.key} active={statusFilter === s.key} onClick={() => setStatusFilter(s.key)}
            label={`${s.emoji} ${s.label}`} count={scoped.filter((j) => j.status === s.key).length} />
        ))}
        <FilterChip active={statusFilter === 'done'} onClick={() => setStatusFilter('done')} label="✅ Done" />
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center text-slate-500 py-10 text-sm">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="card text-center py-10">
          <div className="text-4xl mb-2">🎨</div>
          <p className="text-slate-400 text-sm">
            {search ? 'Nothing matches that search.'
              : techOnly ? 'No cars assigned to you right now.'
              : statusFilter === 'done' ? 'Nothing finished yet.'
              : 'No cars in the shop.'}
          </p>
          {!search && !techOnly && statusFilter !== 'done' && (
            <p className="text-slate-600 text-[11px] mt-2">
              Cars show up here when the shop posts a VIN in the Telegram group.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((job) => (
            <JobCard key={job.id} job={job} onClick={() => navigate(`/body-shop/${job.id}`)} />
          ))}
        </div>
      )}

      {adding && (
        <AddCarModal
          onClose={() => setAdding(false)}
          onAdded={(job) => { setAdding(false); navigate(`/body-shop/${job.id}`) }}
        />
      )}
    </div>
  )
}

function Stat({ emoji, value, label, tone }) {
  return (
    <div className="rounded-xl p-2.5 bg-slate-800 text-center">
      <div className="text-base leading-none">{emoji}</div>
      <div className={`text-xl font-bold mt-1 ${tone || 'text-white'}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-slate-400 mt-0.5">{label}</div>
    </div>
  )
}

function FilterChip({ active, onClick, label, count }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${
        active ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-300 border border-slate-700'
      }`}>
      {label}{count != null && count > 0 ? ` · ${count}` : ''}
    </button>
  )
}

function JobCard({ job, onClick }) {
  const days = job.days_in_shop
  const status = JOB_STATUSES.find((s) => s.key === job.status)
  const partsOpen = (job.parts_needed || 0) + (job.parts_ordered || 0)

  return (
    <button onClick={onClick}
      className="w-full text-left bg-slate-800 rounded-xl p-3 border border-slate-700 active:bg-slate-700 flex gap-3">
      {/* Age — the first thing you see */}
      <div className="shrink-0 w-12 text-center">
        <div className={`text-2xl font-bold leading-none ${ageStyle(days)}`}>{days ?? '—'}</div>
        <div className="text-[9px] uppercase tracking-wide text-slate-500 mt-0.5">days</div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{vehicleLabel(job)}</div>
            <div className="text-[11px] text-slate-400 truncate">
              {job.stock_number ? `#${job.stock_number}` : 'Fresh buy — not in inventory yet'}
              {job.vehicle_color ? ` · ${job.vehicle_color}` : ''}
            </div>
          </div>
          <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-bold ${JOB_STATUS_STYLES[job.status]}`}>
            {status?.label || job.status}
          </span>
        </div>

        <div className="flex items-center gap-3 mt-2 text-[11px] flex-wrap">
          <span className={job.price == null ? 'text-yellow-400 font-semibold' : 'text-emerald-400 font-bold'}>
            {job.price == null ? 'No price yet' : money(job.price)}
          </span>
          <span className="text-slate-400 truncate">
            {job.tech_name ? `👤 ${job.tech_name}` : <span className="text-slate-500">Unassigned</span>}
          </span>
          {partsOpen > 0 && (
            <span className="text-orange-300">
              📦 {job.parts_received || 0}/{job.parts_total} parts
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

function AddCarModal({ onClose, onAdded }) {
  const [vin6, setVin6] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError(''); setSaving(true)
    try {
      onAdded(await createJobFromVin6(vin6))
    } catch (err) {
      setError(err.message || 'Could not add the car')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose() }}>
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">Add a car</h2>
          <button onClick={onClose} disabled={saving} className="text-slate-400 p-1"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-slate-400">Last 6 of VIN</label>
            <input
              value={vin6} onChange={(e) => setVin6(e.target.value.toUpperCase())}
              placeholder="086793" autoFocus autoCapitalize="characters" autoComplete="off"
              className="mt-1 font-mono tracking-widest text-lg"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Only needed for a walk-in — cars posted in the Telegram group add themselves.
            </p>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={saving || vin6.trim().length < 6} className="btn-primary">
            {saving ? 'Adding…' : 'Add to Body Shop'}
          </button>
        </form>
      </div>
    </div>
  )
}
