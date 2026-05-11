import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { supabase } from '../services/supabase'
import { EXTERIOR_PANELS, DAMAGE_TYPES, DAMAGE_SIZES } from '../services/inspectionFlow'
import { markTrackStarted } from '../services/tracks'
import ConditionTabs from '../components/ConditionTabs'
import CarDiagram from '../components/CarDiagram'
import DamageModal from '../components/DamageModal'

export default function ExteriorDamage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [inspection, setInspection] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedPanel, setSelectedPanel] = useState(null)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('inspections').select('*').eq('id', id).single()
      setInspection(data)
      setLoading(false)
      markTrackStarted(id, 'condition')
    }
    load()
  }, [id])

  function handlePanelTap(panelId) {
    setSelectedPanel(panelId)
  }

  async function handleSaveDamage(panelId, damages) {
    // Re-read fresh state to avoid racing with other saves
    const { data: fresh, error: loadErr } = await supabase
      .from('inspections')
      .select('checklist')
      .eq('id', id)
      .single()
    if (loadErr || !fresh) {
      console.error('[ExteriorDamage] reload failed:', loadErr)
      alert('Save failed — please retry. Error: ' + (loadErr?.message || 'unknown'))
      return
    }
    const nextChecklist = { ...(fresh.checklist || {}) }
    nextChecklist.exterior = { ...(nextChecklist.exterior || {}) }
    nextChecklist.exterior[panelId] = { damages }

    const { error: updateErr } = await supabase
      .from('inspections')
      .update({ checklist: nextChecklist })
      .eq('id', id)
    if (updateErr) {
      console.error('[ExteriorDamage] save failed:', updateErr)
      alert('Save failed — please retry. Error: ' + updateErr.message)
      return
    }

    setInspection((prev) => ({ ...prev, checklist: nextChecklist }))
    setSelectedPanel(null)
  }

  function getDamageSummary() {
    const ext = inspection?.checklist?.exterior || {}
    let totalDamages = 0
    let panelsWithDamage = 0
    Object.values(ext).forEach((panel) => {
      if (panel.damages?.length > 0) {
        panelsWithDamage++
        totalDamages += panel.damages.length
      }
    })
    return { totalDamages, panelsWithDamage }
  }

  async function handleNext() {
    await supabase.from('inspections').update({ current_step: 'interior' }).eq('id', id)
    navigate(`/inspect/${id}/interior`)
  }

  if (loading) return <div className="page text-center text-slate-400 pt-20">Loading...</div>
  if (!inspection) return <div className="page text-center text-red-400 pt-20">Not found</div>

  const summary = getDamageSummary()
  const exterior = inspection.checklist?.exterior || {}

  return (
    <div className="page">
      <ConditionTabs inspectionId={id} current="exterior" checklist={inspection.checklist} />

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-emerald-400">Exterior Walk-Around</h1>
          <p className="text-sm text-slate-400">VIN ...{inspection.vin_last6 || inspection.vin?.slice(-6)}</p>
        </div>
      </div>

      {/* Summary - only show if there's damage */}
      {summary.totalDamages > 0 && (
        <div className="flex gap-3 mb-4">
          <div className="flex-1 card text-center py-2">
            <p className="text-xl font-bold text-red-400">{summary.totalDamages}</p>
            <p className="text-xs text-slate-500">Damages</p>
          </div>
          <div className="flex-1 card text-center py-2">
            <p className="text-xl font-bold text-amber-400">{summary.panelsWithDamage}</p>
            <p className="text-xs text-slate-500">Panels</p>
          </div>
        </div>
      )}

      {/* Car Diagram */}
      <CarDiagram damages={exterior} onPanelTap={handlePanelTap} />

      {/* Damage list below diagram */}
      {summary.totalDamages > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-bold text-white mb-2">Recorded Damages</h3>
          <div className="space-y-2">
            {Object.entries(exterior).map(([panelId, panel]) => {
              if (!panel.damages?.length) return null
              const panelInfo = EXTERIOR_PANELS[panelId]
              return (
                <button
                  key={panelId}
                  onClick={() => setSelectedPanel(panelId)}
                  className="w-full card flex items-center gap-3 text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center text-sm font-bold">
                    {panel.damages.length}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-white">{panelInfo?.label || panelId}</p>
                    <p className="text-xs text-slate-400">
                      {panel.damages.map((d) => d.type).join(', ')}
                    </p>
                  </div>
                  {panel.damages.some((d) => (d.photos?.length || 0) > 0 || d.photo_url) && (
                    <div className="flex -space-x-2">
                      {panel.damages
                        .flatMap((d) => d.photos?.length ? d.photos : (d.photo_url ? [{ url: d.photo_url }] : []))
                        .slice(0, 3)
                        .map((p, i) => (
                          <div key={i} className="w-8 h-8 rounded-full border-2 border-slate-800 overflow-hidden">
                            <img src={p.url} className="w-full h-full object-cover" alt="" />
                          </div>
                        ))}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Next button */}
      <div className="mt-6">
        <button onClick={handleNext} className="btn-primary flex items-center justify-center gap-2 text-lg">
          Next: Interior Inspection <ArrowRight size={20} />
        </button>
      </div>

      {/* Damage Modal */}
      {selectedPanel && (
        <DamageModal
          panelId={selectedPanel}
          panelLabel={EXTERIOR_PANELS[selectedPanel]?.label || selectedPanel}
          damages={exterior[selectedPanel]?.damages || []}
          damageTypes={DAMAGE_TYPES}
          damageSizes={DAMAGE_SIZES}
          inspectionId={id}
          onSave={handleSaveDamage}
          onClose={() => setSelectedPanel(null)}
        />
      )}
    </div>
  )
}
