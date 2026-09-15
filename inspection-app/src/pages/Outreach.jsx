// Buyer Outreach: pick cars, and each one is texted to its best-matched buyers
// one at a time. No reply in 30 business minutes and it moves to the next
// buyer; any reply pauses it here until the owner decides.
//
// The screen is ordered by what needs a human: replies first (a buyer is
// waiting on us), then what's running, then what's finished.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, RefreshCw, Plus, X, Send, SkipForward, DollarSign, Square, ChevronDown,
  ChevronUp, MessageSquare, Clock, Search, Check, AlertTriangle, CornerUpLeft, ExternalLink,
} from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { isPrimaryAdmin } from '../services/adminSetup'
import {
  outreachCall, shapeBoard, OFFER_LABEL, CAR_LABEL, money, carName, prettyPhone, timeLabel, deadlineLabel,
} from '../services/outreach'
import { buildOutreachMessage, segmentCount, HOURS } from '../services/outreachMessage'

const OFFER_TONE = {
  sending: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
  sent: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
  replied: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/40',
  expired: 'text-slate-400 bg-slate-800 border-slate-700',
  failed: 'text-red-300 bg-red-500/10 border-red-500/30',
  cancelled: 'text-slate-500 bg-slate-800 border-slate-700',
  sold: 'text-emerald-200 bg-emerald-500/25 border-emerald-400/60',
  opted_out: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
}

