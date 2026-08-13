import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, Check, Image as ImageIcon, Wrench } from 'lucide-react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/useAuth'
import { isAdminProfile } from '../services/adminSetup'
import MarketplacePrice from '../components/MarketplacePrice'
import PhotoEditor from '../components/PhotoEditor'
import DamageEditor from '../components/DamageEditor'
import { fetchPhotoEdit, applyPhotoEdits } from '../services/listingPhotos'
import { ShareCarButton } from '../components/ShareToBuyer'
import { listingUrl } from '../services/marketplaceShare'
import { toInt } from '../services/utils'
import { STARTUP_ITEMS, TEST_DRIVE_ITEMS, EXTERIOR_PANELS, INTERIOR_ZONES } from '../services/inspectionFlow'
import HistoryButton from '../components/HistoryButton'
import { copyText } from '../native/clipboard'
import { openExternal, smsUrl } from '../native/links'

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    copyText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 text-xs font-semibold text-slate-300 active:bg-slate-700"
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
      {copied ? 'Copied' : label}
    </button>
  )
}

// Small inline copy icon that sits right next to a value
function InlineCopy({ text }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => copyText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) })}
      className="shrink-0 text-slate-500 active:text-emerald-400"
      title="Copy"
    >
      {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
    </button>
  )
}

