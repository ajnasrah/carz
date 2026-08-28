// Body Shop board — every car in the shop, longest-owned first.
//
// Cars arrive here on their own: a worker posts the last 6 of the VIN in the
// Telegram body shop group and the webhook opens the job. The manager prices it,
// lists parts, and assigns a tech. Techs see only the cars assigned to them.
//
// The order is days OWNED, not days at the shop: a car we've had since June is
// the expensive one whether it landed at Jorge's this morning or a fortnight
// ago. Cars nobody is going to fix go in On Hold, off the pipeline and out of
// the counts, so the numbers above the list are about work that can move.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Search, RefreshCw, X } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import {
  fetchBoard, fetchRecentlyDone, createJobFromVin6,
  JOB_STATUSES, JOB_STATUS_STYLES, HOLD_STATUS,
  ageStyle, ownedStyle, jobAge, isOnHold, vehicleLabel, lastSix,
  isBodyShopManager, isBodyShopTech, canSeeShopMoney, isBodyShopOnly,
} from '../services/bodyShop'

const money = (n) => (n == null ? null : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)

export default function BodyShop() {
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  // 'open' | a stage key | 'hold' | 'done'
  const [statusFilter, setStatusFilter] = useState('open')
  const [adding, setAdding] = useState(false)

  const manager = isBodyShopManager(profile)
  const tech = isBodyShopTech(profile)
  // A tech who isn't also a manager only ever sees his own cars.
  const techOnly = tech && !manager
  const seeMoney = canSeeShopMoney(profile)
  // Body-shop-only staff have no dashboard to go back to — ProtectedRoute sends
  // them straight here from '/'.
  const shopOnly = isBodyShopOnly(profile)

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
  }, [jobs, doneJobs, techOnly, profile?.id, statusFilter, search])

  // Counts always reflect what this user is allowed to see.
  const scoped = useMemo(
    () => (techOnly && profile?.id ? jobs.filter((j) => j.assigned_tech === profile.id) : jobs),
    [jobs, techOnly, profile?.id])

  // Every figure here is about cars the shop is actually expected to move, so
  // held cars are excluded from all of them — including "oldest", which is the
  // whole reason to park junk in the first place. Their own count is separate.
  const stats = useMemo(() => {
    const open = scoped.filter((j) => j.status !== 'done' && !isOnHold(j))
    const unpriced = open.filter((j) => j.price == null).length
    const oldest = open.length ? Math.max(...open.map((j) => jobAge(j).days || 0)) : null
    const pending = open.filter((j) => j.awaiting_inventory).length
    // Cars with a part still marked Needed — the ordering queue's size. COUNT
    // arrives as a bigint, so it's compared as a number, not for truthiness.
    const toOrder = open.filter((j) => Number(j.parts_needed) > 0).length
    return { count: open.length, unpriced, oldest, pending, toOrder,
             held: scoped.filter(isOnHold).length }
  }, [scoped])

  // How many cars are sitting in each stage right now. Every stage is counted,
  // zeros included — an empty Final Check is itself worth seeing, and a tally
  // that hides its zeros can't be read at a glance.
  const byStage = useMemo(() => {
    const counts = Object.fromEntries(JOB_STATUSES.map((s) => [s.key, 0]))
    for (const j of scoped) if (j.status in counts) counts[j.status] += 1
    return counts
  }, [scoped])

  return (
    <div className="page">
      <div className="flex items-center justify-between mb-4">
        {/* No way back off this page before — and the shop-only crew are routed
            here as their home, so for them '/' would just bounce straight back.
            They keep the plain header; everyone else gets the arrow. */}
        {!shopOnly && (
          <button
            onClick={() => navigate('/')}
            aria-label="Back to dashboard"
            className="p-2 -ml-2 mr-1 rounded-lg bg-slate-800 text-slate-300 active:bg-slate-700"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="page-title mb-0">🎨 Body Shop</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {techOnly ? 'Your cars — longest owned first' : 'Longest owned first'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setLoading(true); load() }}
            className="p-2 rounded-lg bg-slate-800 border border-slate-700 active:bg-slate-700"
            aria-label="Refresh">
            <RefreshCw size={16} className={loading ? 'animate-spin text-slate-500' : 'text-slate-300'} />
          </button>
          {seeMoney && (
            <button onClick={() => navigate('/body-shop/payout')}
              className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm font-semibold active:bg-slate-700"
              title="Saturday payout">💵</button>
          )}
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
          number you just read and the list you get are the same thing — and the
          tally doubles as the filter instead of sitting above a second row of
          chips saying the same numbers. Tap the active one again to go back to
          all open cars.

          Six stages don't fit across a phone, so they wrap to two rows of
          three — which happens to break exactly where the shop does: what the
          car is waiting on, then who is working it. One row again once there's
          width for it. */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mb-2">
        {JOB_STATUSES.filter((s) => s.key !== 'done').map((s) => (
          <StageTile key={s.key} stage={s} count={byStage[s.key]}
            active={statusFilter === s.key}
            onClick={() => setStatusFilter(statusFilter === s.key ? 'open' : s.key)} />
        ))}
      </div>

      {/* The three numbers that aren't a stage. */}
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-slate-400 mb-3">
        <span className="font-semibold text-slate-300">🚗 {stats.count} in shop</span>
        {seeMoney && (
          <span className={stats.unpriced ? 'text-yellow-400' : undefined}>
            💵 {stats.unpriced} no price
          </span>
        )}
        <span className={ownedStyle(stats.oldest)}>
          ⏰ oldest {stats.oldest == null ? '—' : `${stats.oldest}d owned`}
        </span>
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

      {/* The stages live in the tally above; these three are the views that
          aren't a stage. Done has no count on purpose — it's a capped slice of
          history, not cars in the shop, so a number here would read as "50
          finished". On Hold keeps its count: junk you can't see the size of is
          junk that quietly becomes the lot. */}
      <div className="flex gap-1.5 mb-3">
        <FilterChip active={statusFilter === 'open'} onClick={() => setStatusFilter('open')}
          label="All Open" count={stats.count} />
        <FilterChip active={statusFilter === 'hold'} onClick={() => setStatusFilter('hold')}
          label={`${HOLD_STATUS.emoji} On Hold`} count={stats.held} tone="hold" />
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
              : statusFilter === 'hold' ? 'Nothing on hold — the whole board is work.'
              : 'No cars in the shop.'}
          </p>
          {!search && !techOnly && statusFilter !== 'done' && statusFilter !== 'hold' && (
            <p className="text-slate-600 text-[11px] mt-2">
              Cars show up here when the shop posts a VIN in the Telegram group.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2 md:space-y-0 md:grid md:grid-cols-2 md:gap-2 lg:grid-cols-3">
          {/* The ids ride along so the job screen can swipe between exactly the
              cars on screen here, in this order — the same filter, the same
              search, the same oldest-first sort. */}
          {visible.map((job) => (
            <JobCard key={job.id} job={job} showPrice={seeMoney}
              onClick={() => navigate(`/body-shop/${job.id}`,
                { state: { siblings: visible.map((j) => j.id) } })} />
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

// One stage of the pipeline: its count, its name, and whether the board is
// currently filtered to it. A stage holding nothing is greyed rather than
// hidden — "no cars in Final Check" is information.
const STAGE_TONES = {
  intake:        { on: 'bg-slate-600 border-slate-400',        num: 'text-slate-100' },
  need_parts:    { on: 'bg-rose-500/30 border-rose-400',       num: 'text-rose-300' },
  waiting_parts: { on: 'bg-orange-500/30 border-orange-400',   num: 'text-orange-300' },
  parts_in:      { on: 'bg-yellow-500/30 border-yellow-400',   num: 'text-yellow-300' },
  in_progress:   { on: 'bg-emerald-500/30 border-emerald-400', num: 'text-emerald-300' },
  final_check:   { on: 'bg-violet-500/30 border-violet-400',   num: 'text-violet-300' },
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
  // The hold chip goes red when it's holding something — it should read as a
  // pile, not as another lane of the pipeline.
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

function JobCard({ job, onClick, showPrice = true }) {
  // The headline is how long we've OWNED the car — the number the sort uses. A
  // fresh buy has no purchase date to subtract, so it falls back to the shop's
  // own clock and labels itself "in shop" so the two are never confused.
  const age = jobAge(job)
  const status = isOnHold(job) ? HOLD_STATUS : JOB_STATUSES.find((s) => s.key === job.status)
  const partsOpen = (job.parts_needed || 0) + (job.parts_ordered || 0)

  // The last 6 leads the second line: it's the name the car goes by in the
  // Telegram group and on the key tag, so it's what someone holding a phone
  // next to the car is matching against — the stock number is the office's
  // name for it. vehicleLabel() already prints the six when it knows nothing
  // else about the car, so a fresh buy doesn't say it twice.
  const last6 = lastSix(job)
  const showSix = last6 && !vehicleLabel(job).endsWith(last6)
  const meta = [
    job.stock_number ? `#${job.stock_number}` : 'Fresh buy — not in inventory yet',
    job.vehicle_color || null,
  ].filter(Boolean)

  return (
    <button onClick={onClick}
      className="w-full text-left bg-slate-800 rounded-xl p-3 border border-slate-700 active:bg-slate-700 flex gap-3">
      {/* Age — the first thing you see */}
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

        <div className="flex items-center gap-3 mt-2 text-[11px] flex-wrap">
          {showPrice && (
            <span className={job.price == null ? 'text-yellow-400 font-semibold' : 'text-emerald-400 font-bold'}>
              {job.price == null ? 'No price yet' : money(job.price)}
            </span>
          )}
          <span className="text-slate-400 truncate">
            {job.tech_name ? `👤 ${job.tech_name}` : <span className="text-slate-500">Unassigned</span>}
          </span>
          {/* The shop's own clock, kept alongside the ownership age — Jorge is
              judged on this one, and on a held car it's the only honest read of
              how long the junk has been in his way. */}
          {age.owned && job.days_in_shop != null && (
            <span className={ageStyle(job.days_in_shop)}>🎨 {job.days_in_shop}d in shop</span>
          )}
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
