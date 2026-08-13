import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { LogOut, Menu } from 'lucide-react'
import { supabase, selectAll } from '../services/supabase'
import { fetchSoldRecent, ymdMinusDays } from '../services/soldReports'
import { store } from '../native/storage'
import { averages } from '../services/compare'
import { useAuth } from '../context/useAuth'
import { isPrimaryAdmin } from '../services/adminSetup'
import VinSearchBar from '../components/VinSearchBar'
import ActionDrawer from '../components/ActionDrawer'
import BuySellPace from '../components/BuySellPace'

// Rolling windows for the sold side of the comparison. The longest one is what
// gets fetched — switching windows then re-slices in memory, no round trip.
const SOLD_WINDOWS = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 60, label: '60d' },
  { days: 90, label: '90d' },
]
const MAX_SOLD_DAYS = Math.max(...SOLD_WINDOWS.map((w) => w.days))
const SOLD_WINDOW_KEY = 'dashSoldWindow'

// A Frazer-Z car needs dispatch only until we know where it physically is. Once
// it's tracked at ANY real location (in transit, a shop, an auction, …) it's
// been handled. Only null / "unknown" counts as un-located. Mirrors the same
// helper in Inventory.jsx so the dashboard tile and the Needs Dispatch list agree.
function hasBeenLocated(physLoc) {
  return !!physLoc && physLoc !== 'unknown'
}

