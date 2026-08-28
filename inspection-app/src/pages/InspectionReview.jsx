import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, CheckCircle, AlertTriangle, Camera, ChevronDown
} from 'lucide-react'
import { supabase } from '../services/supabase'
import {
  STARTUP_ITEMS, KEY_FOBS_ITEM, EXTERIOR_PANELS, INTERIOR_ZONES,
  TEST_DRIVE_ITEMS, REQUIRED_PHOTOS, allTracksComplete
} from '../services/inspectionFlow'
import { readFindings, readOtherFindings, severityLabel } from '../services/mechanicalFindings'

// Flatten a section's checks into one row per finding. readFindings() also
// converts legacy {status, note} rows into a single finding, so an inspection
// finished before the rewrite still reads the same way here.
function readFindings2(checklist, checks, section) {
  return checks.flatMap((c) =>
    readFindings(checklist, section, c.id).map((f) => ({
      label: c.label,
      note: f.description,
      severity: f.severity,
      photos: f.photos || [],
    })))
}

export default function InspectionReview() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [inspection, setInspection] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('inspections').select('*').eq('id', id).single()
      setInspection(data)
      setLoading(false)
    }
    load()
  }, [id])

  async function markComplete() {
    // Verify all tracks are done before allowing completion
    const { data: fresh } = await supabase.from('inspections').select('checklist').eq('id', id).single()
    if (fresh && !allTracksComplete(fresh.checklist)) {
      alert('Not all inspection tracks are complete. Please finish all sections first.')
      return
    }
    await supabase
      .from('inspections')
      .update({ status: 'complete', completed_at: new Date().toISOString(), current_step: 'complete' })
      .eq('id', id)
    setInspection((prev) => ({ ...prev, status: 'complete' }))
  }

  if (loading) return <div className="page text-center text-slate-400 pt-20">Loading...</div>
  if (!inspection) return <div className="page text-center text-red-400 pt-20">Not found</div>

  const cl = inspection.checklist || {}

  // ── Startup summary ──
  //
  // One row per FINDING, not per failed check. A check now holds a list, so
  // summarising by check would hide exactly what this screen exists to show —
  // and this is the last place anyone looks before the car goes to the shop.
  const startup = cl.startup || {}
  const startupIssues = readFindings2(cl, STARTUP_ITEMS, 'startup')
  const keyFobsCount = startup[KEY_FOBS_ITEM.id]?.value || ''
  const otherIssues = readOtherFindings(cl).map((f) => ({
    label: 'Anything else', note: f.description, severity: f.severity,
  }))

  // ── Exterior summary ──
  const exterior = cl.exterior || {}
  let extDamageCount = 0
  const extDamages = []
  Object.entries(exterior).forEach(([panelId, panel]) => {
    if (panel.damages?.length > 0) {
      extDamageCount += panel.damages.length
      extDamages.push({
        panel: EXTERIOR_PANELS[panelId]?.label || panelId,
        damages: panel.damages,
      })
    }
  })

  // ── Interior summary ──
  const interior = cl.interior || {}
  let intDamageCount = 0
  const intDamages = []
  Object.entries(interior).forEach(([zoneId, zone]) => {
    if (zone.damages?.length > 0) {
      intDamageCount += zone.damages.length
      let label = zoneId
      for (const cat of INTERIOR_ZONES) {
        const z = cat.zones.find((z) => z.id === zoneId)
        if (z) { label = z.label; break }
      }
      intDamages.push({ zone: label, damages: zone.damages })
    }
  })

  // ── Test drive summary ──
  const driveIssues = readFindings2(cl, TEST_DRIVE_ITEMS, 'test_drive')

  // ── Photos summary ──
  const photos = cl.photos || {}
  const photosTaken = REQUIRED_PHOTOS.filter((p) => photos[p.id]?.url).length

  const totalIssues = startupIssues.length + extDamageCount + intDamageCount
    + driveIssues.length + otherIssues.length
  const isComplete = inspection.status === 'complete'

  const sections = [
    {
      key: 'startup',
      title: 'Startup Check',
      status: startupIssues.length > 0 ? 'warn' : 'pass',
      summary: startupIssues.length > 0
        ? `${startupIssues.length} issue${startupIssues.length !== 1 ? 's' : ''} found`
        : 'All clear',
      editPath: `/inspect/${id}/startup`,
    },
    {
      key: 'exterior',
      title: 'Exterior Damage',
      status: extDamageCount > 0 ? 'warn' : 'pass',
      summary: extDamageCount > 0
        ? `${extDamageCount} damage${extDamageCount !== 1 ? 's' : ''} on ${extDamages.length} panel${extDamages.length !== 1 ? 's' : ''}`
        : 'No damage found',
      editPath: `/inspect/${id}/exterior`,
    },
    {
      key: 'interior',
      title: 'Interior Damage',
      status: intDamageCount > 0 ? 'warn' : 'pass',
      summary: intDamageCount > 0
        ? `${intDamageCount} damage${intDamageCount !== 1 ? 's' : ''} in ${intDamages.length} zone${intDamages.length !== 1 ? 's' : ''}`
        : 'No damage found',
      editPath: `/inspect/${id}/interior`,
    },
    {
      key: 'testdrive',
      title: 'Test Drive',
      status: driveIssues.length > 0 ? 'warn' : 'pass',
      summary: driveIssues.length > 0
        ? `${driveIssues.length} issue${driveIssues.length !== 1 ? 's' : ''} found`
        : 'All clear',
      editPath: `/inspect/${id}/testdrive`,
    },
    {
      key: 'photos',
      title: 'Photos',
      status: photosTaken === REQUIRED_PHOTOS.length ? 'pass' : photosTaken > 0 ? 'partial' : 'warn',
      summary: `${photosTaken}/${REQUIRED_PHOTOS.length} photos taken`,
      editPath: `/inspect/${id}/photos`,
    },
  ]

  return (
    <div className="page">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-emerald-400">Inspection Review</h1>
          <p className="text-sm text-slate-400">
            VIN ...{inspection.vin_last6 || inspection.vin?.slice(-6)} &middot;{' '}
            {inspection.mileage?.toLocaleString()} mi
          </p>
        </div>
      </div>

      {/* Overall status */}
      <div className={`card mb-4 text-center py-4 ${isComplete ? 'bg-emerald-500/10 border-emerald-500/30' : ''}`}>
        {isComplete ? (
          <>
            <CheckCircle size={40} className="mx-auto text-emerald-400 mb-2" />
            <p className="text-lg font-bold text-emerald-400">Inspection Complete</p>
            <p className="text-xs text-slate-400 mt-1">
              {new Date(inspection.completed_at).toLocaleString()}
            </p>
          </>
        ) : (
          <>
            <p className="text-3xl font-bold text-white">{totalIssues}</p>
            <p className="text-sm text-slate-400">
              {totalIssues === 0 ? 'No issues found' : `Total Issue${totalIssues !== 1 ? 's' : ''} Found`}
            </p>
          </>
        )}
      </div>

      {/* Section summaries */}
      <div className="space-y-2 mb-6">
        {sections.map((section) => {
          const isExpanded = expanded === section.key

          return (
            <div key={section.key} className="card p-0 overflow-hidden">
              <div className="flex items-center">
                <button
                  className="flex-1 flex items-center gap-3 p-3 text-left"
                  onClick={() => setExpanded(isExpanded ? null : section.key)}
                >
                  <div
                    className={`p-2 rounded-lg ${
                      section.status === 'pass'
                        ? 'bg-emerald-500/20'
                        : section.status === 'partial'
                          ? 'bg-yellow-500/20'
                          : 'bg-red-500/20'
                    }`}
                  >
                    {section.status === 'pass' ? (
                      <CheckCircle size={18} className="text-emerald-400" />
                    ) : section.status === 'partial' ? (
                      <AlertTriangle size={18} className="text-yellow-400" />
                    ) : (
                      <AlertTriangle size={18} className="text-red-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-white">{section.title}</p>
                    <p className={`text-xs ${
                      section.status === 'pass' ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {section.summary}
                    </p>
                  </div>
                  <ChevronDown
                    size={16}
                    className={`text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  />
                </button>
                {!isComplete && (
                  <button
                    onClick={() => navigate(section.editPath)}
                    className="px-3 py-1 mr-2 text-xs text-emerald-400 bg-emerald-500/10 rounded-lg font-semibold"
                  >
                    Edit
                  </button>
                )}
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="border-t border-slate-700 p-3">
                  {section.key === 'startup' && (
                    <div className="space-y-1">
                      {startupIssues.length > 0 ? (
                        startupIssues.map((issue, i) => <IssueRow key={i} issue={issue} />)
                      ) : (
                        <p className="text-xs text-emerald-400">All startup checks passed.</p>
                      )}
                      {otherIssues.length > 0 && (
                        <div className="pt-2 mt-1 border-t border-slate-800 space-y-1">
                          <p className="text-[10px] uppercase tracking-wide text-slate-500">Anything else</p>
                          {otherIssues.map((issue, i) => <IssueRow key={i} issue={issue} />)}
                        </div>
                      )}
                      {keyFobsCount !== '' && (
                        <p className="text-xs text-slate-400 pt-1">Key fobs on hand: <span className="text-white font-semibold">{keyFobsCount}</span></p>
                      )}
                    </div>
                  )}

                  {section.key === 'exterior' && (
                    extDamages.length > 0 ? (
                      <div className="space-y-2">
                        {extDamages.map((ed, i) => (
                          <div key={i}>
                            <p className="text-xs font-bold text-white">{ed.panel}</p>
                            {ed.damages.map((d, j) => {
                              const pics = d.photos?.length ? d.photos : (d.photo_url ? [{ url: d.photo_url }] : [])
                              return (
                                <div key={j} className="text-xs text-slate-400 ml-2 flex gap-2 items-center mt-0.5">
                                  <span className="text-red-400">{d.type}</span>
                                  {d.size && <span>({d.size}{d.size === 'Multiple' && d.count ? `×${d.count}` : ''})</span>}
                                  {pics.slice(0, 3).map((p, k) => (
                                    <img key={k} src={p.url} className="w-6 h-6 rounded object-cover" alt="" />
                                  ))}
                                  {pics.length > 3 && <span className="text-[10px]">+{pics.length - 3}</span>}
                                </div>
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-emerald-400">No exterior damage found.</p>
                    )
                  )}

                  {section.key === 'interior' && (
                    intDamages.length > 0 ? (
                      <div className="space-y-2">
                        {intDamages.map((id_data, i) => (
                          <div key={i}>
                            <p className="text-xs font-bold text-white">{id_data.zone}</p>
                            {id_data.damages.map((d, j) => {
                              const pics = d.photos?.length ? d.photos : (d.photo_url ? [{ url: d.photo_url }] : [])
                              return (
                                <div key={j} className="text-xs text-slate-400 ml-2 flex gap-2 items-center mt-0.5">
                                  <span className="text-red-400">{d.type}</span>
                                  {d.size && <span>({d.size}{d.size === 'Multiple' && d.count ? `×${d.count}` : ''})</span>}
                                  {pics.slice(0, 3).map((p, k) => (
                                    <img key={k} src={p.url} className="w-6 h-6 rounded object-cover" alt="" />
                                  ))}
                                  {pics.length > 3 && <span className="text-[10px]">+{pics.length - 3}</span>}
                                </div>
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-emerald-400">No interior damage found.</p>
                    )
                  )}

                  {section.key === 'testdrive' && (
                    driveIssues.length > 0 ? (
                      <div className="space-y-1">
                        {driveIssues.map((issue, i) => <IssueRow key={i} issue={issue} />)}
                      </div>
                    ) : (
                      <p className="text-xs text-emerald-400">No test drive issues.</p>
                    )
                  )}

                  {section.key === 'photos' && (
                    <div className="grid grid-cols-4 gap-1">
                      {REQUIRED_PHOTOS.map((p) => {
                        const data = photos[p.id]
                        return data?.url ? (
                          <div key={p.id} className="aspect-square rounded overflow-hidden">
                            <img src={data.url} className="w-full h-full object-cover" alt={p.label} />
                          </div>
                        ) : (
                          <div
                            key={p.id}
                            className="aspect-square rounded bg-slate-700 flex items-center justify-center"
                          >
                            <Camera size={12} className="text-slate-500" />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Complete button */}
      {!isComplete && (
        <button
          onClick={markComplete}
          className="btn-primary flex items-center justify-center gap-2 text-lg"
        >
          <CheckCircle size={20} />
          Complete Inspection
        </button>
      )}

      {isComplete && (
        <button onClick={() => navigate('/')} className="btn-secondary">
          Back to Dashboard
        </button>
      )}
    </div>
  )
}

// One finding. The severity is the inspector's own call, made with the car in
// front of him — it rides through to the mechanic's board, so it belongs on the
// screen where he signs the inspection off.
const SEVERITY_TONE = {
  critical: 'bg-red-500/20 text-red-300 border border-red-500/40',
  severe:   'bg-orange-500/20 text-orange-300 border border-orange-500/40',
  moderate: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40',
  minor:    'bg-slate-700 text-slate-300',
}

function IssueRow({ issue }) {
  return (
    <div className="text-xs flex gap-2 items-center flex-wrap">
      <span className="text-red-400 font-semibold">{issue.label}</span>
      {issue.note && <span className="text-slate-300">{issue.note}</span>}
      {issue.severity && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
          SEVERITY_TONE[issue.severity] || SEVERITY_TONE.moderate}`}>
          {severityLabel(issue.severity)}
        </span>
      )}
      {issue.photos?.length > 0 && (
        <span className="text-[10px] text-emerald-400">📷 {issue.photos.length}</span>
      )}
    </div>
  )
}
