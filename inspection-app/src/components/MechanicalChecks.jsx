// The mechanical checklist — a check holds as many findings as the car has.
//
// The old version asked three questions and gave one single-line text box per
// answer. Everything about this component is aimed at one failure: the
// inspector is not forgetting that something was wrong, he is failing to
// reconstruct a list from memory after the drive is over.
//
// So: tap a symptom, it becomes a finding. No typing, no composing a sentence,
// no waiting until the end. Recognition instead of recall — the chips are there
// to be recognised rather than remembered, and each tap is one repair on the
// tech's board.

import { useState, useRef } from 'react'
import { Check, X, Camera, Trash2, Plus } from 'lucide-react'
import { supabase } from '../services/supabase'
import { FINDING_SEVERITIES } from '../services/inspectionFlow'
import {
  readCheck, readFindings, readOtherFindings, OTHER_SECTION,
  setCheckStatus, addFinding, updateFinding, removeFinding, attachPhoto,
} from '../services/mechanicalFindings'

export default function MechanicalChecks({ inspectionId, checklist, checks, section, onChange }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  // Every mutation returns the authoritative checklist from the server, so the
  // page can never act on a copy that another track has moved on from.
  async function run(key, fn) {
    setBusy(key); setError('')
    try {
      const next = await fn()
      if (next) onChange(next)
    } catch (e) {
      setError(e.message || 'Could not save — try again')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="card border-red-500/40 bg-red-500/10 text-red-300 text-sm">{error}</div>
      )}

      {checks.map((check) => (
        <CheckRow
          key={check.id}
          check={check}
          section={section}
          inspectionId={inspectionId}
          checklist={checklist}
          busy={busy}
          run={run}
        />
      ))}

      <OtherFindings
        inspectionId={inspectionId}
        checklist={checklist}
        busy={busy}
        run={run}
      />
    </div>
  )
}

function CheckRow({ check, section, inspectionId, checklist, busy, run }) {
  const entry = readCheck(checklist, section, check.id)
  const status = entry?.status || null
  const findings = readFindings(checklist, section, check.id)
  const [freeText, setFreeText] = useState('')
  const open = status === 'fail' || findings.length > 0

  const chosen = new Set(findings.map((f) => f.symptom).filter(Boolean))

  function toggleSymptom(symptom) {
    const hit = findings.find((f) => f.symptom === symptom)
    if (hit) {
      run(`${check.id}:${symptom}`, () =>
        removeFinding(inspectionId, checklist, section, check.id, hit.id))
    } else {
      run(`${check.id}:${symptom}`, () =>
        addFinding(inspectionId, checklist, section, check.id, { symptom }))
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{check.label}</p>
          <p className="text-xs text-slate-500 mt-0.5 leading-snug">{check.parts}</p>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => run(check.id, () => setCheckStatus(inspectionId, checklist, section, check.id, 'pass'))}
            aria-label={`${check.label} — good`}
            className={`w-11 h-11 rounded-lg flex items-center justify-center ${
              status === 'pass' ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-500 active:bg-emerald-500/30'}`}>
            <Check size={16} />
          </button>
          <button
            onClick={() => run(check.id, () => setCheckStatus(inspectionId, checklist, section, check.id, 'fail'))}
            aria-label={`${check.label} — problem`}
            className={`w-11 h-11 rounded-lg flex items-center justify-center ${
              status === 'fail' ? 'bg-red-500 text-white' : 'bg-slate-800 text-slate-500 active:bg-red-500/30'}`}>
            <X size={16} />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          {/* One tap per problem. Tapping a lit chip takes it back off. */}
          <div className="flex flex-wrap gap-1.5">
            {check.symptoms?.map((s) => (
              <button
                key={s}
                disabled={busy === `${check.id}:${s}`}
                onClick={() => toggleSymptom(s)}
                className={`px-2.5 py-1.5 rounded-full text-xs font-semibold ${
                  chosen.has(s)
                    ? 'bg-red-500 text-slate-900'
                    : 'bg-slate-800 text-slate-300 border border-slate-700 active:bg-slate-700'}`}>
                {s}
              </button>
            ))}
          </div>

          {findings.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {findings.map((f) => (
                <FindingRow
                  key={f.id}
                  finding={f}
                  section={section}
                  checkId={check.id}
                  inspectionId={inspectionId}
                  checklist={checklist}
                  busy={busy}
                  run={run}
                />
              ))}
            </div>
          )}

          {/* Anything the chips don't cover. Always present, because the list of
              things that can be wrong with a used car has no end. */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const text = freeText.trim()
              if (!text) return
              setFreeText('')
              run(`${check.id}:free`, () =>
                addFinding(inspectionId, checklist, section, check.id, { description: text }))
            }}
            className="flex gap-1.5">
            <input
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="Something else on this one…"
              className="text-sm py-2"
            />
            <button type="submit" disabled={!freeText.trim()}
              className="shrink-0 px-3 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 active:bg-slate-700">
              <Plus size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

