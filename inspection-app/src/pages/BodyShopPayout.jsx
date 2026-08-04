// Saturday collection — what the body shop manager is owed.
//
// He's paid the AGREED charge minus what the parts cost. Unpaid work rolls over,
// so a car finished three weeks ago that nobody collected on still shows here.
//
// Two people, two jobs: an owner agrees the charge amount (on the car itself),
// and accounting ticks each car off here before the money goes out. Both checks
// are enforced in the database — the buttons below only reflect them.

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Check, RefreshCw, AlertTriangle } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import {
  fetchPayoutSummary, fetchPayoutLines, fetchPayoutHistory,
  confirmForPayment, collectPayout, isAccounting, vehicleLabel,
  CHARGE_STATUS_LABELS, CHARGE_STATUS_STYLES,
} from '../services/bodyShop'

const money = (n) => (n == null ? '—' : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
const day = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—')

export default function BodyShopPayout() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const accounting = isAccounting(profile)

  const [summary, setSummary] = useState(null)
  const [lines, setLines] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const [s, l, h] = await Promise.all([
        fetchPayoutSummary(), fetchPayoutLines(), fetchPayoutHistory(),
      ])
      setSummary(s); setLines(l); setHistory(h)
    } catch (e) {
      setError(e.message || 'Could not load the payout')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function toggleConfirm(line) {
    setError('')
    const next = !line.approved_at
    setLines((ls) => ls.map((l) => (l.id === line.id
      ? { ...l, approved_at: next ? new Date().toISOString() : null } : l)))
    try {
      await confirmForPayment(line.id, next)
      setSummary(await fetchPayoutSummary())
    } catch (e) {
      setLines((ls) => ls.map((l) => (l.id === line.id ? line : l)))
      setError(e.message || 'Could not confirm')
    }
  }

  async function collect() {
    if (!window.confirm(
      `Record a payout of ${money(summary?.amount_approved)} for ${summary?.jobs_approved} car(s)?\n\n`
      + 'This closes those cars out. Only confirmed cars are included.')) return
    setBusy(true); setError('')
    try {
      await collectPayout(null)
      await load()
    } catch (e) {
      setError(e.message || 'Could not record the payout')
    } finally {
      setBusy(false)
    }
  }

  const weekLines = lines.filter((l) => l.week_ending === summary?.week_ending)
  const rollover = lines.filter((l) => l.week_ending !== summary?.week_ending)

  return (
    <div className="page">
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => navigate('/body-shop')}
          className="flex items-center gap-1 text-slate-300 text-sm active:text-white -ml-1">
          <ChevronLeft size={18} /> Body Shop
        </button>
        <button onClick={() => { setLoading(true); load() }}
          className="p-2 rounded-lg bg-slate-800 border border-slate-700" aria-label="Refresh">
          <RefreshCw size={16} className={loading ? 'animate-spin text-slate-500' : 'text-slate-300'} />
        </button>
      </div>

      <h1 className="page-title mb-0">💵 Saturday Payout</h1>
      <p className="text-[11px] text-slate-500 mb-4">
        Week ending {summary?.week_ending ? day(summary.week_ending) : '—'} · agreed charge minus parts
      </p>

      {error && <div className="card border-red-500/40 bg-red-500/10 text-red-300 text-sm mb-3">{error}</div>}

      {/* The number he's collecting */}
      <div className="card mb-3 text-center">
        <div className="text-[11px] uppercase tracking-wide text-slate-400">Confirmed & ready to pay</div>
        <div className="text-4xl font-bold text-emerald-400 mt-1">{money(summary?.amount_approved)}</div>
        <div className="text-[11px] text-slate-400 mt-1">
          {summary?.jobs_approved || 0} of {summary?.jobs_due || 0} cars confirmed
        </div>
        {accounting && (summary?.jobs_approved || 0) > 0 && (
          <button onClick={collect} disabled={busy} className="btn-primary mt-3">
            {busy ? 'Recording…' : `Record Payout · ${money(summary?.amount_approved)}`}
          </button>
        )}
        {!accounting && (
          <p className="text-[11px] text-slate-500 mt-2">Accounting confirms and records the payout.</p>
        )}
      </div>

      {/* Week-to-date tally */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Tile label="This week" value={money(summary?.amount_this_week)} sub={`${summary?.jobs_this_week || 0} cars`} />
        <Tile label="Rolled over" value={money(summary?.amount_rollover)} sub={`${summary?.jobs_rollover || 0} cars`}
          tone={summary?.jobs_rollover ? 'text-orange-400' : undefined} />
        <Tile label="Total due" value={money(summary?.amount_due)} sub={`${summary?.jobs_due || 0} cars`} />
      </div>

      {(summary?.jobs_unpriced || 0) > 0 && (
        <div className="mb-3 p-2.5 rounded-xl bg-yellow-500/10 border border-yellow-500/40 text-[11px] text-yellow-300 flex gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            {summary.jobs_unpriced} finished {summary.jobs_unpriced === 1 ? 'car has' : 'cars have'} no
            agreed charge yet, so {summary.jobs_unpriced === 1 ? 'it is' : 'they are'} not in the total.
            Agree the charge on the car first.
          </span>
        </div>
      )}

      {loading ? (
        <p className="text-center text-slate-500 py-8 text-sm">Loading…</p>
      ) : lines.length === 0 ? (
        <div className="card text-center py-10">
          <div className="text-4xl mb-2">✅</div>
          <p className="text-slate-400 text-sm">Nothing outstanding — everything finished has been paid.</p>
        </div>
      ) : (
        <>
          {rollover.length > 0 && (
            <Group title={`Rolled over from earlier weeks · ${rollover.length}`} tone="text-orange-400">
              {rollover.map((l) => (
                <Line key={l.id} line={l} accounting={accounting} onToggle={toggleConfirm}
                  onOpen={() => navigate(`/body-shop/${l.id}`)} />
              ))}
            </Group>
          )}
          <Group title={`Finished this week · ${weekLines.length}`}>
            {weekLines.length === 0
              ? <p className="text-[11px] text-slate-500 px-1 py-2">Nothing finished yet this week.</p>
              : weekLines.map((l) => (
                <Line key={l.id} line={l} accounting={accounting} onToggle={toggleConfirm}
                  onOpen={() => navigate(`/body-shop/${l.id}`)} />
              ))}
          </Group>
        </>
      )}

      {history.length > 0 && (
        <Group title="Past payouts">
          {history.map((p) => (
            <div key={p.id} className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
              <div>
                <div className="text-sm font-semibold">Week ending {day(p.week_ending)}</div>
                <div className="text-[11px] text-slate-500">
                  {p.job_count} {p.job_count === 1 ? 'car' : 'cars'} · paid {day(p.paid_at)}
                </div>
              </div>
              <div className="text-emerald-400 font-bold">{money(p.total)}</div>
            </div>
          ))}
        </Group>
      )}
    </div>
  )
}

