import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Upload, Download, ArrowLeft, Copy, Check, AlertTriangle, RefreshCw, ExternalLink, Trash2 } from 'lucide-react'
import XLSXWriter from '../services/xlsxWriter'
import { copyText } from '../native/clipboard'
import {
  parseCSV, parseCarmaxPdf, detectFormat, fetchSoldBook, cleanBook, indexBook, scoreRunList,
  TARGET_PROFIT, TARGET_DAYS, DIRECT_URL,
} from '../services/targetBuyList'
import {
  saveRunList, listSavedRunLists, loadRunList, loadLatestRunList, saveOpened, deleteRunList,
} from '../services/targetRunLists'

// Matches the extension. Five, not fifty — fifty is how many windows a browser
// will accept before it refuses, not how many a person can work, and on a
// 50-car list it took a laptop down. Five is a screenful you can review, proxy
// and close before pressing again. `opened` below is what makes the next press
// pick up where this one stopped.
const OPEN_BATCH = 5

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
  const [opened, setOpened] = useState(() => new Set()) // VINs already sent to a tab
  const [openNote, setOpenNote] = useState('')
  const [saved, setSaved] = useState([])       // recent lists, either surface
  const [restoring, setRestoring] = useState(true)
  // Uploading a file can beat the restore back — the restore reads a whole
  // scored list out of Postgres. Whichever the user asked for last wins, and
  // that is always the upload.
  const uploaded = useRef(false)

  // The book and the last list are independent pulls — the list doesn't wait on
  // six thousand sold cars to come back before it's on screen.
  useEffect(() => { loadBook(); restoreLast() }, [])

  // A scored list survived being closed, so open where it was left. This is the
  // whole point of saving them: at a sale you put the phone down, come back,
  // and the list you built an hour ago is still the list.
  async function restoreLast() {
    setRestoring(true)
    try {
      const [last, recent] = await Promise.all([
        loadLatestRunList(),
        listSavedRunLists().catch(() => []),
      ])
      setSaved(recent)
      if (last && !uploaded.current) {
        setResult(last)
        setOpened(last.opened)
        setFilter('ACTION')
      }
    } catch (e) {
      // A restore that fails is an empty page, not a broken one — say so in the
      // status line and leave Upload working.
      console.error('restoring the last run list failed', e)
    } finally { setRestoring(false) }
  }

  async function openSaved(id) {
    if (id === result?.id) return
    setBusy('Loading…'); setErr('')
    try {
      const list = await loadRunList(id)
      if (!list) throw new Error('That list is no longer saved.')
      setResult(list)
      setOpened(list.opened)
      setFilter('ACTION'); setOpenNote('')
    } catch (e) {
      setErr(e.message || String(e))
    } finally { setBusy('') }
  }

  async function forgetSaved(id) {
    try {
      await deleteRunList(id)
      setSaved((s) => s.filter((r) => r.id !== id))
      if (id === result?.id) { setResult(null); setOpened(new Set()); setOpenNote('') }
    } catch (e) { setErr(e.message || String(e)) }
  }

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
    uploaded.current = true
    setBusy(`Reading ${file.name}…`); setErr(''); setResult(null)
    try {
      // CarMax publishes its run list as a PDF; everyone else sends a CSV.
      const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
      const raw = isPdf
        ? await parseCarmaxPdf(await file.arrayBuffer())
        : parseCSV(await file.text())
      if (!raw.length) {
        throw new Error(isPdf
          ? "Couldn't read any vehicles out of that PDF. CarMax run lists work; a scanned or printed-to-PDF list won't."
          : 'That file has no rows.')
      }
      const fmt = detectFormat(raw)
      if (!fmt) {
        throw new Error('Unrecognised run list. Supported: Edge Pipeline, ADESA, Manheim, CarMax.')
      }
      const { scored, duplicatesDropped } = scoreRunList(raw, fmt, book.byMake)
      setResult({ scored, fmt, fileName: file.name, duplicatesDropped })
      setFilter('ACTION')
      setOpened(new Set()); setOpenNote('')

      // Saved straight away, before anything is done with it, so the minute of
      // scoring can't be lost to a closed tab. A save that fails leaves the
      // list on screen and working — it just won't be there tomorrow.
      setBusy('Saving…')
      try {
        const id = await saveRunList({ scored, fmt, fileName: file.name, bookSize: book.size })
        setResult((r) => (r ? { ...r, id } : r))
        setSaved(await listSavedRunLists())
      } catch (e) {
        console.error(e)
        setErr(`Scored fine, but it couldn't be saved (${e.message}) — it'll be gone if you leave this page.`)
      }
    } catch (e) {
      setErr(e.message || String(e))
    } finally { setBusy('') }
  }

  const counts = useMemo(() => {
    if (!result) return null
    const c = { TARGET: 0, WATCH: 0, PASS: 0, 'NO DATA': 0 }
    for (const r of result.scored) c[r.verdict]++
    return c
  }, [result])

  // The builder for whichever site this run list's cars live on, or null when
  // the source has no VIN-addressable URL (Edge Pipeline).
  const linkFor = result ? DIRECT_URL[result.fmt.id] : null

  // Cars in a band that can actually be opened: scored that way, carrying a
  // VIN to build the URL from, and not already sent to a tab.
  const bandQueue = (band) => (result?.scored || [])
    .filter((c) => c.verdict === band && c.vin && !opened.has(c.vin))

  const bandTotal = (band) => (result?.scored || [])
    .filter((c) => c.verdict === band && c.vin).length

  // Open progress rides with the saved list, so picking the list up on the
  // laptop after working it on the phone doesn't offer all forty targets again.
  function markOpened(next) {
    setOpened(next)
    if (result?.id) saveOpened(result.id, next)
  }

  // TARGET and WATCH open separately — one means "bid on this", the other
  // "keep an eye on it", and opening both at once buries the handful that
  // matter in a pile that doesn't.
  function openBand(band) {
    if (!linkFor) return
    const queue = bandQueue(band)
    if (!queue.length) {
      setOpenNote(bandTotal(band)
        ? `Every ${band.toLowerCase()} is already open — Reset to go again.`
        : `No ${band.toLowerCase()} cars on this list.`)
      return
    }
    const batch = queue.slice(0, OPEN_BATCH)
    // Synchronous inside the click so the browser still counts this as the
    // user gesture that authorised the tabs.
    const next = new Set(opened)
    let blocked = 0
    for (const c of batch) {
      const w = window.open(linkFor(c.vin), '_blank', 'noopener')
      if (w) next.add(c.vin)   // a blocked car stays queued for the next press
      else blocked++
    }
    markOpened(next)
    const left = queue.length - batch.length
    setOpenNote(blocked
      ? `Opened ${batch.length - blocked} of ${batch.length}. Your browser blocked ${blocked} — `
        + `allow pop-ups for this site, then press again; the blocked cars are still queued.`
      : `Opened ${batch.length} ${band.toLowerCase()}${left ? ` · ${left} left, press again` : ''}.`)
  }

  const visible = useMemo(() => {
    if (!result) return []
    if (filter === 'ALL') return result.scored
    // TARGET and WATCH only. `verdict !== 'PASS'` also swept in NO DATA — cars
    // with too few exact comps to judge — which then showed whatever their loose
    // context cohort averaged, so the default view was full of $171 and $0 rows
    // that no verdict rested on.
    if (filter === 'ACTION') return result.scored.filter((c) => c.verdict === 'TARGET' || c.verdict === 'WATCH')
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
    <div className="min-h-screen bg-slate-950 text-slate-100 safe-top">
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

        {/* Saved lists — the same rows the extension writes, so a list scored in
            the popup at the sale is here, and one scored here is there. */}
        {(restoring || saved.length > 0) && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 mb-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500 mr-1">
                {restoring ? 'Looking for your last list…' : 'Saved lists'}
              </span>
              {saved.map((s) => (
                <span key={s.id}
                  className={`group inline-flex items-center rounded-full border text-xs transition-colors
                    ${s.id === result?.id
                      ? 'bg-slate-100 text-slate-900 border-slate-100'
                      : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}>
                  <button onClick={() => openSaved(s.id)} className="pl-3 pr-1.5 py-1"
                    title={`${s.car_count} cars · scored ${new Date(s.created_at).toLocaleString()}`
                      + ` · from the ${s.built_by === 'extension' ? 'extension' : 'web app'}`}>
                    {s.source_label || s.source_id}
                    {s.sale_date ? ` · ${s.sale_date}` : ''}
                    <span className="opacity-60"> · {s.target_count}T/{s.watch_count}W</span>
                  </button>
                  <button onClick={() => forgetSaved(s.id)} title="delete this saved list"
                    className="pr-2 pl-0.5 py-1 opacity-0 group-hover:opacity-60 hover:!opacity-100">
                    <Trash2 size={11} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Upload */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <label className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium cursor-pointer
            ${book ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}>
            <Upload size={16} />
            {busy || 'Upload Run List'}
            <input type="file" accept=".csv,.pdf" className="hidden" disabled={!book}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onFile(f) }} />
          </label>
          <span className="text-xs text-slate-500">Edge Pipeline · ADESA · Manheim · CarMax (PDF)</span>

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
                {result.savedAt && ` · scored ${new Date(result.savedAt).toLocaleString()}`
                  + `${result.builtBy === 'extension' ? ' in the extension' : ''}`}
              </span>
              {[
                ['ACTION', `Targets + Watch (${counts.TARGET + counts.WATCH})`],
                ['TARGET', `Target (${counts.TARGET})`],
                ['WATCH', `Watch (${counts.WATCH})`],
                // Its own band rather than riding along in ACTION: too few exact
                // comps to judge is not the same as worth a look.
                ['NO DATA', `No data (${counts['NO DATA']})`],
                ['ALL', `All (${result.scored.length})`],
              ].map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors
                    ${filter === key ? 'bg-slate-100 text-slate-900 border-slate-100' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-3">
              {linkFor ? (
                <>
                  <button onClick={() => openBand('TARGET')} disabled={!bandTotal('TARGET')}
                    title={`Open TARGET cars only, ${OPEN_BATCH} at a time — press again for the next ${OPEN_BATCH}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold
                      bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white transition-colors">
                    <ExternalLink size={13} /> Open Target ({Math.min(OPEN_BATCH, bandQueue('TARGET').length)} of {bandQueue('TARGET').length} left)
                  </button>
                  <button onClick={() => openBand('WATCH')} disabled={!bandTotal('WATCH')}
                    title={`Open WATCH cars only, ${OPEN_BATCH} at a time — press again for the next ${OPEN_BATCH}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold
                      bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:hover:bg-amber-600 text-white transition-colors">
                    <ExternalLink size={13} /> Open Watch ({Math.min(OPEN_BATCH, bandQueue('WATCH').length)} of {bandQueue('WATCH').length} left)
                  </button>
                  {opened.size > 0 && (
                    <button onClick={() => { markOpened(new Set()); setOpenNote('') }}
                      title="offer every car again from the top"
                      className="px-3 py-1 rounded-md text-xs font-medium border border-slate-700 text-slate-400 hover:text-slate-200">
                      Reset opens
                    </button>
                  )}
                  <span className="text-xs text-slate-500">{openNote}</span>
                </>
              ) : (
                <span className="text-xs text-slate-500">
                  {result.fmt.label} listings are only reachable by an internal id, not by VIN, so they
                  can't be opened from here — use the browser extension, which reads the links off the
                  results page. Copy VINs below and search them on the auction site instead.
                </span>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-slate-400 text-xs uppercase tracking-wide">
                  <tr>
                    {/* Profit / Median / Days / Hit / n are the EXACT cohort —
                        same year, ±20k mi — because that is the only cohort the
                        verdict is allowed to rest on. The loose tiers sit in one
                        dimmed Context column so they can't be mistaken for it. */}
                    {[
                      ['Run'], ['Lane'], ['Vehicle'], ['Trim'], ['Miles'], ['CR'],
                      ['Avg Profit', 'average net profit on exact comps'],
                      ['Median', 'median net profit on exact comps'],
                      ['Days', 'average days on lot for exact comps'],
                      ['Hit', '% of exact comps that cleared $1k'],
                      ['n', 'exact comps: same year, ±20k mi'],
                      ['Context', 'looser cohort — background only, never sets the verdict'],
                      ['Conf'], ['MMR'], ['VIN'], [''],
                    ].map(([h, tip], i) => (
                      <th key={h || `open-${i}`} title={tip}
                        className="text-left font-medium px-2.5 py-2 whitespace-nowrap">{h}</th>
                    ))}
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
                      <td className={`px-2.5 py-1.5 tabular-nums font-semibold ${c.exactProfit > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                        {money(c.exactProfit)}
                      </td>
                      <td className="px-2.5 py-1.5 tabular-nums text-slate-400">{money(c.exactMedProfit)}</td>
                      <td className="px-2.5 py-1.5 tabular-nums">{c.exactDays == null ? '—' : Math.round(c.exactDays)}</td>
                      <td className="px-2.5 py-1.5 tabular-nums text-slate-400">{c.exactHit == null ? '—' : `${Math.round(c.exactHit)}%`}</td>
                      <td className="px-2.5 py-1.5 tabular-nums text-slate-400">{c.exactN || '—'}</td>
                      <td className="px-2.5 py-1.5 text-slate-500 text-xs whitespace-nowrap"
                        title={c.tier ? `${c.n} cars in the ${c.tier} cohort — context only` : ''}>
                        {c.meanProfit == null ? '—' : `${money(c.meanProfit)} · ${c.tier} (${c.n})`}
                      </td>
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
                      {/* A real link rather than a scripted window.open, so a
                          single car always opens even with pop-ups blocked. */}
                      <td className="px-2.5 py-1.5">
                        {linkFor && c.vin
                          ? <a href={linkFor(c.vin)} target="_blank" rel="noopener noreferrer"
                              title="open this car on the auction site"
                              onClick={() => markOpened(new Set(opened).add(c.vin))}
                              className="text-slate-500 hover:text-emerald-400 inline-flex">
                              <ExternalLink size={13} />
                            </a>
                          : null}
                      </td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr><td colSpan={16} className="px-3 py-8 text-center text-slate-500">
                      Nothing on this list met the bar.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Hover a row for the full reasoning. Click a VIN to copy it in full.
              {linkFor && ' The ↗ on a row opens that one car; Open Target and Open Watch '
                + `open a whole band ${OPEN_BATCH} at a time, built straight from the VIN, so nothing gets skipped.`}
              {' '}The Excel download carries every column the auction provided plus the sold-book
              stats — {COLUMNS.length} in total.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
