import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Search, Loader, Package, ChevronRight } from 'lucide-react'
import { searchVin } from '../services/vinSearch'
import VehicleQuickInfo from '../components/VehicleQuickInfo'

// Standalone VIN-check page. The dashboard now exposes the same lookup as a
// global search bar + popup (VinSearchBar); this page is kept for direct links
// and shares searchVin + VehicleQuickInfo so the two never drift.
export default function VinCheck() {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [choices, setChoices] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const inputRef = useRef(null)

  async function lookup(q) {
    setLoading(true)
    setResult(null)
    setChoices(null)
    setNotFound(false)
    const r = await searchVin(q)
    if (r?.multiple) setChoices(r.multiple)
    else setResult(r)
    setNotFound(!r)
    setLoading(false)
  }

  async function handleSearch(e) {
    e?.preventDefault()
    if (input.trim().replace(/[^A-HJ-NPR-Z0-9-]/gi, '').length < 4) return
    await lookup(input.trim())
  }

  function clearSearch() {
    setInput('')
    setResult(null)
    setChoices(null)
    setNotFound(false)
    inputRef.current?.focus()
  }

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-emerald-400">VIN Check</h1>
          <p className="text-sm text-slate-400">Confirm inventory &middot; VIN, last 6, or stock #</p>
        </div>
      </div>

      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Enter VIN, last 6, or stock #..."
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9-]/g, '').slice(0, 17))}
              className="pl-9 font-mono text-lg tracking-wider"
              autoFocus
              spellCheck={false}
            />
          </div>
          <button
            type="submit"
            disabled={loading || input.trim().length < 4}
            className="btn-primary px-5 !w-auto flex items-center gap-1 disabled:opacity-40"
          >
            {loading ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
          </button>
        </div>
      </form>

      {notFound && (
        <div className="text-center py-12">
          <Package size={48} className="mx-auto text-red-500/30 mb-4" />
          <p className="text-red-400 font-bold">Not in inventory</p>
          <p className="text-slate-500 text-xs mt-1">"{input}" not found in current inventory</p>
          <button onClick={clearSearch} className="btn-secondary mt-4 text-xs">Search again</button>
        </div>
      )}

      {choices && (
        <div>
          <p className="text-xs text-slate-400 mb-3">
            {choices.length} cars contain "{input}" — pick one:
          </p>
          <div className="space-y-2">
            {choices.map((c) => (
              <button
                key={c.stock_number || c.vehicle_vin}
                onClick={() => lookup(c.vehicle_vin || c.stock_number)}
                className="w-full flex items-center justify-between gap-2 p-3 rounded-lg bg-slate-800 border border-slate-700 active:bg-slate-700 text-left"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">{c.label || 'Unknown Vehicle'}</p>
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

      {result && (
        <div className="space-y-3">
          <VehicleQuickInfo result={result} />
          <button onClick={clearSearch} className="btn-secondary w-full text-sm">Search Another</button>
        </div>
      )}

      {!result && !choices && !notFound && !loading && (
        <div className="text-center py-16">
          <Package size={48} className="mx-auto text-slate-600 mb-4" />
          <p className="text-slate-400 font-semibold">Check if a car is in inventory</p>
          <p className="text-slate-500 text-xs mt-1">Enter full VIN, last 6 digits, or stock #</p>
        </div>
      )}
    </div>
  )
}
