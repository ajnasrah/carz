import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Search, ChevronDown, Copy, Check, ArrowLeft, SlidersHorizontal, Send } from 'lucide-react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/useAuth'
import { isAdminProfile } from '../services/adminSetup'
import { toInt } from '../services/utils'
import HistoryButton from '../components/HistoryButton'
import MarketplacePrice from '../components/MarketplacePrice'
import MultiSelect from '../components/MultiSelect'
import { fetchPhotoEdits } from '../services/listingPhotos'
import ShareToBuyer, { ShareCarButton } from '../components/ShareToBuyer'
import { saveCsv } from '../native/files'
import { copyText } from '../native/clipboard'
import { isNative } from '../native/platform'

async function exportCsv(cars) {
  const cols = [
    ['stock_number', 'Stock'], ['year', 'Year'], ['make', 'Make'], ['model', 'Model'],
    ['mileage', 'Mileage'], ['vehicle_color', 'Color'], ['vin_last6', 'VIN Last 6'], ['full_vin', 'VIN'],
    ['buy_now', 'Buy Now'], ['sa_url', 'SmartAuction Link'],
  ]
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [cols.map(([, h]) => esc(h)).join(',')]
  for (const c of cars) lines.push(cols.map(([k]) => esc(c[k])).join(','))
  try {
    await saveCsv(
      lines.join('\n'),
      `carz-marketplace-${new Date().toISOString().slice(0, 10)}.csv`,
      { title: 'Marketplace export' },
    )
  } catch (err) {
    console.error('Marketplace export failed', err)
    alert('Could not export: ' + (err?.message || err))
  }
}

// Small inline copy icon that sits right next to a value
function InlineCopy({ text }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={(e) => { e.preventDefault(); copyText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) }) }}
      className="shrink-0 text-slate-500 active:text-emerald-400"
      title="Copy"
    >
      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
    </button>
  )
}

function firstPhoto(checklist, edit) {
  // Handle both checklist.photos and direct photo URLs
  const photos = checklist?.photos || {}

  // An admin's chosen cover wins over the slot preference below — that's the
  // whole point of picking one. Skip anything they removed.
  if (edit) {
    const urls = new Set(
      Object.values(photos).map((p) => (typeof p === 'string' ? p : p?.url)).filter(Boolean),
    )
    const hidden = new Set(edit.hidden || [])
    const chosen = (edit.ordering || []).find((u) => urls.has(u) && !hidden.has(u))
    if (chosen) return chosen
  }

  // Whatever we fall back to, never show a photo an admin removed.
  const hidden = new Set(edit?.hidden || [])
  const urlOf = (p) => (typeof p === 'string' ? p : p?.url) || null

  // Check standard photo slots
  for (const slot of ['driver_front_corner', 'pass_front_corner', 'driver_rear_corner', 'pass_rear_corner']) {
    const url = urlOf(photos[slot])
    if (url && !hidden.has(url)) return url
  }

  // Check any photo in the object
  for (const p of Object.values(photos)) {
    const url = urlOf(p)
    if (url && !hidden.has(url)) return url
  }
  return null
}

// Mileage as bands rather than one "under X" cutoff — "under 150k" swept in
// every low-mile car too, so there was no way to ask for the 100–150k stuff on
// its own. Multi-select like the rest, so 50–100k plus 150k+ is one question.
// Upper bound is exclusive, so the bands don't overlap at the round numbers.
const MILE_BANDS = [
  { label: 'Under 50k', min: 0, max: 50000 },
  { label: '50k – 100k', min: 50000, max: 100000 },
  { label: '100k – 150k', min: 100000, max: 150000 },
  { label: '150k – 200k', min: 150000, max: 200000 },
  { label: '200k+', min: 200000, max: Infinity },
]

function countDamages(checklist) {
  let n = 0
  for (const p of Object.values(checklist?.exterior || {})) n += (p.damages?.length || 0)
  for (const z of Object.values(checklist?.interior || {})) n += (z.damages?.length || 0)
  return n
}

