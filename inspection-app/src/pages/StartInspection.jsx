import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/useAuth'
import { buildEmptyInspection } from '../services/inspectionFlow'

export default function StartInspection() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [vin6, setVin6] = useState('')
  const [odometer, setOdometer] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleStart(e) {
    e.preventDefault()
    setError('')

    if (vin6.length !== 6) {
      setError('Enter last 6 of VIN')
      return
    }
    if (!odometer) {
      setError('Enter odometer')
      return
    }

    setLoading(true)

    const newMiles = parseInt(odometer.replace(/,/g, ''), 10)
    const last6 = vin6.toUpperCase()

    // Sanity check against Frazer inventory: if the same VIN is in stock with
    // a higher mileage reading than the one the inspector just entered,
    // flag it as a likely typo and let them confirm before creating the
    // inspection. Mileage can only go up in real life.
    let invVehicle = null
    try {
      const { data: invRows } = await supabase
        .from('inventory')
        .select('mileage, vehicle_year, vehicle_make, vehicle_model, vehicle_vin, stock_number')
        .eq('last_6_vin', last6)
        .limit(1)
      const inv = invRows?.[0]
      invVehicle = inv || null
      if (inv) {
        const invMiles = parseInt(String(inv.mileage || '').replace(/,/g, ''), 10)
        if (Number.isFinite(invMiles) && Number.isFinite(newMiles) && newMiles < invMiles) {
          const vehicleLabel = [inv.vehicle_year, inv.vehicle_make, inv.vehicle_model]
            .filter(Boolean)
            .join(' ') || `stock ${inv.stock_number || last6}`
          const proceed = window.confirm(
            `⚠️ Odometer is LOWER than inventory\n\n` +
            `Vehicle: ${vehicleLabel}\n` +
            `You entered: ${newMiles.toLocaleString()} mi\n` +
            `Inventory shows: ${invMiles.toLocaleString()} mi\n\n` +
            `Mileage should only go up. This is probably a typo.\n\n` +
            `Tap Cancel to fix it, or OK to continue anyway.`,
          )
          if (!proceed) {
            setLoading(false)
            return
          }
        }
      }
    } catch (err) {
      // Non-critical — if lookup fails, let the inspection proceed
      console.warn('[StartInspection] inventory mileage check skipped:', err)
    }

    // Re-inspection check: if this VIN was inspected before, offer to load
    // the prior findings so the inspector only has to update what changed
    // (typically damages that got repaired). Archived prior inspections are
    // still considered — we always want the single most recent.
    let priorChecklist = null
    let priorInspectionId = null
    try {
      const { data: priorRows } = await supabase
        .from('inspections')
        .select('id, checklist, completed_at, year, make, model')
        .eq('vin_last6', last6)
        .in('status', ['complete', 'archived'])
        .order('completed_at', { ascending: false })
        .limit(1)
      const prior = priorRows?.[0]
      if (prior) {
        const daysAgo = prior.completed_at
          ? Math.max(0, Math.round((Date.now() - new Date(prior.completed_at).getTime()) / 86400000))
          : null
        const vehicleLabel = [prior.year, prior.make, prior.model].filter(Boolean).join(' ') || `VIN ...${last6}`
        const agoText = daysAgo === 0 ? 'today' : daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`
        const useOld = window.confirm(
          `This car was inspected ${agoText}.\n\n` +
          `Vehicle: ${vehicleLabel}\n\n` +
          `Load prior findings so you only have to remove anything that was fixed?\n\n` +
          `Tap OK to reuse the old inspection, or Cancel to start fresh.`,
        )
        if (useOld) {
          priorChecklist = prior.checklist || null
          priorInspectionId = prior.id
        }
      }
    } catch (err) {
      console.warn('[StartInspection] prior inspection lookup skipped:', err)
    }

    // If we're re-inspecting, start from the prior checklist but reset every
    // track to not_started so the inspector is forced to walk through and
    // confirm/edit each section.
    let checklist = buildEmptyInspection()
    if (priorChecklist) {
      checklist = {
        ...priorChecklist,
        tracks: {
          quick: 'not_started',
          condition: 'not_started',
          drive: 'not_started',
        },
      }
    }

    const { data, error: dbError } = await supabase
      .from('inspections')
      .insert({
        user_id: user.id,
        vin_last6: last6,
        // The full VIN and the vehicle, when inventory knows them. The agent's
        // whole value depends on knowing WHICH car it is — what this model is
        // known to fail, which test to describe — and without these it opens
        // with "104,500 miles on it" instead of naming the car. The lookup
        // already happened above for the odometer check; it was just thrown away.
        vin: invVehicle?.vehicle_vin || last6,
        year: invVehicle?.vehicle_year ? parseInt(invVehicle.vehicle_year, 10) || null : null,
        make: invVehicle?.vehicle_make || null,
        model: invVehicle?.vehicle_model || null,
        stock_number: invVehicle?.stock_number || last6,
        mileage: newMiles,
        checklist,
        status: 'in_progress',
        type: 'inbound',
        current_step: 'startup',
        parent_inspection_id: priorInspectionId,
      })
      .select()
      .single()

    if (dbError) {
      setError(dbError.message)
      setLoading(false)
      return
    }

    // Straight into the agent. A new hire's whole job on day one is to walk
    // the car and say what he sees; making him first choose between three
    // tracks he has never heard of is the wrong first screen. The tap screens
    // are still there for anyone who wants them.
    navigate(`/inspect/${data.id}/agent`)
  }

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <h1 className="page-title mb-0">New Inspection</h1>
      </div>

      <form onSubmit={handleStart} className="space-y-4">
        <div>
          <label className="block text-sm text-slate-400 mb-1 font-semibold">Last 6 of VIN</label>
          <input
            type="text"
            placeholder="ABC123"
            value={vin6}
            onChange={(e) => setVin6(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
            className="text-center text-2xl tracking-[0.3em] uppercase font-mono"
            maxLength={6}
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-1 font-semibold">Odometer</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="95,264"
            value={odometer}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '')
              setOdometer(digits ? parseInt(digits).toLocaleString() : '')
            }}
            className="text-center text-xl"
          />
        </div>

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}

        <button
          type="submit"
          disabled={loading || vin6.length !== 6 || !odometer}
          className="btn-primary text-lg"
        >
          {loading ? 'Creating...' : 'Start'}
        </button>
      </form>
    </div>
  )
}
