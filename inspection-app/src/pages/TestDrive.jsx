import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { supabase } from '../services/supabase'
import { TEST_DRIVE_ITEMS } from '../services/inspectionFlow'
import { markTrackComplete, markTrackStarted } from '../services/tracks'

export default function TestDrive() {
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
      markTrackStarted(id, 'drive')
    }
    load()
  }, [id])

  async function persistChecklist(next) {
    setSaving(true)
    const { error } = await supabase
      .from('inspections')
      .update({ checklist: next })
      .eq('id', id)
    setSaving(false)
    if (error) {
      console.error('[TestDrive] save failed:', error)
      alert('Save failed — please retry. ' + error.message)
      throw error
    }
  }

  // Uses functional setState so rapid-fire taps don't overwrite each other.
  // Each call reads the latest prev and merges, then persists the merged result.
  function setStatus(itemId, status) {
    let toSave
    setInspection((prev) => {
      const next = {
        ...(prev?.checklist || {}),
        test_drive: {
          ...(prev?.checklist?.test_drive || {}),
          [itemId]: { ...(prev?.checklist?.test_drive?.[itemId] || {}), status },
        },
      }
      toSave = next
      return { ...prev, checklist: next }
    })
    persistChecklist(toSave).catch(() => {})
  }

  function setNote(itemId, note) {
    let toSave
    setInspection((prev) => {
      const next = {
        ...(prev?.checklist || {}),
        test_drive: {
          ...(prev?.checklist?.test_drive || {}),
          [itemId]: { ...(prev?.checklist?.test_drive?.[itemId] || {}), note },
        },
      }
      toSave = next
      return { ...prev, checklist: next }
    })
    if (noteTimer.current) clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => {
      persistChecklist(toSave).catch(() => {})
    }, 500)
  }

  function markAllGood() {
    let toSave
    setInspection((prev) => {
      const td = { ...(prev?.checklist?.test_drive || {}) }
      TEST_DRIVE_ITEMS.forEach((item) => {
        td[item.id] = { ...(td[item.id] || {}), status: 'pass' }
      })
      const next = { ...(prev?.checklist || {}), test_drive: td }
      toSave = next
      return { ...prev, checklist: next }
    })
    persistChecklist(toSave).catch(() => {})
  }

  function getProgress() {
    if (!inspection?.checklist?.test_drive) return { done: 0, total: 0 }
    const td = inspection.checklist.test_drive
    const done = TEST_DRIVE_ITEMS.filter((item) => td[item.id]?.status === 'pass' || td[item.id]?.status === 'fail').length
    return { done, total: TEST_DRIVE_ITEMS.length }
  }

  async function handleNext() {
    const result = await markTrackComplete(id, 'drive')
    if (result?.error) {
      alert('Save failed: ' + result.error.message)
      return
    }
    navigate('/inspections', {
      state: result.inspectionCompleted
        ? { justCompleted: result.vinLast6 || '' }
        : { trackDone: 'Test Drive' },
    })
  }

  if (loading) return <div className="page text-center text-slate-400 pt-20">Loading...</div>
  if (!inspection) return <div className="page text-center text-red-400 pt-20">Not found</div>

  const testDrive = inspection.checklist?.test_drive || {}
  const progress = getProgress()

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-emerald-400">Test Drive</h1>
          <p className="text-sm text-slate-400">VIN ...{inspection.vin_last6 || inspection.vin?.slice(-6)}</p>
        </div>
        <span className={`text-xs font-bold ${saving ? 'text-yellow-400' : 'text-emerald-400'}`}>
          {saving ? 'Saving...' : `${progress.done}/${progress.total}`}
        </span>
      </div>

      {/* All Good shortcut */}
      <button
        onClick={markAllGood}
        className="w-full mb-4 py-2.5 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-sm flex items-center justify-center gap-2 active:bg-emerald-500/40"
      >
        <Check size={14} /> All Good - No Issues
      </button>

      <div className="space-y-4">
        {TEST_DRIVE_ITEMS.map((item) => {
          const data = testDrive[item.id] || { status: null, note: '' }
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
      </div>

      <div className="mt-6">
        <button onClick={handleNext} className="btn-primary flex items-center justify-center gap-2 text-lg">
          Mark Test Drive Done <ArrowRight size={20} />
        </button>
      </div>
    </div>
  )
}