function PhotoGallery({ photos }) {
  const [idx, setIdx] = useState(0)
  if (!photos.length) return <div className="aspect-[16/10] bg-slate-800 flex items-center justify-center text-slate-600">No Photos</div>
  return (
    <div className="relative aspect-[16/10] bg-black rounded-xl overflow-hidden">
      <img src={photos[idx].url} alt="" className="w-full h-full object-contain" />
      {photos.length > 1 && (
        <>
          <button
            onClick={() => setIdx((i) => (i - 1 + photos.length) % photos.length)}
            className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/60 text-white"
          ><ChevronLeft size={20} /></button>
          <button
            onClick={() => setIdx((i) => (i + 1) % photos.length)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/60 text-white"
          ><ChevronRight size={20} /></button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 px-2 py-0.5 rounded-full text-[10px] text-white font-semibold">
            {idx + 1} / {photos.length}
          </div>
        </>
      )}
      {/* Thumbnail strip — windowed around the current photo so it follows along */}
      <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-1 px-2">
        {(() => {
          const WIN = 12
          const start = Math.max(0, Math.min(idx - Math.floor(WIN / 2), Math.max(0, photos.length - WIN)))
          return photos.slice(start, start + WIN).map((p, j) => {
            const i = start + j
            return (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={`w-8 h-8 rounded overflow-hidden border-2 shrink-0 ${i === idx ? 'border-emerald-400' : 'border-transparent opacity-60'}`}
              >
                <img src={p.url} alt="" className="w-full h-full object-cover" />
              </button>
            )
          })
        })()}
      </div>
    </div>
  )
}

function Section({ title, children }) {
  if (!children) return null
  return (
    <div className="mt-6">
      <h3 className="text-sm font-bold text-emerald-400 mb-2 uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  )
}

function StatusBadge({ status }) {
  if (status === 'pass') return <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold">PASS</span>
  if (status === 'fail') return <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-bold">FAIL</span>
  return <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-400 font-bold">N/A</span>
}

export default function MarketplaceListing() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const isAdmin = isAdminProfile(profile)
  const [car, setCar] = useState(null)
  const [allIds, setAllIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [photoEdit, setPhotoEdit] = useState(null)
  const [editingPhotos, setEditingPhotos] = useState(false)
  const [editingDamages, setEditingDamages] = useState(false)

  useEffect(() => {
    async function load() {
      const [detailRes, listRes] = await Promise.all([
        supabase.rpc('marketplace_listing_detail', { listing_id: id }),
        supabase.rpc('marketplace_listings'),
      ])
      const detail = detailRes.data?.[0] || null
      setCar(detail)
      setAllIds((listRes.data || []).map((r) => r.id))
      const vin = detail?.full_vin || detail?.vin
      if (vin) setPhotoEdit(await fetchPhotoEdit(vin))
      setLoading(false)
    }
    load()
  }, [id])

  const currentIdx = allIds.indexOf(id)
  const prevId = currentIdx > 0 ? allIds[currentIdx - 1] : null
  const nextId = currentIdx < allIds.length - 1 ? allIds[currentIdx + 1] : null

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">Loading...</div>
  if (!car) return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
      <p className="text-red-400">Not found</p>
      <button onClick={() => navigate('/marketplace')} className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm">← Back to marketplace</button>
    </div>
  )

  const cl = car.checklist || {}
  const vehicle = [car.year, car.make, car.model].filter(Boolean).join(' ')
  const miles = toInt(car.mileage)
  const fullVin = car.full_vin || car.vin || ''

  // Collect all photos: stock photos first, then damage photos
  const allPhotos = []
  const stockPhotos = cl.photos || {}
  for (const p of Object.values(stockPhotos)) {
    if (p?.url) allPhotos.push({ url: p.url, label: 'Stock' })
  }
  // Damage photos — handle both photos[] array and legacy photo_url string
  function collectDamagePhotos(damages, label) {
    for (const d of damages || []) {
      if (Array.isArray(d.photos)) {
        for (const p of d.photos) {
          if (p?.url) allPhotos.push({ url: p.url, label })
        }
      }
      if (d.photo_url) allPhotos.push({ url: d.photo_url, label })
    }
  }
  for (const [panelId, panel] of Object.entries(cl.exterior || {})) {
    collectDamagePhotos(panel.damages, EXTERIOR_PANELS[panelId]?.label || panelId)
  }
  for (const [zoneId, zone] of Object.entries(cl.interior || {})) {
    collectDamagePhotos(zone.damages, zoneId)
  }
  // Drop byte-identical duplicates (same URL = same content hash), then apply
  // the admin's edits — removed photos out, chosen order first.
  const seenUrls = new Set()
  const uniquePhotos = allPhotos.filter((p) => (seenUrls.has(p.url) ? false : seenUrls.add(p.url)))
  const dedupedPhotos = applyPhotoEdits(uniquePhotos, photoEdit)

  // Startup findings
  const startupItems = STARTUP_ITEMS.map((item) => ({
    ...item,
    result: cl.startup?.[item.id] || {},
  }))

  // Test drive findings
  const testDriveItems = TEST_DRIVE_ITEMS.map((item) => ({
    ...item,
    result: cl.test_drive?.[item.id] || {},
  }))

  // Exterior damages
  const extDamages = []
  for (const [panelId, panel] of Object.entries(cl.exterior || {})) {
    for (const d of panel.damages || []) {
      extDamages.push({ panel: EXTERIOR_PANELS[panelId]?.label || panelId, ...d })
    }
  }

  // Interior damages — flatten INTERIOR_ZONES (array of categories → id→label map)
  const zoneLabels = {}
  for (const cat of INTERIOR_ZONES || []) {
    for (const z of cat.zones || []) zoneLabels[z.id] = z.label
  }
  const intDamages = []
  for (const [zoneId, zone] of Object.entries(cl.interior || {})) {
    for (const d of zone.damages || []) {
      intDamages.push({ panel: zoneLabels[zoneId] || zoneId, ...d })
    }
  }

  const totalDamages = extDamages.length + intDamages.length

  return (
    <div className="min-h-screen bg-slate-950 text-white safe-top">
      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <Link to="/marketplace" className="p-2 rounded-lg bg-slate-800">
            <ArrowLeft size={18} />
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white">{vehicle || 'Vehicle'}</h1>
            <p className="text-xs text-slate-400">
              {miles.toLocaleString()} miles
              {allIds.length > 1 && ` · ${currentIdx + 1} of ${allIds.length}`}
            </p>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => prevId && navigate(`/marketplace/${prevId}`)}
              disabled={!prevId}
              className="p-2 rounded-lg bg-slate-800 disabled:opacity-30"
            ><ChevronLeft size={18} /></button>
            <button
              onClick={() => nextId && navigate(`/marketplace/${nextId}`)}
              disabled={!nextId}
              className="p-2 rounded-lg bg-slate-800 disabled:opacity-30"
            ><ChevronRight size={18} /></button>
            <HistoryButton stockNumber={car.stock_number} vin={fullVin} />
          </div>
        </div>

        {/* Share sits at the top: sending a car to a buyer is what this page is
            for, and it was buried under the whole inspection report. Links are
            built against the public site, not window.location — inside the app
            that's capacitor://localhost, which resolves for nobody. */}
        <div className="flex gap-2 mb-3">
          <ShareCarButton
            car={car}
            label="Send to buyer"
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-500 text-slate-900 text-sm font-bold active:bg-emerald-600"
          />
          <CopyButton text={listingUrl(car.id)} label="Copy Link" />
        </div>

        {/* Photo gallery */}
        <PhotoGallery photos={dedupedPhotos} />

        {isAdmin && uniquePhotos.length > 0 && (
          <button
            onClick={() => setEditingPhotos(true)}
            className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs font-bold active:bg-slate-700"
          >
            <ImageIcon size={14} /> Edit photos
            {uniquePhotos.length !== dedupedPhotos.length &&
              ` · ${uniquePhotos.length - dedupedPhotos.length} removed`}
          </button>
        )}

        {editingDamages && (
          <DamageEditor
            vin={fullVin}
            checklist={cl}
            onClose={() => setEditingDamages(false)}
            onSaved={async () => {
              const { data } = await supabase.rpc('marketplace_listing_detail', { listing_id: id })
              if (data?.[0]) setCar(data[0])
            }}
          />
        )}

        {editingPhotos && (
          <PhotoEditor
            vin={fullVin}
            photos={uniquePhotos}
            edit={photoEdit}
            onClose={() => setEditingPhotos(false)}
            onSaved={setPhotoEdit}
          />
        )}

        {/* Price + SmartAuction link. The price section always renders now —
            an unpriced car is a thing staff need to see, not hide. */}
        <div className="flex items-center justify-between gap-3 mt-3 bg-slate-900 rounded-lg p-3 border border-slate-800">
          <div className="min-w-0 flex-1">
            <MarketplacePrice
              size="lg"
              vin={fullVin}
              price={car.buy_now}
              source={car.price_source}
              canEdit={isAdmin}
              onChange={(price, source) =>
                setCar((c) => ({ ...c, buy_now: price == null ? null : String(price), price_source: source }))
              }
            />
          </div>
          {car.sa_url && (
              <a
                href={car.sa_url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg bg-emerald-500 text-slate-900 text-sm font-bold"
              >
                View on SmartAuction →
              </a>
          )}
        </div>

        {/* Vehicle details */}
        <Section title="Vehicle Details">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="bg-slate-900 rounded-lg p-2.5">
              <p className="text-[10px] text-slate-500 uppercase">Year</p>
              <p className="font-semibold">{car.year || '—'}</p>
            </div>
            <div className="bg-slate-900 rounded-lg p-2.5">
              <p className="text-[10px] text-slate-500 uppercase">Make</p>
              <p className="font-semibold">{car.make || '—'}</p>
            </div>
            <div className="bg-slate-900 rounded-lg p-2.5">
              <p className="text-[10px] text-slate-500 uppercase">Model</p>
              <p className="font-semibold">{car.model || '—'}</p>
            </div>
            <div className="bg-slate-900 rounded-lg p-2.5">
              <p className="text-[10px] text-slate-500 uppercase">Mileage</p>
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{miles.toLocaleString()}</p>
                <InlineCopy text={String(miles)} />
              </div>
            </div>
            <div className="bg-slate-900 rounded-lg p-2.5 col-span-2">
              <p className="text-[10px] text-slate-500 uppercase">VIN</p>
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold font-mono text-xs break-all">{fullVin}</p>
                <InlineCopy text={fullVin} />
              </div>
            </div>
          </div>
        </Section>

        {/* Condition summary */}
        <Section title={`Condition Report · ${totalDamages} damage${totalDamages !== 1 ? 's' : ''}`}>
          {isAdmin && (
            <button
              onClick={() => setEditingDamages(true)}
              className="w-full flex items-center justify-center gap-1.5 mb-3 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs font-bold active:bg-slate-700"
            >
              <Wrench size={14} /> Add / edit damages
            </button>
          )}

          {/* Startup */}
          <div className="mb-4">
            <p className="text-xs font-bold text-slate-400 mb-1.5">Quick Check</p>
            <div className="space-y-1">
              {startupItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between bg-slate-900 rounded-lg px-3 py-2">
                  <span className="text-xs text-slate-300">{item.label.split('—')[0].trim()}</span>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={item.result.status} />
                    {item.result.note && <span className="text-[10px] text-slate-500 max-w-[120px] truncate">{item.result.note}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Exterior damages */}
          {extDamages.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-bold text-slate-400 mb-1.5">Exterior Damages ({extDamages.length})</p>
              <div className="space-y-1">
                {extDamages.map((d, i) => (
                  <div key={i} className="flex items-start gap-2 bg-slate-900 rounded-lg px-3 py-2">
                    {d.photos?.[0]?.url && (
                      <img src={d.photos[0].url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white">{d.panel} — {d.type}</p>
                      <p className="text-[10px] text-slate-400">
                        {d.size && `${d.size} size`}
                        {d.count && ` x${d.count}`}
                        {d.note && ` · ${d.note}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Interior damages */}
          {intDamages.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-bold text-slate-400 mb-1.5">Interior Damages ({intDamages.length})</p>
              <div className="space-y-1">
                {intDamages.map((d, i) => (
                  <div key={i} className="flex items-start gap-2 bg-slate-900 rounded-lg px-3 py-2">
                    {d.photos?.[0]?.url && (
                      <img src={d.photos[0].url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white">{d.panel} — {d.type}</p>
                      <p className="text-[10px] text-slate-400">
                        {d.size && `${d.size} size`}
                        {d.note && ` · ${d.note}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {totalDamages === 0 && (
            <p className="text-sm text-emerald-400 bg-emerald-500/10 rounded-lg px-3 py-2">No damages reported</p>
          )}

          {/* Test Drive */}
          <div className="mb-4">
            <p className="text-xs font-bold text-slate-400 mb-1.5">Test Drive</p>
            <div className="space-y-1">
              {testDriveItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between bg-slate-900 rounded-lg px-3 py-2">
                  <span className="text-xs text-slate-300">{item.label.split('—')[0].trim()}</span>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={item.result.status} />
                    {item.result.note && <span className="text-[10px] text-slate-500 max-w-[120px] truncate">{item.result.note}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* Request SA listing */}
        {car.sa_status !== 'active' && (
          <Section title="Interested?">
            <button
              onClick={() => {
                const msg = `I'm interested in the ${vehicle} (VIN: ${fullVin}, ${miles.toLocaleString()} mi). Can you list it on SmartAuction?`
                // WKWebView refuses to navigate to sms:, so this button was
                // dead in the native app — openExternal hands it to the OS.
                openExternal(smsUrl('19018319661', msg))
              }}
              className="w-full py-3 rounded-xl bg-emerald-500 text-slate-900 font-bold text-sm active:bg-emerald-600"
            >
              Request SmartAuction Listing
            </button>
            <p className="text-[10px] text-slate-500 text-center mt-1">Opens a text to Carz Inc with vehicle details</p>
          </Section>
        )}

        <p className="text-center text-[10px] text-slate-600 mt-8 mb-4">
          Carz Inc · Memphis, TN · Inspected {car.completed_at ? new Date(car.completed_at).toLocaleDateString() : ''}
        </p>
      </div>
    </div>
  )
}
