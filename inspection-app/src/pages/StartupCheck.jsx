// Quick Check — what the car tells you before it moves.
//
// Same rewrite as the test drive: each check now holds a list of findings
// instead of one pass/fail and one line of text. "Accessories" alone covers
// fourteen separate things; asking an inspector to fit a dead radio, a broken
// window switch and a blown speaker into one sentence is how two of the three
// stopped reaching the shop.

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { supabase } from '../services/supabase'
import { STARTUP_ITEMS, KEY_FOBS_ITEM } from '../services/inspectionFlow'
import { markTrackComplete, markTrackStarted } from '../services/tracks'
import MechanicalChecks from '../components/MechanicalChecks'
import {
  isAnswered, unansweredChecks, readFindings, readOtherFindings, setCheckStatus,
} from '../services/mechanicalFindings'

const CHECKS = STARTUP_ITEMS.map((c) => ({ ...c, section: 'startup' }))

export default function StartupCheck() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [inspection, setInspection] = useState(null)
  const [loading, setLoading] = useState(true)
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('inspections').select('*').eq('id', id).single()
      setInspection(data)
      setLoading(false)
      markTrackStarted(id, 'quick')
    }
    load()
  }, [id])

  const onChange = useCallback((checklist) => {
    setInspection((prev) => ({ ...prev, checklist }))
  }, [])

  const checklist = inspection?.checklist || {}
  const answered = CHECKS.filter((c) => isAnswered(checklist, 'startup', c.id)).length
  const missing = unansweredChecks(checklist, CHECKS)
  const findingCount =
    CHECKS.reduce((n, c) => n + readFindings(checklist, 'startup', c.id).length, 0) +
    readOtherFindings(checklist).length
  const keyFobs = checklist.startup?.[KEY_FOBS_ITEM.id]?.value || ''

  // Key fob count is a plain value on the startup branch, not a finding — it is
  // an inventory fact, not something to repair.
  async function setKeyFobs(value) {
    const { data, error } = await supabase.rpc('patch_inspection_checklist', {
      p_inspection_id: id,
      p_path: ['startup', KEY_FOBS_ITEM.id],
      p_value: { value },
    })
    if (!error && data) onChange(data)
  }

  async function markRestGood() {
    let next = checklist
    for (const c of missing) {
      next = await setCheckStatus(id, next, 'startup', c.id, 'pass')
    }
    onChange(next)
  }

  async function handleNext() {
    if (missing.length > 0) {
      const ok = window.confirm(
        `${missing.length} check${missing.length === 1 ? '' : 's'} not answered:\n\n` +
        missing.map((c) => `• ${c.label}`).join('\n') +
        '\n\nAn unanswered check is not the same as a good one. Finish anyway?'
      )
      if (!ok) return
    }
    setFinishing(true)
    const result = await markTrackComplete(id, 'quick')
    if (result?.error) {
      setFinishing(false)
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

  return (
    <div className="page pb-24">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/')} aria-label="Back"
          className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-amber-400">Quick Check</h1>
          <p className="text-sm text-slate-400">
            VIN ...{inspection.vin_last6 || inspection.vin?.slice(-6)}
          </p>
        </div>
        <span className="text-xs font-bold text-slate-400 tabular-nums">
          {answered}/{CHECKS.length}
        </span>
      </div>

      <p className="text-[11px] text-slate-500 mb-3 leading-snug">
        Tap everything that's wrong. Each tap is its own job for the shop.
      </p>

      {findingCount > 0 && (
        <div className="mb-3 p-2.5 rounded-xl bg-red-500/10 border border-red-500/40 text-[11px] text-red-300">
          {findingCount} {findingCount === 1 ? 'problem' : 'problems'} recorded so far.
        </div>
      )}

      <MechanicalChecks
        inspectionId={id}
        checklist={checklist}
        checks={CHECKS}
        section="startup"
        onChange={onChange}
      />

      <div className="flex items-center gap-3 mt-3 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
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

      {missing.length > 0 && (
        <button onClick={markRestGood}
          className="w-full mt-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 font-semibold text-sm flex items-center justify-center gap-2 active:bg-slate-700">
          <Check size={14} /> Rest of it was fine ({missing.length})
        </button>
      )}

      <div className="mt-4">
        <button onClick={handleNext} disabled={finishing}
          className="btn-primary flex items-center justify-center gap-2 text-lg">
          {finishing ? 'Saving…' : 'Mark Quick Check Done'} <ArrowRight size={20} />
        </button>
      </div>
    </div>
  )
}
