import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, AlertTriangle, RefreshCw, Plus, Check, X, Clock, Shield } from 'lucide-react'
import { supabase } from '../services/supabase'
import HistoryButton from '../components/HistoryButton'

// IMPORTANT: all Tailwind classes MUST be complete static strings (no dynamic
// `bg-${color}-500` construction) — Tailwind's JIT purges classes it can't
// detect statically. Each platform gets pre-defined class strings.
const PLATFORMS = [
  {
    key: 'sa', label: 'SmartAuction',
    needsKey: 'needs_sa', pulledKey: 'pulled_sa', atKey: 'pulled_sa_at',
    unpulled: 'bg-purple-500/5 border-purple-500/30 active:bg-purple-500/20',
    hint: 'text-purple-400/70',
    badge: 'bg-purple-500/20 text-purple-400',
  },
  {
    key: 'manheim', label: 'Manheim',
    needsKey: 'needs_manheim', pulledKey: 'pulled_manheim', atKey: 'pulled_manheim_at',
    unpulled: 'bg-amber-500/5 border-amber-500/30 active:bg-amber-500/20',
    hint: 'text-amber-400/70',
    badge: 'bg-amber-500/20 text-amber-400',
  },
  {
    key: 'ove', label: 'OVE',
    needsKey: 'needs_ove', pulledKey: 'pulled_ove', atKey: 'pulled_ove_at',
    unpulled: 'bg-orange-500/5 border-orange-500/30 active:bg-orange-500/20',
    hint: 'text-orange-400/70',
    badge: 'bg-orange-500/20 text-orange-400',
  },
]

