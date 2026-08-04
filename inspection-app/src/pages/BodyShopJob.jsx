// One body shop job: price it, list the parts, assign a tech, see the photos.
//
// Photos come from the private car-history bucket under `<vin6>/` — the same
// folder the Telegram bot drops the shop's photos into, so what the guys sent
// over Telegram and what's shot in the app are one gallery.

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, Trash2, Plus, X, Camera, Check } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import HistoryButton from '../components/HistoryButton'
import {
  fetchJob, updateJob, setJobStatus, assignTech, deleteJob,
  fetchParts, addPart, updatePart, deletePart,
  fetchTechs, JOB_STATUSES, PART_STATUSES, PART_STATUS_STYLES,
  ageStyle, vehicleLabel, isBodyShopManager,
} from '../services/bodyShop'
import {
  fetchVehiclePhotos, uploadVehiclePhoto, deleteVehiclePhoto, photoSourceLabel,
} from '../services/vehiclePhotos'

const money = (n) => (n == null ? '—' : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)

export default function BodyShopJob() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const manager = isBodyShopManager(profile)

  const [job, setJob] = useState(null)
  const [parts, setParts] = useState([])
  const [photos, setPhotos] = useState([])
  const [techs, setTechs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [photoError, setPhotoError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const j = await fetchJob(id)
      if (!j) { setError('That job no longer exists.'); return }
      setJob(j)
      const [p, t] = await Promise.all([fetchParts(id), fetchTechs()])
      setParts(p); setTechs(t)
      // Photos are a separate, non-fatal concern — a storage hiccup shouldn't
      // blank out the price and the parts list.
      try { setPhotos(await fetchVehiclePhotos({ vin6: j.vin6, stockNumber: j.stock_number })) }
      catch (e) { setPhotoError(e.message || 'Could not load photos') }
    } catch (e) {
      setError(e.message || 'Could not load this job')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function patch(fields) {
    setError('')
    const previous = job
    setJob((j) => ({ ...j, ...fields }))          // optimistic
    try {
      await updateJob(id, fields)
      setJob(await fetchJob(id))                   // re-read for view-computed fields
    } catch (e) {
      setJob(previous)
      setError(e.message || 'Could not save')
    }
  }

  if (loading) return <div className="page"><p className="text-slate-500 text-sm py-10 text-center">Loading…</p></div>
  if (!job) {
    return (
      <div className="page">
        <BackBar onBack={() => navigate('/body-shop')} />
        <div className="card text-center py-10 text-slate-400 text-sm">{error || 'Not found'}</div>
      </div>
    )
  }

  return (
    <div className="page">
      <BackBar onBack={() => navigate('/body-shop')}
        right={<HistoryButton showPhotos stockNumber={job.stock_number} vin={job.vin} />} />

      {/* Car header */}
      <div className="card mb-3">
        <div className="flex items-start gap-3">
          <div className="shrink-0 text-center">
            <div className={`text-3xl font-bold leading-none ${ageStyle(job.days_in_shop)}`}>
              {job.days_in_shop ?? '—'}
            </div>
            <div className="text-[9px] uppercase tracking-wide text-slate-500 mt-0.5">days in shop</div>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold leading-tight truncate">{vehicleLabel(job)}</h1>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {job.stock_number ? `#${job.stock_number}` : `VIN …${job.vin6 || '??????'}`}
              {job.vehicle_color ? ` · ${job.vehicle_color}` : ''}
              {job.mileage ? ` · ${Number(String(job.mileage).replace(/[^0-9]/g, '')).toLocaleString()} mi` : ''}
            </p>
            {job.awaiting_inventory && (
              <p className="text-[10px] text-sky-300 mt-1">
                🆕 Fresh buy — not in inventory yet. It links itself once Frazer has it.
              </p>
            )}
            {job.vin && <p className="text-[10px] text-slate-600 font-mono mt-0.5 truncate">{job.vin}</p>}
          </div>
        </div>
      </div>

      {error && <div className="card border-red-500/40 bg-red-500/10 text-red-300 text-sm mb-3">{error}</div>}

      {/* Status */}
      <Section title="Status">
        <div className="grid grid-cols-2 gap-2">
          {JOB_STATUSES.map((s) => {
            const active = job.status === s.key
            return (
              <button key={s.key}
                onClick={() => !active && setJobStatus(id, s.key).then(() => fetchJob(id)).then(setJob)
                  .catch((e) => setError(e.message || 'Could not change status'))}
                className={`rounded-lg p-3 text-left border ${
                  active
                    ? 'bg-emerald-500 text-slate-900 border-emerald-400 font-bold'
                    : 'bg-slate-800 border-slate-700 active:bg-slate-700'
                }`}>
                <div className="text-base leading-none">{s.emoji}</div>
                <div className="text-sm font-semibold mt-1">{s.label}</div>
                <div className={`text-[10px] mt-0.5 ${active ? 'text-slate-800' : 'text-slate-500'}`}>{s.hint}</div>
              </button>
            )
          })}
        </div>
      </Section>

      {/* Price */}
      <Section title="Price">
        <PriceEditor value={job.price} readOnly={!manager} onSave={(price) => patch({ price })} />
        {(job.parts_total > 0) && (
          <p className="text-[11px] text-slate-500 mt-2">
            Parts logged on this job: <span className="text-slate-300">{money(job.parts_cost)}</span>
            {' '}across {job.parts_total} {job.parts_total === 1 ? 'part' : 'parts'}
          </p>
        )}
      </Section>

      {/* Tech */}
      <Section title="Assigned Tech">
        {manager ? (
          <select value={job.assigned_tech || ''}
            onChange={(e) => assignTech(id, e.target.value || null).then(() => fetchJob(id)).then(setJob)
              .catch((err) => setError(err.message || 'Could not assign'))}>
            <option value="">— Unassigned —</option>
            {techs.map((t) => <option key={t.id} value={t.id}>{t.name || 'Unnamed'}</option>)}
          </select>
        ) : (
          <p className="text-sm">{job.tech_name || <span className="text-slate-500">Unassigned</span>}</p>
        )}
        {manager && techs.length === 0 && (
          <p className="text-[11px] text-slate-500 mt-2">
            Nobody is set up as a body shop tech yet — they pick that role when they sign up.
          </p>
        )}
      </Section>

      {/* Parts */}
      <Section title={`Parts Needed${parts.length ? ` (${parts.filter((p) => p.status === 'received').length}/${parts.length})` : ''}`}>
        <PartsList jobId={id} parts={parts} setParts={setParts} onError={setError} onChanged={() => fetchJob(id).then(setJob)} />
      </Section>

      {/* Photos */}
      <Section title={`Photos${photos.length ? ` (${photos.length})` : ''}`}>
        <PhotoGrid job={job} photos={photos} setPhotos={setPhotos} error={photoError} onError={setPhotoError} />
      </Section>

      {/* Notes */}
      <Section title="Notes">
        <NotesEditor key={job.notes || ''} value={job.notes} onSave={(notes) => patch({ notes })} />
      </Section>

      {manager && (
        <button
          onClick={async () => {
            if (!window.confirm('Remove this car from the body shop? The parts list and app photos on this job go with it.')) return
            try { await deleteJob(id); navigate('/body-shop') }
            catch (e) { setError(e.message || 'Could not remove') }
          }}
          className="btn-danger mt-4 flex items-center justify-center gap-2">
          <Trash2 size={16} /> Remove from Body Shop
        </button>
      )}
    </div>
  )
}

function BackBar({ onBack, right }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <button onClick={onBack} className="flex items-center gap-1 text-slate-300 text-sm active:text-white -ml-1">
        <ChevronLeft size={18} /> Body Shop
      </button>
      {right}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mb-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">{title}</p>
      <div className="card">{children}</div>
    </div>
  )
}

