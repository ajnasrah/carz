import { supabase } from './supabase'
import { allTracksComplete } from './inspectionFlow'

export async function markTrackStarted(inspectionId, trackKey) {
  const { data, error } = await supabase
    .from('inspections')
    .select('checklist')
    .eq('id', inspectionId)
    .single()
  if (error || !data) return { error }

  const checklist = data.checklist || {}
  const tracks = { ...(checklist.tracks || {}) }
  if (tracks[trackKey] !== 'complete') tracks[trackKey] = 'in_progress'

  const updated = { ...checklist, tracks }
  return supabase.from('inspections').update({ checklist: updated }).eq('id', inspectionId)
}

export async function markTrackComplete(inspectionId, trackKey) {
  const { data, error } = await supabase
    .from('inspections')
    .select('checklist, vin_last6, vin, parent_inspection_id')
    .eq('id', inspectionId)
    .single()
  if (error || !data) return { error }

  const checklist = data.checklist || {}
  const tracks = { ...(checklist.tracks || {}), [trackKey]: 'complete' }
  const updated = { ...checklist, tracks }

  const payload = { checklist: updated }
  const inspectionJustCompleted = allTracksComplete(updated)
  if (inspectionJustCompleted) {
    payload.status = 'complete'
    payload.completed_at = new Date().toISOString()
    payload.current_step = 'complete'
  }

  const { error: updateError } = await supabase
    .from('inspections')
    .update(payload)
    .eq('id', inspectionId)
  if (updateError) return { error: updateError }

  // When a re-inspection completes, archive its parent so the old findings
  // don't pollute the Ready-to-List queue. The parent's checklist is still
  // preserved for historical reference.
  if (inspectionJustCompleted && data.parent_inspection_id) {
    const { error: archiveError } = await supabase
      .from('inspections')
      .update({ status: 'archived' })
      .eq('id', data.parent_inspection_id)
    if (archiveError) console.warn('[markTrackComplete] archive parent failed:', archiveError)
  }

  return {
    error: null,
    inspectionCompleted: inspectionJustCompleted,
    vinLast6: data.vin_last6 || (data.vin || '').slice(-6),
  }
}
