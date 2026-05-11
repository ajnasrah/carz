import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight,
  LayoutDashboard, Circle, Smartphone, Armchair,
  PanelLeft, PanelRight, Archive, ArrowUpFromLine,
  Square, Layers, SunDim, Package
} from 'lucide-react'
import { supabase } from '../services/supabase'
import { INTERIOR_ZONES, INTERIOR_DAMAGE_TYPES, DAMAGE_SIZES } from '../services/inspectionFlow'
import { AlertTriangle } from 'lucide-react'
import ConditionTabs from '../components/ConditionTabs'
import DamageModal from '../components/DamageModal'

const ICON_MAP = {
  LayoutDashboard, Circle, Smartphone, Armchair,
  PanelLeft, PanelRight, Archive, ArrowUpFromLine,
  Square, Layers, SunDim, Package,
}

export default function InteriorDamage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [inspection, setInspection] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedZone, setSelectedZone] = useState(null)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('inspections').select('*').eq('id', id).single()
      setInspection(data)
      setLoading(false)
    }
    load()
  }, [id])

  async function handleSaveDamage(zoneId, damages) {
    const { data: fresh, error: loadErr } = await supabase
      .from('inspections')
      .select('checklist')
      .eq('id', id)
      .single()
    if (loadErr || !fresh) {
      console.error('[InteriorDamage] reload failed:', loadErr)
      alert('Save failed — please retry. Error: ' + (loadErr?.message || 'unknown'))
      return
    }
    const nextChecklist = { ...(fresh.checklist || {}) }
    nextChecklist.interior = { ...(nextChecklist.interior || {}) }
    nextChecklist.interior[zoneId] = { damages }

    const { error: updateErr } = await supabase
      .from('inspections')
      .update({ checklist: nextChecklist })
      .eq('id', id)
    if (updateErr) {
      console.error('[InteriorDamage] save failed:', updateErr)
      alert('Save failed — please retry. Error: ' + updateErr.message)
      return
    }

    setInspection((prev) => ({ ...prev, checklist: nextChecklist }))
    setSelectedZone(null)
  }

  async function toggleNeedsDetail() {
    const { data: fresh } = await supabase
      .from('inspections')
      .select('checklist')
      .eq('id', id)
      .single()
    const next = { ...(fresh?.checklist || {}) }
    next.interior_needs_detail = !next.interior_needs_detail
    const { error } = await supabase
      .from('inspections')
      .update({ checklist: next })
      .eq('id', id)
    if (error) {
      alert('Save failed: ' + error.message)
      return
    }
    setInspection((prev) => ({ ...prev, checklist: next }))
  }

  function getDamageSummary() {
    const int = inspection?.checklist?.interior || {}
    let totalDamages = 0
    let zonesWithDamage = 0
    Object.values(int).forEach((zone) => {
      if (zone.damages?.length > 0) {
        zonesWithDamage++
        totalDamages += zone.damages.length
      }
    })
    return { totalDamages, zonesWithDamage }
  }

  function getZoneLabel(zoneId) {
    for (const cat of INTERIOR_ZONES) {
      const z = cat.zones.find((z) => z.id === zoneId)
      if (z) return z.label
    }
    return zoneId
  }

  async function handleNext() {
    const needsDetail = inspection?.checklist?.interior_needs_detail
    const totalDamages = getDamageSummary().totalDamages
    if (needsDetail && totalDamages === 0) {
      const proceed = window.confirm(
        'You flagged this car as needing full interior detail but no zones are logged. Continue anyway?'
      )
      if (!proceed) return
    }
    await supabase.from('inspections').update({ current_step: 'photos' }).eq('id', id)
    navigate(`/inspect/${id}/photos`)
  }

  if (loading) return <div className="page text-center text-slate-400 pt-20">Loading...</div>
  if (!inspection) return <div className="page text-center text-red-400 pt-20">Not found</div>

  const interior = inspection.checklist?.interior || {}
  const summary = getDamageSummary()
  const needsDetail = !!inspection.checklist?.interior_needs_detail

  return (
    <div className="page">
      <ConditionTabs inspectionId={id} current="interior" checklist={inspection.checklist} />

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(`/inspect/${id}/exterior`)} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-emerald-400">Interior Inspection</h1>
          <p className="text-sm text-slate-400">VIN ...{inspection.vin_last6 || inspection.vin?.slice(-6)}</p>
        </div>
      </div>

      {/* Optional flag — only tap if the interior needs full detail for SA listing */}
      <button
        onClick={toggleNeedsDetail}
        className={`w-full mb-4 py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
          needsDetail
            ? 'bg-amber-500/20 text-amber-400 border-2 border-amber-500/50'
            : 'bg-slate-800 text-slate-400 border-2 border-slate-700 active:bg-slate-700'
        }`}
      >
        <AlertTriangle size={16} />
        {needsDetail ? 'Needs Full Interior Detail — tap zones below' : 'Interior Needs Full Detail (optional)'}
      </button>

      {/* Summary */}
      {summary.totalDamages > 0 && (
        <div className="flex gap-3 mb-4">
          <div className="flex-1 card text-center py-2">
            <p className="text-xl font-bold text-red-400">{summary.totalDamages}</p>
            <p className="text-xs text-slate-500">Interior Damages</p>
          </div>
          <div className="flex-1 card text-center py-2">
            <p className="text-xl font-bold text-amber-400">{summary.zonesWithDamage}</p>
            <p className="text-xs text-slate-500">Zones Affected</p>
          </div>
        </div>
      )}

      {/* Interior zone cards by category */}
      <div className="space-y-5">
        {INTERIOR_ZONES.map((category) => (
          <div key={category.category}>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              {category.category}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {category.zones.map((zone) => {
                const Icon = ICON_MAP[zone.icon] || Square
                const zoneData = interior[zone.id]
                const damageCount = zoneData?.damages?.length || 0
                const hasDamage = damageCount > 0

                return (
                  <button
                    key={zone.id}
                    onClick={() => setSelectedZone(zone.id)}
                    className={`relative p-4 rounded-xl border-2 text-left transition-all active:scale-[0.97] ${
                      hasDamage
                        ? 'border-red-500 bg-red-500/10'
                        : 'border-slate-700 bg-slate-800'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <Icon
                        size={24}
                        className={hasDamage ? 'text-red-400' : 'text-slate-500'}
                      />
                      {hasDamage && (
                        <span className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center text-xs font-bold">
                          {damageCount}
                        </span>
                      )}
                    </div>
                    <p className={`text-sm font-semibold mt-2 ${hasDamage ? 'text-red-300' : 'text-white'}`}>
                      {zone.label}
                    </p>
                    {hasDamage && (
                      <p className="text-[10px] text-red-400/70 mt-0.5 truncate">
                        {zoneData.damages.map((d) => d.type).join(', ')}
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Next button */}
      <div className="mt-6">
        <button onClick={handleNext} className="btn-primary flex items-center justify-center gap-2 text-lg">
          Next: Photos <ArrowRight size={20} />
        </button>
      </div>

      {/* Damage Modal */}
      {selectedZone && (
        <DamageModal
          panelId={selectedZone}
          panelLabel={getZoneLabel(selectedZone)}
          damages={interior[selectedZone]?.damages || []}
          damageTypes={INTERIOR_DAMAGE_TYPES}
          damageSizes={DAMAGE_SIZES}
          inspectionId={id}
          onSave={handleSaveDamage}
          onClose={() => setSelectedZone(null)}
        />
      )}
    </div>
  )
}
