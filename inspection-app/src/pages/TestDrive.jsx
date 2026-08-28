// Test Drive — eight checks, each holding as many findings as the car has.
//
// This used to be three questions with one single-line text box each. A car
// with a slipping transmission, a whining diff and a soft pedal had to fit into
// two sentences typed after the drive was over, which is where the findings
// were being lost — not to carelessness, but to being asked to reconstruct a
// list from memory at the end.
//
// Now every problem is one tap, taken the moment it is noticed, and each one
// arrives at the mechanic's board as its own line with its own severity.

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { supabase } from '../services/supabase'
import { TEST_DRIVE_ITEMS } from '../services/inspectionFlow'
import { markTrackComplete, markTrackStarted } from '../services/tracks'
import MechanicalChecks from '../components/MechanicalChecks'
import VoiceMemo from '../components/VoiceMemo'
import {
  isAnswered, unansweredChecks, readFindings, readOtherFindings, setCheckStatus,
  addFinding, attachAudio, uploadMedia, replayHandlers, OTHER_SECTION,
} from '../services/mechanicalFindings'
import { startAutoDrain, onQueueChange, pendingCount } from '../services/captureQueue'

const CHECKS = TEST_DRIVE_ITEMS.map((c) => ({ ...c, section: 'test_drive' }))

export default function TestDrive() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [inspection, setInspection] = useState(null)
  const [loading, setLoading] = useState(true)
  const [finishing, setFinishing] = useState(false)
  const [queued, setQueued] = useState(0)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('inspections').select('*').eq('id', id).single()
      setInspection(data)
      setLoading(false)
      markTrackStarted(id, 'drive')
    }
    load()
  }, [id])

  // Anything recorded without signal is queued locally and replayed when the
  // network returns. A test drive leaves the lot on purpose, so this is the one
  // screen where that is the normal case rather than the edge case.
  useEffect(() => {
    pendingCount().then(setQueued)
    const off = onQueueChange(setQueued)
    const stop = startAutoDrain(replayHandlers)
    return () => { off(); stop() }
  }, [])

  // Writes go through patch_inspection_checklist and come back merged, so what
  // we render is what is stored — including anything another track saved while
  // this page was open.
  const onChange = useCallback((checklist) => {
    setInspection((prev) => ({ ...prev, checklist }))
  }, [])

  const checklist = inspection?.checklist || {}
  const answered = CHECKS.filter((c) => isAnswered(checklist, 'test_drive', c.id)).length
  const missing = unansweredChecks(checklist, CHECKS)
  const findingCount =
    CHECKS.reduce((n, c) => n + readFindings(checklist, 'test_drive', c.id).length, 0) +
    readOtherFindings(checklist).length

  async function markRestGood() {
    let next = checklist
    for (const c of missing) {
      next = await setCheckStatus(id, next, 'test_drive', c.id, 'pass')
    }
    onChange(next)
  }

  async function handleNext() {
    // A hard gate, not a warning. Five inspections reached 'complete' holding no
    // test drive data at all, and a blank check reads downstream as a car with
    // nothing wrong with it. "Rest of it was fine" is one tap away, so this
    // costs an honest inspector nothing.
    if (missing.length > 0) return
    setFinishing(true)
    const result = await markTrackComplete(id, 'drive')
    if (result?.error) {
      setFinishing(false)
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

  return (
    <div className="page pb-24">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/')} aria-label="Back"
          className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-emerald-400">Test Drive</h1>
          <p className="text-sm text-slate-400">
            VIN ...{inspection.vin_last6 || inspection.vin?.slice(-6)}
          </p>
        </div>
        <span className="text-xs font-bold text-slate-400 tabular-nums">
          {answered}/{CHECKS.length}
        </span>
      </div>

      {queued > 0 && (
        <div className="mb-3 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-[11px] text-amber-300">
          📡 {queued} {queued === 1 ? 'note is' : 'notes are'} saved on this phone and waiting for
          signal. Keep going — they upload themselves. Don't close the app until they do.
        </div>
      )}

      <p className="text-[11px] text-slate-500 mb-3 leading-snug">
        Tap a problem the moment you notice it — don't wait until you're parked.
        Every tap becomes its own job for the mechanic.
      </p>

      {findingCount > 0 && (
        <div className="mb-3 p-2.5 rounded-xl bg-red-500/10 border border-red-500/40 text-[11px] text-red-300">
          {findingCount} {findingCount === 1 ? 'problem' : 'problems'} recorded on this drive.
        </div>
      )}

      {/* The one control that works with eyes on the road. It files the note
          under "Anything else" straight away, so a memo can be taken before
          anybody has decided which check it belongs to — deciding is the part
          that had to wait until the car was parked, and waiting is what lost
          the finding. */}
      <div className="mb-3">
        <VoiceMemo
          big
          label="🎙 Say what you just heard"
          onRecorded={async (blob, ext, secs) => {
            const { finding, checklist: afterAdd } = await addFinding(
              id, checklist, OTHER_SECTION, null,
              { description: `Voice note${secs ? ` (${secs}s)` : ''} — from the drive` })
            const clip = await uploadMedia(id, 'drive-memo', blob, ext)
            const next = await attachAudio(id, afterAdd, OTHER_SECTION, null, finding.id, clip)
            onChange(next)
          }}
        />
      </div>

      <MechanicalChecks
        inspectionId={id}
        checklist={checklist}
        checks={CHECKS}
        section="test_drive"
        onChange={onChange}
      />

      {/* Deliberately at the BOTTOM, and it only fills in what is still blank.
          This sat at the top as "All Good — No Issues", above every question, so
          the whole drive could be dismissed before a single one was read. */}
      {missing.length > 0 && (
        <button onClick={markRestGood}
          className="w-full mt-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 font-semibold text-sm flex items-center justify-center gap-2 active:bg-slate-700">
          <Check size={14} /> Rest of it was fine ({missing.length})
        </button>
      )}

      <div className="mt-4">
        <button onClick={handleNext} disabled={finishing || missing.length > 0}
          className="btn-primary flex items-center justify-center gap-2 text-lg disabled:opacity-40">
          {finishing ? 'Saving…' : 'Mark Test Drive Done'} <ArrowRight size={20} />
        </button>
        {missing.length > 0 && (
          <p className="text-[11px] text-slate-500 mt-2 text-center">
            Still to answer: {missing.map((c) => c.label).join(', ')}
          </p>
        )}
      </div>
    </div>
  )
}
