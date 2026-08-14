import { useState, lazy, Suspense } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

// Lazy, and it has to be lazy here rather than only at the route: these three
// tabs are the app's heaviest pages — chart.js lives in Executive and recharts
// in Sold — and a static import of all three would pull both charting libraries
// into whichever chunk Reports lands in, for a visitor who opened one tab.
// Only the tab you're looking at is fetched.
const ExecutiveDashboard = lazy(() => import('./ExecutiveDashboard'))
const SoldReports = lazy(() => import('./SoldReports'))
const VehicleAnalytics = lazy(() => import('./VehicleAnalytics'))

// Reports hub — merges the three reporting surfaces (Executive metrics, Sold
// profit reports, Vehicle Analytics) into one tabbed page so they're a single
// dashboard entry instead of three separate tiles. Each child renders with
// `embedded` so its own page header is suppressed.
const TABS = [
  { key: 'executive', label: 'Executive', Component: ExecutiveDashboard },
  { key: 'sold', label: 'Sold', Component: SoldReports },
  { key: 'analytics', label: 'Analytics', Component: VehicleAnalytics },
]

export default function Reports() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const initial = params.get('tab')
  const [tab, setTab] = useState(TABS.some((t) => t.key === initial) ? initial : 'executive')
  const Active = (TABS.find((t) => t.key === tab) || TABS[0]).Component

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-3">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-lg font-bold text-emerald-400">Reports</h1>
      </div>

      <div className="flex gap-1.5 mb-3 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setParams({ tab: t.key }) }}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex-shrink-0 ${
              tab === t.key ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Keyed by tab so switching tabs shows the spinner again rather than
          holding the previous tab's chart on screen while the next one loads. */}
      <Suspense key={tab} fallback={<p className="text-slate-500 text-sm py-8 text-center">Loading…</p>}>
        <Active embedded />
      </Suspense>
    </div>
  )
}