export default function Dashboard() {
  const { user, profile, signOut } = useAuth()
  const [stats, setStats] = useState({
    carCount: null,
    avgDaysOnLot: null,
    avgAddedCosts: null,
    avgCost: null,
    stuckCount: null,
    missingCount: null,
    needsDispatchCount: null,
    inspectingCount: null,
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const [soldRows, setSoldRows] = useState(null) // null = still loading
  const [soldDays, setSoldDays] = useState(30)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [lotRes, costRes, locs, inspRes] = await Promise.all([
        supabase.from('vehicle_lot_status').select('stock_number, last_seen_at, days_on_lot'),
        supabase.from('inventory').select('stock_number, total_cost, added_costs, location_code, days_on_lot'),
        selectAll(() => supabase.from('vehicle_locations').select('stock_number, physical_location, location_updated_at')),
        supabase.from('inspections').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
      ])
      if (cancelled) return

      const lotRows = lotRes.data || []
      const costs = costRes.data || []
      const now = Date.now()

      const locMap = new Map(locs.map((l) => [l.stock_number, l]))
      const costMap = new Map(costs.map((c) => [c.stock_number, c]))

      let stuck = 0
      let missing = 0
      let needsDispatch = 0
      for (const r of lotRows) {
        const scanMs = r.last_seen_at ? new Date(r.last_seen_at).getTime() : 0
        const loc = locMap.get(r.stock_number) || {}
        const locMs = loc.location_updated_at ? new Date(loc.location_updated_at).getTime() : 0
        let bestMs = Math.max(scanMs, locMs)
        let days = bestMs ? Math.floor((now - bestMs) / 86400000) : null
        if (!bestMs) {
          const cost = costMap.get(r.stock_number) || {}
          if (cost.location_code === 'Z') {
            const dol = parseInt(r.days_on_lot, 10)
            if (Number.isFinite(dol) && dol >= 0) days = dol
          }
        }
        if (days == null) missing += 1
        else if (days >= 21) stuck += 1
        const cost = costMap.get(r.stock_number) || {}
        if (cost.location_code === 'Z' && !hasBeenLocated(loc.physical_location)) needsDispatch += 1
      }

      const inv = averages(costs, (c) => ({
        added: c.added_costs,
        days: c.days_on_lot,
        cost: c.total_cost,
      }))

      setStats({
        carCount: lotRows.length,
        avgDaysOnLot: inv.avgDays,
        avgAddedCosts: inv.avgAdded,
        avgCost: inv.avgCost,
        stuckCount: stuck,
        missingCount: missing,
        needsDispatchCount: needsDispatch,
        inspectingCount: inspRes.count ?? 0,
      })
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Sold side of the comparison. Pulled once at the widest window; the picker
  // just re-slices what's already here.
  useEffect(() => {
    let cancelled = false
    store.get(SOLD_WINDOW_KEY).then((saved) => {
      const days = parseInt(saved, 10)
      if (!cancelled && SOLD_WINDOWS.some((w) => w.days === days)) setSoldDays(days)
    })
    fetchSoldRecent(MAX_SOLD_DAYS)
      .then((rows) => { if (!cancelled) setSoldRows(rows) })
      .catch(() => { if (!cancelled) setSoldRows([]) })
    return () => { cancelled = true }
  }, [])

  function pickSoldDays(days) {
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

  const fmtMoney = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`)

  return (
    <div className="page pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setMenuOpen(true)}
          className="p-2 -ml-2 mr-1 rounded-lg bg-slate-800 text-slate-300"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-emerald-400">CARZ INC</h1>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Inventory Management System</p>
          <p className="text-xs text-slate-400 mt-0.5">{profile?.name || user?.phone || 'Hi'}</p>
        </div>
        <button onClick={signOut} className="p-2 rounded-lg bg-slate-800 text-slate-400" title="Sign out">
          <LogOut size={20} />
        </button>
      </div>

      <ActionDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />

      {/* Global VIN / stock search — opens a quick-info popup */}
      <VinSearchBar />

      {/* The two halves of "how is the lot doing": what a car costs us against
          what a sold one cost, and how fast cars come in against how fast they
          go out. Side by side on a desktop, stacked on a phone. */}
      <div className="grid gap-4 mb-4 lg:grid-cols-2 lg:items-start">
        {/* Inventory vs Sold — what we're holding against what's actually been
            moving. Recon spend and age above the sold line means the lot is
            getting heavier than what it's selling: going backward. */}
        <div className="rounded-xl bg-slate-800 border border-slate-700 p-3">
          <div className="flex items-center justify-between mb-2">
            <Link to="/sold-reports" className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Inventory vs Sold ›
            </Link>
            <div className="flex items-center gap-1">
              {SOLD_WINDOWS.map((w) => (
                <button
                  key={w.days}
                  onClick={() => pickSoldDays(w.days)}
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

            <RowLabel>
              In stock <b className="text-white">{stats.carCount ?? '—'}</b>
            </RowLabel>
            <Cell>{fmtMoney(stats.avgAddedCosts)}</Cell>
            <Cell>{stats.avgDaysOnLot != null ? `${stats.avgDaysOnLot}d` : '—'}</Cell>
            <Cell>{fmtMoney(stats.avgCost)}</Cell>

            <RowLabel>
              Sold {soldDays}d <b className="text-white">{sold ? sold.count : '—'}</b>
            </RowLabel>
            <Cell>{fmtMoney(sold?.avgAdded)}</Cell>
            <Cell>{sold?.avgDays != null ? `${sold.avgDays}d` : '—'}</Cell>
            <Cell>{fmtMoney(sold?.avgCost)}</Cell>

            <RowLabel>Difference</RowLabel>
            <Delta now={stats.avgAddedCosts} was={sold?.avgAdded} money />
            <Delta now={stats.avgDaysOnLot} was={sold?.avgDays} suffix="d" />
            <Delta now={stats.avgCost} was={sold?.avgCost} money neutral />
          </div>
        </div>

        <BuySellPace />
      </div>

      {/* Alerts — two counts, side by side and cut to the bone. They're a
          glance on the way to somewhere else, not something to read; the page
          they open explains itself. A lone alert takes the full width rather
          than sitting next to a gap. */}
      {(stats.stuckCount > 0 || stats.needsDispatchCount > 0) && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          {stats.stuckCount > 0 && (
            <AlertTile
              to="/inventory?filter=stuck21"
              emoji="🔴"
              count={stats.stuckCount}
              label="Stuck 21d+"
              className="bg-red-500/15 border-red-500/40 text-red-400"
              alone={!(stats.needsDispatchCount > 0)}
            />
          )}
          {stats.needsDispatchCount > 0 && (
            <AlertTile
              to="/inventory?filter=needs_dispatch"
              emoji="🚛"
              count={stats.needsDispatchCount}
              label="Need dispatch"
              className="bg-orange-500/15 border-orange-500/40 text-orange-400"
              alone={!(stats.stuckCount > 0)}
            />
          )}
        </div>
      )}

      {(profile?.role === 'admin' || isPrimaryAdmin(profile?.phone)) && (
        <Link 
          to="/admin" 
          className="block mt-4 mx-4 px-4 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg font-semibold text-center shadow-lg hover:shadow-xl transition-shadow"
        >
          <div className="flex items-center justify-center gap-2">
            <span>🛡️</span>
            <span>Admin Panel</span>
          </div>
        </Link>
      )}
    </div>
  )
}

function AlertTile({ to, emoji, count, label, className, alone }) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-2 p-3 rounded-xl border ${className} ${alone ? 'col-span-2' : ''}`}
    >
      <span className="text-xl leading-none">{emoji}</span>
      <span className="text-lg font-bold leading-none">{count}</span>
      <span className="text-[11px] font-semibold opacity-80 leading-tight">{label}</span>
      <span className="ml-auto text-lg leading-none opacity-70">›</span>
    </Link>
  )
}

function Head({ children }) {
  return (
    <span className="text-[9px] uppercase tracking-wide text-slate-500 text-right">{children}</span>
  )
}

function RowLabel({ children }) {
  return <span className="text-[11px] text-slate-400 truncate">{children}</span>
}

function Cell({ children }) {
  return <span className="text-xs font-semibold text-slate-200 text-right tabular-nums">{children}</span>
}

// What we're holding minus what we've been selling. On recon spend and age,
// carrying MORE than we sell is the warning — that's the lot getting heavier.
// Cost per car has no good or bad direction, so `neutral` leaves it uncoloured.
function Delta({ now, was, money, suffix = '', neutral }) {
  if (now == null || was == null) {
    return <span className="text-xs text-slate-600 text-right">—</span>
  }
  const d = Math.round(now - was)
  const sign = d > 0 ? '+' : d < 0 ? '−' : ''
  const body = money
    ? `$${Math.abs(d).toLocaleString()}`
    : `${Math.abs(d)}${suffix}`
  const color = neutral || d === 0
    ? 'text-slate-400'
    : d > 0
    ? 'text-red-400'
    : 'text-emerald-400'
  const arrow = neutral || d === 0 ? '' : d > 0 ? ' ▲' : ' ▼'
  return (
    <span className={`text-xs font-bold text-right tabular-nums ${color}`}>
      {sign}{body}{arrow}
    </span>
  )
}

function ActionTile({ to, href, onClick, emoji, label, primary }) {
  const className = `aspect-square rounded-xl p-3 flex flex-col items-center justify-center gap-1 text-center ${
    primary
      ? 'bg-emerald-500 text-slate-900 active:bg-emerald-600'
      : 'bg-slate-800 text-white border border-slate-700 active:bg-slate-700'
  }`
  const content = (
    <>
      <span className="text-3xl">{emoji}</span>
      <span className="text-xs font-bold leading-tight">{label}</span>
    </>
  )
  if (onClick) {
    return <button onClick={onClick} className={className}>{content}</button>
  }
  if (href) {
    return <a href={href} className={className} target="_blank" rel="noopener noreferrer">{content}</a>
  }
  return <Link to={to} className={className}>{content}</Link>
}
