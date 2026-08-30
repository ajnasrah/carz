import { useMemo, useState } from 'react'
import {
  MapPin, ShoppingCart, Truck, Wrench, Clock, Package, HelpCircle, EyeOff,
} from 'lucide-react'
import { formatLocationLabel } from '../services/locationLabels'

// Shared vehicle-history timeline. Rendered by both VehicleHistoryModal (full
// screen) and VehicleQuickInfo (embedded in the search popup) so the two never
// drift. `events` is an array of vehicle_location_history rows.
//
// Three things this has to undo, all of them measured on prod before the
// trigger was rewritten (see 20260830000021_location_history_repair.sql):
//
//   * ONE MOVE WAS WRITTEN AS UP TO THREE ROWS — 348 real moves stored as 769.
//     The trigger only makes one row per move now, but the 421 duplicates
//     already in the table are staying (history is a record; we don't rewrite
//     it). So the timeline MERGES rows describing the same move instead.
//
//   * MARKETPLACE CHURN BURIED THE MOVES — 1,392 of 3,810 rows were listing
//     status flaps, so a car with two real location changes showed twenty-four
//     events. Physical moves are the timeline; marketplace activity is behind
//     a toggle.
//
//   * PLACES WERE RAW SLUGS — "mechanic_section", "daa_rockies". Now the same
//     names the inventory list uses, from services/locationLabels.
//
// Ordering is by event_at (when it HAPPENED), never created_at (when we heard
// about it). 27 Super Dispatch moves were more than an hour apart on those two.

const MARKETPLACE_TYPES = new Set([
  'marketplace_listed', 'marketplace_status', 'marketplace_sold', 'marketplace_removed',
])

// Which row wins when several describe one move. location_change carries the
// from/to pair; the others were redundant restatements of it.
const MERGE_PRIORITY = {
  location_change: 4,
  service_sent: 3,
  transport_initiated: 2,
  transport_completed: 1,
}

const eventIcons = {
  location_change: MapPin,
  marketplace_listed: ShoppingCart,
  marketplace_status: ShoppingCart,
  marketplace_removed: ShoppingCart,
  marketplace_sold: Package,
  runlist_unconfirmed: HelpCircle,
  transport_initiated: Truck,
  transport_completed: Truck,
  service_sent: Wrench,
  service_completed: Wrench,
  inventory_added: Package,
  inventory_removed: Package,
  manual_update: MapPin,
  scan_detected: MapPin,
  note_added: Clock,
}

const eventLabels = {
  location_change: 'Moved',
  marketplace_listed: 'Listed',
  marketplace_status: 'Listing Status',
  marketplace_removed: 'Off the Marketplace',
  marketplace_sold: 'Sold',
  runlist_unconfirmed: 'Not on the run list',
  transport_initiated: 'Transport Started',
  transport_completed: 'Arrived',
  service_sent: 'Sent to Service',
  service_completed: 'Service Completed',
  inventory_added: 'First Seen',
  inventory_removed: 'Removed from Inventory',
  manual_update: 'Manual Update',
  scan_detected: 'Scanned on Lot',
  note_added: 'Note Added',
}

const MARKETPLACE_NAMES = {
  smart_auction: 'SmartAuction',
  manheim: 'Manheim',
  ove: 'OVE',
}

