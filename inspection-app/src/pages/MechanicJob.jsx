// One car at the mechanic — its problems, its parts, its stage.
//
// The screen is the list of lines. Everything else on it is context for that
// list: the car at the top, the stage buttons, the parts hanging off each line.
// A body shop job is a price and a photo set; a mechanic job is a list of things
// wrong with a car, and closing the last one closes the job (a database trigger
// does that, so nobody has to remember two steps).
//
// Parts attach to a LINE where there's an obvious one — the water pump belongs
// to the water pump — and to the job where there isn't. Both show here; the
// ordering screen reads them the same way.

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, RefreshCw, Trash2, X, Search as SearchIcon } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import PartsSearch from '../components/PartsSearch'
import {
  fetchJob, fetchLines, fetchParts, updateJob,
  addLine, setLineStatus, deleteLine,
  addPart, updatePart, deletePart, markPartOrdered, markPartNeeded,
  fetchMechanics,
  JOB_STATUSES, JOB_STATUS_STYLES, HOLD_STATUS,
  LINE_STATUSES, LINE_STATUS_STYLES, isLineClosed, sortLines,
  SYSTEMS, systemLabel, SEVERITIES, SEVERITY_STYLES,
  PART_STATUS_STYLES,
  ageStyle, ownedStyle, jobAge, vehicleLabel, lastSix,
  isMechanicManager, canSeeMechanicMoney,
} from '../services/mechanic'

const money = (n) => (n == null ? null : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)

