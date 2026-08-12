import { useState, useMemo } from 'react'
import { X, Check, Star, ArrowUp, ArrowDown, Trash2, RotateCcw } from 'lucide-react'
import { savePhotoEdits } from '../services/listingPhotos'

// Bulk photo editing for a listing: tick as many photos as you like, then remove
// them, send them to the front, or bring hidden ones back — all in one save.
//
// Nothing is deleted. Removing a photo hides it from the listing and it stays
// available under "Show removed", because the photo itself belongs to the car
// (Telegram, the inspection, SmartAuction) and other screens still show it.
export default function PhotoEditor({ vin, photos, edit, onClose, onSaved }) {
  // Working copy: the full photo list in current order, each flagged hidden or not.
  const [items, setItems] = useState(() => {
    const hidden = new Set(edit?.hidden || [])
    const rank = new Map((edit?.ordering || []).map((url, i) => [url, i]))
    return [...photos]
      .map((p, i) => ({ ...p, hidden: hidden.has(p.url), _i: i }))
      .sort((a, b) => {
        const ra = rank.has(a.url) ? rank.get(a.url) : Number.MAX_SAFE_INTEGER
        const rb = rank.has(b.url) ? rank.get(b.url) : Number.MAX_SAFE_INTEGER
        return ra - rb || a._i - b._i
      })
  })
  const [picked, setPicked] = useState(() => new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const shown = useMemo(
    () => items.filter((p) => showHidden || !p.hidden),
    [items, showHidden],
  )
  const liveCount = items.filter((p) => !p.hidden).length

  function toggle(url) {
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  function setHidden(urls, hidden) {
    setItems((list) => list.map((p) => (urls.has(p.url) ? { ...p, hidden } : p)))
    setPicked(new Set())
  }

  // Selected photos move to the front, keeping the order they already had
  // between themselves — so "tick three, send to front" is predictable.
  function moveToFront() {
    setItems((list) => [
      ...list.filter((p) => picked.has(p.url)),
      ...list.filter((p) => !picked.has(p.url)),
    ])
    setPicked(new Set())
  }

  // Nudge one photo. Swaps against the previous/next VISIBLE photo, so an arrow
  // never appears to do nothing just because a hidden photo sits in the gap.
  function nudge(url, dir) {
    setItems((list) => {
      const next = [...list]
      const from = next.findIndex((p) => p.url === url)
      if (from < 0) return list
      let to = from + dir
      while (to >= 0 && to < next.length && next[to].hidden && !showHidden) to += dir
      if (to < 0 || to >= next.length) return list
      ;[next[from], next[to]] = [next[to], next[from]]
      return next
    })
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      await savePhotoEdits(vin, {
        hidden: items.filter((p) => p.hidden).map((p) => p.url),
        ordering: items.map((p) => p.url),
      })
      onSaved?.({
        hidden: items.filter((p) => p.hidden).map((p) => p.url),
        ordering: items.map((p) => p.url),
      })
      onClose?.()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  const hiddenCount = items.length - liveCount

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col safe-inset">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-white">Edit Photos</h2>
          <p className="text-[11px] text-slate-400">
            {liveCount} showing{hiddenCount > 0 && ` · ${hiddenCount} removed`}
            {picked.size > 0 && ` · ${picked.size} selected`}
          </p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg bg-slate-800 text-slate-300">
          <X size={18} />
        </button>
      </div>

      {/* Bulk actions — these act on everything ticked */}
      <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-slate-800">
        <button
          onClick={() => setPicked(new Set(shown.map((p) => p.url)))}
          className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-[11px] font-bold"
        >
          Select all
        </button>
        <button
          onClick={() => setPicked(new Set())}
          disabled={!picked.size}
          className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-[11px] font-bold disabled:opacity-40"
        >
          None
        </button>
        <button
          onClick={moveToFront}
          disabled={!picked.size}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500 text-slate-900 text-[11px] font-bold disabled:opacity-40"
        >
          <Star size={12} /> Send to front
        </button>
        <button
          onClick={() => setHidden(picked, true)}
          disabled={!picked.size}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600 text-white text-[11px] font-bold disabled:opacity-40"
        >
          <Trash2 size={12} /> Remove
        </button>
        {hiddenCount > 0 && (
          <>
            <button
              onClick={() => setShowHidden((s) => !s)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold ${
                showHidden ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-200'
              }`}
            >
              {showHidden ? 'Hide removed' : `Show removed (${hiddenCount})`}
            </button>
            {showHidden && (
              <button
                onClick={() => setHidden(picked, false)}
                disabled={!picked.size}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-[11px] font-bold disabled:opacity-40"
              >
                <RotateCcw size={12} /> Restore
              </button>
            )}
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {shown.length === 0 ? (
          <p className="text-center text-slate-500 py-12 text-sm">No photos on this car</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {shown.map((p, i) => {
              const on = picked.has(p.url)
              const isCover = !p.hidden && items.filter((x) => !x.hidden)[0]?.url === p.url
              return (
                <div
                  key={p.url}
                  className={`relative rounded-lg overflow-hidden border-2 ${
                    on ? 'border-emerald-500' : 'border-slate-800'
                  } ${p.hidden ? 'opacity-40' : ''}`}
                >
                  <button onClick={() => toggle(p.url)} className="block w-full aspect-[4/3] bg-slate-900">
                    <img src={p.url} alt="" className="w-full h-full object-cover" />
                  </button>

                  <span
                    className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center border-2 ${
                      on ? 'bg-emerald-500 border-emerald-500' : 'bg-black/50 border-white/60'
                    }`}
                  >
                    {on && <Check size={12} className="text-slate-900" />}
                  </span>

                  {isCover && (
                    <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full bg-emerald-500 text-slate-900 text-[9px] font-bold">
                      COVER
                    </span>
                  )}
                  {p.hidden && (
                    <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full bg-red-600 text-white text-[9px] font-bold">
                      REMOVED
                    </span>
                  )}

                  <div className="absolute bottom-0 inset-x-0 flex items-center justify-between bg-black/60 px-1 py-0.5">
                    <span className="text-[9px] text-slate-300 font-semibold truncate">
                      {p.label || 'Photo'}
                    </span>
                    <span className="flex gap-0.5">
                      <button
                        onClick={() => nudge(p.url, -1)}
                        disabled={i === 0}
                        className="p-1 text-slate-200 disabled:opacity-30"
                        title="Move earlier"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        onClick={() => nudge(p.url, 1)}
                        disabled={i === shown.length - 1}
                        className="p-1 text-slate-200 disabled:opacity-30"
                        title="Move later"
                      >
                        <ArrowDown size={12} />
                      </button>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {error && <p className="px-4 py-2 text-xs text-red-400">{error}</p>}

      <div className="flex gap-2 px-4 py-3 border-t border-slate-800">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-slate-800 text-slate-200 font-bold text-sm">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="flex-1 py-2.5 rounded-lg bg-emerald-500 text-slate-900 font-bold text-sm disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
