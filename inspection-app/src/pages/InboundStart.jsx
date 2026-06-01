import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, AlertTriangle, Info, Package, Calendar, DollarSign, Key, FileText } from 'lucide-react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/useAuth'
import { createInboundInspection, INSPECTION_PRIORITIES, TITLE_STATUSES } from '../services/inboundInspection'

export default function InboundStart() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  // Basic vehicle info
  const [vin, setVin] = useState('')
  const [stockNumber, setStockNumber] = useState('')
  const [odometer, setOdometer] = useState('')
  
  // Source & arrival info
  const [sourceType, setSourceType] = useState('auction')
  const [sourceName, setSourceName] = useState('')
  const [arrivalDate, setArrivalDate] = useState(new Date().toISOString().split('T')[0])
  const [lotLocation, setLotLocation] = useState('')
  
  // Purchase info
  const [purchasePrice, setPurchasePrice] = useState('')
  const [transportCost, setTransportCost] = useState('')
  const [auctionGrade, setAuctionGrade] = useState('')
  
  // Initial assessment
  const [titleStatus, setTitleStatus] = useState('clean')
  const [keysCount, setKeysCount] = useState(1)
  const [priority, setPriority] = useState('normal')
  const [hasFrameDamage, setHasFrameDamage] = useState(false)
  const [hasFloodDamage, setHasFloodDamage] = useState(false)
  
  async function handleStart(e) {
    e.preventDefault()
    setError('')

    // Validation
    if (vin.length < 6) {
      setError('VIN must be at least 6 characters')
      return
    }
    if (!stockNumber) {
      setError('Stock number is required')
      return
    }
    if (!odometer) {
      setError('Odometer reading is required')
      return
    }

    setLoading(true)

    try {
      // Check for duplicate VIN
      const { data: existing } = await supabase
        .from('inspections')
        .select('id, vin, completed_at')
        .eq('vin', vin.toUpperCase())
        .eq('type', 'inbound')
        .eq('status', 'in_progress')
        .single()

      if (existing) {
        const proceed = window.confirm(
          `⚠️ This VIN already has an in-progress inspection.\n\n` +
          `VIN: ${vin}\n\n` +
          `Would you like to continue to the existing inspection?`
        )
        if (proceed) {
          navigate(`/inspect/${existing.id}/arrival`)
        }
        setLoading(false)
        return
      }

      // Create or get vehicle source
      let sourceId = null
      if (sourceName) {
        const { data: sourceData } = await supabase
          .from('vehicle_sources')
          .upsert({
            name: sourceName,
            type: sourceType
          }, {
            onConflict: 'name'
          })
          .select()
          .single()
        sourceId = sourceData?.id
      }

      // Create new inbound inspection
      const inspection = await createInboundInspection({
        user_id: user.id,
        vin: vin.toUpperCase(),
        vin_last6: vin.slice(-6).toUpperCase(),
        stock_number: stockNumber,
        mileage: parseInt(odometer.replace(/,/g, ''), 10),
        source_id: sourceId,
        purchase_price: purchasePrice ? parseFloat(purchasePrice) : null,
        transport_cost: transportCost ? parseFloat(transportCost) : null,
        arrival_date: arrivalDate,
        lot_location: lotLocation,
        auction_grade: auctionGrade,
        title_status: titleStatus,
        keys_count: keysCount,
        inspection_priority: priority,
        frame_damage: hasFrameDamage,
        flood_damage: hasFloodDamage
      })

      // Navigate to arrival check
      navigate(`/inspect/${inspection.id}/arrival`)
    } catch (err) {
      console.error('Failed to create inspection:', err)
      setError(err.message || 'Failed to create inspection')
      setLoading(false)
    }
  }

  return (
    <div className="page max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold">Inbound Inspection</h1>
      </div>

      <form onSubmit={handleStart} className="space-y-6">
        {/* Vehicle Information */}
        <div className="bg-slate-800 rounded-xl p-4 space-y-4">
          <h2 className="font-semibold flex items-center gap-2">
            <Package size={18} />
            Vehicle Information
          </h2>
          
          <div>
            <label className="block text-sm text-slate-400 mb-1">VIN</label>
            <input
              type="text"
              value={vin}
              onChange={(e) => setVin(e.target.value.toUpperCase())}
              className="w-full px-3 py-2 bg-slate-900 rounded-lg"
              placeholder="Full VIN or last 6"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Stock Number</label>
              <input
                type="text"
                value={stockNumber}
                onChange={(e) => setStockNumber(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 rounded-lg"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Odometer</label>
              <input
                type="text"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 rounded-lg"
                placeholder="Miles"
                required
              />
            </div>
          </div>
        </div>

        {/* Source & Arrival */}
        <div className="bg-slate-800 rounded-xl p-4 space-y-4">
          <h2 className="font-semibold flex items-center gap-2">
            <Calendar size={18} />
            Source & Arrival
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Source Type</label>
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 rounded-lg"
              >
                <option value="auction">Auction</option>
                <option value="trade_in">Trade-In</option>
                <option value="wholesale">Wholesale</option>
                <option value="consignment">Consignment</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Source Name</label>
              <input
                type="text"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 rounded-lg"
                placeholder="e.g., Manheim Dallas"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Arrival Date</label>
              <input
                type="date"
                value={arrivalDate}
                onChange={(e) => setArrivalDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Lot Location</label>
              <input
                type="text"
                value={lotLocation}
                onChange={(e) => setLotLocation(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 rounded-lg"
                placeholder="e.g., Row A-5"
              />
            </div>
          </div>
        </div>

        {/* Purchase Information */}
        <div className="bg-slate-800 rounded-xl p-4 space-y-4">
          <h2 className="font-semibold flex items-center gap-2">
            <DollarSign size={18} />
            Purchase Information
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Purchase Price</label>
              <input
                type="number"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 rounded-lg"
                placeholder="0.00"
                step="0.01"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Transport Cost</label>
              <input
                type="number"
                value={transportCost}
                onChange={(e) => setTransportCost(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 rounded-lg"
                placeholder="0.00"
                step="0.01"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">Auction Grade</label>
            <input
              type="text"
              value={auctionGrade}
              onChange={(e) => setAuctionGrade(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 rounded-lg"
              placeholder="e.g., 4.0, Grade B"
            />
          </div>
        </div>

        {/* Initial Assessment */}
        <div className="bg-slate-800 rounded-xl p-4 space-y-4">
          <h2 className="font-semibold flex items-center gap-2">
            <FileText size={18} />
            Initial Assessment
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Title Status</label>
              <select
                value={titleStatus}
                onChange={(e) => setTitleStatus(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 rounded-lg"
              >
                {Object.entries(TITLE_STATUSES).map(([value, config]) => (
                  <option key={value} value={value}>{config.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Keys Count</label>
              <input
                type="number"
                value={keysCount}
                onChange={(e) => setKeysCount(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 bg-slate-900 rounded-lg"
                min="0"
                max="10"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">Inspection Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 rounded-lg"
            >
              {Object.entries(INSPECTION_PRIORITIES).map(([value, config]) => (
                <option key={value} value={value}>{config.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={hasFrameDamage}
                onChange={(e) => setHasFrameDamage(e.target.checked)}
                className="rounded"
              />
              <span className="flex items-center gap-1">
                <AlertTriangle size={16} className="text-yellow-500" />
                Frame Damage Suspected
              </span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={hasFloodDamage}
                onChange={(e) => setHasFloodDamage(e.target.checked)}
                className="rounded"
              />
              <span className="flex items-center gap-1">
                <AlertTriangle size={16} className="text-blue-500" />
                Flood Damage Suspected
              </span>
            </label>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500 rounded-lg p-3 text-red-500">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-blue-600 rounded-lg font-medium disabled:opacity-50"
        >
          {loading ? 'Creating Inspection...' : 'Start Inspection'}
        </button>
      </form>
    </div>
  )
}