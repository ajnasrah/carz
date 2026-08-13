import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../services/supabase'

// How many cars are tied up in the shops right now, and whether that pile is
// growing. The count alone can't answer "are we buying too many or pushing out
// too few" — so the RPC writes today's numbers into a daily table on its way
// past and hands back the same figures from a week ago to read against.
//
// Which locations count as which shop is decided in the database (see
// shop_locations()), not here, so this card, any report and any future alert
// can't disagree about what "at the mechanic" means.
const SHOPS = [
  { key: 'body_shop', label: 'Body Shop', emoji: '🎨', to: '/inventory?filter=body_shop' },
  { key: 'mechanic', label: 'Mechanic', emoji: '🔧', to: '/inventory?filter=mechanic' },
]

const pretty = (slug) =>
  String(slug || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export default function ShopTally() {
  const [rows, setRows] = useState(null) // null = loading
  const [open, setOpen] = useState(null) // which shop's breakdown is showing
  const [breakdown, setBreakdown] = useState({})

  useEffect(() => {
    let cancelled = false
    supabase.rpc('shop_tally').then(({ data, error }) => {
      if (cancelled) return
      setRows(error ? [] : data || [])
    })
    return () => { cancelled = true }
  }, [])

  async function toggle(key) {
    setOpen((o) => (o === key ? null : key))
    if (breakdown[key]) return
    const { data } = await supabase.rpc('shop_tally_breakdown', { p_shop: key })
    setBreakdown((b) => ({ ...b, [key]: data || [] }))
  }

  return (
    <div className="grid grid-cols-2 gap-2 mb-4">
      {SHOPS.map((shop) => {
        const r = rows?.find((x) => x.shop === shop.key)
        const delta = r && r.cars_prev != null ? r.cars - r.cars_prev : null
        return (
          <div key={shop.key} className="rounded-xl bg-slate-800 border border-slate-700 p-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm">{shop.emoji}</span>
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 truncate">
                {shop.label}
              </span>
            </div>

            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-2xl font-bold text-white leading-none">
                {rows == null ? '—' : (r?.cars ?? 0)}
              </span>
              {/* More cars than a week ago means the pile is building: red. */}
              {delta != null && delta !== 0 && (
                <span className={`text-[11px] font-bold ${delta > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {delta > 0 ? '+' : '−'}{Math.abs(delta)} vs {r.prev_day?.slice(5)}
                </span>
              )}
              {r && r.cars_prev == null && (
                <span className="text-[10px] text-slate-500">tracking from today</span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-x-2 mt-2 pt-2 border-t border-slate-700">
              <Stat label="Age" value={r?.avg_days != null ? `${r.avg_days}d` : '—'} />
              <Stat label="Here" value={r?.avg_here != null ? `${r.avg_here}d` : '—'} />
              <Stat label="Add" value={r?.avg_added != null ? `$${Number(r.avg_added).toLocaleString()}` : '—'} />
            </div>

            <button
              onClick={() => toggle(shop.key)}
              className="mt-2 text-[10px] font-bold text-slate-400 active:text-white"
            >
              {open === shop.key ? 'Hide where' : 'Where ›'}
            </button>

            {open === shop.key && (
              <div className="mt-1 space-y-0.5">
                {(breakdown[shop.key] || []).map((b) => (
                  <div key={b.physical_location} className="flex justify-between text-[10px]">
                    <span className="text-slate-400 truncate">{pretty(b.physical_location)}</span>
                    <span className="text-slate-300 font-semibold tabular-nums">{b.cars}</span>
                  </div>
                ))}
                <Link to={shop.to} className="block pt-1 text-[10px] font-bold text-emerald-400">
                  Open list ›
                </Link>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xs font-semibold text-slate-200 tabular-nums">{value}</div>
    </div>
  )
}
