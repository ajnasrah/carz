import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Search, RefreshCw, Clock } from 'lucide-react'
import { supabase } from '../services/supabase'
import { toInt, toMoney, timeAgo } from '../services/utils'
import { fetchAuctionSold } from '../services/soldVehicles'
import VehicleHistoryModal from '../components/VehicleHistoryModal'

// Frazer date: "MM/DD/YY" → Date
function parseDate(v) {
  if (!v || typeof v !== 'string') return null
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return null
  const [, mo, d, y] = m
  const yy = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10)
  return new Date(yy, parseInt(mo, 10) - 1, parseInt(d, 10))
}

export default function Sold() {
  const navigate = useNavigate()
  const [source, setSource] = useState('auction') // 'auction' (live) | 'retail' (Frazer)
  const [retailRows, setRetailRows] = useState([])
  const [auctionRows, setAuctionRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [syncedAt, setSyncedAt] = useState(null)
  const [historyFor, setHistoryFor] = useState(null) // { stock_number, vin }

  // PostgREST caps each request at 1000 rows (db_max_rows), so .limit(5000)
  // silently truncates. Paginate with .range() to get every row.
  async function fetchAllSold(cancelledRef) {
    const PAGE = 1000
    const all = []
    let from = 0
    while (true) {
      if (cancelledRef?.current) return []
      const { data, error } = await supabase.from('sold').select('*').range(from, from + PAGE - 1)
      if (error || !data) break
      all.push(...data)
      if (data.length < PAGE) break
      from += PAGE
      if (from >= 50000) break // safety cap
    }
    return all.sort((a, b) => {
      const da = parseDate(a.sale_date)?.getTime() || 0
      const db = parseDate(b.sale_date)?.getTime() || 0
      return db - da
    })
  }

  async function load(cancelledRef) {
    setLoading(true)
    const [retail, auction] = await Promise.all([fetchAllSold(cancelledRef), fetchAuctionSold()])
    if (cancelledRef?.current) return
    setRetailRows(retail)
    setAuctionRows(auction)
    if (retail.length) setSyncedAt(retail[0].synced_at)
    setLoading(false)
  }

  useEffect(() => {
    const cancelledRef = { current: false }
    load(cancelledRef)
    return () => {
      cancelledRef.current = true
    }
  }, [])

  const rows = source === 'auction' ? auctionRows : retailRows

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toUpperCase()
    return rows.filter((r) =>
      [
        r.stock_number, r.vehicle_vin || r.vin, r.last_6_vin,
        r.vehicle_make, r.vehicle_model,
        r.first_name, r.last_name,
        r.vendor, r.buyer, r.type_of_sale, r.channel,
      ]
        .filter(Boolean)
        .some((v) => String(v).toUpperCase().includes(q)),
    )
  }, [rows, search])

  const totals = useMemo(() => {
    let sales = 0, profit = 0
    for (const r of filtered) {
      sales += toInt(source === 'auction' ? r.sale_price : r.sales_price)
      profit += toInt(source === 'auction' ? r.profit : r.profit_on_sale)
    }
    return { sales, profit, count: filtered.length }
  }, [filtered, source])

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-emerald-400">Sold</h1>
          <p className="text-sm text-slate-400">
            {rows.length} cars
            {source === 'retail' && syncedAt && ` · synced ${new Date(syncedAt).toLocaleString()}`}
          </p>
        </div>
        <button onClick={() => load({ current: false })} className="p-2 rounded-lg bg-slate-800 text-slate-400">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Source toggle */}
      <div className="flex gap-1 mb-4 p-1 bg-slate-800/60 rounded-lg">
        <button
          onClick={() => setSource('auction')}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            source === 'auction' ? 'bg-emerald-500 text-slate-900' : 'text-slate-400'
          }`}
        >
          Auction / Wholesale
          <span className="ml-1 text-xs opacity-70">({auctionRows.length})</span>
        </button>
        <button
          onClick={() => setSource('retail')}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            source === 'retail' ? 'bg-emerald-500 text-slate-900' : 'text-slate-400'
          }`}
        >
          Retail (Frazer)
          <span className="ml-1 text-xs opacity-70">({retailRows.length})</span>
        </button>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Search stock, VIN, buyer, customer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="text-center text-slate-400 py-12">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-400 mb-2">No sold cars yet</p>
          <p className="text-slate-500 text-xs">
            {source === 'retail'
              ? 'Waiting for Frazer SOLD.CSV to land via Power Automate'
              : 'No cars currently marked sold on SmartAuction, Manheim, or OVE'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="card text-center !p-3">
              <p className="text-[10px] uppercase text-slate-400">Count</p>
              <p className="text-lg font-bold text-white">{totals.count}</p>
            </div>
            <div className="card text-center !p-3">
              <p className="text-[10px] uppercase text-slate-400">Gross Sales</p>
              <p className="text-lg font-bold text-white">{toMoney(totals.sales)}</p>
            </div>
            <div className="card text-center !p-3">
              <p className="text-[10px] uppercase text-slate-400">Profit</p>
              <p className={`text-lg font-bold ${totals.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {toMoney(totals.profit)}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {filtered.slice(0, 200).map((r) =>
              source === 'auction' ? (
                <AuctionRow key={r.stock_number} r={r} onHistory={() => setHistoryFor({ stock_number: r.stock_number, vin: r.vin })} />
              ) : (
                <RetailRow key={`${r.stock_number}-${r.sale_date}`} r={r} onHistory={() => setHistoryFor({ stock_number: r.stock_number, vin: r.vehicle_vin })} />
              ),
            )}
            {filtered.length > 200 && (
              <p className="text-center text-xs text-slate-500 py-3">
                Showing first 200 of {filtered.length}. Refine search to narrow.
              </p>
            )}
          </div>
        </>
      )}

      {historyFor && (
        <VehicleHistoryModal
          showPhotos
          stockNumber={historyFor.stock_number}
          vin={historyFor.vin}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </div>
  )
}

function AuctionRow({ r, onHistory }) {
  const label = [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(' ') || 'Vehicle'
  const profit = r.profit
  return (
    <button onClick={onHistory} className="card w-full text-left active:bg-slate-800/60 transition-colors">
      <div className="flex justify-between items-start">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white truncate">{label}</p>
          <p className="text-xs text-slate-400 font-mono">
            {r.stock_number} · {r.last_6_vin}
          </p>
          <div className="flex gap-3 mt-1 text-xs text-slate-500 items-center">
            <span>{r.channel}</span>
            {r.sold_at && <span>{new Date(r.sold_at).toLocaleDateString()}</span>}
            <span className="truncate">{r.buyer}</span>
          </div>
          {r.physical_location && (
            <p className="text-[11px] text-slate-500 mt-1 inline-flex items-center gap-1">
              <Clock size={11} /> {r.physical_location} · tap for history
            </p>
          )}
        </div>
        <div className="text-right shrink-0 ml-3">
          <p className="text-sm font-bold text-white">{toMoney(r.sale_price)}</p>
          {profit != null && (
            <p className={`text-xs font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{toMoney(profit)}</p>
          )}
        </div>
      </div>
    </button>
  )
}

function RetailRow({ r, onHistory }) {
  const label = [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(' ')
  const profit = toInt(r.profit_on_sale)
  const customer = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.vendor || '—'
  return (
    <button onClick={onHistory} className="card w-full text-left active:bg-slate-800/60 transition-colors">
      <div className="flex justify-between items-start">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white truncate">{label}</p>
          <p className="text-xs text-slate-400 font-mono">
            {r.stock_number} · {r.last_6_vin || r.vehicle_vin?.slice(-6)}
          </p>
          <div className="flex gap-3 mt-1 text-xs text-slate-500">
            <span>{r.sale_date}</span>
            {r.type_of_sale && <span>{r.type_of_sale}</span>}
            <span className="truncate">{customer}</span>
          </div>
        </div>
        <div className="text-right shrink-0 ml-3">
          <p className="text-sm font-bold text-white">{toMoney(r.sales_price)}</p>
          <p className={`text-xs font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{toMoney(profit)}</p>
        </div>
      </div>
    </button>
  )
}