export default function PullList() {
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState([])
  const [recentSold, setRecentSold] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('needs_action')
  const [showAdd, setShowAdd] = useState(false)

  async function load() {
    setLoading(true)
    const [alertsRes, soldRes] = await Promise.all([
      supabase.from('pull_tracking').select('*').order('created_at', { ascending: false }),
      supabase.from('sold').select('stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_vin, sale_date, sales_price, first_name, last_name')
        .order('sale_date', { ascending: false }).limit(50),
    ])
    setAlerts(alertsRes.data || [])
    setRecentSold(soldRes.data || [])
    setLoading(false)
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { load() }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  const filtered = useMemo(() => {
    if (filter === 'all') return alerts
    return alerts.filter((a) => a.status === filter)
  }, [alerts, filter])

  const needsActionCount = useMemo(
    () => alerts.filter((a) => a.status === 'needs_action' || a.status === 'in_progress').length,
    [alerts],
  )

  const trackedStocks = useMemo(() => new Set(alerts.map((a) => a.stock_number)), [alerts])

  async function addToTracker(sold) {
    const desc = [sold.vehicle_year, sold.vehicle_make, sold.vehicle_model].filter(Boolean).join(' ')
    const { error } = await supabase.from('pull_tracking').insert({
      stock_number: sold.stock_number,
      vin: sold.vehicle_vin,
      vehicle_desc: desc,
      sale_date: sold.sale_date,
      sale_price: sold.sales_price,
      buyer_name: [sold.first_name, sold.last_name].filter(Boolean).join(' '),
    })
    if (error) { alert('Failed: ' + error.message); return }
    await load()
    setShowAdd(false)
  }

  async function togglePulled(alertId, platform) {
    const row = alerts.find((a) => a.id === alertId)
    if (!row) return
    const newVal = !row[platform.pulledKey]
    const update = { [platform.pulledKey]: newVal }
    if (newVal) {
      update[platform.atKey] = new Date().toISOString()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) update[`pulled_${platform.key}_by`] = user.id
    } else {
      update[platform.atKey] = null
    }

    const allPulled = PLATFORMS.every((p) =>
      !row[p.needsKey] || (p.key === platform.key ? newVal : !!row[p.pulledKey]),
    )
    const anyPulled = PLATFORMS.some((p) =>
      row[p.needsKey] && (p.key === platform.key ? newVal : !!row[p.pulledKey]),
    )
    if (allPulled) {
      update.status = 'resolved'
      update.resolved_at = new Date().toISOString()
    } else if (anyPulled) {
      update.status = 'in_progress'
      update.resolved_at = null
    } else {
      update.status = 'needs_action'
      update.resolved_at = null
    }

    const { error } = await supabase.from('pull_tracking').update(update).eq('id', alertId)
    if (error) { alert('Failed to update: ' + error.message); return }
    setAlerts((prev) => prev.map((a) => a.id === alertId ? { ...a, ...update } : a))
  }

  async function dismissAlert(alertId) {
    const { error } = await supabase.from('pull_tracking').update({ status: 'dismissed' }).eq('id', alertId)
    if (error) { alert('Failed to dismiss: ' + error.message); return }
    setAlerts((prev) => prev.map((a) => a.id === alertId ? { ...a, status: 'dismissed' } : a))
  }

  return (
    <div className="page">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-red-400">Pull List</h1>
          <p className="text-xs text-slate-400">Sold cars that need to be pulled from auctions</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="p-2 rounded-lg bg-red-500/20 text-red-400" title="Add from recent sales">
          <Plus size={20} />
        </button>
        <button onClick={load} className="p-2 rounded-lg bg-slate-800 text-slate-400">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Warning banner */}
      {needsActionCount > 0 && (
        <div className="bg-red-500/20 border-2 border-red-500/50 rounded-xl p-4 mb-4 flex items-start gap-3">
          <AlertTriangle size={24} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 font-bold text-sm">
              {needsActionCount} car{needsActionCount > 1 ? 's' : ''} need{needsActionCount === 1 ? 's' : ''} to be pulled from auctions NOW
            </p>
            <p className="text-red-300/70 text-xs mt-1">
              These cars are SOLD but may still be listed on SmartAuction, Manheim, or OVE.
              A double-sale can result in arbitration fees and lost trust.
            </p>
          </div>
        </div>
      )}

      {/* Add from recent sales panel */}
      {showAdd && (
        <div className="card mb-4 border-emerald-500/30">
          <p className="text-xs text-slate-400 mb-2 font-semibold uppercase">Add from recent sales</p>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {recentSold.filter((s) => !trackedStocks.has(s.stock_number)).slice(0, 20).map((s) => {
              const desc = [s.vehicle_year, s.vehicle_make, s.vehicle_model].filter(Boolean).join(' ')
              return (
                <button
                  key={s.stock_number}
                  onClick={() => addToTracker(s)}
                  className="w-full text-left flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 active:bg-emerald-500/10"
                >
                  <div className="min-w-0">
                    <p className="text-white text-xs font-semibold truncate">{desc || s.stock_number}</p>
                    <p className="text-[10px] text-slate-500">{s.stock_number} · sold {s.sale_date}</p>
                  </div>
                  <Plus size={16} className="text-emerald-400 shrink-0" />
                </button>
              )
            })}
            {recentSold.filter((s) => !trackedStocks.has(s.stock_number)).length === 0 && (
              <p className="text-xs text-slate-500 py-2 text-center">All recent sales are already tracked</p>
            )}
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {[
          { key: 'needs_action', label: 'Needs Action', count: alerts.filter((a) => a.status === 'needs_action').length },
          { key: 'in_progress', label: 'In Progress', count: alerts.filter((a) => a.status === 'in_progress').length },
          { key: 'resolved', label: 'Resolved', count: alerts.filter((a) => a.status === 'resolved').length },
          { key: 'all', label: 'All', count: alerts.length },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
              filter === f.key
                ? f.key === 'needs_action' ? 'bg-red-500 text-white' : 'bg-emerald-500 text-slate-900'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {f.label} {f.count > 0 && `(${f.count})`}
          </button>
        ))}
      </div>

      {/* Alert cards */}
      {loading ? (
        <div className="text-center text-slate-400 py-12">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Shield size={48} className="mx-auto text-emerald-500/30 mb-4" />
          <p className="text-slate-400">
            {filter === 'needs_action' ? 'All clear — no cars need pulling right now' : 'Nothing here'}
          </p>
          <p className="text-slate-500 text-xs mt-1">Tap + to add recently sold cars to track</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => {
            const isResolved = a.status === 'resolved'
            const isDismissed = a.status === 'dismissed'
            return (
              <div
                key={a.id}
                className={`card ${
                  isResolved ? 'border-emerald-500/30 opacity-60'
                  : isDismissed ? 'border-slate-700 opacity-40'
                  : 'border-red-500/40'
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="min-w-0">
                    <p className="font-bold text-white text-sm truncate">{a.vehicle_desc || a.stock_number}</p>
                    <p className="text-xs text-slate-400 font-mono">{a.stock_number} · {a.vin?.slice(-6)}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Sold {a.sale_date}
                      {a.buyer_name && ` to ${a.buyer_name}`}
                      {a.sale_price && ` · $${Number(a.sale_price).toLocaleString()}`}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <HistoryButton showPhotos stockNumber={a.stock_number} vin={a.vin} size={14} className="p-1.5 rounded bg-slate-700 text-slate-400 active:bg-slate-600" />
                    {!isResolved && !isDismissed && (
                      <button
                        onClick={() => dismissAlert(a.id)}
                        className="p-1.5 rounded bg-slate-700 text-slate-400 active:bg-slate-600"
                        title="Dismiss (not listed anywhere)"
                      >
                        <X size={14} />
                      </button>
                    )}
                    {isResolved && (
                      <span className="text-[10px] px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400 font-bold">
                        ALL PULLED
                      </span>
                    )}
                  </div>
                </div>

                {/* Platform pull checklist */}
                {!isDismissed && (
                  <div className="space-y-1.5">
                    {PLATFORMS.map((p) => {
                      if (!a[p.needsKey]) return null
                      const isPulled = !!a[p.pulledKey]
                      const pulledAt = a[p.atKey]
                      return (
                        <button
                          key={p.key}
                          onClick={() => togglePulled(a.id, p)}
                          disabled={isResolved}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                            isPulled
                              ? 'bg-emerald-500/10 border-emerald-500/30'
                              : p.unpulled
                          }`}
                        >
                          <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                            isPulled ? 'bg-emerald-500 text-white' : 'bg-slate-700 border border-slate-600'
                          }`}>
                            {isPulled && <Check size={14} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold ${isPulled ? 'text-emerald-400 line-through' : 'text-white'}`}>
                              {isPulled ? `Pulled from ${p.label}` : `Pull from ${p.label}`}
                            </p>
                            {isPulled && pulledAt && (
                              <p className="text-[10px] text-slate-500">
                                <Clock size={9} className="inline -mt-0.5" /> {new Date(pulledAt).toLocaleString()}
                              </p>
                            )}
                            {!isPulled && (
                              <p className={`text-[10px] ${p.hint}`}>
                                Go to {p.label} → find this VIN → remove listing
                              </p>
                            )}
                          </div>
                          {!isPulled && (
                            <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${p.badge}`}>
                              ACTIVE
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}

                {isDismissed && (
                  <p className="text-xs text-slate-500 italic">Dismissed — not listed on any platform</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
