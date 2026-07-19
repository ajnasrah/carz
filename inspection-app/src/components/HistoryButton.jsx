import { useState } from 'react'
import { Clock } from 'lucide-react'
import VehicleHistoryModal from './VehicleHistoryModal'

// Drop-in "view location history" button. Self-contained (owns its own modal
// state) so any page that renders a vehicle can add history access with a
// single line: <HistoryButton stockNumber={r.stock_number} vin={r.vehicle_vin} />.
// Works VIN-only too — the modal prefers VIN and falls back to stock number.
export default function HistoryButton({ stockNumber, vin, className, size = 16, label }) {
  const [open, setOpen] = useState(false)
  if (!stockNumber && !vin) return null

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setOpen(true)
        }}
        className={
          className ||
          'p-2 rounded-lg bg-slate-800 text-slate-400 active:bg-slate-700 inline-flex items-center gap-1'
        }
        title="Location history"
        aria-label="Location history"
      >
        <Clock size={size} />
        {label && <span className="text-xs">{label}</span>}
      </button>
      {open && (
        <VehicleHistoryModal
          stockNumber={stockNumber}
          vin={vin}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
