import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/useAuth'

export default function Dashboard() {
  const { user, profile, signOut } = useAuth()
  const [stats, setStats] = useState({
    carCount: null,
    avgDaysOnLot: null,
    avgAddedCosts: null,
    stuckCount: null,
    missingCount: null,
    needsDispatchCount: null,
    inspectingCount: null,
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [lotRes, costRes, locRes, inspRes] = await Promise.all([
        supabase.from('vehicle_lot_status').select('stock_number, last_seen_at, days_on_lot'),
        supabase.from('inventory').select('stock_number, total_cost, added_costs, location_code, days_on_lot'),
        supabase.from('vehicle_locations').select('stock_number, physical_location, location_updated_at'),
        supabase.from('inspections').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
      ])
      if (cancelled) return

      const lotRows = lotRes.data || []
      const costs = costRes.data || []
      const locs = locRes.data || []
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
        if (cost.location_code === 'Z' && loc.physical_location !== 'in_transit') needsDispatch += 1
      }

      const num = (v) => Number(String(v || 0).replace(/[^0-9.-]/g, '')) || 0
      let addedSum = 0, addedN = 0
      for (const c of costs) {
        const v = num(c.added_costs)
        if (v > 0) { addedSum += v; addedN += 1 }
      }
      let dolSum = 0, dolN = 0
      for (const c of costs) {
        const v = num(c.days_on_lot)
        if (v >= 0 && c.days_on_lot != null && c.days_on_lot !== '') { dolSum += v; dolN += 1 }
      }

      setStats({
        carCount: lotRows.length,
        avgDaysOnLot: dolN ? Math.round(dolSum / dolN) : null,
        avgAddedCosts: addedN ? Math.round(addedSum / addedN) : null,
        stuckCount: stuck,
        missingCount: missing,
        needsDispatchCount: needsDispatch,
        inspectingCount: inspRes.count ?? 0,
      })
    }
    load()
    return () => { cancelled = true }
  }, [])

  const fmtMoney = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`)

  return (
    <div className="page pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-emerald-400">CARZ INC</h1>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Inventory Management System</p>
          <p className="text-xs text-slate-400 mt-0.5">{profile?.name || user?.phone || 'Hi'}</p>
        </div>
        <button onClick={signOut} className="p-2 rounded-lg bg-slate-800 text-slate-400" title="Sign out">
          <LogOut size={20} />
        </button>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="rounded-xl p-3 bg-slate-800 text-center">
          <div className="text-xl">🚗</div>
          <div className="text-2xl font-bold text-white mt-1">{stats.carCount ?? '—'}</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 mt-0.5">Cars</div>
        </div>
        <div className="rounded-xl p-3 bg-slate-800 text-center">
          <div className="text-xl">📅</div>
          <div className="text-2xl font-bold text-white mt-1">{stats.avgDaysOnLot ?? '—'}{stats.avgDaysOnLot != null && 'd'}</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 mt-0.5">Avg Age</div>
        </div>
        <div className="rounded-xl p-3 bg-slate-800 text-center">
          <div className="text-xl">🔧</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">{stats.avgAddedCosts != null ? fmtMoney(stats.avgAddedCosts) : '—'}</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 mt-0.5">Avg Add</div>
        </div>
      </div>

      {/* Alerts */}
      <div className="space-y-2 mb-4">
        {stats.stuckCount > 0 && (
          <Link
            to="/inventory?filter=stuck21"
            className="flex items-center justify-between p-3 rounded-xl bg-red-500/15 border border-red-500/40"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔴</span>
              <div>
                <div className="text-sm font-bold text-red-400">{stats.stuckCount} cars</div>
                <div className="text-[11px] text-red-300/80">Over 21 days — location not updated</div>
              </div>
            </div>
            <span className="text-red-400 text-xl">›</span>
          </Link>
        )}
        {stats.needsDispatchCount > 0 && (
          <Link
            to="/inventory?filter=needs_dispatch"
            className="flex items-center justify-between p-3 rounded-xl bg-orange-500/15 border border-orange-500/40"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🚛</span>
              <div>
                <div className="text-sm font-bold text-orange-400">{stats.needsDispatchCount} cars need dispatch</div>
                <div className="text-[11px] text-orange-300/80">Frazer code Z — not on an active Super Dispatch</div>
              </div>
            </div>
            <span className="text-orange-400 text-xl">›</span>
          </Link>
        )}
      </div>

      {/* Action grid — big buttons */}
      <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">What do you want to do?</p>
      <div className="grid grid-cols-3 gap-2">
        <ActionTile to="/lot" emoji="🚶" label="Walk Lot" />
        <ActionTile to="/vin-check" emoji="🔍" label="Check VIN" />
        <ActionTile to="/inspections" emoji="📝" label={`Inspect${stats.inspectingCount ? ` (${stats.inspectingCount})` : ''}`} primary />
        <ActionTile to="/inbound" emoji="📥" label="Inbound" />
        <ActionTile to="/inventory" emoji="🚗" label="Cars" />
        <ActionTile to="/sold-reports" emoji="💰" label="Sold" />
        <ActionTile to="/lookup" emoji="📊" label="MMR/BB" />
        <ActionTile to="/marketplace" emoji="🏪" label="Marketplace" />
        <ActionTile to="/analytics" emoji="📈" label="Analytics" />
        <ActionTile to="/front-lot-aging" emoji="⏰" label="Lot Aging" />
        <ActionTile to="/pull-list" emoji="📋" label="Pull List" />
        <ActionTile href="/training/" emoji="🎓" label="Training" />
      </div>

      {profile?.role === 'admin' && (
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

function ActionTile({ to, href, emoji, label, primary }) {
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
  if (href) {
    return <a href={href} className={className} target="_blank" rel="noopener noreferrer">{content}</a>
  }
  return <Link to={to} className={className}>{content}</Link>
}
