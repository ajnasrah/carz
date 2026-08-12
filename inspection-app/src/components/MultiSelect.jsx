import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Check, X } from 'lucide-react'

// A dropdown you can pick several things from at once. Used for make / model /
// year on the marketplace, where "Toyota and Honda" or "2021, 2022 and 2023" is
// the normal question and one-at-a-time selects made it three page visits.
//
// Options are plain strings. The button shows what's picked, so the panel
// doesn't have to stay open to know where you are.
export default function MultiSelect({ label, options, selected, onChange, searchAfter = 8 }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('touchstart', onDocClick)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('touchstart', onDocClick)
    }
  }, [open])

  const shown = useMemo(() => {
    const q = query.trim().toUpperCase()
    if (!q) return options
    return options.filter((o) => String(o).toUpperCase().includes(q))
  }, [options, query])

  function toggle(value) {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value]
    onChange(next)
  }

  const summary =
    selected.length === 0
      ? `All ${label}s`
      : selected.length === 1
      ? String(selected[0])
      : `${selected.length} ${label}s`

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-1 text-sm rounded-lg px-3 py-2 border ${
          selected.length
            ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
            : 'bg-slate-800 border-slate-700 text-white'
        }`}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown size={14} className="shrink-0 text-slate-400" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[11rem] bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-800">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
            <div className="flex items-center gap-2">
              {selected.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="text-[11px] font-bold text-slate-400 active:text-white"
                >
                  Clear
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} className="text-slate-500 active:text-white">
                <X size={13} />
              </button>
            </div>
          </div>

          {options.length > searchAfter && (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}s`}
              className="w-full bg-slate-800 border-b border-slate-700 px-2 py-1.5 text-sm text-white"
            />
          )}

          <div className="max-h-56 overflow-y-auto">
            {shown.length === 0 ? (
              <p className="px-3 py-3 text-xs text-slate-500">Nothing matches</p>
            ) : (
              shown.map((o) => {
                const on = selected.includes(o)
                return (
                  <button
                    type="button"
                    key={o}
                    onClick={() => toggle(o)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${
                      on ? 'text-emerald-300' : 'text-slate-200'
                    } active:bg-slate-800`}
                  >
                    <span
                      className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center ${
                        on ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600'
                      }`}
                    >
                      {on && <Check size={11} className="text-slate-900" />}
                    </span>
                    <span className="truncate">{o}</span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
