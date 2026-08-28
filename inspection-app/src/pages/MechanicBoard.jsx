// Mechanic board — every car at the mechanic, longest-owned first.
//
// Cars arrive here on their own: someone posts the last 6 in the Telegram
// mechanic group and the webhook opens the job, or an inbound inspection finds
// mechanical problems and the work order router opens one.
//
// What this board has and the body shop's doesn't is LINES. "At the mechanic"
// tells you nothing — one alignment and three weeks of engine work look
// identical from the outside. The number on every card is how many problems are
// still open, so the board answers "how far is this car from the front line"
// without opening anything.
//
// The sort is days OWNED, not days at the shop, for the same reason as the body
// shop: a car we've had since June is the expensive one whether it went on the
// lift this morning or a fortnight ago.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Search, RefreshCw, X } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import {
  fetchBoard, fetchRecentlyDone, createJobFromVin6,
  JOB_STATUSES, JOB_STATUS_STYLES, HOLD_STATUS,
  SEVERITY_STYLES, SEVERITIES,
  ageStyle, ownedStyle, jobAge, isOnHold, vehicleLabel, lastSix,
  isMechanicManager, isMechanic, canSeeMechanicMoney,
} from '../services/mechanic'

const money = (n) => (n == null ? null : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)

export default function MechanicBoard() {
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [jobs, setJobs] = useState([])
  const [doneJobs, setDoneJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  // 'open' | a stage key | 'hold' | 'done'
  const [statusFilter, setStatusFilter] = useState('open')
  const [adding, setAdding] = useState(false)

  const manager = isMechanicManager(profile)
  const mech = isMechanic(profile)
  // A mechanic who isn't also a manager only ever sees his own cars.
  const mechOnly = mech && !manager
  const seeMoney = canSeeMechanicMoney(profile)

  // The open board is always loaded, even while the Done tab is showing, because
  // the filter chips count against it.
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
    if (mechOnly && profile?.id) rows = rows.filter((j) => j.assigned_tech === profile.id)
    if (statusFilter === 'hold') {
      rows = rows.filter(isOnHold)
    } else if (statusFilter === 'open') {
      // Held cars are open jobs — the query returns them — but they are not the
      // shop's work list. They only show under their own tab.
      rows = rows.filter((j) => !isOnHold(j))
    } else if (statusFilter !== 'done') {
      rows = rows.filter((j) => j.status === statusFilter)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter((j) =>
        [j.stock_number, j.vin6, j.vin, vehicleLabel(j), j.tech_name]
          .filter(Boolean).some((f) => String(f).toLowerCase().includes(q)))
    }
    return rows
  }, [jobs, doneJobs, mechOnly, profile?.id, statusFilter, search])

  // Counts always reflect what this user is allowed to see.
  const scoped = useMemo(
    () => (mechOnly && profile?.id ? jobs.filter((j) => j.assigned_tech === profile.id) : jobs),
    [jobs, mechOnly, profile?.id])

  // Every figure here is about cars the shop is expected to move, so held cars
  // are excluded from all of them — including "oldest", which is the whole
  // reason to park a car in the first place.
  const stats = useMemo(() => {
    const open = scoped.filter((j) => j.status !== 'done' && !isOnHold(j))
    // A car with no lines is a car nobody has diagnosed. That is the mechanic
    // board's version of the body shop's "no price yet": the thing blocking
    // every other decision about it.
    const undiagnosed = open.filter((j) => Number(j.lines_total) === 0).length
    const oldest = open.length ? Math.max(...open.map((j) => jobAge(j).days || 0)) : null
    const blocked = open.filter((j) => Number(j.blocked_on_parts) > 0).length
    const toOrder = open.filter((j) => Number(j.parts_needed) > 0).length
    return { count: open.length, undiagnosed, oldest, blocked, toOrder,
             held: scoped.filter(isOnHold).length }
  }, [scoped])

  const byStage = useMemo(() => {
    const counts = Object.fromEntries(JOB_STATUSES.map((s) => [s.key, 0]))
    for (const j of scoped) if (j.status in counts) counts[j.status] += 1
    return counts
  }, [scoped])

  return (
    <div className="page">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => navigate('/')}
          aria-label="Back to dashboard"
          className="p-2 -ml-2 mr-1 rounded-lg bg-slate-800 text-slate-300 active:bg-slate-700"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="page-title mb-0">🔧 Mechanic</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {mechOnly ? 'Your cars — longest owned first' : 'Longest owned first'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setLoading(true); load() }}
            className="p-2 rounded-lg bg-slate-800 border border-slate-700 active:bg-slate-700"
            aria-label="Refresh">
            <RefreshCw size={16} className={loading ? 'animate-spin text-slate-500' : 'text-slate-300'} />
          </button>
          {manager && (
            <button onClick={() => navigate('/body-shop/parts')}
              className="relative p-2 rounded-lg bg-slate-800 border border-slate-700 active:bg-slate-700"
              title="Parts to order">
              📦
              {stats.toOrder > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-orange-500 text-slate-900 text-[10px] font-bold leading-4">
                  {stats.toOrder}
                </span>
              )}
            </button>
          )}
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

      {/* The pipeline, counted. Tapping a stage filters the list to it, so the
          number you just read and the list you get are the same thing. Tap the
          active one again to go back to all open cars. */}
      <div className="grid grid-cols-4 gap-1.5 mb-2">
        {JOB_STATUSES.filter((s) => s.key !== 'done').map((s) => (
          <StageTile key={s.key} stage={s} count={byStage[s.key]}
            active={statusFilter === s.key}
            onClick={() => setStatusFilter(statusFilter === s.key ? 'open' : s.key)} />
        ))}
      </div>

      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-slate-400 mb-3">
        <span className="font-semibold text-slate-300">🚗 {stats.count} in shop</span>
        <span className={stats.undiagnosed ? 'text-yellow-400' : undefined}>
          🔍 {stats.undiagnosed} undiagnosed
        </span>
        {stats.blocked > 0 && <span className="text-orange-300">📦 {stats.blocked} on parts</span>}
        <span className={ownedStyle(stats.oldest)}>
          ⏰ oldest {stats.oldest == null ? '—' : `${stats.oldest}d owned`}
        </span>
      </div>

      {stats.undiagnosed > 0 && statusFilter === 'open' && (
        <div className="mb-3 p-2.5 rounded-xl bg-yellow-500/10 border border-yellow-500/40 text-[11px] text-yellow-300">
          🔍 {stats.undiagnosed} {stats.undiagnosed === 1 ? 'car has' : 'cars have'} no problems
          listed yet — nothing can be ordered or scheduled for them until somebody says what's wrong.
        </div>
      )}

      <div className="relative mb-2">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Stock #, VIN, car, mechanic…"
          className="!pl-9"
        />
      </div>

      <div className="flex gap-1.5 mb-3">
        <FilterChip active={statusFilter === 'open'} onClick={() => setStatusFilter('open')}
          label="All Open" count={stats.count} />
        <FilterChip active={statusFilter === 'hold'} onClick={() => setStatusFilter('hold')}
          label={`${HOLD_STATUS.emoji} On Hold`} count={stats.held} tone="hold" />
        <FilterChip active={statusFilter === 'done'} onClick={() => setStatusFilter('done')} label="✅ Done" />
      </div>

      {loading ? (
        <div className="text-center text-slate-500 py-10 text-sm">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="card text-center py-10">
          <div className="text-4xl mb-2">🔧</div>
          <p className="text-slate-400 text-sm">
            {search ? 'Nothing matches that search.'
              : mechOnly ? 'No cars assigned to you right now.'
              : statusFilter === 'done' ? 'Nothing finished yet.'
              : statusFilter === 'hold' ? 'Nothing on hold — the whole board is work.'
              : 'No cars at the mechanic.'}
          </p>
          {!search && !mechOnly && statusFilter !== 'done' && statusFilter !== 'hold' && (
            <p className="text-slate-600 text-[11px] mt-2">
              Cars show up here when someone posts a VIN in the Telegram mechanic group.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2 md:space-y-0 md:grid md:grid-cols-2 md:gap-2 lg:grid-cols-3">
          {visible.map((job) => (
            <JobCard key={job.id} job={job} showMoney={seeMoney}
              onClick={() => navigate(`/mechanic/${job.id}`,
                { state: { siblings: visible.map((j) => j.id) } })} />
          ))}
        </div>
      )}

      {adding && (
        <AddCarModal
          onClose={() => setAdding(false)}
          onAdded={(job) => { setAdding(false); navigate(`/mechanic/${job.id}`) }}
        />
      )}
    </div>
  )
}