function FindingRow({ finding, section, checkId, inspectionId, checklist, busy, run }) {
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  async function onPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const uid = Math.random().toString(36).slice(2, 14)
      const path = `${inspectionId}/damage/${checkId || 'other'}-${uid}.${ext}`

      const { error: upErr } = await supabase.storage
        .from('inspection-photos').upload(path, file, { contentType: file.type })
      if (upErr) throw upErr

      const { data: { publicUrl } } = supabase.storage
        .from('inspection-photos').getPublicUrl(path)

      await run(`${finding.id}:photo`, () =>
        attachPhoto(inspectionId, checklist, section, checkId, finding.id, { url: publicUrl, path }))
    } catch (err) {
      alert('Upload failed: ' + (err.message || err))
    } finally {
      setUploading(false)
      if (e.target) e.target.value = ''
    }
  }

  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-slate-800 border border-slate-700 px-2 py-1.5">
      <span className="min-w-0 flex-1 text-xs truncate">{finding.description}</span>

      {finding.photos?.length > 0 && (
        <span className="shrink-0 text-[10px] text-emerald-400">📷 {finding.photos.length}</span>
      )}

      {/* Severity is captured here, per finding, so the tech's board shows what
          the person who drove the car actually thought — not a guess made later
          from the category name. */}
      <select
        value={finding.severity || 'moderate'}
        onChange={(e) => run(`${finding.id}:sev`, () =>
          updateFinding(inspectionId, checklist, section, checkId, finding.id, { severity: e.target.value }))}
        aria-label="How bad is it"
        className="shrink-0 !w-auto !py-0.5 !px-1 text-[10px] bg-slate-900 border-slate-700">
        {FINDING_SEVERITIES.map((s) => (
          <option key={s.key} value={s.key}>{s.label}</option>
        ))}
      </select>

      <input ref={fileRef} type="file" accept="image/*" capture="environment"
        onChange={onPhoto} className="hidden" />
      <button onClick={() => fileRef.current?.click()} disabled={uploading}
        aria-label="Add a photo" className="shrink-0 p-1 rounded text-slate-400 active:bg-slate-700">
        <Camera size={13} />
      </button>

      <button
        onClick={() => run(`${finding.id}:del`, () =>
          removeFinding(inspectionId, checklist, section, checkId, finding.id))}
        disabled={busy === `${finding.id}:del`}
        aria-label="Remove this finding"
        className="shrink-0 p-1 rounded text-slate-600 active:bg-slate-700">
        <Trash2 size={13} />
      </button>
    </div>
  )
}

// The catch-all. A dead key fob, a hood latch that won't catch, a smell — none
// of it fits a check, and before this it had nowhere to go, so it went nowhere.
function OtherFindings({ inspectionId, checklist, busy, run }) {
  const findings = readOtherFindings(checklist)
  const [text, setText] = useState('')

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
      <p className="text-sm font-semibold text-white">Anything else</p>
      <p className="text-xs text-slate-500 mt-0.5 mb-2">
        Whatever the checks above didn't ask about.
      </p>

      {findings.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {findings.map((f) => (
            <FindingRow
              key={f.id}
              finding={f}
              section={OTHER_SECTION}
              checkId={null}
              inspectionId={inspectionId}
              checklist={checklist}
              busy={busy}
              run={run}
            />
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          const t = text.trim()
          if (!t) return
          setText('')
          run('other:add', () =>
            addFinding(inspectionId, checklist, OTHER_SECTION, null, { description: t }))
        }}
        className="flex gap-1.5">
        <input value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Hood latch won't catch…" className="text-sm py-2" />
        <button type="submit" disabled={!text.trim()}
          className="shrink-0 px-3 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 active:bg-slate-700">
          <Plus size={16} />
        </button>
      </form>
    </div>
  )
}
