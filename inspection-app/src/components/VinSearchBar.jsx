import { useRef, useState } from 'react'
import { Search, Loader, X, Package, ChevronRight } from 'lucide-react'
import { searchVin } from '../services/vinSearch'
import VehicleQuickInfo from './VehicleQuickInfo'

// Global VIN/stock search: an always-visible bar that opens a result popup
// instead of navigating to a separate page. Replaces the old "Check VIN" tile.
export default function VinSearchBar() {
  const inputRef = useRef(null)
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [choices, setChoices] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [term, setTerm] = useState('')

  const canSearch = input.trim().replace(/[^A-HJ-NPR-Z0-9-]/gi, '').length >= 4

  async function lookup(q) {
    setTerm(q)
    setOpen(true)
    setLoading(true)
    setResult(null)
    setChoices(null)
    setNotFound(false)
    const r = await searchVin(q)
    // A partial VIN can match several cars — offer a picker instead of guessing.
    if (r?.multiple) setChoices(r.multiple)
    else setResult(r)
    setNotFound(!r)
    setLoading(false)
  }

  async function run(e) {
    e?.preventDefault()
    if (!canSearch) return
    await lookup(input.trim())
  }

  function close() {
    setOpen(false)
    setInput('')
    setResult(null)
    setChoices(null)
    setNotFound(false)
    setLoading(false)
    setTerm('')
  }

  return (
    <>
      <form onSubmit={run} className="mb-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            ref={inputRef}
            type="text"
            inputMode="text"
            /* Placeholder is short enough to survive the narrowest phone. The
               old one ("Search VIN, last 6, or stock #") truncated mid-word at
               iPhone width because the mono face plus tracking-wide is far wider
               than the label suggests. Mono stays — it's what makes a VIN
               readable — but the letter-spacing goes. */
            placeholder="VIN, last 6, or stock"
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9-]/g, '').slice(0, 17))}
            className="pl-9 pr-20 font-mono"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={!canSearch}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-900 text-sm font-bold disabled:opacity-30"
          >
            Go
          </button>
        </div>
      </form>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60"
          onClick={close}
        >
          <div
            className="w-full max-w-lg bg-slate-900 rounded-t-2xl sm:rounded-2xl border-t sm:border border-slate-700 max-h-[85vh] overflow-y-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="font-mono text-sm text-slate-400 truncate">"{term}"</p>
              <button onClick={close} className="p-1.5 rounded-lg bg-slate-800 text-slate-400 active:bg-slate-700">
                <X size={18} />
              </button>
            </div>

            {loading && (
              <div className="text-center py-12">
                <Loader size={32} className="mx-auto text-emerald-400 animate-spin" />
              </div>
            )}

            {!loading && choices && (
              <div>
                <p className="text-xs text-slate-400 mb-3">
                  {choices.length} cars contain "{term}" — pick one:
                </p>
                <div className="space-y-2">
                  {choices.map((c) => (
                    <button
                      key={c.stock_number || c.vehicle_vin}
                      onClick={() => lookup(c.vehicle_vin || c.stock_number)}
                      className="w-full flex items-center justify-between gap-2 p-3 rounded-lg bg-slate-800 border border-slate-700 active:bg-slate-700 text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white truncate">
                          {c.label || 'Unknown Vehicle'}
                        </p>
                        <p className="text-xs text-slate-400 font-mono truncate">
                          {c.vehicle_vin || c.last_6_vin || '—'}
                          {c.stock_number && ` · ${c.stock_number}`}
                        </p>
                      </div>
                      <ChevronRight size={16} className="shrink-0 text-slate-500" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!loading && result && (
              <>
                <VehicleQuickInfo result={result} />
                <button onClick={() => { close(); inputRef.current?.focus() }} className="btn-secondary w-full text-sm mt-3">
                  Search another
                </button>
              </>
            )}

            {!loading && notFound && (
              <div className="text-center py-12">
                <Package size={48} className="mx-auto text-red-500/30 mb-4" />
                <p className="text-red-400 font-bold">Not found</p>
                <p className="text-slate-500 text-xs mt-1">"{term}" isn't in inventory, sold records, or tracking history</p>
                <button onClick={close} className="btn-secondary mt-4 text-xs">Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
