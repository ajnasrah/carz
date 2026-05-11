import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { supabase } from '../services/supabase'
import { STARTUP_ITEMS, KEY_FOBS_ITEM } from '../services/inspectionFlow'
import { markTrackComplete, markTrackStarted } from '../services/tracks'

export default function StartupCheck() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [inspection, setInspection] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const noteTimer = useRef(null)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('inspections').select('*').eq('id', id).single()
      setInspection(data)
      setLoading(false)
      markTrackStarted(id, 'quick')
    }
    load()
  }, [id])

  async function saveChecklist(updated) {
    setSaving(true)
    await supabase.from('inspections').update({ checklist: updated }).eq('id', id)
    setSaving(false)
  }

  function setStatus(itemId, status) {
    let toSave
    setInspection((prev) => {
      const updated = { ...prev.checklist }
      updated.startup = { ...updated.startup }
      updated.startup[itemId] = { ...updated.startup[itemId], status }
      toSave = updated
      return { ...prev, checklist: updated }
    })
    saveChecklist(toSave)
  }

  function setNote(itemId, note) {
    let toSave
    setInspection((prev) => {
      const updated = { ...prev.checklist }
      updated.startup = { ...updated.startup }
      updated.startup[itemId] = { ...updated.startup[itemId], note }
      toSave = updated
      return { ...prev, checklist: updated }
    })
    if (noteTimer.current) clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => saveChecklist(toSave), 500)
  }

  function setKeyFobs(value) {
    let toSave
    setInspection((prev) => {
      const updated = { ...prev.checklist }
      updated.startup = { ...updated.startup }
      updated.startup[KEY_FOBS_ITEM.id] = { value }
      toSave = updated
      return { ...prev, checklist: updated }
    })
    if (noteTimer.current) clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => saveChecklist(toSave), 500)
  }

  function markAllGood() {
    let toSave
    setInspection((prev) => {
      const updated = { ...prev.checklist }
      updated.startup = { ...updated.startup }
      STARTUP_ITEMS.forEach((item) => {
        updated.startup[item.id] = { ...updated.startup[item.id], status: 'pass' }
      })
      toSave = updated
      return { ...prev, checklist: updated }
    })
    saveChecklist(toSave)
  }

  function getProgress() {
    const startup = inspection?.checklist?.startup || {}
    const done = STARTUP_ITEMS.filter((i) => startup[i.id]?.status === 'pass' || startup[i.id]?.status === 'fail').length
    return { done, total: STARTUP_ITEMS.length }
  }

  async function handleNext() {
    const result = await markTrackComplete(id, 'quick')
    if (result?.error) {
      alert('Save failed: ' + result.error.message)
      return
    }
    navigate('/inspections', {
      state: result.inspectionCompleted
        ? { justCompleted: result.vinLast6 || '' }
        : { trackDone: 'Quick Check' },
    })
  }

  if (loading) return <div className="page text-center text-slate-400 pt-20">Loading...</div>
  if (!inspection) return <div className="page text-center text-red-400 pt-20">Not found</div>

  const progress = getProgress()
  const startup = inspection.checklist?.startup || {}
  const keyFobs = startup[KEY_FOBS_ITEM.id]?.value || ''

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-emerald-400">Startup Check</h1>
          <p className="text-sm text-slate-400">VIN ...{inspection.vin_last6 || inspection.vin?.slice(-6)}</p>
        </div>
        <span className={`text-xs font-bold ${saving ? 'text-yellow-400' : 'text-emerald-400'}`}>
          {saving ? 'Saving...' : `${progress.done}/${progress.total}`}
        </span>
      </div>

      <button
        onClick={markAllGood}
        className="w-full mb-4 py-2.5 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-sm flex items-center justify-center gap-2 active:bg-emerald-500/40"
      >
        <Check size={14} /> All Good - No Issues
      </button>

      <div className="space-y-4">
        {STARTUP_ITEMS.map((item) => {
          const data = startup[item.id] || { status: null, note: '' }
          return (
            <div key={item.id} className="border-b border-slate-800 pb-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{item.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-snug">{item.parts}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => setStatus(item.id, 'pass')}
                    className={`w-11 h-11 rounded-lg flex items-center justify-center transition-colors ${
                      data.status === 'pass' ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-500 active:bg-emerald-500/30'
                    }`}
                  >
                    <Check size={16} />
                  </button>
                  <button
                    onClick={() => setStatus(item.id, 'fail')}
                    className={`w-11 h-11 rounded-lg flex items-center justify-center transition-colors ${
                      data.status === 'fail' ? 'bg-red-500 text-white' : 'bg-slate-800 text-slate-500 active:bg-red-500/30'
                    }`}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              {data.status === 'fail' && (
                <input
                  type="text"
                  placeholder={item.failNote}
                  value={data.note || ''}
                  onChange={(e) => setNote(item.id, e.target.value)}
                  className="text-sm py-2 mt-2 border-red-500/50"
                />
              )}
            </div>
          )
        })}

        <div className="flex items-center gap-3 pt-1">
          <span className="flex-1 text-sm text-white font-semibold">{KEY_FOBS_ITEM.label}</span>
          <input
            type="text"
            inputMode="numeric"
            value={keyFobs}
            onChange={(e) => setKeyFobs(e.target.value.replace(/\D/g, '').slice(0, 2))}
            placeholder="#"
            className="w-16 text-center text-base py-2 px-2"
          />
        </div>
      </div>

      <div className="mt-6">
        <button onClick={handleNext} className="btn-primary flex items-center justify-center gap-2 text-lg">
          Mark Quick Check Done <ArrowRight size={20} />
        </button>
      </div>
    </div>
  )
}
