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
import { enqueue } from './captureQueue'
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

// A save that failed because the phone left the lot is not a save that failed.
// Anything that looks like a dead network is queued and replayed; anything the
// server actively rejected is a real error and surfaces.
function offlineish(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (err?.code) return false      // Postgres said no — that is a real answer
  return /fetch|network|timeout|load failed|connection/i.test(String(err?.message || ''))
}

// Apply a patch to a local copy, so the screen updates at the moment of the tap
// whether or not the write reached the server.
function localPatch(checklist, path, value) {
  const next = { ...(checklist || {}) }
  let node = next
  for (let i = 0; i < path.length - 1; i += 1) {
    const k = path[i]
    node[k] = Array.isArray(node[k]) ? [...node[k]] : { ...(node[k] || {}) }
    node = node[k]
  }
  node[path[path.length - 1]] = value
  return next
}

// One branch, merged server-side. Returns the authoritative checklist so the
// caller re-renders from what is actually stored rather than from its own guess.
async function patchRemote(inspectionId, path, value) {
  const { data, error } = await supabase.rpc('patch_inspection_checklist', {
    p_inspection_id: inspectionId,
    p_path: path,
    p_value: value,
  })
  if (error) throw error
  return data
}

// `intent` is what gets replayed later — never the computed value, which would
// be stale by the time the network returns and would delete anything recorded
// in between. See captureQueue for why.
async function patch(inspectionId, path, value, { checklist, intent } = {}) {
  try {
    return await patchRemote(inspectionId, path, value)
  } catch (err) {
    if (!offlineish(err) || !intent) throw err
    const queued = await enqueue({ inspectionId, ...intent })
    if (!queued) throw err
    return localPatch(checklist, path, value)
  }
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
  }, { checklist, intent: { kind: 'setStatus', section, checkId, status } })
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
    return {
      finding,
      checklist: await patch(inspectionId, [OTHER_SECTION, 'findings'], [...list, finding],
        { checklist, intent: { kind: 'addFinding', section: OTHER_SECTION, checkId: null, finding } }),
    }
  } else {
    const entry = readCheck(checklist, section, checkId) || {}
    const findings = readFindings(checklist, section, checkId).filter((f) => !f.legacy)
    // Recording a problem IS failing the check; making someone tap fail first is
    // a step that adds nothing and can be skipped.
    return {
      finding,
      checklist: await patch(inspectionId, [section, checkId], {
        ...entry, status: 'fail', findings: [...findings, finding],
      }, { checklist, intent: { kind: 'addFinding', section, checkId, finding } }),
    }
  }
}

export async function updateFinding(inspectionId, checklist, section, checkId, findingId, patchObj) {
  if (section === OTHER_SECTION) {
    const list = readOtherFindings(checklist).map((f) => (f.id === findingId ? { ...f, ...patchObj } : f))
    return patch(inspectionId, [OTHER_SECTION, 'findings'], list,
      { checklist, intent: { kind: 'updateFinding', section: OTHER_SECTION, checkId: null, findingId, patch: patchObj } })
  }
  const entry = readCheck(checklist, section, checkId) || {}
  const findings = readFindings(checklist, section, checkId)
    .filter((f) => !f.legacy)
    .map((f) => (f.id === findingId ? { ...f, ...patchObj } : f))
  return patch(inspectionId, [section, checkId], { ...entry, status: 'fail', findings },
    { checklist, intent: { kind: 'updateFinding', section, checkId, findingId, patch: patchObj } })
}

export async function removeFinding(inspectionId, checklist, section, checkId, findingId) {
  if (section === OTHER_SECTION) {
    const list = readOtherFindings(checklist).filter((f) => f.id !== findingId)
    return patch(inspectionId, [OTHER_SECTION, 'findings'], list,
      { checklist, intent: { kind: 'removeFinding', section: OTHER_SECTION, checkId: null, findingId } })
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
  }, { checklist, intent: { kind: 'removeFinding', section, checkId, findingId } })
}

export async function attachPhoto(inspectionId, checklist, section, checkId, findingId, photo) {
  const list = section === OTHER_SECTION
    ? readOtherFindings(checklist)
    : readFindings(checklist, section, checkId)
  const current = list.find((f) => f.id === findingId)
  const photos = [...(current?.photos || []), photo]
  return updateFinding(inspectionId, checklist, section, checkId, findingId, { photos })
}

// A voice memo on a finding. Recorded and attached in the moment, because the
// most useful thing about "whine from the rear" is the sound of it — and a
// noise is the one finding a tech genuinely cannot picture from a sentence.
//
// Kept as audio rather than transcribed: transcription needs a vendor we have
// not chosen yet, and a recording is already more use to the mechanic than a
// transcript would be. Transcription drops in later without changing this.
export async function attachAudio(inspectionId, checklist, section, checkId, findingId, audio) {
  const list = section === OTHER_SECTION
    ? readOtherFindings(checklist)
    : readFindings(checklist, section, checkId)
  const current = list.find((f) => f.id === findingId)
  const clips = [...(current?.audio || []), audio]
  return updateFinding(inspectionId, checklist, section, checkId, findingId, { audio: clips })
}

