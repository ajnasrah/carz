import { useMemo, useState } from 'react'
import { Search, Check, Copy, Link2, MessageSquare, Mail, Loader2, ChevronLeft } from 'lucide-react'
import { createBuyerShareList } from '../services/buyerLists'
import { buildBuyerListMessage, buyerListUrl } from '../services/marketplaceShare'
import { dealerLine, DEALER } from '../config/dealer'
import { copyText } from '../native/clipboard'
import { openExternal, smsUrl } from '../native/links'

const money = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`)
// SmartAuction's export fills Opening Price and leaves Buy Now empty on our
// cars, so the ask is whichever of the two is actually populated.
const ask = (c) => c.buy_now ?? c.opening_price ?? null
const CONF = {
  high: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  medium: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  low: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}

// phone -> email -> name, same as the GHL edge function and BuyerAnalytics, so
// one store typed two ways doesn't split into two buyers.
const buyerKeyOf = (r) =>
  (r.buyer_phone && String(r.buyer_phone).replace(/\D/g, ''))
  || (r.buyer_email && String(r.buyer_email).toLowerCase())
  || (r.buyer_name || '').trim().toLowerCase()

// Buyer Match answers "who buys THIS car". This is the same data read the other
// way round — "what do we have for THIS buyer" — which is the direction you
// actually make calls in.
export default function BuyerCarsView({ results, byVin }) {
  const [query, setQuery] = useState('')
  const [openBuyer, setOpenBuyer] = useState(null)
  const [picked, setPicked] = useState(() => new Set())
  const [topOnly, setTopOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState('')
  const [flash, setFlash] = useState('')
  const [err, setErr] = useState('')

  // Invert car -> top-3 buyers into buyer -> every car he's shortlisted for.
  const buyers = useMemo(() => {
    const map = new Map()
    for (const r of results) {
      for (const rec of r.recommendations) {
        if (topOnly && rec.rank !== 1) continue
        const key = buyerKeyOf(rec)
        if (!map.has(key)) {
          map.set(key, {
            key,
            name: rec.buyer_name,
            email: rec.buyer_email || null,
            phone: rec.buyer_phone || null,
            state: rec.buyer_state || null,
            cars: [],
          })
        }
        const car = byVin.get(r.vin)
        if (!car) continue
        map.get(key).cars.push({ ...car, ...rec, est_value: r.value, segment: r.segment })
      }
    }
    for (const b of map.values()) {
      b.cars.sort((x, y) => x.rank - y.rank || (y.predicted_price || 0) - (x.predicted_price || 0))
      b.total = b.cars.reduce((s, c) => s + (c.predicted_price || 0), 0)
    }
    return [...map.values()].sort((a, b) => b.cars.length - a.cars.length || b.total - a.total)
  }, [results, byVin, topOnly])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return buyers
    const digits = q.replace(/\D/g, '')
    return buyers.filter((b) =>
      b.name.toLowerCase().includes(q)
      || (b.email || '').toLowerCase().includes(q)
      || (digits && (b.phone || '').replace(/\D/g, '').includes(digits)))
  }, [buyers, query])

  const buyer = openBuyer ? buyers.find((b) => b.key === openBuyer) : null

  function select(b) {
    setOpenBuyer(b.key)
    setPicked(new Set(b.cars.map((c) => c.vin)))   // everything on by default
    setLink(''); setErr('')
  }
  function toggle(vin) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(vin)) next.delete(vin); else next.add(vin)
      return next
    })
    setLink('')                                   // the link no longer matches the picks
  }
  function say(msg) { setFlash(msg); setTimeout(() => setFlash(''), 1600) }

  const chosen = buyer ? buyer.cars.filter((c) => picked.has(c.vin)) : []

  async function makeLink() {
    if (!buyer || !chosen.length) return null
    if (link) return link
    setBusy(true); setErr('')
    try {
      const slug = await createBuyerShareList({
        buyerName: buyer.name, buyerKey: buyer.key,
        email: buyer.email, phone: buyer.phone,
        vins: chosen.map((c) => c.vin),
      })
      setLink(slug)
      return slug
    } catch (e) {
      setErr(e.message || String(e))
      return null
    } finally { setBusy(false) }
  }

  async function withMessage(fn) {
    const slug = await makeLink()
    if (!slug) return
    fn(buildBuyerListMessage(chosen, { buyer: buyer.name, slug, dealer: dealerLine() }), slug)
  }

  // ---- buyer picker -------------------------------------------------------
  if (!buyer) {
    return (
      <>
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search buyer by name, email or phone"
              className="w-full bg-slate-800 border border-slate-700 rounded pl-8 pr-3 py-2 text-sm text-slate-200 placeholder-slate-500"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-300 whitespace-nowrap">
            <input type="checkbox" checked={topOnly} onChange={(e) => setTopOnly(e.target.checked)} className="accent-emerald-500" />
            Top pick only
          </label>
        </div>

        {!filtered.length ? (
          <p className="text-slate-400 text-sm p-4 text-center">No buyer matches that.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((b) => (
              <button key={b.key} onClick={() => select(b)}
                className="w-full text-left bg-slate-800/60 border border-slate-700 rounded-lg p-3 hover:border-emerald-500/40">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-100 truncate">{b.name}</div>
                    <div className="text-xs text-slate-400 truncate">
                      {[b.state, b.email, b.phone].filter(Boolean).join(' · ') || 'no contact on file'}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-emerald-400 font-bold">{b.cars.length}</div>
                    <div className="text-[10px] text-slate-500">{money(b.total)} total</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </>
    )
  }

  // ---- one buyer's cars ---------------------------------------------------
  return (
    <>
      <button onClick={() => { setOpenBuyer(null); setLink(''); setErr('') }}
        className="flex items-center gap-1 text-sm text-slate-400 hover:text-emerald-400 mb-2">
        <ChevronLeft size={16} /> All buyers
      </button>

      <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 mb-3">
        <div className="font-semibold text-slate-100">{buyer.name}</div>
        <div className="text-xs text-slate-400 mt-0.5">
          {[buyer.state, buyer.email, buyer.phone].filter(Boolean).join(' · ') || 'no contact on file'}
        </div>
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-700">
          <label className="flex items-center gap-1.5 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={chosen.length === buyer.cars.length && buyer.cars.length > 0}
              onChange={(e) => { setPicked(new Set(e.target.checked ? buyer.cars.map((c) => c.vin) : [])); setLink('') }}
              className="accent-emerald-500"
            />
            Select all {buyer.cars.length}
          </label>
          <span className="text-xs text-slate-400">
            {chosen.length} picked · {money(chosen.reduce((s, c) => s + (c.predicted_price || 0), 0))}
          </span>
        </div>
      </div>

      <div className="space-y-2 mb-3">
        {buyer.cars.map((c) => {
          const on = picked.has(c.vin)
          return (
            <button key={c.vin} onClick={() => toggle(c.vin)}
              className={`w-full text-left rounded-lg border p-3 ${on ? 'bg-emerald-500/5 border-emerald-500/40' : 'bg-slate-800/60 border-slate-700'}`}>
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600'}`}>
                  {on && <Check size={11} className="text-slate-900" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-100 truncate">
                    {c.year} {c.make} {c.model} <span className="text-slate-400 font-normal">{c.trim}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {c.odometer?.toLocaleString()} mi · Ask {money(ask(c))}
                    <span className={`ml-1.5 px-1.5 py-0.5 rounded border text-[10px] ${CONF[c.confidence]}`}>#{c.rank} {c.confidence}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">{c.reason}</p>
                </div>
                <div className="text-emerald-400 font-semibold shrink-0">{money(c.predicted_price)}</div>
              </div>
            </button>
          )
        })}
      </div>

      {err && <p className="text-xs text-red-400 mb-2">{err}</p>}
      {flash && <p className="text-xs text-emerald-400 mb-2">{flash}</p>}
      {link && (
        <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded p-2 mb-2">
          <Link2 size={14} className="text-emerald-400 shrink-0" />
          <span className="text-xs text-slate-300 truncate flex-1">{buyerListUrl(link)}</span>
          <button onClick={() => { copyText(buyerListUrl(link)); say('Link copied') }}
            className="text-slate-400 hover:text-emerald-400"><Copy size={14} /></button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pb-6">
        <Btn disabled={!chosen.length || busy} busy={busy} icon={Link2} label={link ? 'Link ready' : 'Create link'}
          onClick={() => makeLink().then((s) => s && say('Link created'))} />
        {buyer.phone && (
          <Btn disabled={!chosen.length || busy} icon={MessageSquare} label="Text" primary
            onClick={() => withMessage((msg) => openExternal(smsUrl(buyer.phone, msg)))} />
        )}
        {buyer.email && (
          <Btn disabled={!chosen.length || busy} icon={Mail} label="Email"
            onClick={() => withMessage((msg) => openExternal(
              `mailto:${buyer.email}?subject=${encodeURIComponent(`${chosen.length} units from ${DEALER.name}`)}&body=${encodeURIComponent(msg)}`))} />
        )}
        <Btn disabled={!chosen.length || busy} icon={Copy} label="Copy message"
          onClick={() => withMessage((msg) => { copyText(msg); say('Message copied') })} />
      </div>
    </>
  )
}

function Btn({ icon, label, onClick, disabled, primary, busy }) {
  const Icon = icon
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex items-center gap-1.5 px-3 py-2 rounded text-xs font-medium disabled:opacity-40 ${
        primary ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 border border-slate-700 text-slate-200'}`}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />} {label}
    </button>
  )
}
