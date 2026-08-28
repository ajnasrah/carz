// One car, everything it needs, both shops, one screen.
//
// The failure this exists to stop: a tech fixes what is on the mechanic board,
// the car goes back on the front line, and the dent nobody told him about is
// still on it — so it comes back, and the days-owned clock keeps running. A car
// is ready when BOTH shops are done with it, and until now nothing said whether
// that was true without opening two boards and remembering what the other one
// said.
//
// It is also where a tech states that he found everything. That statement is
// kept apart from the car physically leaving the shop: one is a judgement, the
// other is an event, and only the judgement is worth measuring.

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, CheckCircle, ExternalLink } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import {
  fetchCarWorkOrder, signOffJob, sortLines, isLineClosed,
  LINE_STATUS_STYLES, LINE_STATUSES, SEVERITY_STYLES, SEVERITIES,
  JOB_STATUS_STYLES, JOB_STATUSES, HOLD_STATUS,
  ageStyle, ownedStyle, jobAge, vehicleLabel,
  isMechanicManager, canSeeMechanicMoney,
} from '../services/mechanic'

const money = (n) => (n == null ? null : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)

export default function CarWorkOrder() {
  const { vin6 } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const manager = isMechanicManager(profile)
  const seeMoney = canSeeMechanicMoney(profile)

  const load = useCallback(async () => {
    if (!vin6) { setLoading(false); return }
    setError('')
    try {
      setData(await fetchCarWorkOrder(vin6))
    } catch (e) {
      setError(e.message || 'Could not load this car')
    } finally {
      setLoading(false)
    }
  }, [vin6])

  useEffect(() => { setLoading(true); load() }, [load])

  // No VIN in the URL — this screen is also a lookup, because the question
  // "what does this car still need" is asked while standing next to it.
  if (!vin6) {
    return (
      <div className="page">
        <Header onBack={() => navigate('/')} title="Work Order" subtitle="Everything a car still needs" />
        <Lookup onGo={(six) => navigate(`/work/${six}`)} />
        <p className="text-[11px] text-slate-500 mt-3">
          Type the last 6. You'll get both shops on one screen.
        </p>
      </div>
    )
  }

  if (loading) return <div className="page text-center text-slate-400 pt-20">Loading…</div>

  const { mech, body, lines = [], mechParts = [], bodyParts = [], miss } = data || {}
  const car = mech || body
  const openLines = lines.filter((l) => !isLineClosed(l))
  const partsOpen = [...mechParts, ...bodyParts].filter((p) => p.status !== 'received')
  const age = car ? jobAge(car) : null

  // The one sentence this screen exists to say.
  const mechDone = !mech || mech.status === 'done'
  const bodyDone = !body || body.status === 'done'
  const ready = mechDone && bodyDone && openLines.length === 0 && partsOpen.length === 0

  async function onSignOff() {
    setBusy(true)
    try { await signOffJob(mech.id); await load() }
    catch (e) { setError(e.message || 'Could not sign off') }
    finally { setBusy(false) }
  }

  return (
    <div className="page pb-24">
      <Header
        onBack={() => navigate(-1)}
        title={car ? vehicleLabel(car) : `VIN …${vin6}`}
        subtitle={car
          ? `…${vin6}${car.stock_number ? ` · #${car.stock_number}` : ''}`
          : 'Nothing open on this car'}
        onRefresh={() => { setLoading(true); load() }}
      />

      {error && (
        <div className="card border-red-500/40 bg-red-500/10 text-red-300 text-sm mb-3">{error}</div>
      )}

      {!car ? (
        <div className="card text-center py-10">
          <div className="text-4xl mb-2">✅</div>
          <p className="text-slate-400 text-sm">No shop has this car.</p>
          <p className="text-slate-600 text-[11px] mt-2">
            Nothing is open at the mechanic or the body shop for …{vin6}.
          </p>
        </div>
      ) : (
        <>
          {/* The verdict, first, because it is the reason anyone opened this. */}
          <div className={`card mb-3 py-3 text-center ${
            ready ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-amber-500/10 border-amber-500/40'}`}>
            <p className={`text-base font-bold ${ready ? 'text-emerald-400' : 'text-amber-300'}`}>
              {ready ? 'Nothing outstanding' : `${openLines.length + partsOpen.length} thing${
                openLines.length + partsOpen.length === 1 ? '' : 's'} still open`}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {ready
                ? 'Both shops are finished with this car.'
                : 'Fix it all now — a second trip restarts the clock.'}
            </p>
            {age && (
              <p className={`text-[11px] mt-1 ${age.owned ? ownedStyle(age.days) : ageStyle(age.days)}`}>
                {age.days ?? '—'} {age.owned ? 'days owned' : 'days in shop'}
              </p>
            )}
          </div>

          <ShopCard
            title="🔧 Mechanic" job={mech}
            onOpen={() => navigate(`/mechanic/${mech.id}`)}
            empty="Never went to the mechanic."
          />

          {lines.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {sortLines(lines).map((l) => <LineRow key={l.id} line={l} seeMoney={seeMoney} />)}
            </div>
          )}

          <ShopCard
            title="🎨 Body Shop" job={body}
            onOpen={() => navigate(`/body-shop/${body.id}`)}
            empty="Never went to the body shop."
            extra={body && seeMoney && body.price != null ? money(body.price) : null}
          />

          {partsOpen.length > 0 && (
            <div className="card mb-3">
              <p className="text-sm font-bold mb-2">📦 Parts not in yet</p>
              <div className="space-y-1">
                {partsOpen.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-slate-700 text-[10px] font-bold">{p.status}</span>
                    <span className="flex-1 truncate">{p.name}</span>
                    {seeMoney && p.cost != null && (
                      <span className="text-emerald-400 font-semibold">{money(p.cost)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Where the measurement comes from. Shown to the manager because it is
              about whether the inspection is working, not about the tech. */}
          {manager && miss && Number(miss.lines_total) > 0 && (
            <div className="card mb-3">
              <p className="text-sm font-bold mb-1">How much the inspection caught</p>
              <p className="text-[11px] text-slate-400">
                {miss.from_inspection} of {miss.lines_total} came from the inspection;
                {' '}<span className={Number(miss.found_at_shop) > 0 ? 'text-amber-300 font-semibold' : ''}>
                  {miss.found_at_shop}{Number(miss.found_at_shop) === 1 ? ' was' : ' were'} found here
                </span>.
              </p>
            </div>
          )}

          {mech && mech.status !== 'done' && (
            <div className="mt-4">
              {mech.signed_off_at ? (
                <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-sm font-semibold">
                  <CheckCircle size={16} /> Signed off {new Date(mech.signed_off_at).toLocaleDateString()}
                </div>
              ) : (
                <>
                  <button onClick={onSignOff} disabled={busy || openLines.length > 0}
                    className="btn-primary disabled:opacity-40">
                    {busy ? 'Saving…' : "Nothing else found — sign off"}
                  </button>
                  {openLines.length > 0 && (
                    <p className="text-[11px] text-slate-500 mt-2 text-center">
                      {openLines.length} repair{openLines.length === 1 ? '' : 's'} still open.
                      Close or decline {openLines.length === 1 ? 'it' : 'them'} first.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Lookup({ onGo }) {
  const [six, setSix] = useState('')
  const ready = six.trim().length >= 6
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (ready) onGo(six.trim().toUpperCase().slice(-6)) }}
      className="flex gap-2">
      <input
        value={six}
        onChange={(e) => setSix(e.target.value.toUpperCase())}
        placeholder="086793"
        autoFocus autoCapitalize="characters" autoComplete="off"
        className="font-mono tracking-widest text-lg"
      />
      <button type="submit" disabled={!ready}
        className="shrink-0 px-4 rounded-lg bg-emerald-500 text-slate-900 font-bold disabled:opacity-40">
        Go
      </button>
    </form>
  )
}

function Header({ onBack, title, subtitle, onRefresh }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <button onClick={onBack} aria-label="Back"
        className="p-2 -ml-2 rounded-lg bg-slate-800 text-slate-300 active:bg-slate-700">
        <ArrowLeft size={18} />
      </button>
      <div className="flex-1 min-w-0">
        <h1 className="text-lg font-bold truncate leading-tight">{title}</h1>
        <p className="text-[11px] text-slate-400 truncate">{subtitle}</p>
      </div>
      {onRefresh && (
        <button onClick={onRefresh} aria-label="Refresh"
          className="p-2 rounded-lg bg-slate-800 border border-slate-700 active:bg-slate-700">
          <RefreshCw size={16} className="text-slate-300" />
        </button>
      )}
    </div>
  )
}

function ShopCard({ title, job, onOpen, empty, extra }) {
  if (!job) {
    return (
      <div className="card mb-3 py-2.5">
        <p className="text-sm font-bold">{title}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">{empty}</p>
      </div>
    )
  }
  const status = job.status === HOLD_STATUS.key
    ? HOLD_STATUS
    : JOB_STATUSES.find((s) => s.key === job.status)
  return (
    <button onClick={onOpen}
      className="w-full text-left card mb-3 py-2.5 flex items-center gap-2 active:bg-slate-700">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold">{title}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">
          {job.days_in_shop != null ? `${job.days_in_shop}d in shop` : 'just arrived'}
          {job.tech_name ? ` · ${job.tech_name}` : ''}
          {extra ? ` · ${extra}` : ''}
        </p>
      </div>
      <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-bold ${JOB_STATUS_STYLES[job.status]}`}>
        {status?.label || job.status}
      </span>
      <ExternalLink size={13} className="shrink-0 text-slate-500" />
    </button>
  )
}

function LineRow({ line, seeMoney }) {
  const closed = isLineClosed(line)
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${
      closed ? 'bg-slate-900/60 border-slate-800' : 'bg-slate-800 border-slate-700'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs flex-1 min-w-0 ${closed ? 'text-slate-500 line-through' : 'font-semibold'}`}>
          {line.description}
        </span>
        {line.severity && !closed && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${SEVERITY_STYLES[line.severity]}`}>
            {SEVERITIES.find((s) => s.key === line.severity)?.label}
          </span>
        )}
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${LINE_STATUS_STYLES[line.status]}`}>
          {LINE_STATUSES.find((s) => s.key === line.status)?.label}
        </span>
        {seeMoney && line.est_cost != null && (
          <span className="text-[10px] text-slate-400">est ${line.est_cost}</span>
        )}
        {/* Whatever the inspector attached. A recorded noise is the one thing
            that survives the handoff better than any sentence would. */}
        {(line.media || []).map((m, i) => (
          <a key={i} href={m.url} target="_blank" rel="noreferrer"
             className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-emerald-300 font-semibold">
            {m.kind === 'audio' ? '🔊' : '📷'}
          </a>
        ))}
        {!line.source_inspection_id && (
          <span className="text-[10px] text-amber-300" title="Found at the shop, not by the inspection">
            found here
          </span>
        )}
      </div>
    </div>
  )
}