export default function Marketplace() {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile } = useAuth()

  // Staff get a real destination. A buyer is marketplace-only — the dashboard
  // would just bounce him back here — so he gets plain browser-back instead.
  //
  // isNative() is the third case, and skipping it trapped people. This page hides
  // the bottom nav, and the native shell has no URL bar and no browser back — so
  // when a staff member cold-started the app straight onto /marketplace (profile
  // still loading, so backTo null; nothing in history, so canGoBack false) the
  // header rendered no control at all and the only way out was force-quitting.
  // In the app there is always somewhere to send them: ProtectedRoute routes '/'
  // onward to /listings for a buyer and /login for a signed-out visitor, so this
  // recovers every case rather than dead-ending.
  const backTo = profile && profile.account_type !== 'buyer' ? '/' : null
  // 'default' is react-router's key for the entry the tab opened on: a shared
  // link with nothing behind it. Anything else means we navigated here.
  const canGoBack = location.key !== 'default'
  const homeTo = backTo || (isNative() && !canGoBack ? '/' : null)

  const [cars, setCars] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [makeFilter, setMakeFilter] = useState([]) // several at once
  const [modelFilter, setModelFilter] = useState([])
  const [yearFilter, setYearFilter] = useState([])
  const [mileFilter, setMileFilter] = useState([])
  const [sort, setSort] = useState('')
  const [hidden, setHidden] = useState(() => new Set())
  // Removing a car only sets a hide flag, and nothing used to clear it: a car
  // taken down by mistake was gone for good, because re-scraping it and
  // re-uploading its photos rewrites the listing without touching the flag.
  const [showRemoved, setShowRemoved] = useState(false)
  const [photoEdits, setPhotoEdits] = useState(() => new Map())
  const [picked, setPicked] = useState(() => new Set()) // cars staged for one buyer
  const [sharing, setSharing] = useState(false)

  async function load() {
    const [listRes, hiddenRes] = await Promise.all([
      supabase.rpc('marketplace_listings'),
      supabase.from('marketplace_hidden').select('stock_number'),
    ])
    const list = listRes.data || []
    setCars(list)
    setHidden(new Set((hiddenRes.data || []).map((h) => h.stock_number)))
    // Photo edits decide each card's cover shot; without them a car whose cover
    // was changed would show the old one until you opened the listing.
    setPhotoEdits(await fetchPhotoEdits(list.map((c) => c.full_vin)))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Admin controls follow the signed-in profile the app already loaded — no
  // extra round trip, and one shared definition of "admin" with every other page.
  const isAdmin = isAdminProfile(profile)
  // Location history is an internal record — which shop, which transporter,
  // which auction. It is not part of what we sell, and the marketplace is
  // public, so it is staff-only wherever it appears.
  const isStaff = isAdmin || profile?.account_type === 'employee'

  // Price edits land on one car; re-running the whole listings RPC to see them
  // would throw away scroll position and filters for a number we already know.
  function applyPrice(id, price, source) {
    setCars((list) =>
      list.map((c) => (c.id === id ? { ...c, buy_now: price == null ? null : String(price), price_source: source } : c)),
    )
  }

  function togglePick(id) {
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function removeCar(stock) {
    if (!confirm(`Remove ${stock} from the marketplace?`)) return
    const { error } = await supabase.rpc('hide_marketplace_car', { p_stock: stock })
    if (error) { alert('Could not remove: ' + error.message); return }
    setHidden((h) => new Set(h).add(stock))
  }

  async function restoreCar(stock) {
    const { error } = await supabase.rpc('unhide_marketplace_car', { p_stock: stock })
    if (error) { alert('Could not restore: ' + error.message); return }
    setHidden((h) => { const next = new Set(h); next.delete(stock); return next })
  }

  const visible = useMemo(
    () => cars.filter((c) => hidden.has(c.stock_number) === showRemoved),
    [cars, hidden, showRemoved],
  )

  const makes = useMemo(
    () => [...new Set(visible.map((c) => c.make).filter(Boolean))].sort(),
    [visible],
  )
  // Models narrow to the makes you picked — the full list across every make is
  // hundreds of names, most of them irrelevant the moment you choose a brand.
  const models = useMemo(() => {
    const pool = makeFilter.length ? visible.filter((c) => makeFilter.includes(c.make)) : visible
    return [...new Set(pool.map((c) => c.model).filter(Boolean))].sort()
  }, [visible, makeFilter])
  const years = useMemo(
    () => [...new Set(visible.map((c) => c.year).filter(Boolean))].sort((a, b) => Number(b) - Number(a)),
    [visible],
  )

  // Changing the makes can strand a model that's no longer on offer, which would
  // silently filter everything down to nothing. Derived rather than synced, so a
  // stranded model just stops counting — and comes back if the make does.
  const activeModels = useMemo(
    () => modelFilter.filter((m) => models.includes(m)),
    [modelFilter, models],
  )

  const activeFilters =
    makeFilter.length + activeModels.length + yearFilter.length + mileFilter.length

  function clearFilters() {
    setMakeFilter([])
    setModelFilter([])
    setYearFilter([])
    setMileFilter([])
  }

  const filtered = useMemo(() => {
    let result = visible
    if (makeFilter.length) result = result.filter((c) => makeFilter.includes(c.make))
    if (activeModels.length) result = result.filter((c) => activeModels.includes(c.model))
    if (yearFilter.length) result = result.filter((c) => yearFilter.includes(c.year))
    if (mileFilter.length) {
      const bands = MILE_BANDS.filter((b) => mileFilter.includes(b.label))
      result = result.filter((c) => {
        const m = toInt(c.mileage)
        return bands.some((b) => m >= b.min && m < b.max)
      })
    }
    if (search.trim()) {
      const q = search.toUpperCase()
      result = result.filter((c) =>
        [c.vin, c.vin_last6, c.year, c.make, c.model].some((v) => String(v || '').toUpperCase().includes(q)),
      )
    }
    if (sort) {
      const price = (c) => (c.buy_now ? Number(c.buy_now) : null)
      result = [...result].sort((a, b) => {
        switch (sort) {
          case 'make': return String(a.make || '').localeCompare(String(b.make || ''))
          case 'price_asc': return (price(a) ?? Infinity) - (price(b) ?? Infinity)
          case 'price_desc': return (price(b) ?? -Infinity) - (price(a) ?? -Infinity)
          case 'miles_asc': return toInt(a.mileage) - toInt(b.mileage)
          case 'miles_desc': return toInt(b.mileage) - toInt(a.mileage)
          default: return 0
        }
      })
    }
    return result
  }, [visible, search, makeFilter, activeModels, yearFilter, mileFilter, sort])

  // Every car currently on screen is ticked — what flips the Select all button
  // to Deselect all. Scoped to `filtered` on purpose: with a filter on, "all"
  // means the cars you can see, not the whole book behind them.
  const allPicked = filtered.length > 0 && filtered.every((c) => picked.has(c.id))

  return (
    <div className="min-h-screen bg-slate-950 text-white safe-top">
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* The marketplace is public, so it carries no bottom nav — which left
            anyone who walked in from the app with no way out. The exit depends
            on who's looking: staff go to the dashboard, a buyer or a visitor who
            clicked through goes back where they came from, and someone who
            opened a shared link cold gets nothing, because there's nowhere to
            send them. */}
        <div className="relative text-center mb-6">
          {homeTo ? (
            <Link to={homeTo} aria-label="Back to dashboard"
              className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-1 p-2 -ml-2 rounded-lg text-slate-300 active:bg-slate-800 text-sm">
              <ArrowLeft size={18} /> <span className="hidden sm:inline">Dashboard</span>
            </Link>
          ) : canGoBack ? (
            <button onClick={() => navigate(-1)} aria-label="Back"
              className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-1 p-2 -ml-2 rounded-lg text-slate-300 active:bg-slate-800 text-sm">
              <ArrowLeft size={18} /> <span className="hidden sm:inline">Back</span>
            </button>
          ) : null}
          <h1 className="text-2xl font-bold text-emerald-400">CARZ INC</h1>
          <p className="text-slate-400 text-sm">Wholesale Inventory</p>
          {isAdmin && hidden.size > 0 && (
            <button
              onClick={() => setShowRemoved((s) => !s)}
              className="mt-1 text-xs font-semibold text-slate-400 underline active:text-slate-200"
            >
              {showRemoved ? 'Back to the marketplace' : `Removed cars (${hidden.size})`}
            </button>
          )}
        </div>

        {/* Search stays on the surface — it's the one control used on every
            visit. Everything else lives behind Filter, which is where make,
            model and year each take as many picks as you want. */}
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-sm bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-white"
            />
          </div>
          <button
            onClick={() => setShowFilters((s) => !s)}
            className={`flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border whitespace-nowrap ${
              activeFilters
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-white'
            }`}
          >
            <SlidersHorizontal size={15} />
            Filter
            {activeFilters > 0 && (
              <span className="ml-0.5 px-1.5 rounded-full bg-emerald-500 text-slate-900 text-[10px] font-bold">
                {activeFilters}
              </span>
            )}
          </button>
        </div>

        {showFilters && (
          <div className="mb-4 p-3 rounded-xl bg-slate-900 border border-slate-800">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <MultiSelect label="Make" options={makes} selected={makeFilter} onChange={setMakeFilter} />
              <MultiSelect label="Model" options={models} selected={activeModels} onChange={setModelFilter} />
              <MultiSelect label="Year" options={years} selected={yearFilter} onChange={setYearFilter} />
              <MultiSelect
                label="Miles"
                plural="Miles"
                options={MILE_BANDS.map((b) => b.label)}
                selected={mileFilter}
                onChange={setMileFilter}
              />
            </div>
            {activeFilters > 0 && (
              <button
                onClick={clearFilters}
                className="mt-2 text-xs font-semibold text-slate-400 active:text-white"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-xs text-slate-500 whitespace-nowrap">{filtered.length} vehicles</p>
            <div className="relative">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="text-xs bg-slate-800 border border-slate-700 rounded-lg pl-2 pr-6 py-1.5 text-white appearance-none"
              >
                <option value="">Sort: Newest</option>
                <option value="make">Make: A–Z</option>
                <option value="price_asc">Price: Low → High</option>
                <option value="price_desc">Price: High → Low</option>
                <option value="miles_asc">Miles: Low → High</option>
                <option value="miles_desc">Miles: High → Low</option>
              </select>
              <ChevronDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* One control, both directions. "Select all" with no counterpart
                meant the only way back was the Clear button on a bar that only
                exists while something is picked — so the button flips once
                everything on screen is ticked. */}
            <button
              onClick={() => setPicked(allPicked ? new Set() : new Set(filtered.map((c) => c.id)))}
              disabled={!filtered.length}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 disabled:opacity-40 whitespace-nowrap"
            >
              {allPicked ? 'Deselect all' : 'Select all'}
            </button>
            <button
              onClick={() => exportCsv(filtered)}
              disabled={!filtered.length}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-40 whitespace-nowrap"
            >
              Export CSV
            </button>
          </div>
        </div>

        {/* Staging bar — appears the moment a car is ticked, so a list for one
            buyer is built by tapping cars, not by copying links one at a time. */}
        {picked.size > 0 && (
          <div className="sticky top-2 z-20 flex items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-emerald-500 text-slate-900 shadow-lg">
            <span className="text-sm font-bold flex-1">
              {picked.size} car{picked.size !== 1 ? 's' : ''} selected
            </span>
            <button
              onClick={() => setPicked(new Set())}
              className="text-xs font-bold px-2 py-1 rounded-lg bg-slate-900/15"
            >
              Clear
            </button>
            <button
              onClick={() => setSharing(true)}
              className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-900 text-emerald-400"
            >
              <Send size={13} /> Send to buyer
            </button>
          </div>
        )}

        {sharing && (
          <ShareToBuyer
            cars={filtered.filter((c) => picked.has(c.id))}
            onClose={() => setSharing(false)}
          />
        )}

        {loading ? (
          <p className="text-center text-slate-400 py-12">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-slate-500 py-12">No vehicles match your filters</p>
        ) : (
          <div className="space-y-4">
            {filtered.map((car) => {
              const photo = firstPhoto(car.checklist, photoEdits.get((car.full_vin || '').toUpperCase()))
              const damages = countDamages(car.checklist)
              const vehicle = [car.year, car.make, car.model].filter(Boolean).join(' ') || 'Unknown'
              const miles = toInt(car.mileage)
              const vin = car.full_vin || car.vin || car.vin_last6 || ''
              const photoCount = new Set(Object.values(car.checklist?.photos || {}).map((p) => p?.url).filter(Boolean)).size
              return (
                <div
                  key={car.id}
                  className={`bg-slate-900 rounded-xl border overflow-hidden ${
                    picked.has(car.id) ? 'border-emerald-500' : 'border-slate-800'
                  }`}
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
                    <span className="absolute bottom-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-black/60 text-white font-semibold">
                      {photoCount} photos
                    </span>
                    {/* Tick cars as you browse; the bar at the top sends the
                        whole set to one buyer in a single message.
                        The circle is 28px because that's the size it should
                        LOOK, but the button around it is 44px of padding, so a
                        thumb aimed at the circle actually lands. At 28px flat
                        the misses outnumbered the hits and it read as broken. */}
                    <button
                      onClick={() => togglePick(car.id)}
                      aria-label={picked.has(car.id) ? 'Deselect' : 'Select for a buyer'}
                      aria-pressed={picked.has(car.id)}
                      className="absolute top-0 left-0 w-11 h-11 flex items-center justify-center"
                    >
                      <span
                        className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shadow-md ${
                          picked.has(car.id)
                            ? 'bg-emerald-500 border-emerald-500 text-slate-900'
                            : 'bg-black/60 border-white text-transparent'
                        }`}
                      >
                        <Check size={15} />
                      </span>
                    </button>
                  </div>
                  <div className="p-4">
                    <h2 className="font-bold text-white text-lg">{vehicle}</h2>

                    {/* Price section — always present, so a car with no number
                        reads as "not priced yet" instead of looking like a
                        rendering gap. Admins get Set/Edit right here. */}
                    <div className="mt-2 mb-1 py-2 border-y border-slate-800">
                      <MarketplacePrice
                        vin={car.full_vin || ''}
                        price={car.buy_now}
                        source={car.price_source}
                        canEdit={isAdmin}
                        onChange={(price, source) => applyPrice(car.id, price, source)}
                      />
                    </div>

                    <div className="flex gap-4 mt-1 text-sm text-slate-400">
                      <span className="inline-flex items-center gap-1">{miles.toLocaleString()} mi <InlineCopy text={String(miles)} /></span>
                      {car.vehicle_color && <span>{car.vehicle_color}</span>}
                      <span className="inline-flex items-center gap-1">VIN ...{vin.slice(-6)} <InlineCopy text={vin} /></span>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <Link
                        to={`/marketplace/${car.id}`}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-900 text-xs font-bold"
                      >
                        View Details
                      </Link>
                      {isStaff && <HistoryButton stockNumber={car.stock_number} vin={vin} />}
                      <ShareCarButton
                        car={car}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-bold active:bg-slate-700"
                      />
                      {isAdmin && (
                        showRemoved ? (
                          <button
                            onClick={() => restoreCar(car.stock_number)}
                            className="ml-auto px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold"
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            onClick={() => removeCar(car.stock_number)}
                            className="ml-auto px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold"
                          >
                            Remove
                          </button>
                        )
                      )}
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
