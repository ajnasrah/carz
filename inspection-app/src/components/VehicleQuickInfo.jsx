import { useState } from 'react'
import { Copy, Check, Package, MapPin, Clock, ChevronDown, ExternalLink } from 'lucide-react'
import { toInt, toMoney, timeAgo } from '../services/utils'
import HistoryTimeline from './HistoryTimeline'
import { copyText } from '../native/clipboard'

// Self-contained "quick info" card for a vehicle. Given a search result
// ({ vehicle, cost, location, status, sale, history }), it renders a status
// badge, cost breakdown, current location + last-tracked time, sale details
// (sold cars), and a collapsible full history timeline. Used by both the
// global VIN search popup and the standalone /vin-check page so they don't drift.

const LOCATION_CODES = { M: 'Memphis', J: 'Jackson', Z: 'In Transport', X: 'In Transport', A: 'Auction' }

export default function VehicleQuickInfo({ result }) {
  const [copied, setCopied] = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const [imgError, setImgError] = useState(false)

  const v = result?.vehicle
  const c = result?.cost || {}
  const location = result?.location
  const status = result?.status || { state: 'unknown' }
  const sale = result?.sale
  const history = result?.history || []
  const photo = result?.media?.photo || null
  const listingUrl = result?.media?.listingUrl || null
  if (!v) return null

  const isSold = status.state === 'sold'
  const totalCost = toInt(c.total_cost)
  const addedCosts = toInt(c.added_costs)
  const allIn = totalCost + addedCosts
  const miles = toInt(v.mileage)
  const daysOnLot = v.days_on_lot ? toInt(v.days_on_lot) : null
  const label = [v.vehicle_year, v.vehicle_make, v.vehicle_model].filter(Boolean).join(' ')
  const vin = v.vehicle_vin || ''
  const last6 = v.last_6_vin || vin.slice(-6) || ''

  const badge = isSold
    ? { text: 'Sold', cls: 'bg-red-500/20 text-red-400', icon: Package }
    : status.state === 'inventory'
      ? { text: 'In Inventory', cls: 'bg-emerald-500/20 text-emerald-400', icon: Check }
      : { text: 'Tracked', cls: 'bg-slate-700 text-slate-300', icon: MapPin }
  const BadgeIcon = badge.icon

  function handleCopy(text, key) {
    copyText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="space-y-3">
      {/* First "main" photo (from a completed inspection or ready-to-sell intake) */}
      {photo && !imgError && (
        <a
          href={photo}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-xl overflow-hidden border border-slate-700 bg-slate-800"
        >
          <img
            src={photo}
            alt={label || 'Vehicle photo'}
            loading="lazy"
            onError={() => setImgError(true)}
            className="w-full h-48 object-cover"
          />
        </a>
      )}

      {/* Live marketplace (SmartAuction) listing link */}
      {listingUrl && (
        <a
          href={listingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary w-full flex items-center justify-center gap-2 text-sm !border-emerald-500/40 text-emerald-400"
        >
          <ExternalLink size={14} />
          View marketplace listing
        </a>
      )}

      {/* Vehicle header + status badge */}
      <div className={`card ${isSold ? 'border-red-500/30' : 'border-emerald-500/30'}`}>
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${badge.cls}`}>
            <BadgeIcon size={18} />
          </div>
          <span className={`text-xs font-bold uppercase ${badge.cls.split(' ')[1]}`}>{badge.text}</span>
          {isSold && status.marketplace && (
            <span className="text-xs text-slate-500">· {status.marketplace}</span>
          )}
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
          Stock: {v.stock_number || '—'}
          {daysOnLot != null && ` · ${daysOnLot} days on lot`}
        </p>
      </div>

      {/* Current location + last tracked */}
      {location && (location.physical_location || location.updated_at) && (
        <div className="card">
          <p className="text-xs uppercase text-slate-400 font-bold mb-3">Location</p>
          <div className="space-y-2">
            {/* A sold or retired car's own location row is often blank, so this
                can be recovered from the chat-sourced row or from history. Say
                so — "Last Known" is where the car was when we stopped tracking
                it, not a claim that it's parked there today. */}
            <Row
              label={location.last_known ? 'Last Known' : 'Most Recent'}
              value={
                <span className="inline-flex items-center gap-1">
                  <MapPin size={13} className={location.last_known ? 'text-amber-400' : 'text-emerald-400'} />
                  {location.physical_location || 'Unknown'}
                </span>
              }
              highlight
            />
            {location.updated_at && (
              <Row
                label="Last Tracked"
                value={
                  <span className="inline-flex items-center gap-1">
                    <Clock size={13} className="text-slate-500" />
                    {timeAgo(location.updated_at)}
                  </span>
                }
              />
            )}
            {location.source && <Row label="Source" value={location.source} />}
          </div>
        </div>
      )}

      {/* Sale details (sold cars only) */}
      {isSold && sale && (
        <div className="card border-red-500/20">
          <p className="text-xs uppercase text-slate-400 font-bold mb-3">Sale</p>
          <div className="space-y-2">
            <Row label="Sale Price" value={sale.price ? toMoney(sale.price) : '—'} highlight />
            <Row label="Buyer" value={sale.buyer || '—'} />
            <Row label="Sold On" value={sale.sold_on ? new Date(sale.sold_on).toLocaleDateString() : '—'} />
            {sale.marketplace && <Row label="Channel" value={sale.marketplace} />}
          </div>
        </div>
      )}

      {/* Cost breakdown (only when we have inventory cost) */}
      {(totalCost > 0 || addedCosts > 0) && (
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
      )}

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
            <Row label="Location Code" value={LOCATION_CODES[c.location_code] || c.location_code} />
          )}
        </div>
      </div>

      {/* Full history timeline (collapsible) */}
      <div className="card">
        <button
          onClick={() => setShowHistory((s) => !s)}
          className="w-full flex items-center justify-between"
        >
          <span className="text-xs uppercase text-slate-400 font-bold">
            History {history.length > 0 && `(${history.length})`}
          </span>
          <ChevronDown
            size={16}
            className={`text-slate-500 transition-transform ${showHistory ? 'rotate-180' : ''}`}
          />
        </button>
        {showHistory && (
          <div className="mt-4">
            <HistoryTimeline events={history} emptyLabel="No tracked events yet" />
          </div>
        )}
      </div>

      {/* Quick copy */}
      <button
        onClick={() =>
          handleCopy(
            [
              label,
              `VIN: ${vin}`,
              `Stock: ${v.stock_number || '?'}`,
              isSold ? `Status: Sold${sale?.price ? ` for ${toMoney(sale.price)}` : ''}` : `Status: ${badge.text}`,
              location?.physical_location && `Location: ${location.physical_location} (${timeAgo(location.updated_at)})`,
              (totalCost > 0 || addedCosts > 0) && `Cost: ${toMoney(allIn)}`,
              `Miles: ${miles ? miles.toLocaleString() : '?'}`,
            ]
              .filter(Boolean)
              .join('\n'),
            'all',
          )
        }
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
