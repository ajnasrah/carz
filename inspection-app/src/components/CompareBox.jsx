import { useState, useMemo } from 'react'

// The dashboard's Inventory-vs-Sold box, widened to as many rows as you like.
// Everyone is read against one baseline line: above the pack on recon spend or
// days on lot is a warning, above it on profit is the opposite, and what a car
// cost is left uncoloured because there's no honest direction to it.
export default function CompareBox({
  columns,
  rows,
  baseline,
  baselineLabel = 'Everyone',
  rowLabel = 'Name',
  initialShown = 8,
  footnote,
}) {
  const [sortKey, setSortKey] = useState('count')
  const [showAll, setShowAll] = useState(false)

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      // Age sorts worst-first like everything else here: longest sitting on top.
      return bv - av
    })
    return copy
  }, [rows, sortKey])

  const shown = showAll ? sorted : sorted.slice(0, initialShown)

  const fmt = (v, kind) => {
    if (v == null) return '—'
    if (kind === 'money') return `$${Math.round(v).toLocaleString()}`
    if (kind === 'days') return `${v}d`
    return String(v)
  }

  // Colour by which side of the baseline the number falls, not by its size.
  function tone(col, value) {
    if (!col.worse || value == null || baseline?.[col.key] == null) return 'text-slate-200'
    const diff = value - baseline[col.key]
    if (Math.abs(diff) < 1) return 'text-slate-200'
    const bad = col.worse === 'higher' ? diff > 0 : diff < 0
    return bad ? 'text-red-400' : 'text-emerald-400'
  }

  const grid = { gridTemplateColumns: `minmax(6rem,1fr) 2.5rem repeat(${columns.length}, minmax(3.9rem, auto))` }

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <div className="min-w-max">
        {/* Header */}
        <div className="grid gap-x-3 items-baseline pb-1 border-b border-slate-800" style={grid}>
          <span className="text-[9px] uppercase tracking-wide text-slate-500">{rowLabel}</span>
          <button
            onClick={() => setSortKey('count')}
            className={`text-[9px] uppercase tracking-wide text-right ${sortKey === 'count' ? 'text-emerald-400' : 'text-slate-500'}`}
          >
            Cars
          </button>
          {columns.map((c) => (
            <button
              key={c.key}
              onClick={() => setSortKey(c.key)}
              className={`text-[9px] uppercase tracking-wide text-right ${sortKey === c.key ? 'text-emerald-400' : 'text-slate-500'}`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* The line everyone is read against */}
        <div className="grid gap-x-3 items-baseline py-1.5 border-b border-slate-700" style={grid}>
          <span className="text-[11px] font-bold text-slate-300 truncate">{baselineLabel}</span>
          <span className="text-xs font-bold text-slate-300 text-right tabular-nums">{baseline?.count ?? '—'}</span>
          {columns.map((c) => (
            <span key={c.key} className="text-xs font-bold text-slate-300 text-right tabular-nums">
              {fmt(baseline?.[c.key], c.kind)}
            </span>
          ))}
        </div>

        {shown.map((r) => (
          <div key={r.label} className="grid gap-x-3 items-baseline py-1.5 border-b border-slate-800/50" style={grid}>
            <span className="text-[11px] text-slate-400 truncate" title={r.label}>{r.label}</span>
            <span className="text-xs text-slate-300 text-right tabular-nums">{r.count}</span>
            {columns.map((c) => (
              <span key={c.key} className={`text-xs font-semibold text-right tabular-nums ${tone(c, r[c.key])}`}>
                {fmt(r[c.key], c.kind)}
              </span>
            ))}
          </div>
        ))}

        {sorted.length === 0 && (
          <p className="text-xs text-slate-500 py-3 text-center">Nothing to compare in this period</p>
        )}
      </div>

      <div className="flex items-center gap-3 mt-2">
        {sorted.length > initialShown && (
          <button onClick={() => setShowAll((s) => !s)} className="text-[11px] font-bold text-emerald-400">
            {showAll ? 'Show top ' + initialShown : `Show all ${sorted.length}`}
          </button>
        )}
        {footnote && <span className="text-[10px] text-slate-600">{footnote}</span>}
      </div>
    </div>
  )
}