// Replayed by captureQueue when the network comes back. Each handler re-reads
// the live checklist and applies the intent to it, so a queued tap lands
// correctly on top of anything recorded in the meantime.
export const replayHandlers = {
  async setStatus(op) {
    const cl = await fetchChecklist(op.inspectionId)
    await setCheckStatus(op.inspectionId, cl, op.section, op.checkId, op.status)
  },
  async addFinding(op) {
    const cl = await fetchChecklist(op.inspectionId)
    // Re-adding one that already made it through would duplicate it — the id is
    // generated on the phone, so it is the same finding either way.
    const existing = op.section === OTHER_SECTION
      ? readOtherFindings(cl)
      : readFindings(cl, op.section, op.checkId)
    if (existing.some((f) => f.id === op.finding.id)) return

    const path = op.section === OTHER_SECTION
      ? [OTHER_SECTION, 'findings']
      : [op.section, op.checkId]
    const value = op.section === OTHER_SECTION
      ? [...existing, op.finding]
      : { ...(readCheck(cl, op.section, op.checkId) || {}), status: 'fail',
          findings: [...existing.filter((f) => !f.legacy), op.finding] }
    await patchRemote(op.inspectionId, path, value)
  },
  async updateFinding(op) {
    const cl = await fetchChecklist(op.inspectionId)
    await updateFinding(op.inspectionId, cl, op.section, op.checkId, op.findingId, op.patch)
  },
  async removeFinding(op) {
    const cl = await fetchChecklist(op.inspectionId)
    await removeFinding(op.inspectionId, cl, op.section, op.checkId, op.findingId)
  },
  async addDamage(op) {
    const cl = await fetchChecklist(op.inspectionId)
    const entry = cl?.[op.section]?.[op.panelId] || {}
    const damages = Array.isArray(entry.damages) ? entry.damages : []
    if (damages.some((d) => d.id === op.damage.id)) return
    await patchRemote(op.inspectionId, [op.section, op.panelId],
      { ...entry, damages: [...damages, op.damage] })
  },
}

async function fetchChecklist(inspectionId) {
  const { data, error } = await supabase
    .from('inspections').select('checklist').eq('id', inspectionId).single()
  if (error) throw error
  return data?.checklist || {}
}

// Photos and voice notes both land in inspection-photos under the inspection's
// own folder, next to the damage pictures the exterior flow already writes.
// One bucket, one set of policies, one place to look when a car is questioned.
export async function uploadMedia(inspectionId, checkId, file, ext) {
  const uid = Math.random().toString(36).slice(2, 14)
  const path = `${inspectionId}/damage/${checkId || 'other'}-${uid}.${ext}`
  const { error } = await supabase.storage
    .from('inspection-photos').upload(path, file, { contentType: file.type || undefined })
  if (error) throw error
  const { data: { publicUrl } } = supabase.storage.from('inspection-photos').getPublicUrl(path)
  return { url: publicUrl, path }
}

// ---------------------------------------------------------------- damage

// Body and interior damage, written where the damage diagrams write it.
//
// This matters more than it looks: the work order router counts
// checklist.exterior / checklist.interior to decide whether to open a BODY SHOP
// ticket, and reads findings to decide whether to open a MECHANIC job. Damage
// recorded as a finding would send a dented door to the mechanic — the right
// information to the wrong shop, which is worse than not recording it, because
// somebody acts on it.
//
// The agent speaks a panel in whatever words the inspector used, so the name is
// matched against the real panel list rather than trusted. An unmatched panel is
// kept with its spoken name instead of being dropped; a body shop ticket with a
// slightly odd panel label is still a ticket, and losing the damage is the only
// unacceptable outcome.
export function matchPanel(area, spoken, panels, zones) {
  const raw = String(spoken || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
  if (!raw) return null

  const candidates = area === 'interior'
    ? (zones || []).flatMap((c) => c.zones.map((z) => [z.id, z.label]))
    : Object.entries(panels || {}).map(([id, p]) => [id, p.label])

  for (const [id] of candidates) if (id === raw) return id
  for (const [id, label] of candidates) {
    if (String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_') === raw) return id
  }
  // "driver door" -> driver_front_door, "left quarter panel" -> left_quarter
  const words = raw.split('_').filter(Boolean)
  let best = null, bestScore = 0
  for (const [id, label] of candidates) {
    const hay = `${id}_${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
    const score = words.filter((w) => w.length > 2 && hay.includes(w)).length
    if (score > bestScore) { best = id; bestScore = score }
  }
  return bestScore >= 1 ? best : null
}

export async function addDamage(inspectionId, checklist, area, panelId, damage) {
  const section = area === 'interior' ? 'interior' : 'exterior'
  const entry = checklist?.[section]?.[panelId] || {}
  const damages = Array.isArray(entry.damages) ? entry.damages : []
  const next = {
    id: newId(),
    type: damage.type || 'Other',
    size: damage.size || '',
    note: damage.note || '',
    count: '',
    photos: [],
    at: new Date().toISOString(),
  }
  return patch(inspectionId, [section, panelId], { ...entry, damages: [...damages, next] },
    { checklist, intent: { kind: 'addDamage', section, panelId, damage: next } })
}
