// The buyer book: who buys from us, what they bought, and everything we have
// said to them. Before this it meant GoHighLevel in one tab and four screens in
// another — Buyer Match for history, Messages for texts, Outreach for offers.
//
// Two panes, like Messages: the list, and one buyer. On a phone the buyer
// replaces the list; anything wider shows both.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Search, MessageSquare, Phone, Mail, Copy, Check, Target, Ban, RefreshCw,
} from 'lucide-react'
import { fetchBuyers, fetchBuyer, money, sinceLabel } from '../services/buyerCrm'
import { buyerShortName } from '../services/buyerPicks'
import { openExternal, smsUrl } from '../native/links'
import { copyText } from '../native/clipboard'
import { dealerPhonePretty } from '../config/dealer'

function Stat({ label, value, tone = 'text-white' }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-sm font-bold ${tone}`}>{value}</p>
    </div>
  )
}

function Row({ b, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-slate-800/70 ${active ? 'bg-slate-800' : 'active:bg-slate-800/60'}`}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-semibold text-slate-100 text-sm truncate flex-1">{b.buyer_name}</span>
        {b.do_not_text && <Ban size={12} className="text-red-400 shrink-0" />}
        <span className="text-[11px] text-slate-500 shrink-0">{sinceLabel(b.last_sale_date)}</span>
      </div>
      <p className="text-[11px] text-slate-400 truncate">
        {[
          [b.city, b.state].filter(Boolean).join(', '),
          `${b.cars_total} car${b.cars_total === 1 ? '' : 's'}`,
          b.cars_365 ? `${b.cars_365} this year` : null,
          b.phone ? dealerPhonePretty(b.phone) : 'no number',
        ].filter(Boolean).join(' · ')}
      </p>
    </button>
  )
}

function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => copyText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200) })}
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-semibold"
    >
      {done ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />} {label}
    </button>
  )
}

