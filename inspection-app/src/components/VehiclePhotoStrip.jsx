// A car's photos, newest first, in a horizontal strip — every photo we hold for
// it, whatever put it there (Telegram from any crew, app shots, inspections).
// Read-only on purpose: this shows up on history screens, where the point is to
// see what the car looked like over time, not to edit the record.

import { useState, useEffect } from 'react'
import { fetchVehiclePhotos, photoSourceLabel } from '../services/vehiclePhotos'
import PhotoLightbox from './PhotoLightbox'

export default function VehiclePhotoStrip({ vin6, stockNumber }) {
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewIdx, setViewIdx] = useState(null)

  useEffect(() => {
    let cancelled = false
    if (!vin6 && !stockNumber) return    // nothing to key photos off; render stays hidden
    fetchVehiclePhotos({ vin6, stockNumber })
      .then((p) => { if (!cancelled) setPhotos(p) })
      // Never blocks the history it sits above — a storage hiccup just hides it.
      .catch((e) => console.error('vehicle photos:', e.message || e))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [vin6, stockNumber])

  if ((!vin6 && !stockNumber) || loading || photos.length === 0) return null

  return (
    <div className="mb-4">
      <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">
        Photos · {photos.length}
      </p>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {photos.map((photo, i) => (
          <button key={`${photo.bucket}/${photo.path}`} onClick={() => setViewIdx(i)}
            className="relative shrink-0 w-24 h-24 rounded-lg overflow-hidden bg-slate-900 border border-slate-700">
            <img src={photo.url} alt="" loading="lazy" className="w-full h-full object-cover" />
            <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[8px] text-slate-200 py-0.5 px-1 truncate">
              {photoSourceLabel(photo)}
            </span>
          </button>
        ))}
      </div>

      {/* Read-only here — no onDelete, so the viewer offers no delete button. */}
      {viewIdx != null && (
        <PhotoLightbox photos={photos} index={viewIdx} onIndex={setViewIdx}
          onClose={() => setViewIdx(null)} />
      )}
    </div>
  )
}
