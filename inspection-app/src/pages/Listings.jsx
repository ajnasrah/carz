import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, ExternalLink, MapPin, Gauge, ArrowLeft } from 'lucide-react'
import { fetchActiveCars } from '../services/buyerMatchData'
import { useAuth } from '../context/useAuth'
import HistoryButton from '../components/HistoryButton'

// Public, no-auth marketplace of current SmartAuction active inventory (sa_active_cars).
// Buyer recommendations are intentionally NOT shown here — that's internal sales intel.
const money = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`)
const miles = (n) => (n == null ? '—' : `${Math.round(n).toLocaleString()} mi`)

export default function Listings() {
  const { profile } = useAuth()
  const isStaff = !!profile && profile.account_type !== 'buyer'
  const [cars, setCars] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [query, setQuery] = useState('')
  const [make, setMake] = useState('')

  useEffect(() => {
    fetchActiveCars()
      .then((rows) => setCars(rows.sort((a, b) => (b.buy_now || 0) - (a.buy_now || 0))))
      .catch((e) => setErr(e.message || String(e)))
      .finally(() => setLoading(false))
  }, [])

  const makes = useMemo(() => [...new Set(cars.map((c) => c.make).filter(Boolean))].sort(), [cars])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return cars.filter((c) => {
      if (make && c.make !== make) return false
      if (!q) return true
      return `${c.year} ${c.make} ${c.model} ${c.trim} ${c.vin}`.toLowerCase().includes(q)
    })
  }, [cars, query, make])

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 safe-top">
      <header className="bg-slate-950 border-b border-slate-800 px-4 py-4 sticky top-0 z-10">
        {/* This page is public, so BottomNav hides here — and inside the native
            shell there's no URL bar and no browser back either, which left staff
            who tapped through with no way off the screen but force-quitting.
            Only shown for staff: a buyer lives on this page, and '/' would just
            bounce him straight back to it via ProtectedRoute. */}
        {isStaff && (
          <Link to="/" aria-label="Back to dashboard"
            className="inline-flex items-center gap-1 mb-2 -ml-2 p-2 rounded-lg text-slate-300 active:bg-slate-800 text-sm">
            <ArrowLeft size={18} /> Dashboard
          </Link>
        )}
        <h1 className="text-xl font-bold text-emerald-400">CARZ INC — Available Now</h1>
        <p className="text-xs text-slate-400">{cars.length} vehicles on SmartAuction</p>
      </header>

      <div className="max-w-5xl mx-auto p-3">
        {err && <div className="mb-3 p-2 rounded bg-red-500/15 text-red-300 text-sm border border-red-500/30">{err}</div>}

        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-2.5 top-2.5 text-slate-500" />
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search make, model, VIN"
              className="w-full bg-slate-800 border border-slate-700 rounded pl-8 pr-3 py-2 text-sm text-slate-200 placeholder-slate-500"
            />
          </div>
          <select
            value={make} onChange={(e) => setMake(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-2 text-sm text-slate-200"
          >
            <option value="">All makes</option>
            {makes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {loading ? (
          <p className="text-slate-400 p-4 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-slate-400 p-4 text-center">No vehicles match.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((c) => (
              <div key={c.vin} className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold text-slate-100 leading-tight">
                    {c.year} {c.make} {c.model}
                    {c.trim && <span className="block text-xs text-slate-400 font-normal">{c.trim}</span>}
                  </h2>
                  <span className="text-emerald-400 font-bold whitespace-nowrap">{money(c.buy_now)}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400 mt-2">
                  <span className="flex items-center gap-1"><Gauge size={12} /> {miles(c.odometer)}</span>
                  {c.drivetrain && <span>{c.drivetrain}</span>}
                  {c.color && <span>{c.color}</span>}
                  {c.location && <span className="flex items-center gap-1"><MapPin size={12} /> {c.location}</span>}
                </div>
                <div className="mt-auto pt-3">
                  {c.detail_url ? (
                    <a href={c.detail_url} target="_blank" rel="noreferrer"
                      className="flex items-center justify-center gap-1.5 w-full text-sm py-2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25">
                      View on SmartAuction <ExternalLink size={13} />
                    </a>
                  ) : (
                    <div className="text-center text-[11px] text-slate-500 font-mono">{c.vin}</div>
                  )}
                  <div className="mt-2">
                    <HistoryButton vin={c.vin} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
