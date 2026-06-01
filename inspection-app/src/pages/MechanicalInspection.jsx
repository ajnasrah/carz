import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Wrench, Droplet, AlertTriangle, CheckCircle, Plus, X, Gauge } from 'lucide-react'
import { supabase } from '../services/supabase'
import { saveMechanicalIssue, saveFluidLevel, saveTireCondition, MECHANICAL_SYSTEMS } from '../services/inboundInspection'
import StepProgress from '../components/StepProgress'

const FLUID_TYPES = [
  { id: 'engine_oil', label: 'Engine Oil', icon: '🛢️' },
  { id: 'transmission', label: 'Transmission', icon: '⚙️' },
  { id: 'brake', label: 'Brake Fluid', icon: '🚗' },
  { id: 'coolant', label: 'Coolant', icon: '💧' },
  { id: 'power_steering', label: 'Power Steering', icon: '🎯' },
  { id: 'windshield', label: 'Windshield Washer', icon: '💦' }
]

const TIRE_POSITIONS = [
  { id: 'LF', label: 'Left Front' },
  { id: 'RF', label: 'Right Front' },
  { id: 'LR', label: 'Left Rear' },
  { id: 'RR', label: 'Right Rear' }
]

export default function MechanicalInspection() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [inspection, setInspection] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  // Fluids
  const [fluids, setFluids] = useState({})
  
  // Tires
  const [tires, setTires] = useState({})
  
  // Mechanical Issues
  const [issues, setIssues] = useState([])
  const [showAddIssue, setShowAddIssue] = useState(false)
  const [newIssue, setNewIssue] = useState({
    system: 'engine',
    issue_description: '',
    severity: 'minor',
    estimated_repair_cost: '',
    requires_immediate_attention: false
  })
  
  // OBD Codes
  const [obdCodes, setObdCodes] = useState('')
  const [engineHours, setEngineHours] = useState('')

  useEffect(() => {
    loadInspection()
  }, [id])

  async function loadInspection() {
    try {
      const { data, error } = await supabase
        .from('inspections')
        .select(`
          *,
          mechanical_issues(*),
          fluid_levels(*),
          tire_conditions(*)
        `)
        .eq('id', id)
        .single()

      if (error) throw error
      
      setInspection(data)
      
      // Load existing data
      if (data.mechanical_issues) {
        setIssues(data.mechanical_issues)
      }
      
      if (data.fluid_levels) {
        const fluidMap = {}
        data.fluid_levels.forEach(f => {
          fluidMap[f.fluid_type] = {
            level: f.level,
            condition: f.condition,
            notes: f.notes
          }
        })
        setFluids(fluidMap)
      }
      
      if (data.tire_conditions) {
        const tireMap = {}
        data.tire_conditions.forEach(t => {
          tireMap[t.position] = {
            brand: t.brand,
            size: t.size,
            tread_depth_32nds: t.tread_depth_32nds,
            condition: t.condition,
            notes: t.notes
          }
        })
        setTires(tireMap)
      }
      
      if (data.checklist?.mechanical) {
        setObdCodes(data.checklist.mechanical.diagnostic_codes?.join(', ') || '')
        setEngineHours(data.checklist.mechanical.engine_hours || '')
      }
    } catch (err) {
      console.error('Failed to load inspection:', err)
    } finally {
      setLoading(false)
    }
  }

  async function addMechanicalIssue() {
    if (!newIssue.issue_description) return
    
    try {
      const issue = await saveMechanicalIssue(id, {
        ...newIssue,
        estimated_repair_cost: newIssue.estimated_repair_cost ? parseFloat(newIssue.estimated_repair_cost) : null
      })
      
      setIssues(prev => [...prev, issue])
      setNewIssue({
        system: 'engine',
        issue_description: '',
        severity: 'minor',
        estimated_repair_cost: '',
        requires_immediate_attention: false
      })
      setShowAddIssue(false)
    } catch (err) {
      console.error('Failed to add issue:', err)
      alert('Failed to add issue')
    }
  }

  async function removeIssue(issueId) {
    try {
      const { error } = await supabase
        .from('mechanical_issues')
        .delete()
        .eq('id', issueId)
      
      if (error) throw error
      setIssues(prev => prev.filter(i => i.id !== issueId))
    } catch (err) {
      console.error('Failed to remove issue:', err)
    }
  }

  async function handleSave() {
    setSaving(true)

    try {
      // Save fluid levels
      for (const [fluidType, data] of Object.entries(fluids)) {
        if (data.level) {
          await saveFluidLevel(id, fluidType, data)
        }
      }
      
      // Save tire conditions
      for (const [position, data] of Object.entries(tires)) {
        if (data.condition) {
          await saveTireCondition(id, position, data)
        }
      }
      
      // Update checklist
      const updatedChecklist = {
        ...inspection.checklist,
        mechanical: {
          diagnostic_codes: obdCodes ? obdCodes.split(',').map(s => s.trim()) : [],
          engine_hours: engineHours ? parseFloat(engineHours) : null,
          emissions_ready: true,
          completed_at: new Date().toISOString()
        },
        tracks: {
          ...inspection.checklist.tracks,
          mechanical: 'complete'
        }
      }

      const { error } = await supabase
        .from('inspections')
        .update({
          checklist: updatedChecklist,
          current_step: 'estimation'
        })
        .eq('id', id)

      if (error) throw error

      navigate(`/inspect/${id}/estimation`)
    } catch (err) {
      console.error('Failed to save mechanical inspection:', err)
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

  const severityColors = {
    minor: 'text-yellow-500',
    moderate: 'text-orange-500',
    severe: 'text-red-500',
    critical: 'text-red-600 font-bold'
  }

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(`/inspect/${id}`)} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Mechanical Inspection</h1>
          <p className="text-sm text-slate-400">
            {inspection.vin} • Stock #{inspection.stock_number}
          </p>
        </div>
      </div>

      <StepProgress 
        steps={['Arrival', 'Pre-Check', 'Condition', 'Mechanical', 'Photos', 'Review']}
        current={3}
      />

      <div className="space-y-4 mt-6">
        {/* Fluids Check */}
        <div className="bg-slate-800 rounded-xl p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Droplet size={18} />
            Fluid Levels & Condition
          </h2>
          
          <div className="grid gap-3">
            {FLUID_TYPES.map(fluid => (
              <div key={fluid.id} className="bg-slate-900 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{fluid.icon}</span>
                  <span className="font-medium">{fluid.label}</span>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={fluids[fluid.id]?.level || ''}
                    onChange={(e) => setFluids(prev => ({
                      ...prev,
                      [fluid.id]: { ...prev[fluid.id], level: e.target.value }
                    }))}
                    className="px-2 py-1 bg-slate-800 rounded text-sm"
                  >
                    <option value="">Level...</option>
                    <option value="full">Full</option>
                    <option value="adequate">Adequate</option>
                    <option value="low">Low</option>
                    <option value="empty">Empty</option>
                  </select>
                  
                  <select
                    value={fluids[fluid.id]?.condition || ''}
                    onChange={(e) => setFluids(prev => ({
                      ...prev,
                      [fluid.id]: { ...prev[fluid.id], condition: e.target.value }
                    }))}
                    className="px-2 py-1 bg-slate-800 rounded text-sm"
                  >
                    <option value="">Condition...</option>
                    <option value="clean">Clean</option>
                    <option value="dirty">Dirty</option>
                    <option value="contaminated">Contaminated</option>
                    <option value="needs_change">Needs Change</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tires */}
        <div className="bg-slate-800 rounded-xl p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Gauge size={18} />
            Tire Condition
          </h2>
          
          <div className="grid grid-cols-2 gap-3">
            {TIRE_POSITIONS.map(pos => (
              <div key={pos.id} className="bg-slate-900 rounded-lg p-3">
                <div className="font-medium mb-2">{pos.label}</div>
                
                <input
                  type="text"
                  placeholder="Brand"
                  value={tires[pos.id]?.brand || ''}
                  onChange={(e) => setTires(prev => ({
                    ...prev,
                    [pos.id]: { ...prev[pos.id], brand: e.target.value }
                  }))}
                  className="w-full px-2 py-1 bg-slate-800 rounded text-sm mb-2"
                />
                
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    placeholder="Tread /32"
                    min="0"
                    max="32"
                    value={tires[pos.id]?.tread_depth_32nds || ''}
                    onChange={(e) => setTires(prev => ({
                      ...prev,
                      [pos.id]: { ...prev[pos.id], tread_depth_32nds: e.target.value }
                    }))}
                    className="px-2 py-1 bg-slate-800 rounded text-sm"
                  />
                  
                  <select
                    value={tires[pos.id]?.condition || ''}
                    onChange={(e) => setTires(prev => ({
                      ...prev,
                      [pos.id]: { ...prev[pos.id], condition: e.target.value }
                    }))}
                    className="px-2 py-1 bg-slate-800 rounded text-sm"
                  >
                    <option value="">Condition...</option>
                    <option value="excellent">Excellent</option>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="poor">Poor</option>
                    <option value="replace">Replace</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Mechanical Issues */}
        <div className="bg-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Wrench size={18} />
              Mechanical Issues
            </h2>
            <button
              onClick={() => setShowAddIssue(true)}
              className="px-3 py-1 bg-blue-600 rounded-lg text-sm flex items-center gap-1"
            >
              <Plus size={16} />
              Add Issue
            </button>
          </div>
          
          {issues.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              No mechanical issues found
            </div>
          ) : (
            <div className="space-y-2">
              {issues.map(issue => (
                <div key={issue.id} className="bg-slate-900 rounded-lg p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs bg-slate-800 px-2 py-1 rounded">
                          {MECHANICAL_SYSTEMS[issue.system]?.label}
                        </span>
                        <span className={`text-xs ${severityColors[issue.severity]}`}>
                          {issue.severity.toUpperCase()}
                        </span>
                        {issue.requires_immediate_attention && (
                          <AlertTriangle size={14} className="text-red-500" />
                        )}
                      </div>
                      <p className="text-sm">{issue.issue_description}</p>
                      {issue.estimated_repair_cost && (
                        <p className="text-xs text-slate-400 mt-1">
                          Est. repair: ${issue.estimated_repair_cost}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => removeIssue(issue.id)}
                      className="p-1 hover:bg-slate-800 rounded"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {showAddIssue && (
            <div className="mt-3 bg-slate-900 rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={newIssue.system}
                  onChange={(e) => setNewIssue(prev => ({ ...prev, system: e.target.value }))}
                  className="px-2 py-1 bg-slate-800 rounded text-sm"
                >
                  {Object.entries(MECHANICAL_SYSTEMS).map(([key, val]) => (
                    <option key={key} value={key}>{val.label}</option>
                  ))}
                </select>
                
                <select
                  value={newIssue.severity}
                  onChange={(e) => setNewIssue(prev => ({ ...prev, severity: e.target.value }))}
                  className="px-2 py-1 bg-slate-800 rounded text-sm"
                >
                  <option value="minor">Minor</option>
                  <option value="moderate">Moderate</option>
                  <option value="severe">Severe</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              
              <textarea
                value={newIssue.issue_description}
                onChange={(e) => setNewIssue(prev => ({ ...prev, issue_description: e.target.value }))}
                className="w-full px-2 py-1 bg-slate-800 rounded text-sm"
                rows="2"
                placeholder="Describe the issue..."
              />
              
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={newIssue.estimated_repair_cost}
                  onChange={(e) => setNewIssue(prev => ({ ...prev, estimated_repair_cost: e.target.value }))}
                  className="flex-1 px-2 py-1 bg-slate-800 rounded text-sm"
                  placeholder="Est. cost ($)"
                />
                
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={newIssue.requires_immediate_attention}
                    onChange={(e) => setNewIssue(prev => ({ ...prev, requires_immediate_attention: e.target.checked }))}
                  />
                  Urgent
                </label>
                
                <button
                  onClick={addMechanicalIssue}
                  className="px-3 py-1 bg-green-600 rounded text-sm"
                >
                  Add
                </button>
                
                <button
                  onClick={() => setShowAddIssue(false)}
                  className="px-3 py-1 bg-slate-700 rounded text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* OBD Diagnostics */}
        <div className="bg-slate-800 rounded-xl p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Gauge size={18} />
            Diagnostics
          </h2>
          
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-slate-400 mb-1">OBD Codes</label>
              <input
                type="text"
                value={obdCodes}
                onChange={(e) => setObdCodes(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 rounded-lg text-sm"
                placeholder="e.g., P0301, P0420"
              />
            </div>
            
            <div>
              <label className="block text-sm text-slate-400 mb-1">Engine Hours (if available)</label>
              <input
                type="number"
                value={engineHours}
                onChange={(e) => setEngineHours(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 rounded-lg text-sm"
                placeholder="Hours"
              />
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 bg-blue-600 rounded-lg font-medium disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Continue to Estimation'}
        </button>
      </div>
    </div>
  )
}