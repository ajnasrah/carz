import { useRef, useState } from 'react'
import { Search, Loader, X, Package } from 'lucide-react'
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
  const [notFound, setNotFound] = useState(false)
  const [term, setTerm] = useState('')

  const canSearch = input.trim().replace(/[^A-HJ-NPR-Z0-9-]/gi, '').length >= 4

  async function run(e) {
    e?.preventDefault()
    if (!canSearch) return
    const q = input.trim()
    setTerm(q)
    setOpen(true)
    setLoading(true)
    setResult(null)
    setNotFound(false)
    const r = await searchVin(q)
    setResult(r)
    setNotFound(!r)
    setLoading(false)
  }

  function close() {
    setOpen(false)
    setInput('')
    setResult(null)
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
            placeholder="Search VIN, last 6, or stock #"
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9-]/g, '').slice(0, 17))}
            className="pl-9 pr-20 font-mono tracking-wide"
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
                <p className="text-red-400 font-bold">Not in inventory</p>
                <p className="text-slate-500 text-xs mt-1">"{term}" not found in current inventory</p>
                <button onClick={close} className="btn-secondary mt-4 text-xs">Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
