import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Phone, Mail, ExternalLink } from 'lucide-react'
import { fetchBuyerShareList, markBuyerShareListOpened } from '../services/buyerLists'
import { DEALER, dealerPhonePretty } from '../config/dealer'
import { openExternal, smsUrl } from '../native/links'

const money = (n) => (n == null || n <= 0 ? null : `$${Math.round(n).toLocaleString()}`)
// SmartAuction writes the literal 'Trim Unspecified' instead of leaving it blank.
const realTrim = (t) => (t && !/unspecified/i.test(t) ? t : null)

// The page a buyer lands on from a text. Public — no login, no app — so it has
// to answer three things without any chrome around it: who sent this, what the
// cars are, and how to reply.
export default function BuyerList() {
  const { slug } = useParams()
  const [list, setList] = useState(null)
  const [state, setState] = useState('loading')   // loading | ok | missing | error
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await fetchBuyerShareList(slug)
        if (!alive) return
        if (!data) { setState('missing'); return }
        setList(data); setState('ok')
        markBuyerShareListOpened(slug)
      } catch (e) {
        if (!alive) return
        setErr(e.message || String(e)); setState('error')
      }
    })()
    return () => { alive = false }
  }, [slug])

  if (state === 'loading') {
    return <Frame><p className="text-slate-400 text-center py-16">Loading…</p></Frame>
  }
  if (state === 'missing') {
    return (
      <Frame>
        <div className="text-center py-16">
          <p className="text-slate-300 font-medium">This list isn&apos;t available.</p>
          <p className="text-slate-500 text-sm mt-1">
            The link may be wrong, or every car on it has since sold. Give us a call and we&apos;ll put a fresh one together.
          </p>
        </div>
        <Contact />
      </Frame>
    )
  }
  if (state === 'error') {
    return <Frame><p className="text-red-400 text-center py-16 text-sm">{err}</p></Frame>
  }

  const total = list.cars.reduce((s, c) => s + (c.buy_now || 0), 0)

  return (
    <Frame>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white">
          {list.cars.length} unit{list.cars.length === 1 ? '' : 's'} for {list.buyer_name}
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Picked for you by {DEALER.name}
          {total > 0 && <> · {money(total)} total</>}
        </p>
        {list.note && <p className="text-sm text-slate-300 mt-2">{list.note}</p>}
      </div>

      {!list.cars.length ? (
        <p className="text-slate-400 text-sm py-8 text-center">
          Every car on this list has sold. Call us and we&apos;ll send you what just came in.
        </p>
      ) : (
        <div className="space-y-3">
          {list.cars.map((c) => (
            <div key={c.vin} className="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-100">
                    {c.year} {c.make} {c.model}
                    {realTrim(c.trim) && <span className="text-slate-400 font-normal"> {realTrim(c.trim)}</span>}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {c.odometer ? `${c.odometer.toLocaleString()} mi` : null}
                    {c.color ? ` · ${c.color}` : null}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 font-mono">{c.vin}</div>
                </div>
                {money(c.buy_now) && (
                  <div className="text-emerald-400 font-bold text-lg shrink-0">{money(c.buy_now)}</div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                {/* Full photos + the inspection live on the marketplace listing;
                    only cars we've inspected have one. */}
                {c.listing_id && (
                  <Link to={`/marketplace/${c.listing_id}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-700 text-slate-100 text-xs font-medium">
                    Photos &amp; condition
                  </Link>
                )}
                {c.detail_url && (
                  <a href={c.detail_url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-700/60 text-slate-300 text-xs">
                    <ExternalLink size={12} /> SmartAuction
                  </a>
                )}
                <button
                  onClick={() => openExternal(smsUrl(DEALER.phone,
                    `I want the ${[c.year, c.make, c.model].filter(Boolean).join(' ')} (VIN ${c.vin}).`))}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500 text-slate-900 text-xs font-bold">
                  I want it
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Contact />
    </Frame>
  )
}

// Who to call. A buyer who gets a text from an unknown number needs this before
// anything else on the page means much.
function Contact() {
  return (
    <div className="mt-8 mb-6 border-t border-slate-800 pt-5">
      <div className="text-sm font-semibold text-slate-200">{DEALER.name}</div>
      <div className="text-xs text-slate-400">
        {DEALER.department} · {DEALER.city}, {DEALER.state}
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <a href={`tel:${DEALER.phone}`}
          className="flex items-center gap-1.5 px-3 py-2 rounded bg-slate-800 border border-slate-700 text-slate-100 text-xs font-medium">
          <Phone size={13} /> {dealerPhonePretty()}
        </a>
        <button
          onClick={() => openExternal(smsUrl(DEALER.phone, 'Question about the list you sent me:'))}
          className="flex items-center gap-1.5 px-3 py-2 rounded bg-slate-800 border border-slate-700 text-slate-100 text-xs font-medium">
          Text us
        </button>
        {DEALER.email && (
          <a href={`mailto:${DEALER.email}`}
            className="flex items-center gap-1.5 px-3 py-2 rounded bg-slate-800 border border-slate-700 text-slate-100 text-xs font-medium">
            <Mail size={13} /> {DEALER.email}
          </a>
        )}
      </div>
    </div>
  )
}

function Frame({ children }) {
  return (
    <div className="min-h-screen bg-slate-900">
      <div className="max-w-2xl mx-auto px-4 py-6">{children}</div>
    </div>
  )
}
