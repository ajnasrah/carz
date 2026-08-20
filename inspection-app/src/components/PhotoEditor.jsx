import { useState, useMemo, useRef } from 'react'
import { X, Check, Star, ArrowUp, ArrowDown, Trash2, RotateCcw, Wand2, Upload } from 'lucide-react'
import { savePhotoEdits, autoSortPhotos, uploadListingPhotos } from '../services/listingPhotos'

// Bulk photo editing for a listing: tick as many photos as you like, then remove
// them, send them to the front, or bring hidden ones back — all in one save.
//
// Nothing is deleted. Removing a photo hides it from the listing and it stays
// available under "Show removed", because the photo itself belongs to the car
// (Telegram, the inspection, SmartAuction) and other screens still show it.
export default function PhotoEditor({ vin, photos, edit, onClose, onSaved, onPhotosAdded }) {
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
  const [sorting, setSorting] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef(null)

  // Photos dropped or picked here go to the car, not to this screen: the upload
  // writes them server-side and they are part of the listing whether or not you
  // press Save. Save is still what commits the ORDER.
  //
  // They land at the end of the working list, which is where an unordered photo
  // belongs — the sorter has not looked at them yet. It runs on the finished set
  // the moment the upload reports done, so reopening this screen shows them in
  // their proper slots.
  async function addFiles(files) {
    const list = [...(files || [])]
    if (!list.length) return
    setError('')
    setUploading(`0/${list.length}`)
    try {
      const urls = await uploadListingPhotos(vin, list, (n, total) => setUploading(`${n}/${total}`))
      if (urls.length) {
        setItems((prev) => {
          const have = new Set(prev.map((p) => p.url))
          const fresh = urls.filter((u) => !have.has(u))
            .map((url, i) => ({ url, label: 'Added', hidden: false, _i: prev.length + i }))
          return [...prev, ...fresh]
        })
        onPhotosAdded?.()
      }
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setUploading('')
    }
  }

  const shown = useMemo(
    () => items.filter((p) => showHidden || !p.hidden),
    [items, showHidden],
  )
  const liveCount = items.filter((p) => !p.hidden).length

  // Shift-click takes everything between the last one and this one. Ticking 30
  // of a 55-photo car one at a time is the kind of job people stop doing.
  const lastPicked = useRef(null)

  function toggle(url, range = false) {
    setPicked((s) => {
      const next = new Set(s)
      if (range && lastPicked.current && lastPicked.current !== url) {
        const list = shown.map((p) => p.url)
        const a = list.indexOf(lastPicked.current)
        const b = list.indexOf(url)
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          for (let k = lo; k <= hi; k++) next.add(list[k])
          return next
        }
      }
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
    lastPicked.current = url
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

  // Every car is sorted automatically already; this is for redoing one in front
  // of you. It arranges the working copy and stops there — Save is still what
  // commits it, so you can nudge the result first, and so a sort you don't like
  // is undone by closing the screen.
  async function autoSort() {
    setSorting(true)
    setError('')
    try {
      const { ordering } = await autoSortPhotos(vin)
      const rank = new Map(ordering.map((url, i) => [url, i]))
      setItems((list) =>
        [...list].sort((a, b) => {
          const ra = rank.has(a.url) ? rank.get(a.url) : Number.MAX_SAFE_INTEGER
          const rb = rank.has(b.url) ? rank.get(b.url) : Number.MAX_SAFE_INTEGER
          return ra - rb || a._i - b._i
        }),
      )
      setPicked(new Set())
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setSorting(false)
    }
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
          onClick={autoSort}
          disabled={sorting || busy}
          title="Front three-quarter first, then the walkaround, interior, close-ups"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-500 text-white text-[11px] font-bold disabled:opacity-40"
        >
          <Wand2 size={12} /> {sorting ? 'Sorting…' : 'Auto-sort'}
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

      <div
        className="flex-1 overflow-y-auto px-4 py-3"
        // Only react to FILES. Dragging a tile around inside the editor carries
        // no files, and lighting up the drop zone for it made the whole pane
        // feel like it was doing something else with your gesture.
        onDragOver={(e) => {
          if (!e.dataTransfer?.types?.includes('Files')) return
          e.preventDefault(); setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!e.dataTransfer?.files?.length) { setDragging(false); return }
          e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files)
        }}
      >
        {/* Drop anywhere in this pane, or tap to pick — a phone's picker takes
            the whole camera roll at once, which is the point. */}
        <button
          onClick={() => fileInput.current?.click()}
          disabled={!!uploading}
          className={`w-full mb-3 rounded-lg border-2 border-dashed px-3 py-4 text-center transition-colors ${
            dragging ? 'border-emerald-400 bg-emerald-500/10' : 'border-slate-700 bg-slate-900/40'
          } ${uploading ? 'opacity-60' : 'active:border-emerald-500'}`}
        >
          <Upload size={18} className="mx-auto mb-1 text-slate-400" />
          <span className="block text-xs font-bold text-slate-200">
            {uploading ? `Uploading ${uploading}…` : 'Add photos'}
          </span>
          <span className="block text-[10px] text-slate-500 mt-0.5">
            {uploading ? 'keep this screen open' : 'drop a batch here, or tap to choose'}
          </span>
        </button>
        <input
          ref={fileInput} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
        />

        {shown.length === 0 ? (
          <p className="text-center text-slate-500 py-12 text-sm">No photos on this car</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {shown.map((p, i) => {
              const on = picked.has(p.url)
              const isCover = !p.hidden && items.filter((x) => !x.hidden)[0]?.url === p.url
              return (
                // The WHOLE tile toggles. It used to be only the image, while a
                // label-and-arrows bar covered the bottom of every thumbnail and
                // the tick badge covered a corner — so tapping quickly through a
                // batch, a good share of the taps landed on dead pixels and only
                // some photos ticked. That is what "can't select multiple" was.
                <div
                  key={p.url}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => toggle(p.url, e.shiftKey)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(p.url, e.shiftKey) }
                  }}
                  className={`relative rounded-lg overflow-hidden border-2 cursor-pointer select-none ${
                    on ? 'border-emerald-500' : 'border-slate-800'
                  } ${p.hidden ? 'opacity-40' : ''}`}
                >
                  {/* draggable={false} matters: an <img> is draggable by
                      default, so on a desktop the smallest movement while
                      pressing starts a native image drag INSTEAD of a click —
                      the photo just doesn't select and nothing says why. The
                      drop zone above made that worse by highlighting on the
                      same gesture. */}
                  <div className="block w-full aspect-[4/3] bg-slate-900">
                    <img src={p.url} alt="" draggable={false} className="w-full h-full object-cover pointer-events-none" />
                  </div>

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
                        onClick={(e) => { e.stopPropagation(); nudge(p.url, -1) }}
                        disabled={i === 0}
                        className="p-1 text-slate-200 disabled:opacity-30"
                        title="Move earlier"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); nudge(p.url, 1) }}
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
