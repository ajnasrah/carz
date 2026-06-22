import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Search, ChevronDown, Copy, Check } from 'lucide-react'
import { supabase } from '../services/supabase'
import { toInt } from '../services/utils'

function exportCsv(cars) {
  const cols = [
    ['stock_number', 'Stock'], ['year', 'Year'], ['make', 'Make'], ['model', 'Model'],
    ['mileage', 'Mileage'], ['vehicle_color', 'Color'], ['vin_last6', 'VIN Last 6'], ['full_vin', 'VIN'],
  ]
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [cols.map(([, h]) => esc(h)).join(',')]
  for (const c of cars) lines.push(cols.map(([k]) => esc(c[k])).join(','))
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `carz-marketplace-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function QuickCopy({ text, label }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) }) }}
      className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 text-[11px] font-semibold text-slate-300 active:bg-slate-700"
    >
      {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
      {copied ? 'Copied' : label}
    </button>
  )
}

function firstPhoto(checklist) {
  // Handle both checklist.photos and direct photo URLs
  const photos = checklist?.photos || {}
  
  // Check standard photo slots
  for (const slot of ['driver_front_corner', 'pass_front_corner', 'driver_rear_corner', 'pass_rear_corner']) {
    if (photos[slot]?.url) return photos[slot].url
    if (photos[slot] && typeof photos[slot] === 'string') return photos[slot]
  }
  
  // Check any photo in the object
  const first = Object.values(photos).find((p) => {
    if (typeof p === 'string') return p
    return p?.url
  })
  
  if (typeof first === 'string') return first
  return first?.url || null
}

function countDamages(checklist) {
  let n = 0
  for (const p of Object.values(checklist?.exterior || {})) n += (p.damages?.length || 0)
  for (const z of Object.values(checklist?.interior || {})) n += (z.damages?.length || 0)
  return n
}

export default function Marketplace() {
  const [cars, setCars] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [makeFilter, setMakeFilter] = useState('')
  const [yearRange, setYearRange] = useState('')
  const [mileRange, setMileRange] = useState('')

  useEffect(() => {
    async function load() {
      const { data } = await supabase.rpc('marketplace_listings')
      setCars(data || [])
      setLoading(false)
    }
    load()
  }, [])

  const makes = useMemo(() => {
    const set = new Set(cars.map((c) => c.make).filter(Boolean))
    return [...set].sort()
  }, [cars])

  const filtered = useMemo(() => {
    let result = cars
    if (makeFilter) result = result.filter((c) => c.make === makeFilter)
    if (yearRange) {
      const [lo, hi] = yearRange.split('-').map(Number)
      result = result.filter((c) => {
        const y = toInt(c.year)
        return y >= lo && y <= (hi || 9999)
      })
    }
    if (mileRange) {
      const max = toInt(mileRange)
      if (max > 0) result = result.filter((c) => toInt(c.mileage) <= max)
    }
    if (search.trim()) {
      const q = search.toUpperCase()
      result = result.filter((c) =>
        [c.vin, c.vin_last6, c.year, c.make, c.model].some((v) => String(v || '').toUpperCase().includes(q)),
      )
    }
    return result
  }, [cars, search, makeFilter, yearRange, mileRange])

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-emerald-400">CARZ INC</h1>
          <p className="text-slate-400 text-sm">Wholesale Inventory</p>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <div className="relative">
            <select
              value={makeFilter}
              onChange={(e) => setMakeFilter(e.target.value)}
              className="w-full text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white appearance-none"
            >
              <option value="">All Makes</option>
              {makes.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>
          <div className="relative">
            <select
              value={yearRange}
              onChange={(e) => setYearRange(e.target.value)}
              className="w-full text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white appearance-none"
            >
              <option value="">All Years</option>
              <option value="2023-2026">2023–2026</option>
              <option value="2020-2022">2020–2022</option>
              <option value="2017-2019">2017–2019</option>
              <option value="2014-2016">2014–2016</option>
              <option value="2000-2013">2013 & older</option>
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>
          <div className="relative">
            <select
              value={mileRange}
              onChange={(e) => setMileRange(e.target.value)}
              className="w-full text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white appearance-none"
            >
              <option value="">Any Miles</option>
              <option value="50000">Under 50k</option>
              <option value="100000">Under 100k</option>
              <option value="150000">Under 150k</option>
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-sm bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-white"
            />
          </div>
        </div>

        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-slate-500">{filtered.length} vehicles</p>
          <button
            onClick={() => exportCsv(filtered)}
            disabled={!filtered.length}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>

        {loading ? (
          <p className="text-center text-slate-400 py-12">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-slate-500 py-12">No vehicles match your filters</p>
        ) : (
          <div className="space-y-4">
            {filtered.map((car) => {
              const photo = firstPhoto(car.checklist)
              const damages = countDamages(car.checklist)
              const vehicle = [car.year, car.make, car.model].filter(Boolean).join(' ') || 'Unknown'
              const miles = toInt(car.mileage)
              const vin = car.full_vin || car.vin || car.vin_last6 || ''
              const photoCount = Object.values(car.checklist?.photos || {}).filter((p) => p?.url).length
              return (
                <div
                  key={car.id}
                  className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden"
                >
                  <div className="aspect-[16/9] bg-slate-800 relative">
                    {photo ? (
                      <img src={photo} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex items-center justify-center h-full text-slate-600 text-sm">No Photo</div>
                    )}
                    {damages > 0 && (
                      <span className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-red-500/90 text-white font-bold">
                        {damages} damage{damages !== 1 ? 's' : ''}
                      </span>
                    )}
                    <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-black/60 text-white font-semibold">
                      {photoCount} photos
                    </span>
                  </div>
                  <div className="p-4">
                    <h2 className="font-bold text-white text-lg">{vehicle}</h2>
                    <div className="flex gap-4 mt-1 text-sm text-slate-400">
                      <span>{miles.toLocaleString()} mi</span>
                      {car.vehicle_color && <span>{car.vehicle_color}</span>}
                      <span>VIN ...{vin.slice(-6)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <QuickCopy text={vin} label="Copy VIN" />
                      <QuickCopy text={String(miles)} label="Copy Miles" />
                      <Link
                        to={`/marketplace/${car.id}`}
                        className="ml-auto px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-900 text-xs font-bold"
                      >
                        View Details
                      </Link>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