function PriceEditor({ value, onSave, readOnly }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (readOnly) {
    return <div className="text-2xl font-bold text-emerald-400">{money(value)}</div>
  }

  if (!editing) {
    return (
      <button onClick={() => { setDraft(value == null ? '' : String(value)); setEditing(true) }}
        className="w-full flex items-center justify-between active:opacity-70">
        <span className={`text-2xl font-bold ${value == null ? 'text-yellow-400' : 'text-emerald-400'}`}>
          {value == null ? 'Set a price' : money(value)}
        </span>
        <span className="text-[11px] text-slate-500 underline">edit</span>
      </button>
    )
  }

  const commit = () => {
    const trimmed = draft.trim()
    onSave(trimmed === '' ? null : Number(trimmed))
    setEditing(false)
  }

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
        <input
          type="number" inputMode="decimal" min="0" step="1"
          value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
          autoFocus className="!pl-7 text-lg font-bold"
        />
      </div>
      <button onClick={commit} className="px-4 rounded-lg bg-emerald-500 text-slate-900 font-bold">
        <Check size={18} />
      </button>
      <button onClick={() => setEditing(false)} className="px-3 rounded-lg bg-slate-700 text-slate-300">
        <X size={18} />
      </button>
    </div>
  )
}

// Keyed on the saved note by the parent, so a value that changes underneath us
// remounts with a clean draft instead of syncing through an effect.
function NotesEditor({ value, onSave }) {
  const [draft, setDraft] = useState(value || '')
  const [dirty, setDirty] = useState(false)

  return (
    <div>
      <textarea
        rows={3} value={draft}
        onChange={(e) => { setDraft(e.target.value); setDirty(true) }}
        placeholder="What's being done, what to watch out for…"
      />
      {dirty && (
        <button onClick={() => { onSave(draft.trim() || null); setDirty(false) }}
          className="btn-primary mt-2 !py-2 text-sm">Save note</button>
      )}
    </div>
  )
}

