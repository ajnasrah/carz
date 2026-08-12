import { useState } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { supabase } from '../services/supabase'

// The price on a marketplace car, and — for admins — the way to change it.
//
// A price is either ours (set here, stored in marketplace_prices) or
// SmartAuction's (buy now / opening price off the scraper). Ours wins. Clearing
// ours hands the car back to whatever SmartAuction says, which is why Clear is a
// separate action from saving an empty box.
export default function MarketplacePrice({
  vin,
  price,
  source,
  canEdit = false,
  onChange,
  size = 'md',
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const value = price == null || price === '' ? null : Number(price)
  const big = size === 'lg'

  function startEdit() {
    setDraft(value == null ? '' : String(Math.round(value)))
    setError('')
    setEditing(true)
  }

  async function save(next) {
    if (!vin) {
      setError('No VIN on this car — nothing to price')
      return
    }
    setBusy(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('set_marketplace_price', {
      p_vin: vin,
      p_price: next,
    })
    setBusy(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setEditing(false)
    // data is the price now in effect (null once cleared). Falling back to SA's
    // number is the server's job, so a cleared price refetches nothing here —
    // the card just shows "no price" until the next load.
    onChange?.(data == null ? null : Number(data), data == null ? null : 'manual')
  }

  function submit(e) {
    e?.preventDefault?.()
    const digits = draft.replace(/[^0-9.]/g, '')
    if (!digits) {
      setError('Enter a price, or tap Clear')
      return
    }
    const n = Number(digits)
    if (!Number.isFinite(n) || n < 0) {
      setError('Not a valid price')
      return
    }
    save(Math.round(n * 100) / 100)
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="w-full">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
            <input
              autoFocus
              type="text"
              inputMode="decimal"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="0"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-5 pr-2 py-1.5 text-white text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="p-1.5 rounded-lg bg-emerald-500 text-slate-900 disabled:opacity-40"
            title="Save price"
          >
            <Check size={16} />
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={busy}
            className="p-1.5 rounded-lg bg-slate-700 text-slate-300 disabled:opacity-40"
            title="Cancel"
          >
            <X size={16} />
          </button>
          {value != null && source === 'manual' && (
            <button
              type="button"
              onClick={() => save(null)}
              disabled={busy}
              className="px-2 py-1.5 rounded-lg bg-slate-700 text-[11px] font-bold text-slate-300 disabled:opacity-40"
              title="Remove our price and fall back to SmartAuction"
            >
              Clear
            </button>
          )}
        </div>
        {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
      </form>
    )
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">
          Price{source === 'smartauction' ? ' · SmartAuction' : ''}
        </p>
        {value != null ? (
          <p className={`text-emerald-400 font-bold ${big ? 'text-2xl' : 'text-lg'} leading-tight`}>
            ${value.toLocaleString()}
          </p>
        ) : (
          <p className={`text-slate-500 font-semibold ${big ? 'text-xl' : 'text-base'} leading-tight`}>
            No price
          </p>
        )}
      </div>
      {canEdit && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); startEdit() }}
          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-700 text-slate-200 text-[11px] font-bold active:bg-slate-600"
        >
          <Pencil size={11} /> {value == null ? 'Set' : 'Edit'}
        </button>
      )}
    </div>
  )
}