function Detail({ buyer, row, onBack }) {
  const navigate = useNavigate()
  if (!buyer) return null
  const phone = buyer.phone
  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="flex items-start gap-2 mb-3">
        <button onClick={onBack} className="md:hidden p-2 -ml-2 rounded-lg text-slate-300 active:bg-slate-800">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-white leading-tight">{row?.buyer_name}</h2>
          <p className="text-xs text-slate-400">
            {[[row?.city, row?.state].filter(Boolean).join(', '), phone ? dealerPhonePretty(phone) : 'no number on file', row?.email]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      {buyer.do_not_text && (
        <p className="mb-3 flex items-center gap-1.5 text-xs text-red-300 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2">
          <Ban size={13} /> Asked us to stop texting. Call instead.
        </p>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        {phone && !buyer.do_not_text && (
          <button
            onClick={() => openExternal(smsUrl(phone, `Hi ${buyerShortName(row?.buyer_name)}, `))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 text-slate-900 text-xs font-bold"
          ><MessageSquare size={13} /> Text</button>
        )}
        {phone && (
          <button onClick={() => openExternal(`tel:${phone}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-bold"
          ><Phone size={13} /> Call</button>
        )}
        {row?.email && (
          <button onClick={() => openExternal(`mailto:${row.email}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-bold"
          ><Mail size={13} /> Email</button>
        )}
        {phone && <CopyBtn text={phone} label="Number" />}
        {/* The cars we'd pitch him right now live on Buyer Match's Match tab —
            one engine, not a second opinion built here. */}
        <button onClick={() => navigate(`/buyer-match?buyer=${encodeURIComponent(row?.buyer_name || '')}`)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-emerald-300 text-xs font-bold"
        ><Target size={13} /> Cars for him</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Stat label="Cars, all time" value={row?.cars_total ?? 0} />
        <Stat label="Last 12 months" value={row?.cars_365 ?? 0} />
        <Stat label="Spend, 12 mo" value={money(row?.spend_365)} />
        <Stat label="Last bought" value={sinceLabel(row?.last_sale_date)} />
      </div>

      {!!row?.channels?.length && (
        <div className="flex flex-wrap gap-1 mb-4">
          {row.channels.map((c) => (
            <span key={c} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">{c}</span>
          ))}
        </div>
      )}

      <Section title={`Bought (${buyer.purchases.length})`}>
        <ul className="divide-y divide-slate-800/70">
          {buyer.purchases.slice(0, 60).map((p, i) => (
            <li key={`${p.vin}-${i}`} className="py-1.5 flex items-baseline gap-2 text-sm">
              <span className="text-slate-200 flex-1 truncate">{p.vehicle}</span>
              <span className="text-slate-500 text-[11px] shrink-0">{p.channel}</span>
              <span className="text-emerald-400 text-xs shrink-0">{money(p.sale_price)}</span>
              <span className="text-slate-500 text-[11px] shrink-0 w-20 text-right">{p.sale_date}</span>
            </li>
          ))}
        </ul>
        {buyer.purchases.length > 60 && (
          <p className="text-[11px] text-slate-500 pt-1">…and {buyer.purchases.length - 60} older</p>
        )}
      </Section>

      <Section title={`Cars we sent him (${buyer.contacts.length})`}>
        {buyer.contacts.length === 0
          ? <p className="text-xs text-slate-500">Nothing yet.</p>
          : (
            <ul className="divide-y divide-slate-800/70">
              {buyer.contacts.slice(0, 40).map((c, i) => (
                <li key={i} className="py-1.5 text-sm flex items-baseline gap-2">
                  <span className="text-slate-300 flex-1 truncate">
                    {c.stock_number || c.vin}
                    <span className="text-slate-500 text-[11px]">
                      {' '}· {c.kind === 'pitch' ? `texted by ${c.by || 'staff'}` : `outreach ${c.status}`}
                    </span>
                  </span>
                  <span className="text-slate-500 text-[11px] shrink-0">{sinceLabel(c.at)}</span>
                </li>
              ))}
            </ul>
          )}
      </Section>

      <Section title={`Texts (${buyer.texts.length})`}>
        {buyer.texts.length === 0
          ? <p className="text-xs text-slate-500">No texts through the Carz Inc number. Texts sent from a personal phone are not recorded.</p>
          : (
            <ul className="space-y-1.5">
              {buyer.texts.slice(0, 40).map((t, i) => (
                <li key={i} className={`text-[13px] rounded-lg px-2.5 py-1.5 ${
                  t.direction === 'in' ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-slate-800'
                }`}>
                  <p className="text-slate-100 whitespace-pre-wrap break-words">{t.body}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {t.direction === 'in' ? 'from him' : 'to him'} · {sinceLabel(t.created_at)}
                    {t.status === 'failed' ? ' · did not send' : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
      </Section>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mb-4">
      <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">{title}</p>
      {children}
    </div>
  )
}

export default function Buyers() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openKey, setOpenKey] = useState(params.get('buyer') || null)
  const [detail, setDetail] = useState(null)

  const load = useCallback(async (query) => {
    setLoading(true)
    setError('')
    try { setList(await fetchBuyers(query)) }
    catch (e) { setError(e.message || 'Could not load buyers') }
    finally { setLoading(false) }
  }, [])

  // Search on a pause in typing, not per keystroke: each call aggregates every
  // sale we have ever made.
  useEffect(() => {
    const t = setTimeout(() => load(q), q ? 400 : 0)
    return () => clearTimeout(t)
  }, [q, load])

  useEffect(() => {
    if (!openKey) { setDetail(null); return }
    let cancelled = false
    setDetail(null)
    fetchBuyer(openKey).then((d) => { if (!cancelled) setDetail(d) }, () => {})
    return () => { cancelled = true }
  }, [openKey])

  const row = useMemo(() => list.find((b) => b.buyer_key === openKey) || null, [list, openKey])

  function open(b) {
    setOpenKey(b.buyer_key)
    setParams({ ...(q ? { q } : {}), buyer: b.buyer_key }, { replace: true })
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white safe-top">
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => navigate('/')} className="p-2 -ml-2 rounded-lg text-slate-300 active:bg-slate-800">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white">Buyer Book</h1>
            <p className="text-[11px] text-slate-400">
              {loading ? 'Loading…' : `${list.length} buyer${list.length === 1 ? '' : 's'}`} · every channel we sell through
            </p>
          </div>
          <button onClick={() => load(q)} className="p-2 rounded-lg bg-slate-800 text-slate-300"><RefreshCw size={16} /></button>
        </div>

        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, phone or email"
            className="w-full text-sm bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-white"
          />
        </div>

        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

        <div className="flex gap-4">
          <div className={`${openKey ? 'hidden md:block' : ''} md:w-80 shrink-0 bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden max-h-[calc(100vh-190px)] overflow-y-auto`}>
            {!loading && list.length === 0 && <p className="text-xs text-slate-500 p-3">No buyer matches that.</p>}
            {list.map((b) => (
              <Row key={b.buyer_key} b={b} active={b.buyer_key === openKey} onClick={() => open(b)} />
            ))}
          </div>

          <div className={`${openKey ? 'flex' : 'hidden'} md:flex flex-1 min-w-0`}>
            {openKey && !detail && <p className="text-sm text-slate-500">Loading…</p>}
            {detail && <Detail buyer={detail} row={row} onBack={() => { setOpenKey(null); setParams(q ? { q } : {}, { replace: true }) }} />}
            {!openKey && <p className="hidden md:block text-sm text-slate-500">Pick a buyer.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
