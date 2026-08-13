import { useState } from 'react'
import { X, Plus, Trash2, Wand2 } from 'lucide-react'
import {
  SA_DAMAGE_TYPES, SA_EXTERIOR_PANELS, SA_INTERIOR_PANELS,
  STANDARD_DAMAGES, readDamages, saveDamages, isInteriorPanel,
} from '../services/listingDamages'

// Type up a car's damages without the extension. Same panels, same types, same
// place they're stored — a car typed here shows on the marketplace immediately
// and comes back into the extension's wizard for the SmartAuction fill.
export default function DamageEditor({ vin, checklist, onClose, onSaved }) {
  const initial = readDamages(checklist)
  const [rows, setRows] = useState(initial.rows)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function update(i, patch) {
    setRows((list) => list.map((r, n) => (n === i ? { ...r, ...patch } : r)))
  }
  function add(row = { panel: '', type: '', note: '', photos: [] }) {
    setRows((list) => [...list, row])
  }
  function addStandards() {
    setRows((list) => {
      const have = new Set(list.map((r) => `${r.panel}|${r.type}`))
      const missing = STANDARD_DAMAGES
        .filter((s) => !have.has(`${s.panel}|${s.type}`))
        .map((s) => ({ ...s, photos: [] }))
      return [...list, ...missing]
    })
  }

  async function save() {
    const usable = rows.filter((r) => r.panel && r.type)
    if (usable.length !== rows.length && usable.length === 0 && rows.length > 0) {
      setError('Each damage needs a panel and a type')
      return
    }
    setBusy(true)
    setError('')
    try {
      await saveDamages(vin, usable)
      onSaved?.(usable)
      onClose?.()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  const incomplete = rows.filter((r) => !r.panel || !r.type).length

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col safe-inset">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-white">Damages</h2>
          <p className="text-[11px] text-slate-400">
            {rows.length} listed
            {initial.fromInspection > 0 && ` · ${initial.fromInspection} from the inspection (not editable here)`}
          </p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg bg-slate-800 text-slate-300">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {rows.length === 0 && (
          <p className="text-center text-slate-500 py-10 text-sm">
            No damages typed yet. Add one, or drop in the standard disclosures.
          </p>
        )}
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg bg-slate-900 border border-slate-800 p-2.5">
            <div className="flex gap-2">
              <select
                value={r.panel}
                onChange={(e) => update(i, { panel: e.target.value })}
                className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white"
              >
                <option value="">Panel…</option>
                <optgroup label="Exterior">
                  {SA_EXTERIOR_PANELS.map((p) => <option key={p} value={p}>{p}</option>)}
                </optgroup>
                <optgroup label="Interior">
                  {SA_INTERIOR_PANELS.map((p) => <option key={p} value={p}>{p}</option>)}
                </optgroup>
              </select>
              <select
                value={r.type}
                onChange={(e) => update(i, { type: e.target.value })}
                className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white"
              >
                <option value="">Type…</option>
                {SA_DAMAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button
                onClick={() => setRows((list) => list.filter((_, n) => n !== i))}
                className="shrink-0 p-2 rounded-lg bg-slate-800 text-red-400"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <input
                value={r.note}
                onChange={(e) => update(i, { note: e.target.value })}
                placeholder="Description (optional)"
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white"
              />
              {r.panel && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-500">
                  {isInteriorPanel(r.panel) ? 'Interior' : 'Exterior'}
                </span>
              )}
              {r.photos?.length > 0 && (
                <span className="shrink-0 text-[10px] text-slate-500">{r.photos.length} 📷</span>
              )}
            </div>
          </div>
        ))}

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => add()}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs font-bold"
          >
            <Plus size={14} /> Add damage
          </button>
          <button
            onClick={addStandards}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs font-bold"
            title="Add the disclosures that go on every car"
          >
            <Wand2 size={14} /> Standard
          </button>
        </div>
      </div>

      {(error || incomplete > 0) && (
        <p className={`px-4 py-2 text-xs ${error ? 'text-red-400' : 'text-amber-400'}`}>
          {error || `${incomplete} row${incomplete !== 1 ? 's' : ''} missing a panel or type — they won't be saved`}
        </p>
      )}

      <div className="flex gap-2 px-4 py-3 border-t border-slate-800">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-slate-800 text-slate-200 font-bold text-sm">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="flex-1 py-2.5 rounded-lg bg-emerald-500 text-slate-900 font-bold text-sm disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
