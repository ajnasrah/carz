import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Search, Loader, Package, Copy, Check } from 'lucide-react'
import { supabase } from '../services/supabase'
import { toInt, toMoney } from '../services/utils'

export default function VinCheck() {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)   // { vehicle, cost } or null
  const [notFound, setNotFound] = useState(false)
  const [copied, setCopied] = useState(null)
  const inputRef = useRef(null)

  async function handleSearch(e) {
    e?.preventDefault()
    const q = input.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '')
    if (!q || q.length < 4) return

    setLoading(true)
    setResult(null)
    setNotFound(false)

    // Search vehicle_lot_status (inventory view) by full VIN or last 6
    let query = supabase.from('vehicle_lot_status').select('*')
    if (q.length === 17) {
      query = query.eq('vehicle_vin', q)
    } else {
      // last 4-7 chars — match against last_6_vin or tail of vehicle_vin
      query = query.or(`last_6_vin.eq.${q},vehicle_vin.ilike.%${q}`)
    }

    const { data: vehicles, error: vErr } = await query.limit(5)

    if (vErr || !vehicles || vehicles.length === 0) {
      // Fallback: try plain inventory table
      let fallback = supabase.from('inventory').select('*')
      if (q.length === 17) {
        fallback = fallback.eq('vehicle_vin', q)
      } else {
        fallback = fallback.or(`last_6_vin.eq.${q},vehicle_vin.ilike.%${q}`)
      }
      const { data: inv } = await fallback.limit(5)
      if (!inv || inv.length === 0) {
        setNotFound(true)
        setLoading(false)
        return
      }
      // Use first match from inventory
      const v = inv[0]
      setResult({ vehicle: v, cost: v })
      setLoading(false)
      return
    }

    const v = vehicles[0]

    // Fetch cost data from inventory table
    const { data: costRows } = await supabase
      .from('inventory')
      .select('total_cost, added_costs, buyer, vendor, location_code')
      .eq('stock_number', v.stock_number)
      .limit(1)

    setResult({ vehicle: v, cost: costRows?.[0] || {} })
    setLoading(false)
  }

  function handleCopy(text, label) {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 1500)
  }

  function clearSearch() {
    setInput('')
    setResult(null)
    setNotFound(false)
    inputRef.current?.focus()
  }

  const v = result?.vehicle
  const c = result?.cost || {}

  const totalCost = toInt(c.total_cost)
  const addedCosts = toInt(c.added_costs)
  const allIn = totalCost + addedCosts
  const miles = toInt(v?.mileage)
  const daysOnLot = v?.days_on_lot ? toInt(v.days_on_lot) : null
  const label = v ? [v.vehicle_year, v.vehicle_make, v.vehicle_model].filter(Boolean).join(' ') : ''
  const vin = v?.vehicle_vin || ''
  const last6 = v?.last_6_vin || vin?.slice(-6) || ''

  return (
    <div className="page">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-emerald-400">VIN Check</h1>
          <p className="text-sm text-slate-400">Confirm inventory &middot; full or last 6</p>
        </div>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Enter VIN or last 6..."
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, 17))}
              className="pl-9 font-mono text-lg tracking-wider"
              autoFocus
              spellCheck={false}
            />
          </div>
          <button
            type="submit"
            disabled={loading || input.length < 4}
            className="btn-primary px-5 !w-auto flex items-center gap-1 disabled:opacity-40"
          >
            {loading ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
          </button>
        </div>
      </form>

      {/* Not found */}
      {notFound && (
        <div className="text-center py-12">
          <Package size={48} className="mx-auto text-red-500/30 mb-4" />
          <p className="text-red-400 font-bold">Not in inventory</p>
          <p className="text-slate-500 text-xs mt-1">
            "{input}" not found in current inventory
          </p>
          <button onClick={clearSearch} className="btn-secondary mt-4 text-xs">
            Search again
          </button>
        </div>
      )}

      {/* Result card */}
      {v && (
        <div className="space-y-3">
          {/* Vehicle header */}
          <div className="card border-emerald-500/30">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <Check size={18} className="text-emerald-400" />
              </div>
              <span className="text-xs font-bold text-emerald-400 uppercase">In Inventory</span>
            </div>
            <p className="text-xl font-bold text-white">{label || 'Unknown Vehicle'}</p>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm text-slate-400 font-mono">{vin || last6}</p>
              {vin && (
                <button
                  onClick={() => handleCopy(vin, 'vin')}
                  className="p-1 rounded bg-slate-700 text-slate-400 active:bg-slate-600"
                >
                  {copied === 'vin' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Stock: {v.stock_number}
              {daysOnLot != null && ` · ${daysOnLot} days on lot`}
            </p>
          </div>

          {/* Cost breakdown */}
          <div className="card">
            <p className="text-xs uppercase text-slate-400 font-bold mb-3">Cost Breakdown</p>
            <div className="space-y-2">
              <Row label="Total Cost" value={toMoney(totalCost)} highlight />
              <Row label="Added Costs" value={toMoney(addedCosts)} />
              <div className="border-t border-slate-700 pt-2">
                <Row label="All-In Cost" value={toMoney(allIn)} highlight big />
              </div>
            </div>
          </div>

          {/* Vehicle details */}
          <div className="card">
            <p className="text-xs uppercase text-slate-400 font-bold mb-3">Details</p>
            <div className="space-y-2">
              <Row label="Mileage" value={miles ? `${miles.toLocaleString()} mi` : '—'} />
              <Row label="Year" value={v.vehicle_year || '—'} />
              <Row label="Age" value={daysOnLot != null ? `${daysOnLot} days` : '—'} />
              <Row label="Buyer" value={c.buyer || '—'} />
              <Row label="Vendor" value={c.vendor || '—'} />
              {c.location_code && (
                <Row label="Location" value={
                  { M: 'Memphis', J: 'Jackson', Z: 'Transport', X: 'Dispatched', A: 'Auction' }[c.location_code] || c.location_code
                } />
              )}
            </div>
          </div>

          {/* Quick copy */}
          <button
            onClick={() => handleCopy(
              [label, `VIN: ${vin}`, `Stock: ${v.stock_number}`, `Cost: ${toMoney(allIn)}`, `Miles: ${miles ? miles.toLocaleString() : '?'}`, `Buyer: ${c.buyer || '?'}`].join('\n'),
              'all'
            )}
            className="btn-secondary w-full flex items-center justify-center gap-2 text-sm"
          >
            {copied === 'all' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            {copied === 'all' ? 'Copied!' : 'Copy Summary'}
          </button>

          <button onClick={clearSearch} className="btn-secondary w-full text-sm">
            Search Another
          </button>
        </div>
      )}

      {/* Empty state */}
      {!result && !notFound && !loading && (
        <div className="text-center py-16">
          <Package size={48} className="mx-auto text-slate-600 mb-4" />
          <p className="text-slate-400 font-semibold">Check if a car is in inventory</p>
          <p className="text-slate-500 text-xs mt-1">Enter full VIN or last 6 digits</p>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, highlight, big }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`font-mono ${big ? 'text-lg font-bold text-emerald-400' : highlight ? 'text-sm font-bold text-white' : 'text-sm text-slate-300'}`}>
        {value}
      </span>
    </div>
  )
}
