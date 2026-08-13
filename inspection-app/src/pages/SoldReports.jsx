import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, Download, TrendingUp, TrendingDown, Award, AlertTriangle, Target, Ban, ChevronDown, ChevronRight, Filter, X } from 'lucide-react'
import {
  BarChart, Bar, Line, ComposedChart, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts'
import {
  fetchSoldClean, filterByPeriod, summarize, groupByMonth, groupByDaysOnLot,
  groupByMake, groupByModel, findModelSweetSpot,
  groupByYearBand, groupByMileageBand, findSweetSpots,
  fetchSoldWithBuyers, groupByBuyer, groupByField, dailyProfitByBuyer,
  fmt, profitColor, PERIODS,
} from '../services/soldReports'
import XLSXWriter from '../services/xlsxWriter'
import CompareBox from '../components/CompareBox'
import InventoryVsSold from '../components/InventoryVsSold'
import BuySellPace from '../components/BuySellPace'
import { compareGroups, COMPARE_COLUMNS } from '../services/compare'

// How many cars the By Profit list paints before you ask for more.
const CARS_PAGE = 150

// One row per car, in the order you'd read it: what it was, how long it sat,
// who moved it, what it cost, what it made. Buyer/vendor/customer come off the
// raw `sold` table (joined by stock number) because sold_clean doesn't carry
// them — so a car with no matching row still exports, just without the names.
//
// [header, value(cleanRow, soldRow), column width, kind]
const EXPORT_COLUMNS = [
  ['Stock #',       (r) => r.stock_number,                  12, 'text'],
  ['Sale Date',     (r) => r.sale_date,                     12, 'text'],
  ['Year',          (r) => r.year ?? r.vehicle_year,         7, 'year'],
  ['Make',          (r) => r.make ?? r.vehicle_make,        14, 'text'],
  ['Model',         (r) => r.model ?? r.vehicle_model,      18, 'text'],
  ['Mileage',       (r) => r.mileage,                       11, 'int'],
  ['Days on Lot',   (r) => r.days_on_lot,                   11, 'int'],
  ['Buyer',         (r, b) => b?.buyer,                     16, 'text'],
  ['Vendor',        (r, b) => b?.vendor,                    16, 'text'],
  ['Customer',      (r, b) => b?.customer,                  20, 'text'],
  ['Original Cost', (r) => r.original_cost,                 13, 'money'],
  ['Total Cost',    (r) => r.total_cost,                    13, 'money'],
  ['Sales Price',   (r) => r.sales_price,                   13, 'money'],
  ['Profit',        (r) => r.profit,                        12, 'money'],
]

export default function SoldReports({ embedded = false }) {
  const navigate = useNavigate()
  const [allRows, setAllRows] = useState([])
  const [buyerRows, setBuyerRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [periodKey, setPeriodKey] = useState('mtd')
  const [tab, setTab] = useState('summary')
  const [makeSort, setMakeSort] = useState('avgProfit')
  const [modelSort, setModelSort] = useState('avgProfit')
  const [expandedModel, setExpandedModel] = useState(null)
  // The car list renders capped — "All" is thousands of rows and painting them
  // all locks the phone up. Lift it on demand.
  const [carsShown, setCarsShown] = useState(CARS_PAGE)
  const [lastRefreshed, setLastRefreshed] = useState(null)
  
  // Filter states
  const [filterMake, setFilterMake] = useState('')
  const [filterModel, setFilterModel] = useState('')
  const [filterBuyer, setFilterBuyer] = useState('')
  const [filterVendor, setFilterVendor] = useState('')
  const [availableMakes, setAvailableMakes] = useState([])
  const [availableModels, setAvailableModels] = useState([])
  const [availableBuyers, setAvailableBuyers] = useState([])
  const [availableVendors, setAvailableVendors] = useState([])

  // Initial load + auto-refresh every 5 minutes so the dashboard stays fresh
  // when frazer-ingest pushes new sold data behind the scenes.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [rows, bRows] = await Promise.all([
          fetchSoldClean(),
          fetchSoldWithBuyers().catch(() => []),
        ])
        if (cancelled) return
        setAllRows(rows)
        setBuyerRows(bRows)
        setLastRefreshed(new Date())
        
        // Extract unique values for filters - note sold_clean uses 'make' not 'vehicle_make'
        const uniqueMakes = [...new Set(rows.map(r => r.make || r.vehicle_make).filter(Boolean))].sort()
        const uniqueBuyers = [...new Set(bRows.map(r => r.buyer).filter(Boolean))].sort()
        const uniqueVendors = [...new Set(bRows.map(r => r.vendor).filter(Boolean))].sort()
        
        console.log('Filter data loaded:', {
          makes: uniqueMakes.length,
          buyers: uniqueBuyers.length,
          vendors: uniqueVendors.length,
          totalRows: rows.length,
          buyerRows: bRows.length
        })
        
        setAvailableMakes(uniqueMakes)
        setAvailableBuyers(uniqueBuyers)
        setAvailableVendors(uniqueVendors)
      } catch (err) {
        if (cancelled) return
        console.error('SoldReports load failed', err)
        setError(err.message || 'Failed to load sold data')
      }
      if (!cancelled) setLoading(false)
    }
    load()
    const interval = setInterval(load, 5 * 60 * 1000)  // 5 minutes
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])
  
  // Update available models when make changes
  useEffect(() => {
    if (filterMake) {
      const models = [...new Set(allRows.filter(r => (r.make || r.vehicle_make) === filterMake).map(r => r.model || r.vehicle_model).filter(Boolean))].sort()
      setAvailableModels(models)
    } else {
      setAvailableModels([])
      setFilterModel('')
    }
  }, [filterMake, allRows])

  const filtered = useMemo(() => {
    let result = filterByPeriod(allRows, periodKey)
    
    // Apply make filter (sold_clean uses 'make' not 'vehicle_make')
    if (filterMake) {
      result = result.filter(r => (r.make || r.vehicle_make) === filterMake)
    }
    
    // Apply model filter (sold_clean uses 'model' not 'vehicle_model')
    if (filterModel) {
      result = result.filter(r => (r.model || r.vehicle_model) === filterModel)
    }
    
    // Apply buyer filter
    if (filterBuyer) {
      const buyerStocks = new Set(buyerRows.filter(r => r.buyer === filterBuyer).map(r => r.stock_number))
      result = result.filter(r => buyerStocks.has(r.stock_number))
    }
    
    // Apply vendor filter
    if (filterVendor) {
      const vendorStocks = new Set(buyerRows.filter(r => r.vendor === filterVendor).map(r => r.stock_number))
      result = result.filter(r => vendorStocks.has(r.stock_number))
    }
    
    return result
  }, [allRows, periodKey, filterMake, filterModel, filterBuyer, filterVendor, buyerRows])

  // buyer / vendor / customer live on the raw `sold` table, keyed by stock
  // number. Both the car list and the export join through this.
  const byStock = useMemo(
    () => new Map(buyerRows.map((b) => [b.stock_number, b])),
    [buyerRows],
  )

  // Every car the filters are showing, worst deal first. A car with no profit
  // recorded sorts to the BOTTOM rather than the top — unknown is not the same
  // as lost money, and putting it first would bury the real losses.
  const byProfit = useMemo(() => {
    const rank = (r) => (Number.isFinite(r.profit) ? r.profit : Infinity)
    return [...filtered].sort((a, b) => rank(a) - rank(b))
  }, [filtered])

  // Export exactly what the page is showing — the same period and the same
  // make/model/buyer/vendor filters, one row per car. Deliberately NOT the
  // whole sold book: if you've narrowed to Toyota MTD, that's what lands in
  // the file, and the filename says so.
  function exportSold() {
    if (!filtered.length) return
    const S = XLSXWriter.S

    const rows = [EXPORT_COLUMNS.map(([h]) => ({ v: h, s: S.HEADER }))]
    for (const r of filtered) {
      const b = byStock.get(r.stock_number)
      rows.push(EXPORT_COLUMNS.map(([, get, , kind]) => {
        const v = get(r, b)
        if (v == null || v === '') return ''
        if (kind === 'text') return { v: String(v), s: S.TEXT }
        const n = Number(v)
        if (!Number.isFinite(n)) return ''
        if (kind === 'year') return n                          // plain digits, no grouping
        return { v: Math.round(n), s: kind === 'money' ? S.MONEY : S.NUMBER }
      }))
    }

    const blob = XLSXWriter.build({
      sheetName: 'Sold',
      rows,
      widths: EXPORT_COLUMNS.map(([, , w]) => w),
    })
    // Name it after what's actually in it, so two exports from different
    // filters don't overwrite each other in Downloads.
    const parts = ['sold', periodKey, filterMake, filterModel, filterBuyer, filterVendor]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    // download() writes a file and opens the share sheet on native, so it can
    // reject (no disk, share extension cancelled). Swallow rather than leave an
    // unhandled rejection.
    XLSXWriter.download(blob, `${parts.join('-')}-${new Date().toISOString().slice(0, 10)}.xlsx`)
      .catch((err) => console.error('Sold export failed', err))
  }
  const stats = useMemo(() => summarize(filtered), [filtered])
  const monthly = useMemo(() => groupByMonth(filtered), [filtered])
  const daysBands = useMemo(() => groupByDaysOnLot(filtered), [filtered])
  const makes = useMemo(() => groupByMake(filtered, 10), [filtered])
  const yearBands = useMemo(() => groupByYearBand(filtered), [filtered])
  const mileageBands = useMemo(() => groupByMileageBand(filtered), [filtered])
  // minVolume scales with period size so short periods (MTD) still produce results
  const sweetSpots = useMemo(() => {
    const minVol = filtered.length < 100 ? 3 : filtered.length < 400 ? 8 : 15
    return findSweetSpots(filtered, minVol)
  }, [filtered])

  // Buyer breakdown — fetchSoldWithBuyers normalizes sale_date to ISO, so we
  // can use the shared filterByPeriod helper.
  // Make/model come off sold_clean ('make') while these rows carry Frazer's
  // 'vehicle_make', so match on text rather than assuming identical casing.
  const sameText = (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase()

  // Everything the filter bar says, applied. This used to be period-only, which
  // is why picking a buyer changed the Summary numbers but left the Buyers,
  // Vendors and Customers tabs sitting there unchanged — they read this set.
  const filteredBuyerRows = useMemo(() => {
    let rows = filterByPeriod(buyerRows, periodKey)
    if (filterMake) rows = rows.filter((r) => sameText(r.vehicle_make, filterMake))
    if (filterModel) rows = rows.filter((r) => sameText(r.vehicle_model, filterModel))
    if (filterBuyer) rows = rows.filter((r) => r.buyer === filterBuyer)
    if (filterVendor) rows = rows.filter((r) => r.vendor === filterVendor)
    return rows
  }, [buyerRows, periodKey, filterMake, filterModel, filterBuyer, filterVendor])

  // The comparison deliberately does NOT narrow to the picked buyer/vendor —
  // a table of one row against a baseline of itself compares nothing. Picking
  // someone pins and highlights their row instead, so you can read them against
  // the pack, which is the question being asked.
  const compareRows = useMemo(() => {
    let rows = filterByPeriod(buyerRows, periodKey)
    if (filterMake) rows = rows.filter((r) => sameText(r.vehicle_make, filterMake))
    if (filterModel) rows = rows.filter((r) => sameText(r.vehicle_model, filterModel))
    return rows
  }, [buyerRows, periodKey, filterMake, filterModel])
  const buyers    = useMemo(() => groupByBuyer(filteredBuyerRows), [filteredBuyerRows])
  const vendors   = useMemo(() => groupByField(filteredBuyerRows, 'vendor'),   [filteredBuyerRows])
  const customers = useMemo(() => groupByField(filteredBuyerRows, 'customer'), [filteredBuyerRows])
  const buyerSeries = useMemo(() => dailyProfitByBuyer(filteredBuyerRows), [filteredBuyerRows])

  // The dashboard's Inventory-vs-Sold comparison, pointed at people instead of
  // periods: every buyer (and every vendor) read against the same baseline, on
  // the same numbers, by the same shared code.
  const soldMetrics = (r) => ({
    added: r.added_costs,
    days: r.days_on_lot,
    cost: r.total_cost,
    profit: r.profit_on_sale,
  })
  const buyerCompare = useMemo(
    () => compareGroups(compareRows, { keyOf: (r) => r.buyer, get: soldMetrics, minCount: 2 }),
    [compareRows],
  )
  const vendorCompare = useMemo(
    () => compareGroups(compareRows, { keyOf: (r) => r.vendor, get: soldMetrics, minCount: 2 }),
    [compareRows],
  )

  const sortedMakes = useMemo(() => {
    const copy = [...makes]
    if (makeSort === 'avgProfit') copy.sort((a, b) => b.avgProfit - a.avgProfit)
    else if (makeSort === 'count') copy.sort((a, b) => b.count - a.count)
    else if (makeSort === 'pctWinners') copy.sort((a, b) => b.pctWinners - a.pctWinners)
    else if (makeSort === 'totalProfit') copy.sort((a, b) => b.totalProfit - a.totalProfit)
    else if (makeSort === 'avgDays') copy.sort((a, b) => a.avgDays - b.avgDays)
    return copy
  }, [makes, makeSort])

  // Models — top 10 (target list) + bottom 10 (avoid list) + sortable full table
  const allModels = useMemo(() => groupByModel(filtered, 10), [filtered])
  const sortedModels = useMemo(() => {
    const copy = [...allModels]
    if (modelSort === 'avgProfit') copy.sort((a, b) => b.avgProfit - a.avgProfit)
    else if (modelSort === 'count') copy.sort((a, b) => b.count - a.count)
    else if (modelSort === 'pctWinners') copy.sort((a, b) => b.pctWinners - a.pctWinners)
    else if (modelSort === 'totalProfit') copy.sort((a, b) => b.totalProfit - a.totalProfit)
    else if (modelSort === 'avgDays') copy.sort((a, b) => a.avgDays - b.avgDays)
    return copy
  }, [allModels, modelSort])

  // Top 10 target vehicles (highest avg profit, min volume already enforced)
  const topModels = useMemo(() => {
    return [...allModels]
      .sort((a, b) => b.avgProfit - a.avgProfit)
      .slice(0, 10)
  }, [allModels])

  // Bottom 10 avoid list — lowest avg profit, EXCLUDING anything already in
  // the top list. Prevents the "both lists show the same entries in reverse"
  // bug when allModels has fewer than ~20 entries.
  const avoidModels = useMemo(() => {
    const topKeys = new Set(topModels.map((m) => `${m.make}|${m.model}`))
    return [...allModels]
      .filter((m) => !topKeys.has(`${m.make}|${m.model}`))
      .sort((a, b) => a.avgProfit - b.avgProfit)
      .slice(0, 10)
  }, [allModels, topModels])

  const topBuy = useMemo(() => sweetSpots.slice(0, 5), [sweetSpots])
  // Bottom 5 combos — lowest avg profit, excluding any already in topBuy.
  // Same dedup as avoidModels for the same reason.
  const topAvoid = useMemo(() => {
    // dedup key must match findSweetSpots's shape: yearBand + mileBand
    const buyKeys = new Set(topBuy.map((s) => `${s.yearBand}|${s.mileBand}`))
    return [...sweetSpots]
      .filter((s) => !buyKeys.has(`${s.yearBand}|${s.mileBand}`))
      .reverse()
      .slice(0, 5)
  }, [sweetSpots, topBuy])

  if (loading) {
    return (
      <div className="page">
        <Header navigate={navigate} />
        <div className="text-center text-slate-400 py-12">Loading sold data…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <Header navigate={navigate} />
        <div className="card border border-red-500/30 bg-red-500/10">
          <p className="text-red-400 font-semibold">Failed to load</p>
          <p className="text-xs text-slate-400 mt-1">{error}</p>
          <p className="text-xs text-slate-500 mt-2">
            Make sure the <code>sold_clean</code> view exists in Supabase.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="page pb-12">
      {!embedded && <Header navigate={navigate} />}

      {/* Filter Panel */}
      <div className="bg-slate-800 rounded-lg p-3 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="text-emerald-400" size={16} />
          <span className="text-xs font-semibold text-slate-300">Filters</span>
          <div className="ml-auto flex items-center gap-2">
            {(filterMake || filterModel || filterBuyer || filterVendor) && (
              <button
                onClick={() => {
                  setFilterMake('')
                  setFilterModel('')
                  setFilterBuyer('')
                  setFilterVendor('')
                }}
                className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors"
              >
                Clear All
              </button>
            )}
            {/* Sits with the filters because that's exactly what it obeys —
                the count is the promise of what lands in the file. Disabled at
                zero rather than handing over an empty spreadsheet. */}
            <button
              onClick={exportSold}
              disabled={!filtered.length}
              title={filtered.length ? `Export these ${filtered.length} cars to Excel` : 'Nothing to export'}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold transition-colors ${
                filtered.length
                  ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                  : 'bg-slate-700/50 text-slate-600'
              }`}
            >
              <Download size={13} /> Export {filtered.length}
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          <select
            value={filterMake}
            onChange={(e) => {
              setFilterMake(e.target.value)
              setFilterModel('')
            }}
            className="px-2 py-1.5 bg-slate-700 text-white rounded text-xs border border-slate-600 focus:border-emerald-400 focus:outline-none"
          >
            <option value="">All Makes {availableMakes.length > 0 ? `(${availableMakes.length})` : ''}</option>
            {availableMakes.map(make => (
              <option key={make} value={make}>{make}</option>
            ))}
          </select>
          
          <select
            value={filterModel}
            onChange={(e) => setFilterModel(e.target.value)}
            disabled={!filterMake}
            className="px-2 py-1.5 bg-slate-700 text-white rounded text-xs border border-slate-600 focus:border-emerald-400 focus:outline-none disabled:opacity-50"
          >
            <option value="">All Models</option>
            {availableModels.map(model => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
          
          <select
            value={filterBuyer}
            onChange={(e) => setFilterBuyer(e.target.value)}
            className="px-2 py-1.5 bg-slate-700 text-white rounded text-xs border border-slate-600 focus:border-emerald-400 focus:outline-none"
          >
            <option value="">All Buyers</option>
            {availableBuyers.map(buyer => (
              <option key={buyer} value={buyer}>{buyer}</option>
            ))}
          </select>
          
          <select
            value={filterVendor}
            onChange={(e) => setFilterVendor(e.target.value)}
            className="px-2 py-1.5 bg-slate-700 text-white rounded text-xs border border-slate-600 focus:border-emerald-400 focus:outline-none"
          >
            <option value="">All Vendors</option>
            {availableVendors.map(vendor => (
              <option key={vendor} value={vendor}>{vendor}</option>
            ))}
          </select>
        </div>
        
        {/* Active filters display */}
        {(filterMake || filterModel || filterBuyer || filterVendor) && (
          <div className="flex flex-wrap gap-1 mt-2">
            {filterMake && (
              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-xs">
                {filterMake}
              </span>
            )}
            {filterModel && (
              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-xs">
                {filterModel}
              </span>
            )}
            {filterBuyer && (
              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-xs">
                Buyer: {filterBuyer}
              </span>
            )}
            {filterVendor && (
              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-xs">
                Vendor: {filterVendor}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Period selector */}
      <div className="flex gap-2 mb-4 overflow-x-auto -mx-4 px-4 pb-1">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriodKey(p.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold ${
              periodKey === p.key ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto -mx-4 px-4">
        {[
          { key: 'summary',   label: '📊 Summary' },
          { key: 'pace',      label: '⚖️ Pace' },
          { key: 'cars',      label: '📉 By Profit' },
          { key: 'buyers',    label: '👥 Buyers' },
          { key: 'vendors',   label: '🏷️ Vendors' },
          { key: 'customers', label: '🤝 Customers' },
          { key: 'best',      label: '🏆 Best' },
          { key: 'worst',     label: '👎 Worst' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 px-3 py-2 rounded-lg text-xs font-bold ${
              tab === t.key ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-300'
            }`}
          >{t.label}</button>
        ))}
      </div>

      {/* Pace tab — the two "how is the lot doing" reads, together: what a car
          in stock costs against what a sold one cost, and how fast cars come in
          against how fast they go out. Both carry their own period control,
          because they answer over different spans than the page filter. */}
      {tab === 'pace' && (
        <div className="grid gap-4 mb-4 lg:grid-cols-2 lg:items-start">
          <InventoryVsSold />
          <BuySellPace />
        </div>
      )}

      {/* KPI strip — always visible (summary of current period) */}
      {tab === 'summary' && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <KPICard label="Total Sold" value={fmt.count(stats.count)} />
          <KPICard label="Total Profit" value={fmt.money(stats.totalProfit)} highlight />
          <KPICard label="Avg Profit" value={fmt.money(stats.avgProfit)} highlight />
          <KPICard label="Median" value={fmt.money(stats.medianProfit)} />
          <KPICard label="% Winners ($1k+)" value={fmt.pct(stats.pctWinners)} good />
          <KPICard label="% Losers" value={fmt.pct(stats.pctLosers)} bad />
          <KPICard label="Avg Days on Lot" value={fmt.days(stats.avgDays)} span={2} />
        </div>
      )}

      {/* === BY PROFIT TAB === */}
      {/* Every car the filters are showing, worst deal first. The point is the
          top of this list: the cars that lost money, by name, so they can be
          looked at one by one. Same rows the Export button writes. */}
      {tab === 'cars' && (
      <Section
        title="Every Car · Worst First"
        subtitle={`${byProfit.length} ${byProfit.length === 1 ? 'car' : 'cars'} in this view · least profit at the top`}
        icon={<TrendingDown size={14} className="text-red-400" />}
      >
        {byProfit.length === 0 ? (
          <p className="text-xs text-slate-500 py-3 text-center">Nothing sold in this period.</p>
        ) : (<>
          <div className="space-y-1">
            {byProfit.slice(0, carsShown).map((r, i) => {
              const b = byStock.get(r.stock_number)
              const profit = Number.isFinite(r.profit) ? r.profit : null
              return (
                <div key={`${r.stock_number}-${i}`}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-600 font-bold text-[10px] w-6 shrink-0">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold text-xs truncate">
                      {[r.year ?? r.vehicle_year, r.make ?? r.vehicle_make, r.model ?? r.vehicle_model]
                        .filter(Boolean).join(' ') || r.stock_number}
                    </p>
                    <p className="text-[10px] text-slate-500 truncate">
                      #{r.stock_number}
                      {r.days_on_lot != null && ` · ${r.days_on_lot}d on lot`}
                      {b?.buyer && ` · ${b.buyer}`}
                      {r.sale_date && ` · ${r.sale_date}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {/* No profit recorded is its own state — not a zero, and not
                        a loss. Saying so beats showing $0 and being believed. */}
                    <p className={`text-xs font-bold ${profit == null ? 'text-slate-600' : profitColor(profit)}`}>
                      {profit == null ? 'no profit data' : fmt.money(profit)}
                    </p>
                    {r.sales_price != null && (
                      <p className="text-[10px] text-slate-500">sold {fmt.money(r.sales_price)}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {byProfit.length > carsShown && (
            <button
              onClick={() => setCarsShown((n) => n + CARS_PAGE)}
              className="w-full mt-2 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold active:bg-slate-700"
            >
              Show {Math.min(CARS_PAGE, byProfit.length - carsShown)} more
              {' '}· {byProfit.length - carsShown} left
            </button>
          )}
        </>)}
      </Section>
      )}
      {/* === END BY PROFIT TAB === */}

      {/* === SUMMARY TAB === */}
      {tab === 'summary' && (<>
      {/* Monthly trend chart */}
      <Section title="Monthly Trend" subtitle="Volume + avg profit over time">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: '#94a3b8', fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 12 }}
                formatter={(v, name) => name === 'count' ? [v, 'sold'] : [fmt.money(v), 'avg profit']}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="right" dataKey="count" fill="#334155" name="sold" />
              <Line yAxisId="left" type="monotone" dataKey="avgProfit" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 3 }} name="avg profit" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>

      {/* Days on lot — the killer insight */}
      <Section title="Days on Lot vs Profit" subtitle="The 30-day cliff" icon={<AlertTriangle size={14} className="text-yellow-400" />}>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daysBands} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 12 }}
                formatter={(v) => [fmt.money(v), 'avg profit']}
                labelFormatter={(l) => {
                  const b = daysBands.find((x) => x.label === l)
                  return `${l} · ${b?.count || 0} sold · ${fmt.pct(b?.pctWinners || 0)} winners`
                }}
              />
              <Bar dataKey="avgProfit">
                {daysBands.map((entry, i) => (
                  <Cell key={i} fill={profitColor(entry.avgProfit)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-500 mt-2">
          Cars sold past 30 days drop sharply in margin. Past 60 days they lose money on average.
        </p>
      </Section>

      {/* Year band + Mileage band side-by-side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <Section title="By Year" compact>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={yearBands} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 9 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 11 }}
                  formatter={(v) => [fmt.money(v), 'avg profit']}
                />
                <Bar dataKey="avgProfit">
                  {yearBands.map((entry, i) => (
                    <Cell key={i} fill={profitColor(entry.avgProfit)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section title="By Mileage" compact>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mileageBands} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 9 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 11 }}
                  formatter={(v) => [fmt.money(v), 'avg profit']}
                />
                <Bar dataKey="avgProfit">
                  {mileageBands.map((entry, i) => (
                    <Cell key={i} fill={profitColor(entry.avgProfit)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>
      </>)}
      {/* === END SUMMARY TAB === */}

      {/* === BEST TAB (Buy More combos + Target Vehicles + All Models) === */}
      {tab === 'best' && (<>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <Section title="Buy More" subtitle="Year × mileage combos with best margins" icon={<Award size={14} className="text-emerald-400" />} compact>
          {topBuy.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">Not enough data — widen the period</p>
          ) : (
            <div className="space-y-1.5">
              {topBuy.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">
                    <span className="text-emerald-400 font-bold">#{i + 1}</span>
                    {' '}{s.yearBand} · {s.mileBand}
                  </span>
                  <div className="text-right">
                    <span className="text-emerald-400 font-bold">{fmt.money(s.avgProfit)}</span>
                    <span className="text-slate-500 ml-1">({s.count})</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
      </>)}
      {/* === END BEST TAB === */}

      {/* === WORST TAB === */}
      {tab === 'worst' && (<>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <Section title="Avoid" subtitle="Combos that consistently disappoint" icon={<TrendingDown size={14} className="text-red-400" />} compact>
          {topAvoid.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">Not enough data — widen the period</p>
          ) : (
            <div className="space-y-1.5">
              {topAvoid.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">
                    <span className="text-red-400 font-bold">#{i + 1}</span>
                    {' '}{s.yearBand} · {s.mileBand}
                  </span>
                  <div className="text-right">
                    <span className={`font-bold ${s.avgProfit < 0 ? 'text-red-400' : 'text-yellow-400'}`}>
                      {fmt.money(s.avgProfit)}
                    </span>
                    <span className="text-slate-500 ml-1">({s.count})</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
      </>)}
      {/* === END WORST TAB === */}

      {/* TARGET VEHICLES — top 10 models (Best tab) */}
      {tab === 'best' && (
      <Section title="🎯 Target Vehicles" subtitle="Top 10 models by avg profit · tap any row to see ideal year × mileage spec" icon={<Target size={14} className="text-emerald-400" />}>
        {topModels.length === 0 ? (
          <p className="text-xs text-slate-500 py-3 text-center">Not enough data — widen the period</p>
        ) : (
          <div className="space-y-1">
            {topModels.map((m, i) => {
              const key = `${m.make}|${m.model}`
              const expanded = expandedModel === key
              const sweet = expanded ? findModelSweetSpot(m.items) : []
              return (
                <div key={key} className="rounded-lg bg-slate-900/60 border border-slate-800 overflow-hidden">
                  <button
                    onClick={() => setExpandedModel(expanded ? null : key)}
                    className="w-full px-3 py-2 flex items-center gap-2 active:bg-slate-800/60"
                  >
                    {expanded ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                    <span className="text-emerald-400 font-bold text-xs w-5">#{i + 1}</span>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-white font-bold text-xs truncate">{m.label}</p>
                      <p className="text-[10px] text-slate-500">
                        {m.count} sold · {fmt.pct(m.pctWinners)} winners · {fmt.days(m.avgDays)} avg
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-sm" style={{ color: profitColor(m.avgProfit) }}>{fmt.money(m.avgProfit)}</p>
                      <p className="text-[10px] text-slate-500">{fmt.money(m.totalProfit)} total</p>
                    </div>
                  </button>
                  {expanded && (
                    <div className="border-t border-slate-800 px-3 py-2 bg-slate-900/40">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">
                        Best year × mileage specs
                      </p>
                      {sweet.length === 0 ? (
                        <p className="text-[10px] text-slate-500 py-1">Not enough data per spec — need 3+ sales per combo</p>
                      ) : (
                        <div className="space-y-1">
                          {sweet.slice(0, 5).map((s, j) => (
                            <div key={j} className="flex items-center justify-between text-[11px]">
                              <span className="text-slate-300">
                                <span className="text-emerald-400 font-bold">{j === 0 ? '🎯' : ` `}</span>{' '}
                                {s.yearBand} · {s.mileBand}
                              </span>
                              <div className="text-right">
                                <span className="font-bold" style={{ color: profitColor(s.avgProfit) }}>{fmt.money(s.avgProfit)}</span>
                                <span className="text-slate-500 ml-1">({s.count} · {fmt.pct(s.pctWinners)} win)</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Section>
      )}

      {/* AVOID MODELS — bottom 10 (Worst tab) */}
      {tab === 'worst' && (
      <Section title="🚫 Avoid These Models" subtitle="Bottom 10 by avg profit · stop sourcing these" icon={<Ban size={14} className="text-red-400" />}>
        {avoidModels.length === 0 ? (
          <p className="text-xs text-slate-500 py-3 text-center">Not enough data — widen the period</p>
        ) : (
          <div className="space-y-1">
            {avoidModels.map((m, i) => (
              <div key={`${m.make}|${m.model}`} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-800">
                <span className="text-red-400 font-bold text-xs w-5">#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold text-xs truncate">{m.label}</p>
                  <p className="text-[10px] text-slate-500">
                    {m.count} sold · {fmt.pct(m.pctLosers)} lose · {fmt.days(m.avgDays)} avg on lot
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-sm" style={{ color: profitColor(m.avgProfit) }}>{fmt.money(m.avgProfit)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
      )}

      {/* Full models leaderboard — sortable (Summary tab) */}
      {tab === 'summary' && (
      <Section title="All Models" subtitle={`${allModels.length} models · sorted by ${modelSort}`}>
        <div className="flex gap-1.5 mb-3 overflow-x-auto -mx-1 px-1">
          {[
            { k: 'avgProfit',   l: 'Avg $' },
            { k: 'totalProfit', l: 'Total $' },
            { k: 'count',       l: 'Volume' },
            { k: 'pctWinners',  l: '% Win' },
            { k: 'avgDays',     l: 'Days' },
          ].map((s) => (
            <button
              key={s.k}
              onClick={() => setModelSort(s.k)}
              className={`shrink-0 px-2 py-1 rounded text-[10px] font-semibold ${
                modelSort === s.k ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-400'
              }`}
            >{s.l}</button>
          ))}
        </div>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 text-[10px] uppercase">
                <th className="text-left py-1 pr-2">Model</th>
                <th className="text-right py-1 px-1">Sold</th>
                <th className="text-right py-1 px-1">Avg $</th>
                <th className="text-right py-1 px-1">Total $</th>
                <th className="text-right py-1 px-1">% Win</th>
                <th className="text-right py-1 pl-1">Days</th>
              </tr>
            </thead>
            <tbody>
              {sortedModels.map((m) => (
                <tr key={`${m.make}|${m.model}`} className="border-t border-slate-800">
                  <td className="py-1.5 pr-2 text-white font-semibold truncate max-w-[140px]">{m.label}</td>
                  <td className="text-right text-slate-400 px-1">{m.count}</td>
                  <td className="text-right font-bold px-1" style={{ color: profitColor(m.avgProfit) }}>
                    {fmt.money(m.avgProfit)}
                  </td>
                  <td className="text-right text-slate-300 px-1">{fmt.money(m.totalProfit)}</td>
                  <td className="text-right text-slate-300 px-1">{fmt.pct(m.pctWinners)}</td>
                  <td className="text-right text-slate-400 pl-1">{fmt.days(m.avgDays)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      )}

      {/* Buyer daily profit line chart (Buyers tab) */}
      {tab === 'buyers' && buyerSeries.data.length > 0 && (
        <Section title="Daily Profit by Buyer" subtitle={`Per day total for the ${PERIODS.find((p)=>p.key===periodKey)?.label || periodKey} period`} icon={<TrendingUp size={14} className="text-emerald-400" />}>
          <div className="h-64 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={buyerSeries.data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} width={50} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, fontSize: 11 }}
                  formatter={(v) => fmt.money(v)}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {buyerSeries.buyers.map((b, i) => (
                  <Line
                    key={b}
                    type="monotone"
                    dataKey={b}
                    stroke={['#10b981','#3b82f6','#f59e0b','#ef4444','#a855f7','#06b6d4','#eab308'][i % 7]}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}

      {/* Buyer breakdown (Buyers tab) */}
      {tab === 'buyers' && (
      <Section
        title="Compare Buyers"
        subtitle={`${buyerCompare.groups.length} buyers with 2+ cars · read against everyone`}
        icon={<Target size={14} className="text-emerald-400" />}
      >
        <CompareBox
          rowLabel="Buyer"
          columns={COMPARE_COLUMNS}
          rows={buyerCompare.groups}
          baseline={buyerCompare.baseline}
          baselineLabel="All buyers"
          highlight={filterBuyer}
          footnote={buyerCompare.hiddenCars ? `${buyerCompare.hiddenCars} one-off cars not shown` : ''}
        />
      </Section>
      )}

      {tab === 'buyers' && (
      <Section title="Buyer Performance" subtitle={`${buyers.length} buyers · who's making you money`} icon={<Award size={14} className="text-amber-400" />}>
        {buyers.length === 0 ? (
          <p className="text-xs text-slate-500 py-3 text-center">No buyer data for this period</p>
        ) : (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs min-w-max">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="text-left py-2 pr-2">Buyer</th>
                  <th className="text-right px-2">#</th>
                  <th className="text-right px-2">Total Profit</th>
                  <th className="text-right px-2">Avg $</th>
                  <th className="text-right px-2">Wins</th>
                  <th className="text-right px-2">Losses</th>
                  <th className="text-right px-2">Loss $</th>
                  <th className="text-right px-2">Win %</th>
                  <th className="text-right pl-2">Avg Days</th>
                </tr>
              </thead>
              <tbody>
                {buyers.map((b) => (
                  <tr key={b.buyer} className="border-b border-slate-800/50">
                    <td className="py-2 pr-2 font-bold text-white">{b.buyer}</td>
                    <td className="px-2 text-right text-slate-300">{b.count}</td>
                    <td className={`px-2 text-right font-bold ${b.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt.money(b.totalProfit)}</td>
                    <td className={`px-2 text-right ${b.avgProfit >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{fmt.money(b.avgProfit)}</td>
                    <td className="px-2 text-right text-emerald-400">{b.wins}</td>
                    <td className="px-2 text-right text-red-400">{b.losses}</td>
                    <td className="px-2 text-right text-red-400">{b.losses ? fmt.money(b.lossAmount) : '—'}</td>
                    <td className="px-2 text-right text-slate-300">{fmt.pct(b.pctWinners)}</td>
                    <td className="pl-2 text-right text-slate-400">{b.avgDays}d</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-700 bg-slate-800/50">
                  <td className="py-2 pr-2 font-bold text-slate-300">TOTAL</td>
                  <td className="px-2 text-right text-slate-300">{buyers.reduce((s,b)=>s+b.count,0)}</td>
                  <td className="px-2 text-right font-bold text-emerald-400">{fmt.money(buyers.reduce((s,b)=>s+b.totalProfit,0))}</td>
                  <td className="px-2 text-right text-emerald-300">{fmt.money(Math.round(buyers.reduce((s,b)=>s+b.totalProfit,0) / Math.max(1, buyers.reduce((s,b)=>s+b.count,0))))}</td>
                  <td className="px-2 text-right text-emerald-400">{buyers.reduce((s,b)=>s+b.wins,0)}</td>
                  <td className="px-2 text-right text-red-400">{buyers.reduce((s,b)=>s+b.losses,0)}</td>
                  <td className="px-2 text-right text-red-400">{fmt.money(buyers.reduce((s,b)=>s+b.lossAmount,0))}</td>
                  <td className="px-2 text-right text-slate-300">—</td>
                  <td className="pl-2 text-right text-slate-400">—</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Section>
      )}

      {/* Vendors tab */}
      {tab === 'vendors' && (
        <Section
          title="Compare Vendors"
          subtitle={`${vendorCompare.groups.length} vendors with 2+ cars · read against everyone`}
          icon={<Target size={14} className="text-emerald-400" />}
        >
          <CompareBox
            rowLabel="Vendor"
            columns={COMPARE_COLUMNS}
            rows={vendorCompare.groups}
            baseline={vendorCompare.baseline}
            baselineLabel="All vendors"
            highlight={filterVendor}
            footnote={vendorCompare.hiddenCars ? `${vendorCompare.hiddenCars} one-off cars not shown` : ''}
          />
        </Section>
      )}

      {tab === 'vendors' && (
        <PeopleTable title="Vendor Performance" subtitle={`${vendors.length} vendors · where the cars came from`} rows={vendors} colLabel="Vendor" />
      )}

      {/* Customers tab */}
      {tab === 'customers' && (
        <PeopleTable title="Customer Performance" subtitle={`${customers.length} customers · who bought from us`} rows={customers} colLabel="Customer" />
      )}

      {/* Make leaderboard (Summary tab) */}
      {tab === 'summary' && (
      <Section title="Make Performance" subtitle={`${makes.length} makes · sorted by ${makeSort}`} icon={<TrendingUp size={14} className="text-emerald-400" />}>
        <div className="flex gap-1.5 mb-3 overflow-x-auto -mx-1 px-1">
          {[
            { k: 'avgProfit',   l: 'Avg $' },
            { k: 'totalProfit', l: 'Total $' },
            { k: 'count',       l: 'Volume' },
            { k: 'pctWinners',  l: '% Win' },
            { k: 'avgDays',     l: 'Days' },
          ].map((s) => (
            <button
              key={s.k}
              onClick={() => setMakeSort(s.k)}
              className={`shrink-0 px-2 py-1 rounded text-[10px] font-semibold ${
                makeSort === s.k ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-400'
              }`}
            >{s.l}</button>
          ))}
        </div>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 text-[10px] uppercase">
                <th className="text-left py-1 pr-2">Make</th>
                <th className="text-right py-1 px-1">Sold</th>
                <th className="text-right py-1 px-1">Avg $</th>
                <th className="text-right py-1 px-1">Total $</th>
                <th className="text-right py-1 px-1">% Win</th>
                <th className="text-right py-1 pl-1">Days</th>
              </tr>
            </thead>
            <tbody>
              {sortedMakes.map((m) => (
                <tr key={m.make} className="border-t border-slate-800">
                  <td className="py-1.5 pr-2 text-white font-semibold truncate max-w-[100px]">{m.make}</td>
                  <td className="text-right text-slate-400 px-1">{m.count}</td>
                  <td className="text-right font-bold px-1" style={{ color: profitColor(m.avgProfit) }}>
                    {fmt.money(m.avgProfit)}
                  </td>
                  <td className="text-right text-slate-300 px-1">{fmt.money(m.totalProfit)}</td>
                  <td className="text-right text-slate-300 px-1">{fmt.pct(m.pctWinners)}</td>
                  <td className="text-right text-slate-400 pl-1">{fmt.days(m.avgDays)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      )}

      <p className="text-[10px] text-slate-600 text-center mt-6">
        Source: <code>sold_clean</code> view · IQR-trimmed · {fmt.count(allRows.length)} rows
        {lastRefreshed && (
          <> · refreshed {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · auto every 5min</>
        )}
      </p>
    </div>
  )
}

// ── Sub-components ──
function Header({ navigate }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
        <ArrowLeft size={20} />
      </button>
      <div className="flex-1">
        <h1 className="text-lg font-bold text-emerald-400">Sold Reports</h1>
        <p className="text-xs text-slate-400">Profit trends · cleaned data</p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="p-2 rounded-lg bg-slate-800 text-slate-400"
        title="Refresh"
      >
        <RefreshCw size={18} />
      </button>
    </div>
  )
}

function KPICard({ label, value, highlight, good, bad, span }) {
  const valueClass = bad
    ? 'text-red-400'
    : good
    ? 'text-emerald-400'
    : highlight
    ? 'text-emerald-400'
    : 'text-white'
  return (
    <div className={`card ${span === 2 ? 'col-span-2' : ''}`}>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-xl font-bold ${valueClass} mt-0.5`}>{value}</p>
    </div>
  )
}

function Section({ title, subtitle, icon, children, compact }) {
  return (
    <div className={`card ${compact ? 'mb-0' : 'mb-4'}`}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <h2 className="text-sm font-bold text-emerald-400">{title}</h2>
      </div>
      {subtitle && <p className="text-[10px] text-slate-500 mb-2">{subtitle}</p>}
      {children}
    </div>
  )
}

function PeopleTable({ title, subtitle, rows, colLabel }) {
  if (!rows.length) {
    return (
      <Section title={title} subtitle={subtitle}>
        <p className="text-xs text-slate-500 py-3 text-center">No data for this period</p>
      </Section>
    )
  }
  const totals = rows.reduce((t, b) => ({
    count: t.count + b.count,
    totalProfit: t.totalProfit + b.totalProfit,
    wins: t.wins + b.wins,
    losses: t.losses + b.losses,
    lossAmount: t.lossAmount + b.lossAmount,
  }), { count: 0, totalProfit: 0, wins: 0, losses: 0, lossAmount: 0 })
  return (
    <Section title={title} subtitle={subtitle}>
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800">
              <th className="text-left py-2 pr-2">{colLabel}</th>
              <th className="text-right px-2">#</th>
              <th className="text-right px-2">Total Profit</th>
              <th className="text-right px-2">Avg $</th>
              <th className="text-right px-2">Wins</th>
              <th className="text-right px-2">Losses</th>
              <th className="text-right px-2">Loss $</th>
              <th className="text-right px-2">Win %</th>
              <th className="text-right pl-2">Avg Days</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.name} className="border-b border-slate-800/50">
                <td className="py-2 pr-2 font-bold text-white">{b.name}</td>
                <td className="px-2 text-right text-slate-300">{b.count}</td>
                <td className={`px-2 text-right font-bold ${b.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt.money(b.totalProfit)}</td>
                <td className={`px-2 text-right ${b.avgProfit >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{fmt.money(b.avgProfit)}</td>
                <td className="px-2 text-right text-emerald-400">{b.wins}</td>
                <td className="px-2 text-right text-red-400">{b.losses}</td>
                <td className="px-2 text-right text-red-400">{b.losses ? fmt.money(b.lossAmount) : '—'}</td>
                <td className="px-2 text-right text-slate-300">{fmt.pct(b.pctWinners)}</td>
                <td className="pl-2 text-right text-slate-400">{b.avgDays}d</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-700 bg-slate-800/50">
              <td className="py-2 pr-2 font-bold text-slate-300">TOTAL</td>
              <td className="px-2 text-right text-slate-300">{totals.count}</td>
              <td className="px-2 text-right font-bold text-emerald-400">{fmt.money(totals.totalProfit)}</td>
              <td className="px-2 text-right text-emerald-300">{fmt.money(Math.round(totals.totalProfit / Math.max(1, totals.count)))}</td>
              <td className="px-2 text-right text-emerald-400">{totals.wins}</td>
              <td className="px-2 text-right text-red-400">{totals.losses}</td>
              <td className="px-2 text-right text-red-400">{fmt.money(totals.lossAmount)}</td>
              <td className="px-2 text-right text-slate-300">—</td>
              <td className="pl-2 text-right text-slate-400">—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Section>
  )
}