// When it happened. event_at is the move's own time; created_at is only the
// fallback for rows written before the column existed.
const whenOf = (e) => e.event_at || e.created_at

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Rows written by the same trigger firing on one UPDATE share a car and a
// timestamp to the second. That is what makes them one event rather than
// several — nothing else about them distinguishes a genuine second move made
// in the same second, which does not happen.
function mergeSameMove(rows) {
  const groups = new Map()
  for (const row of rows) {
    if (MARKETPLACE_TYPES.has(row.event_type)) {
      groups.set(`mk:${row.id}`, [row])          // never merged: separate axis
      continue
    }
    const key = `${row.stock_number}|${new Date(whenOf(row)).getTime()}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  return [...groups.values()].map((rows) => {
    if (rows.length === 1) return rows[0]
    const best = [...rows].sort(
      (a, b) => (MERGE_PRIORITY[b.event_type] || 0) - (MERGE_PRIORITY[a.event_type] || 0))[0]
    // Keep every fact the discarded rows carried — the service provider and the
    // transport destination only ever lived on the rows being folded away.
    return {
      ...best,
      previous_location: rows.find((r) => r.previous_location)?.previous_location ?? best.previous_location,
      new_location: rows.find((r) => r.new_location)?.new_location ?? best.new_location,
      service_provider: rows.find((r) => r.service_provider)?.service_provider ?? null,
      transport_destination: rows.find((r) => r.transport_destination)?.transport_destination ?? null,
      _merged: rows.length,
    }
  })
}

function describe(event) {
  const parts = []
  const from = formatLocationLabel(event.previous_location)
  const to = formatLocationLabel(event.new_location)

  if (event.event_type === 'runlist_unconfirmed') {
    const list = event.event_data?.run_list
    parts.push(`Still shown at ${to || 'the auction'} — not on ${
      list ? formatLocationLabel(list) : 'this week'}'s list`)
  } else if (from && to && from !== to) {
    parts.push(`${from} → ${to}`)
  } else if (to) {
    parts.push(to)
  }

  if (event.marketplace) {
    const name = MARKETPLACE_NAMES[event.marketplace] || event.marketplace
    // A removal has no status to print — that's what removed MEANS. The old
    // renderer required both and silently produced an empty line instead.
    parts.push(event.marketplace_status ? `${name}: ${event.marketplace_status}` : name)
  }
  if (event.sale_price) parts.push(`$${Number(event.sale_price).toLocaleString()}`)
  if (event.buyer_name) parts.push(event.buyer_name)
  if (event.transport_destination) parts.push(`to ${formatLocationLabel(event.transport_destination)}`)
  return parts.join(' • ')
}

function toneFor(type) {
  if (type === 'marketplace_sold') return 'bg-emerald-500/20 text-emerald-400'
  if (MARKETPLACE_TYPES.has(type)) return 'bg-slate-800 text-slate-500'
  if (type === 'runlist_unconfirmed') return 'bg-amber-500/20 text-amber-400'
  if (type === 'service_sent') return 'bg-orange-500/20 text-orange-400'
  if (type.includes('transport')) return 'bg-blue-500/20 text-blue-400'
  return 'bg-slate-800 text-slate-400'
}

export default function HistoryTimeline({ events = [], emptyLabel = 'No history records found' }) {
  const [showMarketplace, setShowMarketplace] = useState(false)

  const { shown, marketplaceCount } = useMemo(() => {
    const merged = mergeSameMove(events)
      .sort((a, b) => new Date(whenOf(b)) - new Date(whenOf(a)))
    const mk = merged.filter((e) => MARKETPLACE_TYPES.has(e.event_type)).length
    return {
      shown: showMarketplace ? merged : merged.filter((e) => !MARKETPLACE_TYPES.has(e.event_type)),
      marketplaceCount: mk,
    }
  }, [events, showMarketplace])

  if (!events.length) {
    return <div className="text-center py-8 text-slate-400">{emptyLabel}</div>
  }

  return (
    <div>
      {marketplaceCount > 0 && (
        <button
          onClick={() => setShowMarketplace((v) => !v)}
          className="mb-4 flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
        >
          {showMarketplace ? <EyeOff size={13} /> : <ShoppingCart size={13} />}
          {showMarketplace
            ? 'Hide marketplace activity'
            : `Show ${marketplaceCount} marketplace ${marketplaceCount === 1 ? 'event' : 'events'}`}
        </button>
      )}

      {shown.length === 0 ? (
        <div className="text-center py-8 text-slate-400">No moves recorded for this car</div>
      ) : (
        <div className="space-y-4">
          {shown.map((event, idx) => (
            <div key={event.id ?? idx} className="flex gap-3">
              <div className="flex-shrink-0 mt-1">
                <div className={`p-2 rounded-full ${toneFor(event.event_type)}`}>
                  <EventIcon eventType={event.event_type} />
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-white">
                      {eventLabels[event.event_type] || event.event_type}
                    </p>
                    <p className="text-sm text-slate-400 mt-1">{describe(event)}</p>
                  </div>
                  <div className="text-right text-sm text-slate-500 flex-shrink-0">
                    <div>{formatDate(whenOf(event))}</div>
                    {event.created_by && (
                      <div className="text-xs mt-1 truncate max-w-[10rem]">
                        by {event.created_by}
                      </div>
                    )}
                  </div>
                </div>

                {idx < shown.length - 1 && (
                  <div className="border-l-2 border-slate-700 ml-4 h-4 mt-2" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EventIcon({ eventType }) {
  const IconComponent = eventIcons[eventType] || Clock
  return <IconComponent className="h-4 w-4" />
}
