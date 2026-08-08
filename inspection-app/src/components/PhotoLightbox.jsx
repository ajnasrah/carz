// Full-screen photo viewer that pages through the whole set.
//
// Every photo grid in the app used to open one image and make you close it to
// see the next — which, on a car with twenty shots off the Telegram group, is
// twenty opens and twenty closes to look at a quarter panel. Here you swipe, tap
// an arrow, or press ← / → , and the counter says how far in you are.
//
// Marked [data-no-swipe] so a screen underneath that pages on swipe (the body
// shop job screen swipes between cars) stops while this is open — useSwipe
// treats that attribute as blocking the listeners above it, not its own.

import { useEffect } from 'react'
import { X, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import useSwipe from '../hooks/useSwipe'
import { photoSourceLabel } from '../services/vehiclePhotos'

export default function PhotoLightbox({ photos, index, onIndex, onClose, onDelete }) {
  const photo = photos[index]

  // Clamped, not wrapped: running off the end of a car's photos and landing back
  // on the first one reads as "it looped", and you lose your place.
  const go = (delta) => {
    const next = index + delta
    if (next >= 0 && next < photos.length) onIndex(next)
  }

  const swipe = useSwipe({
    onLeft: () => go(1),
    onRight: () => go(-1),
    enabled: photos.length > 1,
  })

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!photo) return null

  const deletable = onDelete && photo.source === 'app'

  return (
    <div data-no-swipe {...swipe}
      className="fixed inset-0 z-[60] bg-black/90 flex flex-col safe-inset"
      onClick={onClose}>
      <div className="flex justify-between items-center gap-3 p-4" onClick={(e) => e.stopPropagation()}>
        <span className="text-[11px] text-slate-400 min-w-0 truncate">
          {photoSourceLabel(photo)}
          {photo.takenAt ? ` · ${new Date(photo.takenAt).toLocaleDateString()}` : ''}
        </span>
        <div className="flex items-center gap-3 shrink-0">
          {/* Telegram photos are the crew's record — deleting one here would
              quietly rewrite the car's history, so only app shots offer it. */}
          {deletable && (
            <button onClick={() => onDelete(photo)} className="text-red-400 flex items-center gap-1 text-sm">
              <Trash2 size={16} /> Delete
            </button>
          )}
          {photos.length > 1 && (
            <span className="text-[11px] text-slate-400 tabular-nums">{index + 1} / {photos.length}</span>
          )}
          <button onClick={onClose} className="text-white" aria-label="Close"><X size={22} /></button>
        </div>
      </div>

      <div className="flex-1 flex items-center min-h-0">
        {photos.length > 1 && (
          <button onClick={(e) => { e.stopPropagation(); go(-1) }} disabled={index === 0}
            aria-label="Previous photo"
            className="shrink-0 h-full px-2 text-white/70 disabled:opacity-20 active:text-white">
            <ChevronLeft size={32} />
          </button>
        )}
        {/* stopPropagation so tapping the photo itself doesn't close the viewer —
            only the backdrop does. */}
        <img src={photo.url} alt="" onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 max-h-full object-contain" />
        {photos.length > 1 && (
          <button onClick={(e) => { e.stopPropagation(); go(1) }} disabled={index === photos.length - 1}
            aria-label="Next photo"
            className="shrink-0 h-full px-2 text-white/70 disabled:opacity-20 active:text-white">
            <ChevronRight size={32} />
          </button>
        )}
      </div>

      {photos.length > 1 && (
        <p className="text-center text-[10px] text-slate-500 pb-3">swipe or use ← → to move through the photos</p>
      )}
    </div>
  )
}
