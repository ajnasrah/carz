import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Upload, Download, ArrowLeft, Copy, Check, AlertTriangle, RefreshCw } from 'lucide-react'
import XLSXWriter from '../services/xlsxWriter'
import { copyText } from '../native/clipboard'
import {
  parseCSV, detectFormat, fetchSoldBook, cleanBook, indexBook, scoreRunList,
  TARGET_PROFIT, TARGET_DAYS,
} from '../services/targetBuyList'

const money = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`)
const num = (n) => (n == null ? '—' : Math.round(n).toLocaleString())

const VERDICT = {
  TARGET: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  WATCH: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  PASS: 'bg-slate-500/10 text-slate-400 border-slate-600/30',
}
const CONF = { HIGH: 'text-emerald-400', MEDIUM: 'text-yellow-400', LOW: 'text-slate-400', NONE: 'text-slate-600' }

// Every column the auction gave us, plus what our sold book says about it.
const COLUMNS = [
  // VIN sits up front, not out past the stats. Manheim/OVE timed sales carry
  // no run number, lane or lot, so on those lists the VIN is the only thing
  // that identifies the car at all.
  ['Rank', 'rank', 6], ['Verdict', 'verdict', 10], ['VIN', 'vin', 20], ['Confidence', 'confidence', 11],
  ['Exact Matches', 'exactN', 13], ['Exact Avg Profit', 'exactProfit', 15],
  ['Exact Med Profit', 'exactMedProfit', 15], ['Exact Avg Days', 'exactDays', 13],
  ['Exact % Cleared $1k', 'exactHit', 18], ['Exact % Lost Money', 'exactLoss', 18],
  ['Shared Comps', 'compShared', 12],
  ['Same-Yr Sold', 'sameYearN', 12], ['Same-Yr Avg Profit', 'sameYearProfit', 17],
  ['Run #', 'run', 9], ['Lane', 'lane', 6], ['Lot', 'lot', 7], ['Sale Date', 'saleDate', 11],
  ['Year', 'year', 6], ['Make', 'make', 14], ['Model', 'model', 18], ['Trim / Style', 'style', 18],
  ['Miles', 'odo', 10], ['Color', 'color', 11], ['CR Grade', 'grade', 9], ['Has CR', 'hasCR', 7],
  ['Photos', 'pics', 7], ['Drivetrain', 'drivetrain', 11], ['Engine', 'engine', 16],
  ['Transmission', 'transmission', 13], ['Fuel', 'fuel', 9],
  ['Context Avg Profit', 'meanProfit', 17], ['Context Avg Days', 'meanDays', 16],
  ['Context Cars', 'n', 12], ['Context Tier', 'tier', 12],
  ['Our Median Resale', 'medResale', 16], ['MMR / Auction Value', 'auctionValue', 18],
  ['Why', 'why', 70], ['Stock', 'stock', 11],
  ['Seller', 'seller', 22], ['Location', 'location', 22], ['Channel', 'channel', 12],
  ['Title Status', 'titleStatus', 13], ['Announcements', 'announcements', 30],
]

// Identifier columns must stay text. "4-0131" imports as a number and
// "5E-0027" as scientific notation (5.00E-27) if the cell has no explicit text
// format — which also splits sorting into a number block and a text block.
const TEXT_KEYS = new Set(['run', 'lane', 'lot', 'stock', 'vin', 'saleDate', 'grade'])
const MONEY_KEYS = new Set(['meanProfit', 'medProfit', 'medResale', 'auctionValue', 'exactProfit', 'exactMedProfit', 'sameYearProfit'])
const INT_KEYS = new Set(['odo', 'meanDays', 'hitRate', 'n', 'pics', 'rank', 'year', 'exactN', 'exactDays', 'exactHit', 'exactLoss', 'compShared', 'sameYearN'])

export default function ListBuilder() {
  const [book, setBook] = useState(null) // { byMake, size, autoCount, storedCount, removed }
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null) // { scored, fmt, fileName, duplicatesDropped }
  const [filter, setFilter] = useState('ACTION') // ACTION | TARGET | WATCH | ALL
  const [copied, setCopied] = useState('')

  useEffect(() => { loadBook() }, [])

  async function loadBook() {
    setLoading(true); setErr('')
    try {
      const { rows, total, from, to } = await fetchSoldBook()
      if (!rows.length) throw new Error('Sold book is empty — list_all_sold() returned nothing.')
      const { book: cleaned, removedOutliers, removedPassthrough } = cleanBook(rows)
      setBook({
        byMake: indexBook(cleaned),
        size: cleaned.length,
        raw: total,
        from,
        to,
        removedOutliers,
        removedPassthrough,
      })
    } catch (e) {
      setErr(e.message || String(e))
    } finally { setLoading(false) }
  }

  async function onFile(file) {
    if (!file || !book) return
    setBusy(`Reading ${file.name}…`); setErr(''); setResult(null)
    try {
      const raw = parseCSV(await file.text())
      if (!raw.length) throw new Error('That file has no rows.')
      const fmt = detectFormat(raw)
      if (!fmt) {
        throw new Error('Unrecognised run list. Supported: Edge Pipeline, ADESA, Manheim.')
      }
      const { scored, duplicatesDropped } = scoreRunList(raw, fmt, book.byMake)
      setResult({ scored, fmt, fileName: file.name, duplicatesDropped })
      setFilter('ACTION')
    } catch (e) {
      setErr(e.message || String(e))
    } finally { setBusy('') }
  }

  const counts = useMemo(() => {
    if (!result) return null
    const c = { TARGET: 0, WATCH: 0, PASS: 0 }
    for (const r of result.scored) c[r.verdict]++
    return c
  }, [result])

  const visible = useMemo(() => {
    if (!result) return []
    if (filter === 'ALL') return result.scored
    if (filter === 'ACTION') return result.scored.filter((c) => c.verdict !== 'PASS')
    return result.scored.filter((c) => c.verdict === filter)
  }, [result, filter])

  function downloadExcel() {
    if (!result) return
    const S = XLSXWriter.S
    const verdictStyle = { TARGET: S.GREEN, WATCH: S.YELLOW, PASS: S.DEFAULT }

    const rows = [COLUMNS.map(([h]) => ({ v: h, s: S.HEADER }))]
    for (const c of result.scored) {
      rows.push(COLUMNS.map(([, key]) => {
        const v = c[key]
        if (key === 'verdict') return { v, s: verdictStyle[v] }
        if (v == null || v === '') return ''
        if (TEXT_KEYS.has(key)) return { v: String(v), s: S.TEXT }
        if (key === 'hasCR') return v ? 'Y' : ''
        if (MONEY_KEYS.has(key)) {
          const n = Number(v)
          return Number.isFinite(n) ? { v: Math.round(n), s: S.MONEY } : ''
        }
        if (INT_KEYS.has(key)) {
          const n = Number(v)
          if (!Number.isFinite(n)) return ''
          // years are plain digits; everything else reads better grouped
          return key === 'year' ? n : { v: Math.round(n), s: S.NUMBER }
        }
        return v
      }))
    }

    const blob = XLSXWriter.build({
      sheetName: 'Target Buy List',
      rows,
      widths: COLUMNS.map(([, , w]) => w),
    })
    const src = result.fmt.id.replace(/_/g, '-')
    // download() writes a file and opens the share sheet on native, so it can
    // reject (no disk, share extension crash). Swallow it rather than leave an
    // unhandled rejection — cancelling the sheet already resolves false.
    XLSXWriter.download(blob, `target-buy-list-${src}-${new Date().toISOString().slice(0, 10)}.xlsx`)
      .catch((err) => console.error('Target buy list export failed', err))
  }

  function copyList(kind) {
    if (!result) return
    const targets = result.scored.filter((c) => c.verdict === 'TARGET')
    const text = targets.map((c) => (kind === 'runs' ? c.run : c.vin)).filter(Boolean).join('\n')
    copyText(text).then(() => {
      setCopied(kind)
      setTimeout(() => setCopied(''), 1500)
    })
  }

  // Last 6 is enough to recognise a car but not to search for one — copy hands
  // back the full 17.
  function copyVin(vin) {
    copyText(vin).then(() => {
      setCopied(vin)
      setTimeout(() => setCopied(''), 1000)
    })
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-[1600px] mx-auto px-4 py-5">
        <div className="flex items-center gap-3 mb-1">
          <Link to="/" className="text-slate-400 hover:text-slate-200"><ArrowLeft size={20} /></Link>
          <h1 className="text-xl font-bold">List Builder</h1>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Upload an auction run list. Every car is cross-checked against what we've actually sold —
          matched on year, make, model and mileage. A <span className="text-emerald-400 font-medium">TARGET</span> is
          a car whose matches averaged over {money(TARGET_PROFIT)} profit and moved in under {TARGET_DAYS} days.
        </p>

        {/* Sold book status */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 mb-4 text-sm">
          {loading ? (
            <span className="text-slate-400">Loading sold book…</span>
          ) : book ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="text-slate-300">
                Sold book: <span className="font-semibold text-slate-100">{book.size.toLocaleString()}</span> cars
              </span>
              <span className="text-slate-500 text-xs">
                {book.from} → {book.to} · {book.removedOutliers.length} outliers and{' '}
                {book.removedPassthrough.length} pass-throughs removed
              </span>
              <button onClick={loadBook} className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1">
                <RefreshCw size={12} /> refresh
              </button>

            </div>
          ) : null}
        </div>

        {/* Upload */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <label className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium cursor-pointer
            ${book ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}>
            <Upload size={16} />
            {busy || 'Upload Run List'}
            <input type="file" accept=".csv" className="hidden" disabled={!book}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onFile(f) }} />
          </label>
          <span className="text-xs text-slate-500">Edge Pipeline · ADESA · Manheim</span>

          {result && (
            <>
              <button onClick={downloadExcel}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium">
                <Download size={16} /> Download Excel
              </button>
              <button onClick={() => copyList('runs')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">
                {copied === 'runs' ? <Check size={14} /> : <Copy size={14} />} Run #s
              </button>
              <button onClick={() => copyList('vins')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">
                {copied === 'vins' ? <Check size={14} /> : <Copy size={14} />} VINs
              </button>
            </>
          )}
        </div>

        {err && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 px-4 py-3 mb-4 text-sm">{err}</div>
        )}

        {result && counts && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-sm text-slate-400 mr-1">
                {result.fmt.label} · {result.scored.length} cars
                {result.duplicatesDropped > 0 && ` · ${result.duplicatesDropped} duplicates collapsed`}
              </span>
              {[
                ['ACTION', `Targets + Watch (${counts.TARGET + counts.WATCH})`],
                ['TARGET', `Target (${counts.TARGET})`],
                ['WATCH', `Watch (${counts.WATCH})`],
                ['ALL', `All (${result.scored.length})`],
              ].map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors
                    ${filter === key ? 'bg-slate-100 text-slate-900 border-slate-100' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-slate-400 text-xs uppercase tracking-wide">
                  <tr>
                    {['Run', 'Lane', 'Vehicle', 'Trim', 'Miles', 'CR', 'Avg Profit', 'Median', 'Days', 'Hit', 'n', 'Tier', 'Conf', 'MMR', 'VIN']
                      .map((h) => <th key={h} className="text-left font-medium px-2.5 py-2 whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <tr key={c.vin || c.rank} className="border-t border-slate-800/70 hover:bg-slate-900/40" title={c.why}>
                      <td className="px-2.5 py-1.5 font-mono text-xs whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-semibold mr-1.5 ${VERDICT[c.verdict]}`}>
                          {c.verdict[0]}
                        </span>
                        {c.run || '—'}
                      </td>
                      <td className="px-2.5 py-1.5 text-slate-400">{c.lane || '—'}</td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">{[c.year, c.make, c.model].filter(Boolean).join(' ')}</td>
                      <td className="px-2.5 py-1.5 text-slate-400 max-w-[160px] truncate">{c.style || '—'}</td>
                      <td className="px-2.5 py-1.5 tabular-nums">{num(c.odo)}</td>
                      <td className="px-2.5 py-1.5 text-slate-400">{c.grade || '—'}</td>
                      <td className={`px-2.5 py-1.5 tabular-nums font-semibold ${c.meanProfit > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                        {money(c.meanProfit)}
                      </td>
                      <td className="px-2.5 py-1.5 tabular-nums text-slate-400">{money(c.medProfit)}</td>
                      <td className="px-2.5 py-1.5 tabular-nums">{c.meanDays == null ? '—' : Math.round(c.meanDays)}</td>
                      <td className="px-2.5 py-1.5 tabular-nums text-slate-400">{c.hitRate == null ? '—' : `${Math.round(c.hitRate)}%`}</td>
                      <td className="px-2.5 py-1.5 tabular-nums text-slate-400">{c.n || '—'}</td>
                      <td className="px-2.5 py-1.5 text-slate-400 text-xs">{c.tier || '—'}</td>
                      <td className={`px-2.5 py-1.5 text-xs font-medium ${CONF[c.confidence]}`}>
                        {c.confidence === 'NONE' ? '—' : c.confidence}
                      </td>
                      <td className="px-2.5 py-1.5 tabular-nums text-slate-400">{money(c.auctionValue)}</td>
                      <td className="px-2.5 py-1.5 font-mono text-[11px] text-slate-500">
                        {c.vin
                          ? <button onClick={() => copyVin(c.vin)} title={`${c.vin} — click to copy`}
                              className="hover:text-slate-200 border-b border-dotted border-slate-700">
                              {copied === c.vin ? 'copied' : c.vin.slice(-6)}
                            </button>
                          : '—'}
                      </td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr><td colSpan={15} className="px-3 py-8 text-center text-slate-500">
                      Nothing on this list met the bar.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Hover a row for the full reasoning. The Excel download carries every column the auction
              provided plus the sold-book stats — {COLUMNS.length} in total.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
