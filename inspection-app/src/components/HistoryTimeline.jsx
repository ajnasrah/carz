import {
  MapPin,
  ShoppingCart,
  Truck,
  Wrench,
  Clock,
  Package,
} from 'lucide-react'

// Shared vehicle-history timeline. Rendered by both VehicleHistoryModal (full
// screen) and VehicleQuickInfo (embedded in the search popup) so the two never
// drift. `events` is an array of vehicle_location_history rows, newest first.

const eventIcons = {
  location_change: MapPin,
  marketplace_listed: ShoppingCart,
  marketplace_status: ShoppingCart,
  marketplace_sold: Package,
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
  location_change: 'Location Changed',
  marketplace_listed: 'Listed on Marketplace',
  marketplace_status: 'Marketplace Status Update',
  marketplace_sold: 'Sold',
  transport_initiated: 'Transport Started',
  transport_completed: 'Transport Completed',
  service_sent: 'Sent to Service',
  service_completed: 'Service Completed',
  inventory_added: 'Added to Inventory',
  inventory_removed: 'Removed from Inventory',
  manual_update: 'Manual Update',
  scan_detected: 'Scanned on Lot',
  note_added: 'Note Added',
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getEventDescription(event) {
  const parts = []
  if (event.previous_location && event.new_location) {
    parts.push(`${event.previous_location} → ${event.new_location}`)
  } else if (event.new_location) {
    parts.push(`Location: ${event.new_location}`)
  }
  if (event.marketplace && event.marketplace_status) {
    parts.push(`${event.marketplace}: ${event.marketplace_status}`)
  }
  if (event.sale_price) parts.push(`Sale Price: $${Number(event.sale_price).toLocaleString()}`)
  if (event.buyer_name) parts.push(`Buyer: ${event.buyer_name}`)
  if (event.service_provider) parts.push(`Service: ${event.service_provider}`)
  if (event.transport_destination) parts.push(`Destination: ${event.transport_destination}`)
  return parts.join(' • ')
}

function EventIcon({ eventType }) {
  const IconComponent = eventIcons[eventType] || Clock
  return <IconComponent className="h-4 w-4" />
}

export default function HistoryTimeline({ events = [], emptyLabel = 'No history records found' }) {
  if (!events.length) {
    return <div className="text-center py-8 text-slate-400">{emptyLabel}</div>
  }

  return (
    <div className="space-y-4">
      {events.map((event, idx) => (
        <div key={event.id ?? idx} className="flex gap-3">
          <div className="flex-shrink-0 mt-1">
            <div
              className={`p-2 rounded-full ${
                event.event_type.includes('sold')
                  ? 'bg-green-500/20 text-green-400'
                  : event.event_type.includes('service')
                    ? 'bg-orange-500/20 text-orange-400'
                    : event.event_type.includes('transport')
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-slate-800 text-slate-400'
              }`}
            >
              <EventIcon eventType={event.event_type} />
            </div>
          </div>

          <div className="flex-1">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-white">
                  {eventLabels[event.event_type] || event.event_type}
                </p>
                <p className="text-sm text-slate-400 mt-1">{getEventDescription(event)}</p>
                {event.event_data && Object.keys(event.event_data).length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300">
                      Additional details
                    </summary>
                    <pre className="text-xs text-slate-400 mt-1 p-2 bg-slate-800 rounded overflow-x-auto">
                      {JSON.stringify(event.event_data, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
              <div className="text-right text-sm text-slate-500 ml-4 flex-shrink-0">
                <div>{formatDate(event.created_at)}</div>
                {event.created_by && <div className="text-xs mt-1">by {event.created_by}</div>}
              </div>
            </div>

            {idx < events.length - 1 && (
              <div className="border-l-2 border-slate-700 ml-4 h-4 mt-2"></div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