function Tile({ label, value, sub, tone }) {
  return (
    <div className="rounded-xl p-2.5 bg-slate-800 text-center">
      <div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${tone || 'text-white'}`}>{value}</div>
      <div className="text-[10px] text-slate-500">{sub}</div>
    </div>
  )
}

function Group({ title, tone, children }) {
  return (
    <div className="mb-3">
      <p className={`text-[11px] uppercase tracking-wide mb-1.5 ${tone || 'text-slate-500'}`}>{title}</p>
      <div className="card">{children}</div>
    </div>
  )
}

function Line({ line, accounting, onToggle, onOpen }) {
  const confirmed = !!line.approved_at
  const payable = line.payout != null

  return (
    <div className="flex items-start gap-2 py-2 border-b border-slate-800 last:border-0">
      {/* Accounting's tick. Disabled when there's no agreed charge to pay. */}
      <button
        onClick={() => accounting && payable && onToggle(line)}
        disabled={!accounting || !payable}
        className={`shrink-0 w-6 h-6 rounded-md border flex items-center justify-center mt-0.5 ${
          confirmed ? 'bg-emerald-500 border-emerald-400 text-slate-900'
          : payable ? 'border-slate-600 text-transparent'
          : 'border-slate-700 text-transparent opacity-40'
        }`}
        aria-label={confirmed ? 'Confirmed' : 'Confirm for payment'}>
        <Check size={14} />
      </button>

      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="text-sm font-semibold truncate">{vehicleLabel(line)}</div>
        <div className="text-[11px] text-slate-400 truncate">
          {line.stock_number ? `#${line.stock_number}` : `VIN …${line.vin6}`} · done {day(line.completed_at)}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          {money(line.agreed_amount ?? line.price)} charge − {money(line.parts_cost)} parts
        </div>
        {line.charge_status !== 'agreed' && (
          <span className={`inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold ${CHARGE_STATUS_STYLES[line.charge_status]}`}>
            {CHARGE_STATUS_LABELS[line.charge_status]}
          </span>
        )}
      </button>

      <div className={`shrink-0 text-right font-bold ${payable ? 'text-emerald-400' : 'text-slate-600'}`}>
        {payable ? money(line.payout) : '—'}
      </div>
    </div>
  )
}
