import { useEffect, useMemo, useState } from 'react'
import { Upload, Copy, Mail, Phone, Check, ChevronDown, ChevronUp, RefreshCw, Sparkles, ExternalLink } from 'lucide-react'
import { recommendAll } from '../services/buyerMatch'
import {
  parseCSV, mapActiveRow, mapSoldRow, fetchActiveCars, fetchSoldSales,
  saveActive, saveSold, saveRecommendations,
} from '../services/buyerMatchData'
import { triggerGhlSync, seedGhlBuyers } from '../services/ghlSync'

const money = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`)
const CONF = {
  high: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  medium: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  low: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}

export default function BuyerMatch() {
  const [active, setActive] = useState([])
  const [sold, setSold] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [spread, setSpread] = useState(true)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [copied, setCopied] = useState('')
  const [ghl, setGhl] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const [a, s] = await Promise.all([fetchActiveCars(), fetchSoldSales()])
      setActive(a); setSold(s)
    } catch (e) {
      // Tables may not exist yet — fall back to upload-only mode.
      setErr(e.message?.includes('does not exist') ? '' : (e.message || String(e)))
    } finally { setLoading(false) }
  }

  async function onFile(kind, file) {
    if (!file) return
    setBusy(`Reading ${file.name}…`); setErr('')
    try {
      const text = await file.text()
      const raw = parseCSV(text)
      let nextActive = active, nextSold = sold
      if (kind === 'active') {
        nextActive = raw.map(mapActiveRow).filter((r) => r.vin)
        setActive(nextActive)
        setBusy('Saving active list…')
        await saveActive(nextActive).catch(() => {})  // best-effort persist
      } else {
        const rows = raw.map(mapSoldRow).filter((r) => r.vin && r.buyer_name)
        // merge into current sold (dedupe by VIN, newest wins)
        const byVin = new Map(sold.map((r) => [r.vin, r]))
        for (const r of rows) byVin.set(r.vin, r)
        nextSold = [...byVin.values()]
        setSold(nextSold)
        setBusy('Saving sold history…')
        await saveSold(rows).catch(() => {})
        // New sold rows carry buyer contacts → push any never-contacted buyers to GHL.
        setBusy('Syncing new leads to GHL…')
        const r = await triggerGhlSync()
        setGhl(r.ok ? `GHL: ${r.pushed} new lead${r.pushed === 1 ? '' : 's'} pushed${r.failed ? `, ${r.failed} failed` : ''}` : `GHL sync failed: ${r.error}`)
      }
      // Cache the computed picks so they're queryable (extension / future marketplace surface).
      if (nextActive.length && nextSold.length) {
        await saveRecommendations(recommendAll(nextActive, nextSold, { spread: { enabled: spread } })).catch(() => {})
      }
    } catch (e) { setErr(e.message || String(e)) }
    finally { setBusy('') }
  }

  async function onSeedGhl(file) {
    if (!file) return
    setBusy('Seeding existing GHL opportunities…'); setErr(''); setGhl('')
    try {
      const { seeded, skipped } = await seedGhlBuyers(await file.text())
      setGhl(`Seeded ${seeded} existing GHL contact${seeded === 1 ? '' : 's'} (skipped ${skipped} with no phone/email/name).`)
    } catch (e) { setErr(e.message || String(e)) }
    finally { setBusy('') }
  }

  async function syncNow() {
    setBusy('Syncing new leads to GHL…'); setGhl('')
    const r = await triggerGhlSync()
    setGhl(r.ok ? `GHL: ${r.pushed} new lead${r.pushed === 1 ? '' : 's'} pushed of ${r.candidates} candidate${r.candidates === 1 ? '' : 's'}${r.failed ? `, ${r.failed} failed` : ''}` : `GHL sync failed: ${r.error}`)
    setBusy('')
  }

  const results = useMemo(() => {
    if (!active.length || !sold.length) return []
    return recommendAll(active, sold, { spread: { enabled: spread } })
  }, [active, sold, spread])

  const byVin = useMemo(() => new Map(active.map((c) => [c.vin, c])), [active])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return results
    return results.filter((r) => {
      const c = byVin.get(r.vin)
      return c && `${c.year} ${c.make} ${c.model} ${c.trim} ${c.vin}`.toLowerCase().includes(q)
    })
  }, [results, query, byVin])

  function copy(text, tag) {
    navigator.clipboard?.writeText(text)
    setCopied(tag); setTimeout(() => setCopied(''), 1200)
  }

  function outreach(car, rec) {
    const v = `${car.year} ${car.make} ${car.model}${car.trim ? ' ' + car.trim : ''}`
    const subject = `${v} available — ${car.odometer?.toLocaleString()} mi`
    const body =
      `Hi,\n\nWe have a ${v} (VIN ${car.vin}, ${car.odometer?.toLocaleString()} mi) on SmartAuction now.` +
      ` Based on your buying history I thought it'd be a fit — asking around ${money(rec.predicted_price)}.` +
      `${car.detail_url ? `\n\n${car.detail_url}` : ''}\n\nLet me know if you want it. Thanks!`
    return { subject, body }
  }

  if (loading) return <Shell><p className="text-slate-400 p-4">Loading…</p></Shell>

  const needData = !active.length || !sold.length

  return (
    <Shell>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-xl font-bold text-emerald-400 flex items-center gap-2">
            <Sparkles size={20} /> Buyer Match
          </h1>
          <p className="text-xs text-slate-400">
            {active.length} active · {sold.length.toLocaleString()} sold (training)
          </p>
        </div>
        <div className="flex items-center gap-1">
          <a href="/listings" target="_blank" rel="noreferrer" className="p-2 text-slate-400 hover:text-emerald-400" title="Public listings">
            <ExternalLink size={18} />
          </a>
          <button onClick={load} className="p-2 text-slate-400 hover:text-emerald-400" title="Reload">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {err && <div className="mb-3 p-2 rounded bg-red-500/15 text-red-300 text-sm border border-red-500/30">{err}</div>}
      {busy && <div className="mb-3 p-2 rounded bg-emerald-500/15 text-emerald-300 text-sm">{busy}</div>}
      {ghl && <div className="mb-3 p-2 rounded bg-sky-500/15 text-sky-300 text-sm border border-sky-500/30">{ghl}</div>}

      {/* Upload zone */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <UploadBox label="Active list" sub="InventoryResults.csv" onPick={(f) => onFile('active', f)} done={active.length > 0} />
        <UploadBox label="Sold list" sub="Sold export" onPick={(f) => onFile('sold', f)} done={sold.length > 0} />
      </div>

      {/* GHL lead sync */}
      <div className="flex items-center gap-2 mb-4 text-xs">
        <label className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-slate-600 bg-slate-800/40 text-slate-300 cursor-pointer hover:border-sky-500/50">
          <Upload size={13} /> Seed GHL opportunities
          <input type="file" accept=".csv" className="hidden" onChange={(e) => onSeedGhl(e.target.files?.[0])} />
        </label>
        <button onClick={syncNow} className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20">
          <RefreshCw size={13} /> Sync new leads to GHL
        </button>
      </div>

      {needData ? (
        <p className="text-slate-400 text-sm p-4 text-center">
          Upload the SmartAuction <b>active</b> list and a <b>sold</b> report to see the top-3 buyers for each car.
          Sold data accumulates — upload daily to keep training the model.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3">
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search make / model / VIN"
              className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500"
            />
            <label className="flex items-center gap-1.5 text-xs text-slate-300 whitespace-nowrap">
              <input type="checkbox" checked={spread} onChange={(e) => setSpread(e.target.checked)} className="accent-emerald-500" />
              Spread
            </label>
          </div>

          <div className="space-y-3">
            {filtered.map((res) => {
              const car = byVin.get(res.vin)
              if (!car) return null
              const open = expanded === res.vin
              const top = res.recommendations[0]
              return (
                <div key={res.vin} className="bg-slate-800/60 border border-slate-700 rounded-lg overflow-hidden">
                  <button onClick={() => setExpanded(open ? null : res.vin)} className="w-full text-left p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-100 truncate">
                          {car.year} {car.make} {car.model} <span className="text-slate-400 font-normal">{car.trim}</span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {car.odometer?.toLocaleString()} mi · Buy Now {money(car.buy_now)} · est. value {money(res.value)}
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">{res.segment}/{res.tier}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {top ? (
                          <>
                            <div className="text-emerald-400 font-bold">{money(top.predicted_price)}</div>
                            <div className="text-[10px] text-slate-500 truncate max-w-[110px]">{top.buyer_name}</div>
                          </>
                        ) : <span className="text-xs text-slate-500">no match</span>}
                        {open ? <ChevronUp size={16} className="inline text-slate-500 mt-1" /> : <ChevronDown size={16} className="inline text-slate-500 mt-1" />}
                      </div>
                    </div>
                  </button>

                  {open && (
                    <div className="border-t border-slate-700 divide-y divide-slate-700/60">
                      {res.recommendations.length === 0 && (
                        <p className="text-xs text-slate-500 p-3">No buyer history matches this car yet (cold start).</p>
                      )}
                      {res.recommendations.map((rec) => {
                        const { subject, body } = outreach(car, rec)
                        const mailto = rec.buyer_email
                          ? `mailto:${rec.buyer_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null
                        const sms = rec.buyer_phone ? `sms:${rec.buyer_phone}?&body=${encodeURIComponent(body)}` : null
                        return (
                          <div key={rec.rank} className="p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="w-5 h-5 rounded-full bg-slate-700 text-slate-200 text-xs flex items-center justify-center shrink-0">{rec.rank}</span>
                                <span className="font-medium text-slate-100 truncate">{rec.buyer_name}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${CONF[rec.confidence]}`}>{rec.confidence}</span>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-emerald-400 font-semibold leading-tight">{money(rec.predicted_price)}</div>
                                {rec.buyer_avg_price != null && (
                                  <div className="text-[10px] text-slate-400 leading-tight">
                                    avg paid {money(rec.buyer_avg_price)} · {rec.buyer_seg_count ? `${rec.buyer_seg_count} ${res.segment}${rec.buyer_seg_count > 1 ? 's' : ''}` : 'overall'}
                                  </div>
                                )}
                              </div>
                            </div>
                            <p className="text-xs text-slate-400 mt-1 ml-7">{rec.reason}</p>
                            <div className="flex flex-wrap gap-1.5 mt-2 ml-7">
                              {rec.buyer_email && (
                                <Action onClick={() => copy(rec.buyer_email, `e${rec.rank}${res.vin}`)} icon={copied === `e${rec.rank}${res.vin}` ? Check : Copy} label="Email" />
                              )}
                              {rec.buyer_phone && (
                                <Action onClick={() => copy(rec.buyer_phone, `p${rec.rank}${res.vin}`)} icon={copied === `p${rec.rank}${res.vin}` ? Check : Phone} label="Phone" />
                              )}
                              {mailto && <Action href={mailto} icon={Mail} label="Draft email" primary />}
                              {sms && <Action href={sms} icon={Phone} label="Text" />}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </Shell>
  )
}

function Shell({ children }) {
  return <div className="p-3 min-h-screen bg-slate-900 text-slate-200">{children}</div>
}

function UploadBox({ label, sub, onPick, done }) {
  return (
    <label className={`flex flex-col items-center justify-center gap-1 p-3 rounded-lg border-2 border-dashed cursor-pointer text-center
      ${done ? 'border-emerald-600/50 bg-emerald-500/5' : 'border-slate-600 bg-slate-800/40 hover:border-emerald-600/50'}`}>
      {done ? <Check size={18} className="text-emerald-400" /> : <Upload size={18} className="text-slate-400" />}
      <span className="text-sm font-medium text-slate-200">{label}</span>
      <span className="text-[10px] text-slate-500">{sub}</span>
      <input type="file" accept=".csv" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
    </label>
  )
}

function Action({ icon, label, onClick, href, primary }) {
  const Icon = icon  // capitalized const is covered by the repo's varsIgnorePattern
  const cls = `flex items-center gap-1 text-[11px] px-2 py-1 rounded border
    ${primary ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-slate-700/50 text-slate-300 border-slate-600'}`
  return href
    ? <a href={href} className={cls}><Icon size={12} /> {label}</a>
    : <button onClick={onClick} className={cls}><Icon size={12} /> {label}</button>
}
