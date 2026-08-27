// Parts to Order — the single list a manager works when he sits down to buy.
//
// The complaint this exists to fix: ordering meant opening one car at a time to
// find out whether it still needed anything, and nothing recorded that you'd
// already been through it, so the same cars came round again every session.
//
// Here a car is on the list while it has a part marked Needed, and it drops off
// the moment its last one is marked Ordered. Work the list top to bottom and it
// empties. Nothing you've ordered for ever asks to be looked at twice.
//
// Order is the board's order — longest OWNED first — because the car burning the
// most money is the one whose bumper should be bought first.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, ChevronRight, Undo2 } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import {
  fetchPartsToOrder, markPartOrdered, markPartNeeded, markJobPartsOrdered,
  advanceToWaitingParts, updateJob,
  jobAge, ownedStyle, ageStyle, vehicleLabel, lastSix,
  isBodyShopManager, canSeeShopMoney, JOB_STATUSES, JOB_STATUS_STYLES,
} from '../services/bodyShop'

const money = (n) => (n == null ? null : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)

export default function PartsToOrder() {
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [cars, setCars] = useState([])
  const [untriaged, setUntriaged] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // The last thing ordered, kept only so it can be put back. One deep — an undo
  // stack on a list that changes under you is a way to restore the wrong car.
  const [undo, setUndo] = useState(null)
  const undoTimer = useRef(null)

  // Buying is the manager's job and the costs on this screen are his numbers, so
  // a tech who wanders in goes back to the board rather than seeing a price list.
  const manager = isBodyShopManager(profile)
  const seeMoney = canSeeShopMoney(profile)

  const load = useCallback(async () => {
    setError('')
    try {
      const { cars: rows, untriaged: n } = await fetchPartsToOrder()
      setCars(rows)
      setUntriaged(n)
    } catch (e) {
      setError(e.message || 'Could not load the order list')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!manager) { navigate('/body-shop', { replace: true }); return }
    setLoading(true)
    load()
  }, [manager, navigate, load])

  useEffect(() => () => clearTimeout(undoTimer.current), [])

  function offerUndo(payload) {
    clearTimeout(undoTimer.current)
    setUndo(payload)
    undoTimer.current = setTimeout(() => setUndo(null), 12000)
  }

  // Ordering is optimistic: the row leaves the screen on tap, because a list you
  // have to wait on is a list you lose your place in. A failure puts it back and
  // says so.
  async function orderPart(carIndex, part, fields) {
    const car = cars[carIndex]
    if (!car) return
    const remaining = car.parts.filter((p) => p.id !== part.id)
    applyRemaining(car.job.id, remaining)

    try {
      await markPartOrdered(part.id, fields)
      const from = remaining.length === 0 ? await advanceToWaitingParts(car.job) : null
      offerUndo({
        label: `${part.name} · ${vehicleLabel(car.job)}`,
        parts: [part], job: car.job, movedFrom: from,
      })
    } catch (e) {
      setError(e.message || 'Could not mark that part ordered')
      await load()
    }
  }

  async function orderAll(carIndex) {
    const car = cars[carIndex]
    if (!car) return
    const all = car.parts
    applyRemaining(car.job.id, [])

    try {
      await markJobPartsOrdered(car.job.id)
      const from = await advanceToWaitingParts(car.job)
      offerUndo({
        label: `${all.length} ${all.length === 1 ? 'part' : 'parts'} · ${vehicleLabel(car.job)}`,
        parts: all, job: car.job, movedFrom: from,
      })
    } catch (e) {
      setError(e.message || 'Could not mark those parts ordered')
      await load()
    }
  }

  // A car with nothing left needing an order is off the list — that IS the
  // feature, so it happens here in one place for both paths above.
  function applyRemaining(jobId, remaining) {
    setCars((rows) => rows
      .map((c) => (c.job.id === jobId ? { ...c, parts: remaining } : c))
      .filter((c) => c.parts.length > 0))
  }

  async function undoLast() {
    if (!undo) return
    const payload = undo
    setUndo(null)
    clearTimeout(undoTimer.current)
    try {
      await Promise.all(payload.parts.map((p) => markPartNeeded(p.id)))
      // Putting the parts back has to put the stage back too, or the undo leaves
      // a car sitting in Waiting Parts with nothing on order.
      if (payload.movedFrom) await updateJob(payload.job.id, { status: payload.movedFrom })
      await load()
    } catch (e) {
      setError(e.message || 'Could not undo that')
    }
  }

  const partCount = cars.reduce((n, c) => n + c.parts.length, 0)

  return (
    <div className="page pb-24">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate('/body-shop')} aria-label="Back to the board"
          className="p-2 -ml-2 mr-1 rounded-lg bg-slate-800 text-slate-300 active:bg-slate-700">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="page-title mb-0">📦 Parts to Order</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {loading ? 'Loading…'
              : partCount === 0 ? 'Nothing waiting to be bought'
              : `${partCount} ${partCount === 1 ? 'part' : 'parts'} across ${cars.length} ${cars.length === 1 ? 'car' : 'cars'} — longest owned first`}
          </p>
        </div>
        <button onClick={() => { setLoading(true); load() }}
          className="p-2 rounded-lg bg-slate-800 border border-slate-700 active:bg-slate-700"
          aria-label="Refresh">
          <RefreshCw size={16} className={loading ? 'animate-spin text-slate-500' : 'text-slate-300'} />
        </button>
      </div>

      {error && (
        <div className="card border-red-500/40 bg-red-500/10 text-red-300 text-sm mb-3">{error}</div>
      )}

      {loading ? (
        <div className="text-center text-slate-500 py-10 text-sm">Loading…</div>
      ) : cars.length === 0 ? (
        <div className="card text-center py-10">
          <div className="text-4xl mb-2">📦</div>
          <p className="text-slate-400 text-sm">
            Everything in the shop has its parts on order.
          </p>
          {untriaged > 0 && (
            <p className="text-slate-600 text-[11px] mt-2">
              {untriaged} open {untriaged === 1 ? 'car has' : 'cars have'} no parts listed at all —
              {' '}nobody has said what {untriaged === 1 ? 'it needs' : 'they need'} yet.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3 md:space-y-0 md:grid md:grid-cols-2 md:gap-3">
          {cars.map((car, i) => (
            <CarParts key={car.job.id} car={car} showCost={seeMoney}
              onOpen={() => navigate(`/body-shop/${car.job.id}`)}
              onOrder={(part, fields) => orderPart(i, part, fields)}
              onOrderAll={() => orderAll(i)} />
          ))}

          {untriaged > 0 && (
            <p className="text-center text-[11px] text-slate-600 pt-2 md:col-span-2">
              {untriaged} open {untriaged === 1 ? 'car has' : 'cars have'} no parts listed yet —
              {' '}they aren't on this list because nothing has been asked for.
            </p>
          )}
        </div>
      )}

      {undo && (
        <div className="fixed inset-x-0 bottom-0 z-30 p-3 md:pl-56">
          <div className="mx-auto max-w-md flex items-center gap-3 rounded-xl bg-slate-800 border border-slate-600 px-3 py-2.5 shadow-2xl">
            <span className="text-[11px] text-slate-300 min-w-0 flex-1 truncate">
              ✅ Ordered — {undo.label}
            </span>
            <button onClick={undoLast}
              className="shrink-0 flex items-center gap-1 text-xs font-bold text-emerald-400 active:text-emerald-300">
              <Undo2 size={14} /> Undo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// One car and everything still to buy for it. The card header is the board's
// card in miniature — same age-first read — so a manager scanning this list is
// looking at the same thing he was looking at a screen ago.
function CarParts({ car, onOpen, onOrder, onOrderAll, showCost }) {
  const { job, parts } = car
  const age = jobAge(job)
  const stage = JOB_STATUSES.find((s) => s.key === job.status)
  const last6 = lastSix(job)
  const showSix = last6 && !vehicleLabel(job).endsWith(last6)

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <button onClick={onOpen} className="w-full text-left p-3 flex gap-3 active:bg-slate-700">
        <div className="shrink-0 w-12 text-center">
          <div className={`text-2xl font-bold leading-none ${age.owned ? ownedStyle(age.days) : ageStyle(age.days)}`}>
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
                {job.stock_number ? `#${job.stock_number}` : 'Fresh buy — not in inventory yet'}
              </div>
            </div>
            <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-bold ${JOB_STATUS_STYLES[job.status]}`}>
              {stage?.label || job.status}
            </span>
          </div>
        </div>
        <ChevronRight size={16} className="shrink-0 self-center text-slate-600" />
      </button>

      <div className="border-t border-slate-700 divide-y divide-slate-700/60">
        {parts.map((part) => (
          <PartRow key={part.id} part={part} showCost={showCost}
            onOrder={(fields) => onOrder(part, fields)} />
        ))}
      </div>

      {parts.length > 1 && (
        <button onClick={onOrderAll}
          className="w-full py-2.5 text-xs font-bold text-emerald-400 bg-slate-800/60 border-t border-slate-700 active:bg-slate-700">
          Mark all {parts.length} ordered
        </button>
      )}
    </div>
  )
}

// A part, with the two things you learn at the moment you buy it: who from and
// what it cost. Both optional — a part ordered with no price still leaves the
// list, because holding the list hostage to bookkeeping is how the list stops
// getting worked.
function PartRow({ part, onOrder, showCost }) {
  const [vendor, setVendor] = useState(part.vendor || '')
  const [cost, setCost] = useState(part.cost == null ? '' : String(part.cost))
  const [busy, setBusy] = useState(false)

  function submit() {
    if (busy) return
    setBusy(true)
    onOrder({ vendor, ...(showCost ? { cost } : {}) })
  }

  return (
    <div className="p-3">
      <div className="text-sm text-slate-200">{part.name}</div>
      {part.eta && (
        <div className="text-[11px] text-slate-500 mt-0.5">ETA {part.eta}</div>
      )}
      <div className="flex items-center gap-2 mt-2">
        <input
          value={vendor} onChange={(e) => setVendor(e.target.value)}
          placeholder="Vendor" autoComplete="off"
          className="flex-1 min-w-0 !py-2 text-sm" />
        {showCost && (
          <input
            value={cost} onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="$" inputMode="decimal"
            className="w-20 shrink-0 !py-2 text-sm" />
        )}
        <button onClick={submit} disabled={busy}
          className="shrink-0 px-3 py-2 rounded-lg bg-emerald-500 text-slate-900 font-bold text-xs active:bg-emerald-600 disabled:opacity-50">
          Ordered
        </button>
      </div>
      {showCost && part.cost != null && (
        <div className="text-[11px] text-slate-500 mt-1">Quoted {money(part.cost)}</div>
      )}
    </div>
  )
}
