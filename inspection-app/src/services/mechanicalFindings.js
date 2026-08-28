// Mechanical findings — one row per thing actually wrong with the car.
//
// The problem this replaces: a check was one pass/fail plus one single-line text
// box. "Accessories" covered fourteen items, "drivetrain" covered three systems.
// An inspector who found three problems had one sentence to hold them, written
// after the drive was over — so at least one was gone by the time he typed.
//
// Now a check holds a LIST. Each finding is one repair: what it is, which system
// it belongs to, how bad it is, and a photo if there's something to see. That
// maps one-to-one onto a mechanic line, so what the inspector saw and what the
// tech reads are the same list.
//
// Every write goes through patch_inspection_checklist, which merges server-side.
// Writing the whole checklist from a page-load snapshot is what let the three
// parallel tracks erase each other — see the RPC's own comment.

import { supabase } from './supabase'
import { findCheck, FINDING_SEVERITIES } from './inspectionFlow'

export const DEFAULT_SEVERITY = 'moderate'

// Free-form findings that belong to no check — the "something else" bucket.
// Everything an inspector notices that the form didn't ask about used to have
// nowhere to go, so it went nowhere.
export const OTHER_SECTION = 'other'

function newId() {
  // crypto.randomUUID is unavailable on older webviews and on http:// origins.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `f-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function severityLabel(key) {
  return FINDING_SEVERITIES.find((s) => s.key === key)?.label || 'Should fix'
}

// ---------------------------------------------------------------- reading

export function readCheck(checklist, section, checkId) {
  return checklist?.[section]?.[checkId] || null
}

export function readFindings(checklist, section, checkId) {
  const entry = readCheck(checklist, section, checkId)
  if (!entry) return []
  if (Array.isArray(entry.findings)) return entry.findings

  // Legacy rows: one status plus one note. Surface the note as a single finding
  // so old inspections still read as findings everywhere downstream instead of
  // quietly showing as "failed, no detail".
  if (entry.status === 'fail' && entry.note) {
    const check = findCheck(checkId)
    return [{
      id: `legacy-${checkId}`,
      description: entry.note,
      system: check?.system || 'other',
      severity: check?.severity || DEFAULT_SEVERITY,
      photos: [],
      legacy: true,
    }]
  }
  return []
}

export function readOtherFindings(checklist) {
  const list = checklist?.[OTHER_SECTION]?.findings
  return Array.isArray(list) ? list : []
}

// Everything wrong with the car, across every check and the other bucket.
export function allFindings(checklist, checks) {
  const out = []
  for (const check of checks) {
    for (const f of readFindings(checklist, check.section, check.id)) {
      out.push({ ...f, checkId: check.id, checkLabel: check.label, section: check.section })
    }
  }
  for (const f of readOtherFindings(checklist)) {
    out.push({ ...f, checkId: null, checkLabel: 'Something else', section: OTHER_SECTION })
  }
  return out
}

// A check is answered once it is explicitly passed or failed. Used to gate
// track completion — an unanswered check is not a passing one, and letting a
// track finish with nothing recorded is how five "complete" inspections ended
// up holding no test drive data at all.
export function isAnswered(checklist, section, checkId) {
  const s = readCheck(checklist, section, checkId)?.status
  return s === 'pass' || s === 'fail'
}

export function unansweredChecks(checklist, checks) {
  return checks.filter((c) => !isAnswered(checklist, c.section, c.id))
}

// ---------------------------------------------------------------- writing

// One branch, merged server-side. Returns the authoritative checklist so the
// caller re-renders from what is actually stored rather than from its own guess.
async function patch(inspectionId, path, value) {
  const { data, error } = await supabase.rpc('patch_inspection_checklist', {
    p_inspection_id: inspectionId,
    p_path: path,
    p_value: value,
  })
  if (error) throw error
  return data
}

export async function setCheckStatus(inspectionId, checklist, section, checkId, status) {
  const entry = readCheck(checklist, section, checkId) || {}
  const findings = Array.isArray(entry.findings) ? entry.findings : []
  // Passing a check that already has findings would leave them stranded —
  // counted nowhere, shown nowhere, but still in the JSON. Clear them, so
  // "actually it's fine" means what it says.
  return patch(inspectionId, [section, checkId], {
    ...entry,
    status,
    findings: status === 'pass' ? [] : findings,
  })
}

export async function addFinding(inspectionId, checklist, section, checkId, { symptom, description, severity, note } = {}) {
  const check = checkId ? findCheck(checkId) : null
  const finding = {
    id: newId(),
    symptom: symptom || null,
    description: (description || symptom || '').trim(),
    // The check's name travels with the finding so the work order router can
    // write "Brakes — Grinding" without keeping its own copy of the labels in
    // SQL. One place to rename a check, not two.
    check_label: check?.label || null,
    system: check?.system || 'other',
    severity: severity || check?.severity || DEFAULT_SEVERITY,
    note: note || '',
    photos: [],
    at: new Date().toISOString(),
  }
  if (!finding.description) throw new Error('Say what is wrong')

  if (section === OTHER_SECTION) {
    const list = readOtherFindings(checklist)
    await patch(inspectionId, [OTHER_SECTION, 'findings'], [...list, finding])
  } else {
    const entry = readCheck(checklist, section, checkId) || {}
    const findings = readFindings(checklist, section, checkId).filter((f) => !f.legacy)
    // Recording a problem IS failing the check; making someone tap fail first is
    // a step that adds nothing and can be skipped.
    await patch(inspectionId, [section, checkId], {
      ...entry, status: 'fail', findings: [...findings, finding],
    })
  }
  return finding
}

export async function updateFinding(inspectionId, checklist, section, checkId, findingId, patchObj) {
  if (section === OTHER_SECTION) {
    const list = readOtherFindings(checklist).map((f) => (f.id === findingId ? { ...f, ...patchObj } : f))
    return patch(inspectionId, [OTHER_SECTION, 'findings'], list)
  }
  const entry = readCheck(checklist, section, checkId) || {}
  const findings = readFindings(checklist, section, checkId)
    .filter((f) => !f.legacy)
    .map((f) => (f.id === findingId ? { ...f, ...patchObj } : f))
  return patch(inspectionId, [section, checkId], { ...entry, status: 'fail', findings })
}

export async function removeFinding(inspectionId, checklist, section, checkId, findingId) {
  if (section === OTHER_SECTION) {
    const list = readOtherFindings(checklist).filter((f) => f.id !== findingId)
    return patch(inspectionId, [OTHER_SECTION, 'findings'], list)
  }
  const entry = readCheck(checklist, section, checkId) || {}
  const findings = readFindings(checklist, section, checkId)
    .filter((f) => !f.legacy && f.id !== findingId)
  // Removing the last finding leaves the check failed but empty, which reads as
  // "something was wrong and nobody said what". Send it back to unanswered so
  // the completion gate makes someone look again.
  return patch(inspectionId, [section, checkId], {
    ...entry,
    status: findings.length ? 'fail' : null,
    findings,
  })
}

export async function attachPhoto(inspectionId, checklist, section, checkId, findingId, photo) {
  const list = section === OTHER_SECTION
    ? readOtherFindings(checklist)
    : readFindings(checklist, section, checkId)
  const current = list.find((f) => f.id === findingId)
  const photos = [...(current?.photos || []), photo]
  return updateFinding(inspectionId, checklist, section, checkId, findingId, { photos })
}
