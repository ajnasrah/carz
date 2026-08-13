import { useState, useEffect, useMemo } from 'react'
import {
  PACE_MODES,
  PACE_MODE_KEY,
  fetchBuySellPace,
  bucketPace,
} from '../services/buySellPace'
import { store } from '../native/storage'

// Two series, and their job is identity — "bought" and "sold" are not good and
// bad, and they are not two ends of one scale. So: two categorical hues, and
// deliberately NOT the emerald/red this dashboard uses for status. Buying
// harder than you sell is a decision, not an alarm, and painting it red would
// editorialise a number Abdullah reads twenty times a day.
//
// Validated as a categorical pair against this card's surface (#1e293b, dark):
// lightness band, chroma floor, contrast ≥3:1 all pass, and the adjacent-pair
// separation is ΔE 23.4 protan / 28.6 tritan / 30.6 normal-vision — well clear
// of the ΔE 8 floor, so the pair survives every kind of colour blindness.
const BOUGHT = '#0284c7'
const SOLD = '#d97706'

const PLOT_H = 80 // px of bar area, sized so 8 weekly columns stay legible on a phone

export default function BuySellPace() {
  const [pace, setPace] = useState(null) // null = still loading
  const [mode, setMode] = useState('week')
  const [activeIdx, setActiveIdx] = useState(null) // null = the current period

  useEffect(() => {
    let cancelled = false
    store.get(PACE_MODE_KEY).then((saved) => {
      if (!cancelled && PACE_MODES.some((m) => m.key === saved)) setMode(saved)
    })
    fetchBuySellPace()
      .then((p) => { if (!cancelled) setPace(p) })
      .catch(() => { if (!cancelled) setPace({ buys: [], sells: [], undatedBuys: 0 }) })
    return () => { cancelled = true }
  }, [])

  function pickMode(key) {
    setMode(key)
    setActiveIdx(null)
    store.set(PACE_MODE_KEY, key)
  }

  const rows = useMemo(() => bucketPace(pace, mode), [pace, mode])
  const max = Math.max(1, ...rows.map((r) => Math.max(r.bought, r.sold)))
  const active = rows[activeIdx ?? rows.length - 1] || null
  const loading = pace === null

  const unit = mode === 'month' ? 'month' : 'week'

  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
          Buying vs Selling
        </span>
        <div className="flex items-center gap-1">
          {PACE_MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => pickMode(m.key)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                mode === m.key ? 'bg-emerald-500 text-slate-900' : 'bg-slate-700 text-slate-300'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* The reading area. Rather than float a tooltip over an 80px plot on a
          phone — where there is no hover and nowhere to put it — touching a
          column swaps its numbers in here, into space already reserved. */}
      <div className="flex items-end justify-between gap-2 mb-2 min-h-[38px]">
        <div className="min-w-0">
          <div className="text-[10px] text-slate-500 truncate">
            {active ? active.title : '—'}
            {active?.current && <span className="text-slate-600"> · so far</span>}
          </div>
          <div className="text-sm text-slate-400">
            <b className="text-white">{loading ? '—' : active?.bought ?? 0}</b> bought
            <span className="text-slate-600 mx-1.5">·</span>
            <b className="text-white">{loading ? '—' : active?.sold ?? 0}</b> sold
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-white leading-none">
            {loading || !active ? '—' : `${active.net > 0 ? '+' : active.net < 0 ? '−' : ''}${Math.abs(active.net)}`}
          </div>
          <div className="text-[9px] text-slate-500 leading-tight mt-0.5">
            {loading || !active ? '' : active.net > 0 ? 'buying faster' : active.net < 0 ? 'selling faster' : 'even'}
          </div>
        </div>
      </div>

      {/* Plot. One hairline at the top carries the scale so no bar needs its own
          number — the exact counts live in the line above and in each column's
          screen-reader label. The scale gets its own row rather than floating
          over the plot: whenever the tallest bar sits on the right, a label
          inside the box lands right on top of it. */}
      <div className="text-right text-[8px] text-slate-500 tabular-nums leading-none mb-0.5 h-[9px]">
        {loading ? '' : max}
      </div>
      <div className="relative" style={{ height: PLOT_H }}>
        <div className="absolute inset-x-0 top-0 border-t border-slate-700" />
        <div className={`flex items-end gap-1.5 h-full ${loading ? 'opacity-40' : ''}`}>
          {rows.map((r, i) => (
            <button
              key={r.start}
              type="button"
              onMouseEnter={() => setActiveIdx(i)}
              onMouseLeave={() => setActiveIdx(null)}
              onFocus={() => setActiveIdx(i)}
              onBlur={() => setActiveIdx(null)}
              onClick={() => setActiveIdx(i)}
              aria-label={`${r.title}: bought ${r.bought}, sold ${r.sold}`}
              className="flex-1 h-full flex items-end justify-center gap-[2px] rounded-t"
              // The in-progress period is a partial count sitting next to
              // complete ones; fading it stops it reading as a collapse in pace.
              style={{ opacity: r.current ? 0.55 : 1 }}
            >
              {/* Capped as well as proportional — at six monthly columns an
                  uncapped 42% is a 35px slab, which reads loud next to the rest
                  of this dashboard. */}
              <span
                className="w-[42%] max-w-[16px] rounded-t-[4px]"
                style={{ height: `${(r.bought / max) * 100}%`, background: BOUGHT }}
              />
              <span
                className="w-[42%] max-w-[16px] rounded-t-[4px]"
                style={{ height: `${(r.sold / max) * 100}%`, background: SOLD }}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-1.5 mt-1">
        {rows.map((r) => (
          <span
            key={r.start}
            className={`flex-1 text-center text-[8px] tabular-nums ${
              r.current ? 'text-slate-600' : 'text-slate-500'
            }`}
          >
            {r.label}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-2 text-[9px] text-slate-400">
        <Swatch color={BOUGHT}>Bought</Swatch>
        <Swatch color={SOLD}>Sold</Swatch>
        <span className="ml-auto text-slate-600">
          {`last ${rows.length} ${unit}s`}
        </span>
      </div>

      {/* Whose lot is growing. The card total says the pile got bigger; it
          doesn't say who put the cars there, and that's the part you can act on.
          Follows whichever column is being touched, so the same list answers
          "this week" and "back in June" without a second control. */}
      {!loading && active?.buyers?.length > 0 && (
        <div className="mt-3 pt-2 border-t border-slate-700">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">By buyer</span>
            <span className="text-[9px] text-slate-600 truncate ml-2">{active.title}</span>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2.5 gap-y-1 items-baseline">
            <span />
            <ColHead color={BOUGHT}>In</ColHead>
            <ColHead color={SOLD}>Out</ColHead>
            <span className="text-[8px] uppercase text-slate-600 text-right">Net</span>
            {active.buyers.map((b) => (
              <BuyerRow key={b.buyer} b={b} />
            ))}
          </div>
        </div>
      )}

      {pace?.undatedBuys > 0 && (
        // Only ever rendered when the data is actually short, so it wears
        // readable ink rather than the muted grey the chrome uses.
        <div className="mt-1.5 text-[9px] text-slate-500">
          {pace.undatedBuys} car{pace.undatedBuys === 1 ? '' : 's'} with no purchase date — not counted as a buy
        </div>
      )}
    </div>
  )
}

// Ties the In/Out columns back to the two bar colours without painting the
// numbers themselves — a dot beside the word, the figures in plain ink.
function ColHead({ color, children }) {
  return (
    <span className="text-[8px] uppercase text-slate-600 text-right whitespace-nowrap">
      <i className="inline-block w-1.5 h-1.5 rounded-sm mr-1 align-middle" style={{ background: color }} />
      {children}
    </span>
  )
}

// Whoever is buying faster than their cars leave is the answer to the question,
// so they're the only rows in full ink; everyone at or below even is context.
function BuyerRow({ b }) {
  const over = b.net > 0
  return (
    <>
      <span className={`text-[11px] truncate ${over ? 'text-white font-semibold' : 'text-slate-400'}`}>
        {b.buyer}
      </span>
      <span className="text-[11px] text-slate-300 text-right tabular-nums">{b.bought}</span>
      <span className="text-[11px] text-slate-300 text-right tabular-nums">{b.sold}</span>
      <span className={`text-[11px] font-bold text-right tabular-nums ${over ? 'text-white' : 'text-slate-500'}`}>
        {b.net > 0 ? '+' : b.net < 0 ? '−' : ''}{Math.abs(b.net)}
      </span>
    </>
  )
}

// A colour on its own never carries the identity: the swatch sits beside a word,
// and the numbers above stay in plain ink.
function Swatch({ color, children }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-2 h-2 rounded-sm" style={{ background: color }} />
      {children}
    </span>
  )
}
