import { supabase } from './supabase'

// Inbound Inspection Service
// Comprehensive service for managing inbound vehicle inspections

export const INSPECTION_PRIORITIES = {
  urgent: { label: 'Urgent', color: 'red', order: 1 },
  high: { label: 'High', color: 'orange', order: 2 },
  normal: { label: 'Normal', color: 'blue', order: 3 },
  low: { label: 'Low', color: 'gray', order: 4 }
}

export const CONDITION_GRADES = {
  A: { label: 'Excellent', color: 'green', minScore: 90 },
  B: { label: 'Good', color: 'blue', minScore: 75 },
  C: { label: 'Fair', color: 'yellow', minScore: 60 },
  D: { label: 'Poor', color: 'orange', minScore: 40 },
  F: { label: 'Salvage', color: 'red', minScore: 0 }
}

export const TITLE_STATUSES = {
  clean: { label: 'Clean', color: 'green' },
  salvage: { label: 'Salvage', color: 'red' },
  rebuilt: { label: 'Rebuilt', color: 'orange' },
  lemon: { label: 'Lemon', color: 'yellow' },
  pending: { label: 'Pending', color: 'gray' }
}

export const REPAIR_METHODS = {
  pdr: { label: 'PDR (Paintless Dent Repair)', avgCost: 150 },
  paint: { label: 'Paint & Refinish', avgCost: 500 },
  replace: { label: 'Replace Part', avgCost: 800 },
  repair: { label: 'Repair/Fix', avgCost: 300 },
  detail: { label: 'Detail/Clean', avgCost: 100 }
}

export const MECHANICAL_SYSTEMS = {
  engine: { label: 'Engine', icon: 'Zap' },
  transmission: { label: 'Transmission', icon: 'Settings' },
  suspension: { label: 'Suspension', icon: 'Activity' },
  brakes: { label: 'Brakes', icon: 'Disc' },
  electrical: { label: 'Electrical', icon: 'Battery' },
  hvac: { label: 'HVAC', icon: 'Wind' },
  exhaust: { label: 'Exhaust', icon: 'Cloud' },
  cooling: { label: 'Cooling System', icon: 'Thermometer' },
  fuel: { label: 'Fuel System', icon: 'Fuel' },
  other: { label: 'Other', icon: 'Tool' }
}

// Create new inbound inspection
export async function createInboundInspection(data) {
  const { data: inspection, error } = await supabase
    .from('inspections')
    .insert({
      ...data,
      type: 'inbound',
      status: 'in_progress',
      checklist: buildInboundChecklist()
    })
    .select()
    .single()

  if (error) throw error
  return inspection
}

// Build comprehensive inbound checklist
export function buildInboundChecklist() {
  return {
    v: 3, // Version 3 for inbound
    arrival: {
      date: new Date().toISOString(),
      condition_on_arrival: null,
      transport_damage: [],
      missing_items: [],
      keys_received: 0,
      documents_received: []
    },
    pre_inspection: {
      vin_verified: false,
      title_checked: false,
      history_report_pulled: false,
      auction_sheet_reviewed: false,
      frame_scanner_used: false
    },
    fluids: {},
    tires: {},
    mechanical: {
      engine_hours: null,
      diagnostic_codes: [],
      emissions_ready: false
    },
    estimation: {
      parts_needed: [],
      labor_hours: 0,
      detail_needed: false,
      ready_for_lot: false
    },
    tracks: {
      quick: 'not_started',
      condition: 'not_started',
      drive: 'not_started',
      mechanical: 'not_started',
      estimation: 'not_started'
    }
  }
}

// Save damage estimate
export async function saveDamageEstimate(inspectionId, damage) {
  const { data, error } = await supabase
    .from('damage_estimates')
    .insert({
      inspection_id: inspectionId,
      ...damage
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// Save mechanical issue
export async function saveMechanicalIssue(inspectionId, issue) {
  const { data, error } = await supabase
    .from('mechanical_issues')
    .insert({
      inspection_id: inspectionId,
      ...issue
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// Save tire condition
export async function saveTireCondition(inspectionId, position, condition) {
  const { data, error } = await supabase
    .from('tire_conditions')
    .upsert({
      inspection_id: inspectionId,
      position,
      ...condition
    }, {
      onConflict: 'inspection_id,position'
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// Save fluid levels
export async function saveFluidLevel(inspectionId, fluidType, level) {
  const { data, error } = await supabase
    .from('fluid_levels')
    .upsert({
      inspection_id: inspectionId,
      fluid_type: fluidType,
      ...level
    }, {
      onConflict: 'inspection_id,fluid_type'
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// Calculate condition grade based on inspection findings
export function calculateConditionGrade(inspection) {
  let score = 100
  const checklist = inspection.checklist || {}
  
  // Deduct for startup issues
  const startupIssues = Object.values(checklist.startup || {}).filter(v => v === false).length
  score -= startupIssues * 5
  
  // Deduct for exterior damage
  const exteriorDamages = Object.keys(checklist.exterior || {}).length
  score -= Math.min(exteriorDamages * 3, 30)
  
  // Deduct for interior damage
  const interiorDamages = Object.keys(checklist.interior || {}).length
  score -= Math.min(interiorDamages * 2, 20)
  
  // Deduct for test drive issues
  const driveIssues = Object.values(checklist.test_drive || {}).filter(v => v === false).length
  score -= driveIssues * 10
  
  // Major deductions
  if (inspection.frame_damage) score -= 30
  if (inspection.flood_damage) score -= 40
  if (inspection.title_status !== 'clean') score -= 20
  
  score = Math.max(0, Math.min(100, score))
  
  // Determine grade
  for (const [grade, config] of Object.entries(CONDITION_GRADES)) {
    if (score >= config.minScore) return grade
  }
  return 'F'
}

// Get inspection statistics
export async function getInboundStats(dateRange = 30) {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - dateRange)
  
  const { data, error } = await supabase
    .from('inspections')
    .select('*, damage_estimates(*), mechanical_issues(*)')
    .eq('type', 'inbound')
    .gte('created_at', startDate.toISOString())
  
  if (error) throw error
  
  return {
    total: data.length,
    completed: data.filter(i => i.status === 'complete').length,
    avgRepairCost: data.reduce((sum, i) => sum + (i.estimated_repair_cost || 0), 0) / data.length,
    byGrade: data.reduce((acc, i) => {
      const grade = i.condition_grade || 'Ungraded'
      acc[grade] = (acc[grade] || 0) + 1
      return acc
    }, {}),
    bySource: data.reduce((acc, i) => {
      const source = i.source_id || 'Unknown'
      acc[source] = (acc[source] || 0) + 1
      return acc
    }, {})
  }
}

// Approve or reject inspection
export async function approveInspection(inspectionId, approverId, status, comments) {
  const { data, error } = await supabase
    .from('inspection_approvals')
    .insert({
      inspection_id: inspectionId,
      approver_id: approverId,
      status,
      comments,
      approved_at: status === 'approved' ? new Date().toISOString() : null
    })
    .select()
    .single()

  if (error) throw error
  
  // Update inspection status if approved
  if (status === 'approved') {
    await supabase
      .from('inspections')
      .update({ status: 'complete', completed_at: new Date().toISOString() })
      .eq('id', inspectionId)
  }
  
  return data
}

// Get pending approvals
export async function getPendingApprovals() {
  const { data, error } = await supabase
    .from('inspections')
    .select(`
      *,
      inspection_approvals!left(*)
    `)
    .eq('type', 'inbound')
    .eq('status', 'in_progress')
    .is('inspection_approvals.id', null)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}