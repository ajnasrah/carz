import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { toInt, toMoney } from '../services/utils'

// Self-contained "quick info" card for a vehicle. Given a search result
// ({ vehicle, cost }), it renders the in-inventory header, cost breakdown,
// details, and a copy-summary button. Used by both the global VIN search popup
// and the standalone /vin-check page so the two never drift.
export default function VehicleQuickInfo({ result }) {
  const [copied, setCopied] = useState(null)

  const v = result?.vehicle
  const c = result?.cost || {}
  if (!v) return null

  const totalCost = toInt(c.total_cost)
  const addedCosts = toInt(c.added_costs)
  const allIn = totalCost + addedCosts
  const miles = toInt(v.mileage)
  const daysOnLot = v.days_on_lot ? toInt(v.days_on_lot) : null
  const label = [v.vehicle_year, v.vehicle_make, v.vehicle_model].filter(Boolean).join(' ')
  const vin = v.vehicle_vin || ''
  const last6 = v.last_6_vin || vin.slice(-6) || ''

  function handleCopy(text, key) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
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
              { M: 'Memphis', J: 'Jackson', Z: 'In Transport', X: 'In Transport', A: 'Auction' }[c.location_code] || c.location_code
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