export default function MechanicJob() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [job, setJob] = useState(null)
  const [lines, setLines] = useState([])
  const [parts, setParts] = useState([])
  const [mechanics, setMechanics] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [addingLine, setAddingLine] = useState(false)

  const manager = isMechanicManager(profile)
  const seeMoney = canSeeMechanicMoney(profile)

  const load = useCallback(async () => {
    setError('')
    try {
      const [j, l, p] = await Promise.all([fetchJob(id), fetchLines(id), fetchParts(id)])
      if (!j) throw new Error('That job no longer exists')
      setJob(j); setLines(l); setParts(p)
    } catch (e) {
      setError(e.message || 'Could not load the job')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { setLoading(true); load() }, [load])

  // Only the manager assigns work, so only he pays for the extra query.
  useEffect(() => {
    if (!manager) return
    fetchMechanics().then(setMechanics).catch(() => setMechanics([]))
  }, [manager])

  // Closing the last open line closes the job underneath us, so every line
  // change refetches the job rather than assuming its status held.
  async function onLineChanged() {
    const [j, l] = await Promise.all([fetchJob(id), fetchLines(id)])
    setJob(j); setLines(l)
  }

  async function setStatus(next) {
    try {
      await updateJob(id, { status: next })
      setJob(await fetchJob(id))
    } catch (e) {
      setError(e.message || 'Could not change the status')
    }
  }

  if (loading) {
    return <div className="page"><div className="text-center text-slate-500 py-10 text-sm">Loading…</div></div>
  }

  if (!job) {
    return (
      <div className="page">
        <button onClick={() => navigate('/mechanic')} className="btn-secondary mb-4">
          <ArrowLeft size={16} /> Back to the board
        </button>
        <div className="card border-red-500/40 bg-red-500/10 text-red-300 text-sm">
          {error || 'That job no longer exists'}
        </div>
      </div>
    )
  }

  const age = jobAge(job)
  const onHold = job.status === HOLD_STATUS.key
  const last6 = lastSix(job)
  const openLines = lines.filter((l) => !isLineClosed(l))
  const jobParts = parts.filter((p) => !p.line_id)

  const vehicle = {
    year: job.vehicle_year, make: job.vehicle_make,
    model: job.vehicle_model, vin: job.vin,
  }

  return (
    <div className="page pb-24">
      {/* ------------------------------------------------------------ header */}
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => navigate('/mechanic')} aria-label="Back to the board"
          className="p-2 -ml-2 rounded-lg bg-slate-800 text-slate-300 active:bg-slate-700">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold truncate leading-tight">{vehicleLabel(job)}</h1>
          <div className="text-[11px] text-slate-400 truncate">
            {last6 && <span className="font-mono text-slate-300">…{last6}</span>}
            {job.stock_number && <span className="text-slate-600"> · #{job.stock_number}</span>}
            {job.mileage != null && <span className="text-slate-600"> · {Number(job.mileage).toLocaleString()} mi</span>}
          </div>
        </div>
        <button onClick={() => { setLoading(true); load() }} aria-label="Refresh"
          className="p-2 rounded-lg bg-slate-800 border border-slate-700 active:bg-slate-700">
          <RefreshCw size={16} className="text-slate-300" />
        </button>
      </div>

      {error && (
        <div className="card border-red-500/40 bg-red-500/10 text-red-300 text-sm mb-3">{error}</div>
      )}

      {/* Both clocks. Days owned is what the board sorts on and what the money
          argument is about; days in shop is how long this shop has had it. */}
      <div className="flex items-center gap-4 mb-3 text-[11px]">
        <span className={age.owned ? ownedStyle(age.days) : ageStyle(age.days)}>
          <b className="text-base">{age.days ?? '—'}</b> {age.owned ? 'days owned' : 'days in shop'}
        </span>
        {age.owned && job.days_in_shop != null && (
          <span className={ageStyle(job.days_in_shop)}>🔧 {job.days_in_shop}d in shop</span>
        )}
        {seeMoney && Number(job.parts_cost) > 0 && (
          <span className="text-emerald-400 font-semibold">📦 {money(job.parts_cost)} in parts</span>
        )}
      </div>

      {/* ------------------------------------------------------------ stage */}
      <div className="flex gap-1.5 flex-wrap mb-2">
        {JOB_STATUSES.map((s) => (
          <button key={s.key} onClick={() => setStatus(s.key)} title={s.hint}
            className={`px-2.5 py-1.5 rounded-full text-xs font-semibold ${
              job.status === s.key
                ? JOB_STATUS_STYLES[s.key].replace('/20', '/40')
                : 'bg-slate-800 text-slate-400 border border-slate-700 active:bg-slate-700'}`}>
            {s.emoji} {s.label}
          </button>
        ))}
        <button onClick={() => setStatus(onHold ? 'intake' : HOLD_STATUS.key)}
          title={onHold ? 'Put it back on the board' : HOLD_STATUS.hint}
          className={`px-2.5 py-1.5 rounded-full text-xs font-semibold ${
            onHold ? 'bg-red-500 text-slate-900'
                   : 'bg-slate-800 text-slate-400 border border-slate-700 active:bg-slate-700'}`}>
          {HOLD_STATUS.emoji} {onHold ? 'On Hold' : 'Hold'}
        </button>
      </div>

      {onHold && (
        <div className="mb-3 p-2.5 rounded-xl bg-red-500/10 border border-red-500/40 text-[11px] text-red-300">
          Parked. It keeps its lines and parts, it's out of the board's counts, and nothing
          automatic will close it — a car pushed round the back won't come back marked repaired.
        </div>
      )}

      {/* --------------------------------------------------------- assignment */}
      {manager && (
        <div className="mb-4">
          <label className="text-[11px] uppercase tracking-wide text-slate-400">Mechanic</label>
          <select
            value={job.assigned_tech || ''}
            onChange={async (e) => {
              await updateJob(id, { assigned_tech: e.target.value || null })
              setJob(await fetchJob(id))
            }}
            className="mt-1 text-sm">
            <option value="">Unassigned</option>
            {mechanics.map((m) => (
              <option key={m.id} value={m.id}>{m.name || 'Unnamed'}</option>
            ))}
          </select>
        </div>
      )}

      {/* ------------------------------------------------------------ lines */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-bold text-sm">
          What's wrong with it
          {lines.length > 0 && (
            <span className="ml-2 text-[11px] font-normal text-slate-400">
              {openLines.length} of {lines.length} open
            </span>
          )}
        </h2>
        <button onClick={() => setAddingLine(true)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500 text-slate-900 font-bold text-xs active:bg-emerald-600">
          <Plus size={14} /> Problem
        </button>
      </div>

      {lines.length === 0 ? (
        <div className="card text-center py-8 mb-4">
          <div className="text-3xl mb-2">🔍</div>
          <p className="text-slate-400 text-sm">Nothing listed yet.</p>
          <p className="text-slate-600 text-[11px] mt-1">
            Until somebody says what's wrong, this car can't be ordered for or scheduled.
          </p>
        </div>
      ) : (
        <div className="space-y-2 mb-4">
          {sortLines(lines).map((line) => (
            <LineRow
              key={line.id}
              line={line}
              parts={parts.filter((p) => p.line_id === line.id)}
              vehicle={vehicle}
              seeMoney={seeMoney}
              manager={manager}
              onChanged={onLineChanged}
              onPartsChanged={async () => setParts(await fetchParts(id))}
              jobId={id}
            />
          ))}
        </div>
      )}

      {/* ------------------------------------------- parts not tied to a line */}
      {jobParts.length > 0 && (
        <div className="mb-4">
          <h2 className="font-bold text-sm mb-2">
            Other parts
            <span className="ml-2 text-[11px] font-normal text-slate-500">for the car, not one repair</span>
          </h2>
          <div className="space-y-1.5">
            {jobParts.map((p) => (
              <PartRow key={p.id} part={p} seeMoney={seeMoney} manager={manager}
                onChanged={async () => setParts(await fetchParts(id))} />
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ notes */}
      <div className="mb-4">
        <label className="text-[11px] uppercase tracking-wide text-slate-400">Notes</label>
        <textarea
          defaultValue={job.notes || ''}
          onBlur={async (e) => {
            const v = e.target.value.trim() || null
            if (v === (job.notes || null)) return
            await updateJob(id, { notes: v })
            setJob(await fetchJob(id))
          }}
          rows={3}
          placeholder="Anything that isn't a specific repair…"
          className="mt-1 text-sm"
        />
      </div>

      {addingLine && (
        <AddLineModal
          jobId={id}
          onClose={() => setAddingLine(false)}
          onAdded={async () => { setAddingLine(false); await onLineChanged() }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- one line

function LineRow({ line, parts, vehicle, seeMoney, manager, onChanged, onPartsChanged, jobId }) {
  const [busy, setBusy] = useState(false)
  const [searching, setSearching] = useState(false)
  const [addingPart, setAddingPart] = useState(false)
  const closed = isLineClosed(line)

  async function setStatus(status) {
    setBusy(true)
    try { await setLineStatus(line.id, status); await onChanged() }
    finally { setBusy(false) }
  }

  async function remove() {
    setBusy(true)
    try { await deleteLine(line.id); await onChanged() }
    finally { setBusy(false) }
  }

  return (
    <div className={`rounded-xl border p-3 ${
      closed ? 'bg-slate-900/60 border-slate-800' : 'bg-slate-800 border-slate-700'}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-semibold leading-snug ${closed ? 'text-slate-500 line-through' : ''}`}>
            {line.description}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 font-semibold">
              {systemLabel(line.system)}
            </span>
            {line.severity && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${SEVERITY_STYLES[line.severity]}`}>
                {SEVERITIES.find((s) => s.key === line.severity)?.label}
              </span>
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${LINE_STATUS_STYLES[line.status]}`}>
              {LINE_STATUSES.find((s) => s.key === line.status)?.label}
            </span>
            {seeMoney && line.est_cost != null && (
              <span className="text-[10px] text-slate-400">est {money(line.est_cost)}</span>
            )}
            {line.source_inspection_id && (
              <span className="text-[10px] text-slate-500" title="Raised by an inspection">📋 inspection</span>
            )}
          </div>
        </div>
        {manager && (
          <button onClick={remove} disabled={busy} aria-label="Delete this line"
            className="shrink-0 p-1.5 rounded-lg text-slate-500 active:bg-slate-700">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Status is set by tapping, because a mechanic with a phone in a greasy
          hand isn't opening a dropdown. */}
      <div className="flex gap-1 flex-wrap mt-2">
        {LINE_STATUSES.map((s) => (
          <button key={s.key} onClick={() => setStatus(s.key)} disabled={busy || line.status === s.key}
            className={`px-2 py-1 rounded-full text-[10px] font-semibold ${
              line.status === s.key
                ? LINE_STATUS_STYLES[s.key].replace('/20', '/40')
                : 'bg-slate-900 text-slate-500 border border-slate-700 active:bg-slate-700'}`}>
            {s.emoji} {s.label}
          </button>
        ))}
      </div>

      {/* Parts for this specific repair */}
      {parts.length > 0 && (
        <div className="mt-2 space-y-1">
          {parts.map((p) => (
            <PartRow key={p.id} part={p} seeMoney={seeMoney} manager={manager} onChanged={onPartsChanged} compact />
          ))}
        </div>
      )}

      {!closed && (
        <div className="flex gap-1.5 mt-2">
          <button onClick={() => setSearching((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-[11px] font-semibold text-slate-300 active:bg-slate-700">
            <SearchIcon size={12} /> {searching ? 'Hide' : 'Find parts'}
          </button>
          <button onClick={() => setAddingPart(true)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-[11px] font-semibold text-slate-300 active:bg-slate-700">
            <Plus size={12} /> Part
          </button>
        </div>
      )}

      {searching && (
        <div className="mt-2">
          <PartsSearch vehicle={vehicle} defaultTerm={line.description} />
        </div>
      )}

      {addingPart && (
        <AddPartModal
          jobId={jobId} lineId={line.id} seeMoney={seeMoney}
          onClose={() => setAddingPart(false)}
          onAdded={async () => { setAddingPart(false); await onPartsChanged() }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- one part

function PartRow({ part, seeMoney, manager, onChanged, compact = false }) {
  const [busy, setBusy] = useState(false)

  async function toggle() {
    setBusy(true)
    try {
      if (part.status === 'needed') await markPartOrdered(part.id)
      else if (part.status === 'ordered') await updatePart(part.id, { status: 'received' })
      else await markPartNeeded(part.id)
      await onChanged()
    } finally { setBusy(false) }
  }

  return (
    <div className={`flex items-center gap-2 rounded-lg bg-slate-900 border border-slate-800 px-2 py-1.5 ${
      compact ? 'text-[11px]' : 'text-xs'}`}>
      <button onClick={toggle} disabled={busy}
        className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${PART_STATUS_STYLES[part.status]}`}>
        {part.status}
      </button>
      <span className="min-w-0 flex-1 truncate">{part.name}</span>
      {part.vendor && <span className="shrink-0 text-slate-500 truncate max-w-[80px]">{part.vendor}</span>}
      {seeMoney && part.cost != null && (
        <span className="shrink-0 text-emerald-400 font-semibold">{money(part.cost)}</span>
      )}
      {manager && (
        <button onClick={async () => { setBusy(true); try { await deletePart(part.id); await onChanged() } finally { setBusy(false) } }}
          disabled={busy} aria-label="Delete this part"
          className="shrink-0 p-1 rounded text-slate-600 active:bg-slate-800">
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- modals

function AddLineModal({ jobId, onClose, onAdded }) {
  const [description, setDescription] = useState('')
  const [system, setSystem] = useState('other')
  const [severity, setSeverity] = useState('moderate')
  const [estCost, setEstCost] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError(''); setSaving(true)
    try {
      await addLine(jobId, {
        description, system, severity,
        est_cost: estCost === '' ? null : Number(estCost),
      })
      await onAdded()
    } catch (err) {
      setError(err.message || 'Could not add it')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose() }}>
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">What's wrong with it?</h2>
          <button onClick={onClose} disabled={saving} className="text-slate-400 p-1"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <input
              value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Rear brakes grinding" autoFocus className="text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] uppercase tracking-wide text-slate-400">System</label>
              <select value={system} onChange={(e) => setSystem(e.target.value)} className="mt-1 text-sm">
                {SYSTEMS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-slate-400">How bad</label>
              <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="mt-1 text-sm">
                {SEVERITIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-slate-400">Rough cost (optional)</label>
            <input type="number" inputMode="decimal" value={estCost}
              onChange={(e) => setEstCost(e.target.value)} placeholder="250" className="mt-1 text-sm" />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={saving || !description.trim()} className="btn-primary">
            {saving ? 'Adding…' : 'Add it'}
          </button>
        </form>
      </div>
    </div>
  )
}

function AddPartModal({ jobId, lineId, seeMoney, onClose, onAdded }) {
  const [name, setName] = useState('')
  const [vendor, setVendor] = useState('')
  const [cost, setCost] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError(''); setSaving(true)
    try {
      await addPart(jobId, {
        name, lineId,
        vendor: vendor.trim() || null,
        cost: cost === '' ? null : Number(cost),
      })
      await onAdded()
    } catch (err) {
      setError(err.message || 'Could not add the part')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose() }}>
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">Add a part</h2>
          <button onClick={onClose} disabled={saving} className="text-slate-400 p-1"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Water pump" autoFocus className="text-sm" />
          <input value={vendor} onChange={(e) => setVendor(e.target.value)}
            placeholder="Where from (optional)" className="text-sm" />
          {seeMoney && (
            <input type="number" inputMode="decimal" value={cost}
              onChange={(e) => setCost(e.target.value)} placeholder="Cost (optional)" className="text-sm" />
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={saving || !name.trim()} className="btn-primary">
            {saving ? 'Adding…' : 'Add part'}
          </button>
        </form>
      </div>
    </div>
  )
}
