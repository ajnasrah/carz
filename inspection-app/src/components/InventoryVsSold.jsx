import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../services/supabase'
import { fetchSoldRecent, ymdMinusDays } from '../services/soldReports'
import { averages } from '../services/compare'
import { store } from '../native/storage'

// What we're holding, against what's actually been moving. Recon spend and age
// above the sold line mean the lot is getting heavier than what it sells —
// going backward. Cost per car is left uncoloured: there's no honest good or
// bad direction to it.
//
// Self-contained (fetches its own two sides) so it can sit on the dashboard and
// inside Sold Reports without either page having to feed it.
const SOLD_WINDOWS = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 60, label: '60d' },
  { days: 90, label: '90d' },
]
const MAX_SOLD_DAYS = Math.max(...SOLD_WINDOWS.map((w) => w.days))
const SOLD_WINDOW_KEY = 'dashSoldWindow'

const fmtMoney = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`)

export default function InventoryVsSold({ title = 'Inventory vs Sold' }) {
  const [inv, setInv] = useState(null)
  const [soldRows, setSoldRows] = useState(null)
  const [soldDays, setSoldDays] = useState(30)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('inventory')
      .select('stock_number, total_cost, added_costs, days_on_lot')
      .then(({ data }) => {
        if (cancelled) return
        setInv(averages(data || [], (c) => ({
          added: c.added_costs,
          days: c.days_on_lot,
          cost: c.total_cost,
        })))
      })
    store.get(SOLD_WINDOW_KEY).then((saved) => {
      const days = parseInt(saved, 10)
      if (!cancelled && SOLD_WINDOWS.some((w) => w.days === days)) setSoldDays(days)
    })
    // Widest window once; the picker re-slices it in memory.
    fetchSoldRecent(MAX_SOLD_DAYS)
      .then((rows) => { if (!cancelled) setSoldRows(rows) })
      .catch(() => { if (!cancelled) setSoldRows([]) })
    return () => { cancelled = true }
  }, [])

  function pick(days) {
    setSoldDays(days)
    store.set(SOLD_WINDOW_KEY, String(days))
  }

  const sold = useMemo(() => {
    if (!soldRows) return null
    // Same local-date cutoff the fetch used — toISOString() would shift the
    // boundary by a day west of UTC.
    const key = ymdMinusDays(soldDays)
    const inWindow = soldRows.filter((r) => (r.sale_date || '').slice(0, 10) >= key)
    return averages(inWindow, (r) => ({
      added: r.added_costs,
      days: r.days_on_lot,
      cost: r.total_cost,
    }))
  }, [soldRows, soldDays])

  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{title}</span>
        <div className="flex items-center gap-1">
          {SOLD_WINDOWS.map((w) => (
            <button
              key={w.days}
              onClick={() => pick(w.days)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                soldDays === w.days ? 'bg-emerald-500 text-slate-900' : 'bg-slate-700 text-slate-300'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 items-baseline">
        <span />
        <Head>Avg Add</Head>
        <Head>Avg Age</Head>
        <Head>Avg Cost</Head>

        <RowLabel>In stock <b className="text-white">{inv?.count ?? '—'}</b></RowLabel>
        <Cell>{fmtMoney(inv?.avgAdded)}</Cell>
        <Cell>{inv?.avgDays != null ? `${inv.avgDays}d` : '—'}</Cell>
        <Cell>{fmtMoney(inv?.avgCost)}</Cell>

        <RowLabel>Sold {soldDays}d <b className="text-white">{sold ? sold.count : '—'}</b></RowLabel>
        <Cell>{fmtMoney(sold?.avgAdded)}</Cell>
        <Cell>{sold?.avgDays != null ? `${sold.avgDays}d` : '—'}</Cell>
        <Cell>{fmtMoney(sold?.avgCost)}</Cell>

        <RowLabel>Difference</RowLabel>
        <Delta now={inv?.avgAdded} was={sold?.avgAdded} money />
        <Delta now={inv?.avgDays} was={sold?.avgDays} suffix="d" />
        <Delta now={inv?.avgCost} was={sold?.avgCost} money neutral />
      </div>
    </div>
  )
}

function Head({ children }) {
  return <span className="text-[9px] uppercase tracking-wide text-slate-500 text-right">{children}</span>
}
function RowLabel({ children }) {
  return <span className="text-[11px] text-slate-400 truncate">{children}</span>
}
function Cell({ children }) {
  return <span className="text-xs font-semibold text-slate-200 text-right tabular-nums">{children}</span>
}

// Carrying MORE recon spend or MORE age than we sell is the warning. Cost per
// car has no direction, so `neutral` leaves it grey.
function Delta({ now, was, money, suffix = '', neutral }) {
  if (now == null || was == null) return <span className="text-xs text-slate-600 text-right">—</span>
  const d = Math.round(now - was)
  const sign = d > 0 ? '+' : d < 0 ? '−' : ''
  const body = money ? `$${Math.abs(d).toLocaleString()}` : `${Math.abs(d)}${suffix}`
  const color = neutral || d === 0 ? 'text-slate-400' : d > 0 ? 'text-red-400' : 'text-emerald-400'
  const arrow = neutral || d === 0 ? '' : d > 0 ? ' ▲' : ' ▼'
  return (
    <span className={`text-xs font-bold text-right tabular-nums ${color}`}>
      {sign}{body}{arrow}
    </span>
  )
}
