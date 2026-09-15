import { useEffect, useMemo, useRef, useState } from 'react'
import { Images, X, Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronRight, ImagePlus } from 'lucide-react'
import { AUCTION_LOCATIONS, isSamePlace } from '../services/locationLabels'
import {
  readInventoryImage, matchReads, fetchLocations, fetchCarsAtLocation, applyAuctionLocations,
} from '../services/auctionListUpload'
import * as haptics from '../native/haptics'

// Pictures read at once. Enough that ten screenshots finish while the walker
// is still standing there, few enough not to choke one bar of signal.
const PARALLEL = 3

// "Upload inventory list" on Walk Lot. Pick the auction, pick pictures of its
// inventory, and every picture is read on the spot; the result lists which of
// our cars were on them and which rows aren't ours, and nothing moves until
// Update is tapped. See src/services/auctionListUpload.js for the matching rules.
export default function AuctionListUpload({ inventory, defaultAuction, onToast }) {
  const [open, setOpen] = useState(false)
  const [auction, setAuction] = useState('')
  const [images, setImages] = useState([])     // { id, name, status: reading|done|error, count, error, note }
  const [reads, setReads] = useState([])       // every vehicle row read, all pictures
  const [ticked, setTicked] = useState({})     // stock_number → bool, overrides the default
  const [current, setCurrent] = useState(new Map())
  const [atAuction, setAtAuction] = useState([])
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(null)
  const [showNotFound, setShowNotFound] = useState(false)
  const [showMissing, setShowMissing] = useState(false)
  const fileRef = useRef(null)

  // Walking an auction's lot already says which auction this is.
  useEffect(() => {
    if (open && !auction && AUCTION_LOCATIONS.some((a) => a.location === defaultAuction)) {
      setAuction(defaultAuction)
    }
  }, [open, auction, defaultAuction])

  const auctionName = AUCTION_LOCATIONS.find((a) => a.location === auction)?.name || ''
  const reading = images.some((i) => i.status === 'reading')
  const result = useMemo(() => matchReads(reads, inventory), [reads, inventory])
  const matchedStocks = useMemo(
    () => [...result.found, ...result.check].map((e) => e.car.stock_number),
    [result],
  )

  // Where the matched cars are now, so the list can say "already there".
  const stocksKey = matchedStocks.join(',')
  useEffect(() => {
    if (!matchedStocks.length) { setCurrent(new Map()); return }
    let cancelled = false
    fetchLocations(matchedStocks)
      .then((m) => { if (!cancelled) setCurrent(m) })
      .catch((e) => console.error('auction upload: locations', e))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stocksKey])

  useEffect(() => {
    if (!auction || !reads.length) { setAtAuction([]); return }
    let cancelled = false
    fetchCarsAtLocation(auction)
      .then((s) => { if (!cancelled) setAtAuction(s) })
      .catch((e) => console.error('auction upload: cars at auction', e))
    return () => { cancelled = true }
  }, [auction, reads.length, applied])

  const byStock = useMemo(() => new Map(inventory.map((c) => [c.stock_number, c])), [inventory])
  // Only cars still in inventory: a sold car's location row keeps the last
  // place it stood, and "missing from the pictures" means nothing for it.
  const missing = useMemo(() => {
    const seen = new Set(matchedStocks)
    return atAuction
      .filter((s) => !seen.has(s) && byStock.has(s))
      .map((s) => ({ stock_number: s, car: byStock.get(s) }))
  }, [atAuction, matchedStocks, byStock])

  const isTicked = (e) => ticked[e.car.stock_number] ?? (e.kind === 'found')
  const selected = [...result.found, ...result.check].filter(isTicked)
  const toMove = selected.filter((e) => !isSamePlace(current.get(e.car.stock_number), auction))

  async function handleFiles(fileList) {
    const files = [...(fileList || [])]
    if (fileRef.current) fileRef.current.value = ''   // same picture can be picked again
    if (!files.length) return
    setApplied(null)

    const batch = files.map((f, i) => ({ id: `${Date.now()}-${i}`, name: f.name || `Picture ${i + 1}`, file: f }))
    setImages((prev) => [...prev, ...batch.map(({ id, name }) => ({ id, name, status: 'reading' }))])

    const queue = [...batch]
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        try {
          const out = await readInventoryImage(job.file, auctionName)
          setReads((prev) => [...prev, ...out.vehicles])
          setImages((prev) => prev.map((im) => im.id === job.id
            ? { ...im, status: 'done', count: out.vehicles.length, note: out.note }
            : im))
        } catch (e) {
          setImages((prev) => prev.map((im) => im.id === job.id
            ? { ...im, status: 'error', error: e.message }
            : im))
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, batch.length) }, worker))
    haptics.success()
  }

  async function handleApply() {
    if (!auction || !selected.length) return
    setApplying(true)
    try {
      const out = await applyAuctionLocations({
        cars: selected.map((e) => e.car),
        location: auction,
        auctionName,
        imageCount: images.filter((i) => i.status === 'done').length,
      })
      setApplied(out)
      setCurrent(await fetchLocations(matchedStocks))
      haptics.success()
      onToast?.('success', `${out.moved} car${out.moved === 1 ? '' : 's'} → ${auctionName}`,
        out.alreadyThere ? `${out.alreadyThere} already marked there` : 'Locations updated')
    } catch (e) {
      haptics.fail()
      onToast?.('error', 'Update failed', e.message)
    } finally {
      setApplying(false)
    }
  }

  function reset() {
    setImages([]); setReads([]); setTicked({}); setApplied(null)
    setShowNotFound(false); setShowMissing(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-lg font-semibold bg-slate-800 text-slate-300 border border-slate-700"
      >
        <Images size={18} />
        Upload Inventory List
      </button>
    )
  }

  const doneCount = images.filter((i) => i.status === 'done').length
  const finished = images.filter((i) => i.status !== 'reading').length

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
      <div className="flex items-center justify-between mb-3">
        <p className="font-semibold text-sm text-white flex items-center gap-2">
          <Images size={16} className="text-emerald-400" /> Upload Inventory List
        </p>
        <button onClick={() => { setOpen(false); reset() }} className="p-1 text-slate-400" aria-label="Close">
          <X size={18} />
        </button>
      </div>

      {/* 1. Auction */}
      <label className="block text-[10px] uppercase tracking-wide text-slate-400 mb-1">Auction</label>
      <select
        value={auction}
        onChange={(e) => { setAuction(e.target.value); setApplied(null) }}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-3 text-base font-bold text-emerald-400 focus:outline-none focus:border-emerald-500"
      >
        <option value="">Pick the auction first…</option>
        {AUCTION_LOCATIONS.map((a) => (
          <option key={a.location} value={a.location}>{a.name}</option>
        ))}
      </select>

      {/* 2. Pictures */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={!auction || reading}
        className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-lg font-semibold bg-emerald-500 text-slate-900 disabled:bg-slate-700 disabled:text-slate-500"
      >
        {reading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
        {reading
          ? `Reading pictures… ${finished} of ${images.length} done`
          : images.length ? 'Add more pictures' : 'Choose pictures'}
      </button>
      {!auction && (
        <p className="mt-1 text-center text-[10px] text-slate-500">Every car found is marked at the auction you pick.</p>
      )}

      {/* Per-picture status */}
      {images.length > 0 && (
        <div className="mt-3 space-y-1">
          {images.map((im) => (
            <div key={im.id} className="flex items-center gap-2 text-xs">
              {im.status === 'reading' && <Loader2 size={12} className="animate-spin text-slate-400 shrink-0" />}
              {im.status === 'done' && <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />}
              {im.status === 'error' && <AlertCircle size={12} className="text-red-400 shrink-0" />}
              <span className="text-slate-300 truncate flex-1">{im.name}</span>
              <span className={`shrink-0 ${im.status === 'error' ? 'text-red-400' : 'text-slate-500'}`}>
                {im.status === 'reading' && 'reading…'}
                {im.status === 'done' && `${im.count} car${im.count === 1 ? '' : 's'}`}
                {im.status === 'error' && im.error}
              </span>
            </div>
          ))}
          {images.filter((i) => i.note).map((im) => (
            <p key={`${im.id}-note`} className="text-[10px] text-yellow-400">{im.name}: {im.note}</p>
          ))}
        </div>
      )}

      {/* Results */}
      {doneCount > 0 && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Stat n={result.found.length} label="found" tone="text-emerald-400" />
            <Stat n={result.check.length} label="to check" tone="text-yellow-400" />
            <Stat n={result.notFound.length} label="not ours" tone="text-slate-400" />
          </div>

          {result.found.length > 0 && (
            <Section title={`Found in inventory (${result.found.length})`}>
              {result.found.map((e) => (
                <CarRow key={e.car.stock_number} entry={e} ticked={isTicked(e)}
                  here={isSamePlace(current.get(e.car.stock_number), auction)}
                  onToggle={() => setTicked((t) => ({ ...t, [e.car.stock_number]: !isTicked(e) }))} />
              ))}
            </Section>
          )}

          {result.check.length > 0 && (
            <Section title={`Probably ours — tick to include (${result.check.length})`} tone="text-yellow-400">
              {result.check.map((e) => (
                <CarRow key={e.car.stock_number} entry={e} ticked={isTicked(e)}
                  here={isSamePlace(current.get(e.car.stock_number), auction)}
                  onToggle={() => setTicked((t) => ({ ...t, [e.car.stock_number]: !isTicked(e) }))} />
              ))}
            </Section>
          )}

          {result.found.length === 0 && result.check.length === 0 && !reading && (
            <p className="mt-4 text-center text-xs text-slate-400">None of the cars in these pictures are in our inventory.</p>
          )}

          {result.notFound.length > 0 && (
            <Collapsible
              open={showNotFound} onToggle={() => setShowNotFound((v) => !v)}
              title={`Not found in inventory (${result.notFound.length})`}
            >
              {result.notFound.map((r, i) => (
                <div key={`${r.vin || r.stock_number || r.label}-${i}`} className="px-2 py-1.5 text-xs">
                  <p className="text-slate-300 truncate">{r.label || 'Unknown vehicle'}</p>
                  <p className="text-slate-500 font-mono text-[10px]">
                    {r.vin ? `VIN ${r.vin}` : r.stock_number ? `Stock ${r.stock_number}` : 'no VIN readable'}
                  </p>
                </div>
              ))}
            </Collapsible>
          )}

          {missing.length > 0 && !reading && (
            <Collapsible
              open={showMissing} onToggle={() => setShowMissing((v) => !v)}
              title={`Marked at ${auctionName} but not in these pictures (${missing.length})`}
              tone="text-orange-400"
            >
              {missing.map((m) => (
                <div key={m.stock_number} className="px-2 py-1.5 text-xs">
                  <p className="text-slate-300 truncate">
                    {[m.car.vehicle_year, m.car.vehicle_make, m.car.vehicle_model].filter(Boolean).join(' ') || `Stock ${m.stock_number}`}
                  </p>
                  <p className="text-slate-500 font-mono text-[10px]">
                    {m.stock_number}{m.car.vehicle_vin ? ` · ${m.car.vehicle_vin.slice(-6)}` : ''}
                  </p>
                </div>
              ))}
            </Collapsible>
          )}

          {(result.found.length > 0 || result.check.length > 0) && (
            <button
              onClick={handleApply}
              disabled={applying || reading || !toMove.length}
              className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-lg font-bold bg-emerald-500 text-slate-900 disabled:bg-slate-700 disabled:text-slate-400"
            >
              {applying && <Loader2 size={18} className="animate-spin" />}
              {toMove.length
                ? `Update ${toMove.length} location${toMove.length === 1 ? '' : 's'} → ${auctionName}`
                : selected.length ? `All ${selected.length} already at ${auctionName}` : 'Tick cars to update'}
            </button>
          )}
          {applied && (
            <p className="mt-2 text-center text-xs text-emerald-400">
              ✓ Moved {applied.moved}{applied.alreadyThere ? ` · ${applied.alreadyThere} were already there` : ''}
            </p>
          )}
          {!reading && (
            <button onClick={reset} className="mt-2 w-full text-center text-[11px] text-slate-500 py-1">
              Clear and start over
            </button>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ n, label, tone }) {
  return (
    <div className="rounded-lg bg-slate-900/60 py-2">
      <p className={`text-lg font-bold ${tone}`}>{n}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  )
}

function Section({ title, tone = 'text-emerald-400', children }) {
  return (
    <div className="mt-4">
      <p className={`text-[10px] uppercase tracking-wide mb-1 ${tone}`}>{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Collapsible({ open, onToggle, title, tone = 'text-slate-400', children }) {
  return (
    <div className="mt-4">
      <button onClick={onToggle} className={`flex items-center gap-1 text-[10px] uppercase tracking-wide ${tone}`}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {open && <div className="mt-1 rounded-lg bg-slate-900/60 divide-y divide-slate-800">{children}</div>}
    </div>
  )
}

function CarRow({ entry, ticked, here, onToggle }) {
  const { car, label, how } = entry
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left border ${
        ticked ? 'bg-slate-800 border-emerald-500/40' : 'bg-slate-900/40 border-slate-800'
      }`}
    >
      <span className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
        ticked ? 'bg-emerald-500 border-emerald-500 text-slate-900' : 'border-slate-600'
      }`}>
        {ticked && <CheckCircle2 size={14} />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-white truncate">{label || `Stock ${car.stock_number}`}</span>
        <span className="block text-[10px] text-slate-400 font-mono truncate">
          {car.stock_number} · {String(car.vehicle_vin || '').slice(-6)} · {how}
        </span>
      </span>
      {here && <span className="text-[10px] text-emerald-400 shrink-0">already here</span>}
    </button>
  )
}
