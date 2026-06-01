import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle, XCircle, AlertTriangle, Camera, Package, FileCheck } from 'lucide-react'
import { supabase } from '../services/supabase'
import StepProgress from '../components/StepProgress'

const ARRIVAL_CHECKS = [
  { id: 'vin_match', label: 'VIN matches paperwork', category: 'documentation' },
  { id: 'title_present', label: 'Title/MSO present', category: 'documentation' },
  { id: 'keys_match', label: 'Keys count matches', category: 'documentation' },
  { id: 'auction_sheet', label: 'Auction sheet reviewed', category: 'documentation' },
  { id: 'transport_damage', label: 'No transport damage', category: 'condition' },
  { id: 'fluids_leaking', label: 'No fluid leaks', category: 'condition' },
  { id: 'glass_intact', label: 'Glass intact', category: 'condition' },
  { id: 'wheels_present', label: 'All wheels present', category: 'condition' },
  { id: 'battery_present', label: 'Battery present', category: 'components' },
  { id: 'catalytic_present', label: 'Catalytic converter present', category: 'components' },
  { id: 'airbags_present', label: 'Airbags appear intact', category: 'components' }
]

export default function ArrivalInspection() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [inspection, setInspection] = useState(null)
  const [checks, setChecks] = useState({})
  const [notes, setNotes] = useState({})
  const [transportDamage, setTransportDamage] = useState('')
  const [missingItems, setMissingItems] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadInspection()
  }, [id])

  async function loadInspection() {
    try {
      const { data, error } = await supabase
        .from('inspections')
        .select('*')
        .eq('id', id)
        .single()

      if (error) throw error
      
      setInspection(data)
      
      // Load existing arrival checks if any
      if (data.checklist?.arrival) {
        const arrival = data.checklist.arrival
        setTransportDamage(arrival.transport_damage?.join(', ') || '')
        setMissingItems(arrival.missing_items?.join(', ') || '')
        
        // Set checks from saved data
        ARRIVAL_CHECKS.forEach(check => {
          if (arrival[check.id] !== undefined) {
            setChecks(prev => ({ ...prev, [check.id]: arrival[check.id] }))
          }
        })
      }
    } catch (err) {
      console.error('Failed to load inspection:', err)
    } finally {
      setLoading(false)
    }
  }

  function toggleCheck(checkId) {
    setChecks(prev => {
      const current = prev[checkId]
      if (current === true) return { ...prev, [checkId]: false }
      if (current === false) return { ...prev, [checkId]: undefined }
      return { ...prev, [checkId]: true }
    })
  }

  async function handleSave() {
    setSaving(true)

    try {
      const updatedChecklist = {
        ...inspection.checklist,
        arrival: {
          ...inspection.checklist.arrival,
          ...checks,
          transport_damage: transportDamage ? transportDamage.split(',').map(s => s.trim()) : [],
          missing_items: missingItems ? missingItems.split(',').map(s => s.trim()) : [],
          notes: notes,
          completed_at: new Date().toISOString()
        }
      }

      const { error } = await supabase
        .from('inspections')
        .update({
          checklist: updatedChecklist,
          current_step: 'pre_inspection'
        })
        .eq('id', id)

      if (error) throw error

      // Navigate to next step
      navigate(`/inspect/${id}/pre-inspection`)
    } catch (err) {
      console.error('Failed to save arrival inspection:', err)
      alert('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="flex items-center justify-center py-12">
          <div className="text-slate-500">Loading inspection...</div>
        </div>
      </div>
    )
  }

  const allChecked = ARRIVAL_CHECKS.every(check => checks[check.id] !== undefined)
  const hasIssues = Object.values(checks).some(v => v === false)

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(`/inspect/${id}`)} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Arrival Inspection</h1>
          <p className="text-sm text-slate-400">
            {inspection.vin} • Stock #{inspection.stock_number}
          </p>
        </div>
      </div>

      <StepProgress 
        steps={['Arrival', 'Pre-Check', 'Condition', 'Mechanical', 'Photos', 'Review']}
        current={0}
      />

      <div className="space-y-4 mt-6">
        {/* Documentation Checks */}
        <div className="bg-slate-800 rounded-xl p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <FileCheck size={18} />
            Documentation
          </h2>
          <div className="space-y-2">
            {ARRIVAL_CHECKS.filter(c => c.category === 'documentation').map(check => (
              <CheckItem
                key={check.id}
                check={check}
                value={checks[check.id]}
                onToggle={() => toggleCheck(check.id)}
                onNote={(note) => setNotes(prev => ({ ...prev, [check.id]: note }))}
              />
            ))}
          </div>
        </div>

        {/* Condition Checks */}
        <div className="bg-slate-800 rounded-xl p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle size={18} />
            Condition
          </h2>
          <div className="space-y-2">
            {ARRIVAL_CHECKS.filter(c => c.category === 'condition').map(check => (
              <CheckItem
                key={check.id}
                check={check}
                value={checks[check.id]}
                onToggle={() => toggleCheck(check.id)}
                onNote={(note) => setNotes(prev => ({ ...prev, [check.id]: note }))}
              />
            ))}
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Transport Damage (if any)</label>
              <input
                type="text"
                value={transportDamage}
                onChange={(e) => setTransportDamage(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 rounded-lg text-sm"
                placeholder="e.g., Scratch on bumper, dent on door"
              />
            </div>
          </div>
        </div>

        {/* Components Check */}
        <div className="bg-slate-800 rounded-xl p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Package size={18} />
            Components
          </h2>
          <div className="space-y-2">
            {ARRIVAL_CHECKS.filter(c => c.category === 'components').map(check => (
              <CheckItem
                key={check.id}
                check={check}
                value={checks[check.id]}
                onToggle={() => toggleCheck(check.id)}
                onNote={(note) => setNotes(prev => ({ ...prev, [check.id]: note }))}
              />
            ))}
          </div>

          <div className="mt-4">
            <label className="block text-sm text-slate-400 mb-1">Missing Items (if any)</label>
            <input
              type="text"
              value={missingItems}
              onChange={(e) => setMissingItems(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 rounded-lg text-sm"
              placeholder="e.g., Spare tire, floor mats, owner's manual"
            />
          </div>
        </div>

        {/* Summary */}
        {allChecked && (
          <div className={`rounded-xl p-4 ${hasIssues ? 'bg-yellow-500/10 border border-yellow-500' : 'bg-green-500/10 border border-green-500'}`}>
            <div className="flex items-center gap-2">
              {hasIssues ? (
                <>
                  <AlertTriangle size={20} className="text-yellow-500" />
                  <span className="font-medium">Issues found during arrival inspection</span>
                </>
              ) : (
                <>
                  <CheckCircle size={20} className="text-green-500" />
                  <span className="font-medium">Vehicle arrived in expected condition</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => navigate(`/inspect/${id}/photos/arrival`)}
            className="flex-1 py-3 bg-slate-700 rounded-lg font-medium flex items-center justify-center gap-2"
          >
            <Camera size={18} />
            Take Arrival Photos
          </button>
          <button
            onClick={handleSave}
            disabled={!allChecked || saving}
            className="flex-1 py-3 bg-blue-600 rounded-lg font-medium disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Continue to Pre-Check'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CheckItem({ check, value, onToggle, onNote }) {
  const [showNote, setShowNote] = useState(false)
  const [note, setNote] = useState('')

  return (
    <div className="space-y-2">
      <div
        onClick={onToggle}
        className="flex items-center justify-between p-3 bg-slate-900 rounded-lg cursor-pointer hover:bg-slate-800 transition-colors"
      >
        <span className="flex-1">{check.label}</span>
        <div className="flex items-center gap-2">
          {value === true && <CheckCircle size={20} className="text-green-500" />}
          {value === false && (
            <>
              <XCircle size={20} className="text-red-500" />
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowNote(!showNote)
                }}
                className="p-1 hover:bg-slate-700 rounded"
              >
                <AlertTriangle size={16} className="text-yellow-500" />
              </button>
            </>
          )}
          {value === undefined && <div className="w-5 h-5 border border-slate-600 rounded" />}
        </div>
      </div>
      
      {showNote && value === false && (
        <div className="ml-3">
          <input
            type="text"
            value={note}
            onChange={(e) => {
              setNote(e.target.value)
              onNote(e.target.value)
            }}
            className="w-full px-3 py-2 bg-slate-800 rounded-lg text-sm"
            placeholder="Describe the issue..."
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}