function Chip({ status, children }) {
  return (
    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${OFFER_TONE[status] || OFFER_TONE.expired}`}>
      {children || OFFER_LABEL[status] || status}
    </span>
  )
}

function CarHead({ car, right }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <p className="font-bold text-white text-sm leading-tight">{carName(car)}</p>
        <p className="text-[11px] text-slate-400">
          {money(car.price)}
          {car.mileage ? ` · ${Number(car.mileage).toLocaleString()} mi` : ''}
          {car.stock_number ? ` · #${car.stock_number}` : ''}
          {' · '}…{String(car.vin).slice(-6)}
          {car.sa_url && (
            <a href={car.sa_url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-sky-400">
              SA <ExternalLink size={10} />
            </a>
          )}
        </p>
      </div>
      {right}
    </div>
  )
}

function Thread({ messages }) {
  if (!messages.length) return null
  return (
    <div className="mt-2 space-y-1.5">
      {messages.slice(-6).map((m) => {
        const inbound = m.direction === 'in'
        return (
          <div key={m.id} className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[88%] rounded-2xl px-3 py-1.5 ${inbound
              ? 'bg-emerald-500/15 border border-emerald-500/30 rounded-bl-sm'
              : 'bg-slate-800 rounded-br-sm'}`}>
              <p className="text-xs text-slate-100 whitespace-pre-wrap break-words">{m.body}</p>
              <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
                {inbound && <CornerUpLeft size={10} className="text-emerald-400" />}
                {timeLabel(m.created_at)}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Lineup({ car }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button onClick={() => setOpen(!open)} className="text-[11px] text-slate-400 flex items-center gap-1">
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        Lineup · {car.counted} of {car.max_offers} texted · {car.lineup.length} matched
      </button>
      {open && (
        <div className="mt-1.5 space-y-1">
          {car.lineup.map((c) => (
            <div key={c.rank} className="flex items-center gap-2 text-xs">
              <span className="w-5 text-right text-slate-500">{c.rank}</span>
              <span className="flex-1 min-w-0 truncate text-slate-200" title={c.reason || ''}>
                {c.buyer_name}
                <span className="text-slate-500"> · {[c.city, c.state].filter(Boolean).join(', ')}</span>
              </span>
              {c.offer ? <Chip status={c.offer.status} /> : <span className="text-[10px] text-slate-600">-</span>}
            </div>
          ))}
          {car.offers.filter((o) => o.manual).map((o) => (
            <p key={o.id} className="text-[11px] text-slate-500 pl-7">Sent by hand to {o.buyer_name}</p>
          ))}
        </div>
      )}
    </div>
  )
}

// Sold: which buyer, at what price. Defaults to whoever replied last.
function SoldForm({ car, defaultOfferId, onDone, onCancel }) {
  const offered = car.offers.filter((o) => !['failed', 'cancelled'].includes(o.status))
  const [offerId, setOfferId] = useState(defaultOfferId || offered[offered.length - 1]?.id || '')
  const [price, setPrice] = useState(car.price ? String(Math.round(car.price)) : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    setBusy(true); setErr('')
    try {
      const out = await outreachCall('sold', { car_id: car.id, offer_id: offerId, price })
      onDone(out.alerted ? 'Marked sold. Text sent to 901-831-9661.' : `Marked sold, but the alert text failed: ${out.alert_error}`)
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  if (!offered.length) {
    return <p className="mt-2 text-xs text-amber-300">No buyer has been texted this car yet.</p>
  }
  return (
    <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2">
      <label className="block text-[11px] text-slate-400">Sold to
        <select value={offerId} onChange={(e) => setOfferId(e.target.value)}
          className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-sm text-white">
          {offered.map((o) => <option key={o.id} value={o.id}>{o.buyer_name} · {prettyPhone(o.phone)}</option>)}
        </select>
      </label>
      <label className="block text-[11px] text-slate-400">Sale price
        <div className="mt-1 flex items-center bg-slate-900 border border-slate-700 rounded-lg px-2">
          <DollarSign size={14} className="text-slate-500" />
          <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ''))}
            className="flex-1 bg-transparent py-2 text-sm text-white outline-none" placeholder="32500" />
        </div>
      </label>
      {err && <p className="text-xs text-red-300">{err}</p>}
      <p className="text-[11px] text-slate-500">Stops this car for everyone, hides it from the marketplace, and texts you the VIN, price and buyer.</p>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-bold">Cancel</button>
        <button disabled={busy || !price || !offerId} onClick={submit}
          className="flex-1 py-2 rounded-lg bg-emerald-500 text-slate-900 text-xs font-bold disabled:opacity-50">
          {busy ? 'Saving…' : `Sold ${price ? money(price) : ''}`}
        </button>
      </div>
    </div>
  )
}

function Actions({ car, replied, onAction, allowNext }) {
  const [mode, setMode] = useState(null)   // 'sold' | 'stop'
  const [busy, setBusy] = useState('')

  async function run(label, action, payload) {
    setBusy(label)
    try { await onAction(action, payload) } finally { setBusy('') }
  }

  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {allowNext && (
          <button disabled={!!busy} onClick={() => run('next', 'next_buyer', { car_id: car.id })}
            className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-sky-500 text-slate-900 text-xs font-bold disabled:opacity-50">
            <SkipForward size={14} /> {busy === 'next' ? 'Moving…' : 'Next buyer'}
          </button>
        )}
        {replied && (
          <button disabled={!!busy} onClick={() => run('car', 'next_car', { offer_id: replied.id })}
            className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-800 text-sky-200 text-xs font-bold disabled:opacity-50">
            <Send size={13} /> {busy === 'car' ? 'Sending…' : 'Send buyer next car'}
          </button>
        )}
        <button disabled={!!busy} onClick={() => setMode(mode === 'sold' ? null : 'sold')}
          className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-bold">
          <DollarSign size={14} /> Sold
        </button>
        <button disabled={!!busy} onClick={() => setMode(mode === 'stop' ? null : 'stop')}
          className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-bold">
          <Square size={12} /> Stop
        </button>
      </div>
      {mode === 'sold' && (
        <SoldForm car={car} defaultOfferId={replied?.id}
          onCancel={() => setMode(null)}
          onDone={(msg) => { setMode(null); onAction(null, null, msg) }} />
      )}
      {mode === 'stop' && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-700 p-2">
          <p className="flex-1 text-xs text-slate-300">Stop texting buyers about this car?</p>
          <button onClick={() => setMode(null)} className="px-3 py-1.5 rounded bg-slate-800 text-xs text-slate-300">No</button>
          <button onClick={() => { setMode(null); run('stop', 'stop', { car_id: car.id }) }}
            className="px-3 py-1.5 rounded bg-red-500/80 text-xs font-bold text-white">Stop</button>
        </div>
      )}
    </>
  )
}

function NeedsYouCard({ car, onAction }) {
  const replied = car.replied[car.replied.length - 1] || null
  return (
    <div className="card border border-emerald-500/40 mb-3">
      <CarHead car={car} right={<Chip status="replied">Replied</Chip>} />
      {car.replied.map((o) => (
        <div key={o.id} className="mt-3">
          <p className="text-xs text-slate-300">
            <span className="font-bold text-white">{o.buyer_name}</span> · {prettyPhone(o.phone)}
            <span className="text-slate-500"> · replied {timeLabel(o.replied_at)}{o.rank ? ` · match #${o.rank}` : ''}</span>
          </p>
          <Thread messages={car.threadFor(o.phone)} />
          {!car.threadFor(o.phone).length && o.reply_body && (
            <p className="mt-1 text-xs text-emerald-200 bg-emerald-500/10 rounded-lg px-2 py-1 whitespace-pre-wrap">{o.reply_body}</p>
          )}
        </div>
      ))}
      <Actions car={car} replied={replied} onAction={onAction} allowNext />
      <Lineup car={car} />
    </div>
  )
}

function ActiveCard({ car, now, onAction }) {
  return (
    <div className="card mb-3">
      <CarHead car={car} right={<Chip status={car.open.length ? 'sent' : 'expired'}>{CAR_LABEL[car.status]}</Chip>} />
      {car.open.map((o) => (
        <p key={o.id} className="mt-2 text-xs text-slate-300 flex items-center gap-1.5">
          <Clock size={12} className="text-sky-400" />
          <span className="font-semibold text-white truncate">{o.buyer_name}</span>
          <span className="text-slate-500 shrink-0">
            {o.status === 'sending' ? 'sending…' : deadlineLabel(o.expires_at, now)}
            {o.manual ? ' · by hand' : o.rank ? ` · match #${o.rank}` : ''}
          </span>
        </p>
      ))}
      {car.status_note && (
        <p className="mt-2 text-[11px] text-amber-300/90 flex items-start gap-1">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {car.status_note}
        </p>
      )}
      <Actions car={car} onAction={onAction} />
      <Lineup car={car} />
    </div>
  )
}

function DoneCard({ car, onRequeue }) {
  const sold = car.offers.find((o) => o.status === 'sold')
  return (
    <div className="card mb-2 py-2.5">
      <CarHead car={car} right={<Chip status={car.status === 'sold' ? 'sold' : 'expired'}>{CAR_LABEL[car.status]}</Chip>} />
      <p className="mt-1 text-[11px] text-slate-500">
        {sold ? `${sold.buyer_name}` : car.status_note || ''}
        {' · '}{car.counted} texted · {timeLabel(car.closed_at || car.updated_at)}
      </p>
      {car.status === 'exhausted' && onRequeue && (
        <button onClick={() => onRequeue(car.vin)} className="mt-1.5 text-[11px] font-bold text-sky-400">
          Queue again (skips buyers already texted)
        </button>
      )}
    </div>
  )
}

function AddSheet({ available, onClose, onAdded }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return available
    return available.filter((c) => [carName(c), c.vin, c.stock_number, c.top_buyer].join(' ').toLowerCase().includes(s))
  }, [available, q])
  const first = available.find((c) => picked.has(c.vin))
  const preview = first ? buildOutreachMessage(first) : null

  function toggle(vin) {
    const next = new Set(picked)
    if (next.has(vin)) next.delete(vin); else next.add(vin)
    setPicked(next)
  }

  async function add() {
    setBusy(true); setErr('')
    try {
      const out = await outreachCall('add', { vins: [...picked] })
      onAdded(out)
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950/95 flex flex-col safe-inset">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-white">Add cars to outreach</h2>
          <p className="text-[11px] text-slate-400">Live on SmartAuction · {available.length} available</p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg bg-slate-800 text-slate-300"><X size={18} /></button>
      </div>
      <div className="px-4 pt-3">
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3">
          <Search size={14} className="text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Year, make, model, VIN, buyer"
            className="flex-1 bg-transparent py-2 text-sm text-white outline-none" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
        {shown.map((c) => {
          const on = picked.has(c.vin)
          return (
            <button key={c.vin} onClick={() => toggle(c.vin)}
              className={`w-full text-left rounded-lg border px-3 py-2 flex items-center gap-3 ${on ? 'border-sky-500/60 bg-sky-500/10' : 'border-slate-800 bg-slate-900'}`}>
              <span className={`w-5 h-5 shrink-0 rounded border flex items-center justify-center ${on ? 'bg-sky-500 border-sky-500' : 'border-slate-600'}`}>
                {on && <Check size={13} className="text-slate-900" />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-white truncate">{carName(c)}</span>
                <span className="block text-[11px] text-slate-400 truncate">
                  {money(c.price)}{c.mileage ? ` · ${Number(c.mileage).toLocaleString()} mi` : ''} · …{c.vin.slice(-6)}
                  {c.top_buyer ? ` · best: ${c.top_buyer}` : ' · no textable match yet'}
                  {c.already_offered ? ` · ${c.already_offered} already texted` : ''}
                </span>
              </span>
            </button>
          )
        })}
        {!shown.length && <p className="text-sm text-slate-500 text-center py-6">No cars match.</p>}
      </div>
      {preview && (
        <div className="px-4 pb-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
            First text · {segmentCount(preview)} SMS segments
          </p>
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-slate-300 bg-slate-900 border border-slate-800 rounded-lg p-2">{preview}</pre>
        </div>
      )}
      <div className="px-4 py-3 border-t border-slate-800">
        {err && <p className="text-xs text-red-300 mb-2">{err}</p>}
        <button disabled={!picked.size || busy} onClick={add}
          className="w-full py-3 rounded-lg bg-sky-500 text-slate-900 font-bold text-sm disabled:opacity-40">
          {busy ? 'Matching buyers…' : `Add ${picked.size || ''} ${picked.size === 1 ? 'car' : 'cars'} to the queue`}
        </button>
        <p className="mt-1.5 text-[11px] text-slate-500 text-center">
          Up to 5 buyers each, 30 min to reply, Mon-Sat {HOURS.open / 60}am-{HOURS.close / 60 - 12}pm
        </p>
      </div>
    </div>
  )
}

export default function Outreach() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const admin = profile?.role === 'admin' || isPrimaryAdmin(profile?.phone)

  const [board, setBoard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      setBoard(await outreachCall('board'))
      setErr('')
    } catch (e) {
      setErr(e.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!admin) { navigate('/'); return }
    // The first load is kicked off from a timer, not called inline, so the
    // effect itself never sets state synchronously.
    const first = setTimeout(load, 0)
    // Replies land by webhook; poll so a paused car shows up without a refresh.
    const poll = setInterval(load, 20000)
    const clock = setInterval(() => setNow(Date.now()), 15000)
    return () => { clearTimeout(first); clearInterval(poll); clearInterval(clock) }
  }, [admin, navigate, load])

  const { needsYou, active, done } = useMemo(() => shapeBoard(board), [board])

  async function onAction(action, payload, message) {
    if (message) { setNote(message); await load(); return }
    setErr(''); setNote('')
    try {
      const out = await outreachCall(action, payload)
      if (action === 'next_car') setNote(`Texted ${out.buyer} the ${carName(out.car)}.`)
      if (action === 'next_buyer') {
        const sent = out.tick?.sent?.find((s) => s.sent)
        setNote(sent ? `Texted ${sent.buyer}.` : 'Moved on. The next buyer will be texted as soon as one is eligible.')
      }
      if (action === 'stop') setNote('Stopped.')
    } catch (e) {
      setErr(e.message)
    }
    await load()
  }

  async function requeue(vin) {
    setErr(''); setNote('')
    try {
      const out = await outreachCall('add', { vins: [vin] })
      setNote(out.refused?.length ? out.refused.map((r) => r.reason).join('; ') : 'Queued again.')
    } catch (e) {
      setErr(e.message)
    }
    await load()
  }

  if (!admin) return null

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => navigate('/admin')} className="p-2 rounded-lg bg-slate-800"><ArrowLeft size={20} /></button>
        <div className="flex-1 min-w-0">
          <h1 className="page-title mb-0">Buyer Outreach</h1>
          <p className="text-[11px] text-slate-400">
            {board ? (
              <>
                <span className={board.business_open ? 'text-emerald-400' : 'text-amber-300'}>
                  {board.business_open ? 'Sending now' : 'Paused until 8am (Mon-Sat)'}
                </span>
                {` · ${board.texts_24h} texts in 24h`}
                {board.opt_outs ? ` · ${board.opt_outs} opted out` : ''}
              </>
            ) : 'AI-matched buyers, one at a time'}
          </p>
        </div>
        <button onClick={load} className="p-2 rounded-lg bg-slate-800" title="Refresh">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <button onClick={() => setAdding(true)} disabled={!board}
        className="w-full mb-4 py-3 rounded-lg bg-sky-500 text-slate-900 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
        <Plus size={16} /> Add cars
      </button>

      {err && <p className="mb-3 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{err}</p>}
      {note && <p className="mb-3 text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">{note}</p>}

      {loading && !board && <p className="text-slate-400">Loading…</p>}

      {needsYou.length > 0 && (
        <section className="mb-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-emerald-400 mb-2 flex items-center gap-1.5">
            <MessageSquare size={13} /> Needs you · {needsYou.length}
          </h2>
          {needsYou.map((car) => <NeedsYouCard key={car.id} car={car} onAction={onAction} />)}
        </section>
      )}

      {board && (
        <section className="mb-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">In the queue · {active.length}</h2>
          {active.map((car) => <ActiveCard key={car.id} car={car} now={now} onAction={onAction} />)}
          {!active.length && (
            <div className="card text-center text-sm text-slate-500">
              Nothing running. Add cars and the first buyer on each gets texted right away{board.business_open ? '' : ' at 8am'}.
            </div>
          )}
        </section>
      )}

      {done.length > 0 && (
        <section>
          <button onClick={() => setShowDone(!showDone)} className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1">
            {showDone ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Finished, last 14 days · {done.length}
          </button>
          {showDone && done.map((car) => <DoneCard key={car.id} car={car} onRequeue={requeue} />)}
        </section>
      )}

      {adding && board && (
        <AddSheet available={board.available} onClose={() => setAdding(false)}
          onAdded={(out) => {
            setAdding(false)
            const sent = (out.tick?.sent || []).filter((s) => s.sent).length
            setNote([
              `${out.added.length} added`,
              sent ? `${sent} texted` : null,
              out.refused.length ? `${out.refused.length} refused: ${out.refused.map((r) => `…${r.vin.slice(-6)} ${r.reason}`).join('; ')}` : null,
            ].filter(Boolean).join(' · '))
            load()
          }} />
      )}
    </div>
  )
}