const STAGE_TONES = {
  intake:        { on: 'bg-slate-600 border-slate-400',        num: 'text-slate-100' },
  diagnosing:    { on: 'bg-cyan-500/30 border-cyan-400',       num: 'text-cyan-300' },
  waiting_parts: { on: 'bg-orange-500/30 border-orange-400',   num: 'text-orange-300' },
  in_progress:   { on: 'bg-emerald-500/30 border-emerald-400', num: 'text-emerald-300' },
}

function StageTile({ stage, count, active, onClick }) {
  const tone = STAGE_TONES[stage.key] || STAGE_TONES.intake
  return (
    <button onClick={onClick} title={stage.hint}
      className={`rounded-xl p-2 text-center border transition-colors ${
        active ? tone.on : 'bg-slate-800 border-slate-700 active:bg-slate-700'}`}>
      <div className="text-base leading-none">{stage.emoji}</div>
      <div className={`text-xl font-bold mt-1 ${count ? tone.num : 'text-slate-600'}`}>{count}</div>
      <div className="text-[9px] uppercase tracking-wide text-slate-400 mt-0.5 leading-tight">
        {stage.label}
      </div>
    </button>
  )
}

function FilterChip({ active, onClick, label, count, tone }) {
  const idle = tone === 'hold' && count > 0
    ? 'bg-red-500/10 text-red-300 border border-red-500/40'
    : 'bg-slate-800 text-slate-300 border border-slate-700'
  return (
    <button onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${
        active ? (tone === 'hold' ? 'bg-red-500 text-slate-900' : 'bg-emerald-500 text-slate-900') : idle
      }`}>
      {label}{count != null && count > 0 ? ` · ${count}` : ''}
    </button>
  )
}

function JobCard({ job, onClick, showMoney = true }) {
  const age = jobAge(job)
  const status = isOnHold(job) ? HOLD_STATUS : JOB_STATUSES.find((s) => s.key === job.status)

  const linesTotal = Number(job.lines_total) || 0
  const linesOpen = Number(job.lines_open) || 0
  const worst = job.worst_severity
  const worstLabel = SEVERITIES.find((s) => s.key === worst)?.label

  const last6 = lastSix(job)
  const showSix = last6 && !vehicleLabel(job).endsWith(last6)
  const meta = [
    job.stock_number ? `#${job.stock_number}` : 'Not in inventory yet',
    job.vehicle_color || null,
  ].filter(Boolean)

  return (
    <button onClick={onClick}
      className="w-full text-left bg-slate-800 rounded-xl p-3 border border-slate-700 active:bg-slate-700 flex gap-3">
      {/* Age — the first thing you see, and what the board sorts on */}
      <div className="shrink-0 w-12 text-center">
        <div className={`text-2xl font-bold leading-none ${
          age.owned ? ownedStyle(age.days) : ageStyle(age.days)}`}>
          {age.days ?? '—'}
        </div>
        <div className="text-[9px] uppercase tracking-wide text-slate-500 mt-0.5 leading-tight">
          {age.owned ? 'days owned' : 'days in shop'}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{vehicleLabel(job)}</div>
            <div className="text-[11px] text-slate-400 truncate">
              {showSix && (
                <>
                  <span className="font-mono text-slate-300">…{last6}</span>
                  <span className="text-slate-600"> · </span>
                </>
              )}
              {meta.join(' · ')}
            </div>
          </div>
          <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-bold ${JOB_STATUS_STYLES[job.status]}`}>
            {status?.label || job.status}
          </span>
        </div>

        {/* The line count is this board's headline fact. A car with no lines
            reads as undiagnosed rather than as finished — those are opposite
            situations and a bare "0" would show them the same way. */}
        <div className="flex items-center gap-3 mt-2 text-[11px] flex-wrap">
          {linesTotal === 0 ? (
            <span className="text-yellow-400 font-semibold">🔍 Not diagnosed</span>
          ) : (
            <span className={linesOpen ? 'text-slate-200 font-semibold' : 'text-emerald-400 font-semibold'}>
              🔧 {linesOpen} of {linesTotal} open
            </span>
          )}
          {worst && linesOpen > 0 && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${SEVERITY_STYLES[worst]}`}>
              {worstLabel}
            </span>
          )}
          <span className="text-slate-400 truncate">
            {job.tech_name ? `👤 ${job.tech_name}` : <span className="text-slate-500">Unassigned</span>}
          </span>
          {age.owned && job.days_in_shop != null && (
            <span className={ageStyle(job.days_in_shop)}>🔧 {job.days_in_shop}d in shop</span>
          )}
          {Number(job.parts_total) > 0 && (
            <span className="text-orange-300">
              📦 {job.parts_received || 0}/{job.parts_total} parts
            </span>
          )}
          {showMoney && Number(job.parts_cost) > 0 && (
            <span className="text-emerald-400 font-semibold">{money(job.parts_cost)}</span>
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
              Only needed for a car pushed straight in — cars posted in the Telegram group add themselves.
            </p>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={saving || vin6.trim().length < 6} className="btn-primary">
            {saving ? 'Adding…' : 'Add to Mechanic'}
          </button>
        </form>
      </div>
    </div>
  )
}