function PartsList({ jobId, parts, setParts, onError, onChanged }) {
  const [name, setName] = useState('')
  const [cost, setCost] = useState('')
  const [vendor, setVendor] = useState('')
  const [showDetail, setShowDetail] = useState(false)
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const created = await addPart(jobId, { name, cost, vendor })
      setParts((p) => [...p, created])
      setName(''); setCost(''); setVendor(''); setShowDetail(false)
      onChanged?.()
    } catch (err) {
      onError(err.message || 'Could not add the part')
    } finally {
      setSaving(false)
    }
  }

  // Tap the status pill to advance: needed → ordered → received → needed.
  async function cyclePart(part) {
    const order = ['needed', 'ordered', 'received']
    const next = order[(order.indexOf(part.status) + 1) % order.length]
    setParts((ps) => ps.map((p) => (p.id === part.id ? { ...p, status: next } : p)))
    try {
      const updated = await updatePart(part.id, { status: next })
      setParts((ps) => ps.map((p) => (p.id === part.id ? updated : p)))
      onChanged?.()
    } catch (err) {
      setParts((ps) => ps.map((p) => (p.id === part.id ? part : p)))
      onError(err.message || 'Could not update the part')
    }
  }

  async function remove(part) {
    setParts((ps) => ps.filter((p) => p.id !== part.id))
    try { await deletePart(part.id); onChanged?.() }
    catch (err) { setParts((ps) => [...ps, part]); onError(err.message || 'Could not delete') }
  }

  return (
    <div>
      {parts.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {parts.map((part) => {
            const meta = PART_STATUSES.find((s) => s.key === part.status)
            return (
              <div key={part.id} className="flex items-center gap-2 py-1">
                <button onClick={() => cyclePart(part)}
                  className={`shrink-0 text-[10px] px-2 py-1 rounded-full font-bold w-24 text-center ${PART_STATUS_STYLES[part.status]}`}>
                  {meta?.emoji} {meta?.label}
                </button>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm truncate ${part.status === 'received' ? 'text-slate-400 line-through' : ''}`}>
                    {part.name}
                  </div>
                  {(part.vendor || part.cost != null) && (
                    <div className="text-[10px] text-slate-500 truncate">
                      {[part.vendor, part.cost != null ? money(part.cost) : null].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                <button onClick={() => remove(part)} className="shrink-0 p-1 text-slate-600 active:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <form onSubmit={submit} className="space-y-2">
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Add a part…" className="flex-1 !py-2 text-sm" />
          <button type="submit" disabled={saving || !name.trim()}
            className="px-3 rounded-lg bg-emerald-500 text-slate-900 font-bold disabled:opacity-40">
            <Plus size={18} />
          </button>
        </div>
        {showDetail ? (
          <div className="flex gap-2">
            <input value={vendor} onChange={(e) => setVendor(e.target.value)}
              placeholder="Where from" className="flex-1 !py-2 text-sm" />
            <input value={cost} onChange={(e) => setCost(e.target.value)} type="number" inputMode="decimal"
              placeholder="$" className="w-24 !py-2 text-sm" />
          </div>
        ) : (
          <button type="button" onClick={() => setShowDetail(true)}
            className="text-[11px] text-slate-500 underline">+ cost / where from</button>
        )}
      </form>

      {parts.length === 0 && (
        <p className="text-[11px] text-slate-600 mt-2">
          Tap a part's tag to move it Needed → Ordered → Received.
        </p>
      )}
    </div>
  )
}

// The car's whole photo history, newest first — Telegram (any group), app shots,
// inspection photos — each badged with where it came from. Defaults to just the
// body shop's own photos, because that's what the manager is looking for; one tap
// shows everything, which is how you spot damage the car arrived with.
function PhotoGrid({ job, photos, setPhotos, error, onError }) {
  const [uploading, setUploading] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [showAll, setShowAll] = useState(false)

  // A car that comes back gets a NEW job, but photos are car-level — so without
  // this the new job would show the previous visit's damage with nothing marking
  // it as old, and the manager reads last month's quarter panel as today's work.
  // "This visit" = shop photos taken since the car arrived. The 6h grace absorbs
  // the usual case of photos landing just before the VIN message that opened the
  // job, without reaching back into an earlier visit.
  const since = job.entered_at ? new Date(job.entered_at).getTime() - 6 * 3600 * 1000 : null
  const shopPhotos = photos.filter((p) => p.station === 'body_shop' || p.source === 'app')
  const thisVisit = since == null ? shopPhotos
    : shopPhotos.filter((p) => p.takenAt && new Date(p.takenAt).getTime() >= since)
  const visible = showAll ? photos : thisVisit
  const otherCount = photos.length - thisVisit.length

  async function handleFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUploading(true); onError('')
    try {
      const car = { vin6: job.vin6, stockNumber: job.stock_number, vin: job.vin }
      for (const file of files) await uploadVehiclePhoto(car, file)
      setPhotos(await fetchVehiclePhotos(car))
    } catch (err) {
      onError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function remove(photo) {
    if (!window.confirm('Delete this photo?')) return
    try {
      await deleteVehiclePhoto(photo)
      setPhotos((ps) => ps.filter((p) => p.path !== photo.path))
      setViewing(null)
    } catch (err) { onError(err.message || 'Could not delete') }
  }

  return (
    <div>
      {error && <p className="text-[11px] text-red-400 mb-2">{error}</p>}

      {otherCount > 0 && (
        <div className="flex gap-1.5 mb-2">
          <button onClick={() => setShowAll(false)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${
              !showAll ? 'bg-emerald-500 text-slate-900' : 'bg-slate-700 text-slate-300'}`}>
            This visit · {thisVisit.length}
          </button>
          <button onClick={() => setShowAll(true)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${
              showAll ? 'bg-emerald-500 text-slate-900' : 'bg-slate-700 text-slate-300'}`}>
            Whole history · {photos.length}
          </button>
        </div>
      )}

      {visible.length > 0 ? (
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          {visible.map((photo) => (
            <button key={`${photo.bucket}/${photo.path}`} onClick={() => setViewing(photo)}
              className="relative aspect-square rounded-lg overflow-hidden bg-slate-900 border border-slate-700">
              <img src={photo.url} alt="" loading="lazy" className="w-full h-full object-cover" />
              {showAll && (
                <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[8px] text-slate-200 py-0.5 px-1 truncate">
                  {photoSourceLabel(photo)}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 mb-3">
          {!job.vin6 ? 'This job has no VIN attached, so photos can’t be matched to it.'
            : photos.length > 0 ? 'Nothing shot this visit yet — tap “Whole history” for earlier photos of this car.'
            : 'No photos yet. Anything the shop posts in the Telegram group shows up here.'}
        </p>
      )}

      {job.vin6 && (
        <label className={`btn-secondary flex items-center justify-center gap-2 cursor-pointer !py-2 text-sm ${uploading ? 'opacity-50' : ''}`}>
          <Camera size={16} />
          {uploading ? 'Uploading…' : 'Add Photos'}
          <input type="file" accept="image/*" capture="environment" multiple
            onChange={handleFiles} disabled={uploading} className="hidden" />
        </label>
      )}

      {viewing && (
        <div className="fixed inset-0 z-40 bg-black/90 flex flex-col safe-inset"
          onClick={() => setViewing(null)}>
          <div className="flex justify-between items-center p-4" onClick={(e) => e.stopPropagation()}>
            {/* Telegram photos are the crew's record — deleting them here would
                quietly rewrite the car's history, so it isn't offered. */}
            {viewing.source === 'app' ? (
              <button onClick={() => remove(viewing)} className="text-red-400 flex items-center gap-1 text-sm">
                <Trash2 size={16} /> Delete
              </button>
            ) : (
              <span className="text-[11px] text-slate-400">
                {photoSourceLabel(viewing)}
                {viewing.takenAt ? ` · ${new Date(viewing.takenAt).toLocaleDateString()}` : ''}
              </span>
            )}
            <button onClick={() => setViewing(null)} className="text-white"><X size={22} /></button>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 min-h-0">
            <img src={viewing.url} alt="" className="max-w-full max-h-full object-contain" />
          </div>
        </div>
      )}
    </div>
  )
}
