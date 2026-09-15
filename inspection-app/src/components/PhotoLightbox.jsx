// Full-screen photo viewer that pages through the whole set — and zooms.
//
// Every photo grid in the app used to open one image and make you close it to
// see the next — which, on a car with twenty shots off the Telegram group, is
// twenty opens and twenty closes to look at a quarter panel. Here you swipe, tap
// an arrow, or press ← / → , and the counter says how far in you are.
//
// Zoom is the other half of that: a phone photo of a whole bumper is useless for
// judging a scuff unless you can get into it. Pinch with two fingers, double-tap,
// or scroll/±  on a desktop; drag to move around once you're in. Paging is held
// off while you're zoomed, so dragging across a fender doesn't flip to the next
// car's photo — zoom back out (double-tap, or the % chip) to page again.
//
// Marked [data-no-swipe] so a screen underneath that pages on swipe (the body
// shop job screen swipes between cars) stops while this is open — useSwipe
// treats that attribute as blocking the listeners above it, not its own.

import { useEffect, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import useSwipe from '../hooks/useSwipe'
import { photoSourceLabel } from '../services/vehiclePhotos'

const MAX_ZOOM = 6
const DOUBLE_TAP_ZOOM = 2.5
const IDENTITY = { s: 1, x: 0, y: 0 }

export default function PhotoLightbox({ photos, index, onIndex, onClose, onDelete }) {
  const photo = photos[index]

  // scale + translate of the image, in screen px. Rendered as
  // translate(x,y) scale(s) about the image's own centre.
  const [zoom, setZoom] = useState(IDENTITY)
  const zoomed = zoom.s > 1.01
  // Only flipped at the two ends of a gesture, not per frame: the transform
  // must not ease while fingers are on it, or the photo lags the pinch.
  const [gesturing, setGesturing] = useState(false)

  const imgRef = useRef(null)
  // Live gesture bookkeeping. A ref, not state: touchmove fires far faster than
  // React can re-render, and every frame needs the values the gesture STARTED
  // with, not whatever the last committed render happened to hold.
  const g = useRef({ mode: null, dist: 0, mid: null, from: IDENTITY, pt: null, lastTap: 0, moved: false, suppress: 0 })

  // A new photo starts fresh. Staying zoomed into the top-left corner while the
  // picture underneath changes is disorienting, and on a portrait shot after a
  // landscape one the crop lands somewhere meaningless. Done during render
  // rather than in an effect so the new photo's first paint is already at 1× —
  // out of an effect it flashes in at the old zoom and then snaps back.
  const [shown, setShown] = useState(photo?.url)
  if (photo?.url !== shown) {
    setShown(photo?.url)
    setZoom(IDENTITY)
    setGesturing(false)
  }

  // Clamped, not wrapped: running off the end of a car's photos and landing back
  // on the first one reads as "it looped", and you lose your place.
  const go = (delta) => {
    const next = index + delta
    if (next >= 0 && next < photos.length) onIndex(next)
  }

  // How big the picture actually is inside its box. object-contain letterboxes
  // it, so the element's own width is not the image's width — panning bounds off
  // the element box would let you drag a wide photo into empty black.
  function painted() {
    const el = imgRef.current
    if (!el) return null
    const bw = el.offsetWidth, bh = el.offsetHeight
    const { naturalWidth: nw, naturalHeight: nh } = el
    if (!nw || !nh) return { w: bw, h: bh, bw, bh }
    const r = Math.min(bw / nw, bh / nh)
    return { w: nw * r, h: nh * r, bw, bh }
  }

  // Never let an edge of the photo pull inside the frame: at any scale you can
  // only pan as far as the overflow, so the picture always fills what it can.
  function clamp(s, x, y) {
    const p = painted()
    if (!p) return { s, x, y }
    const maxX = Math.max(0, (p.w * s - p.bw) / 2)
    const maxY = Math.max(0, (p.h * s - p.bh) / 2)
    return {
      s,
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    }
  }

  function centre() {
    const el = imgRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }

  // Scale about a point on the screen — the pinch midpoint, the tapped spot, the
  // cursor — so the pixel under your fingers stays under your fingers.
  function zoomAbout(px, py, nextScale, from = zoom) {
    const s = Math.min(MAX_ZOOM, Math.max(1, nextScale))
    const c = centre()
    const k = s / from.s
    if (s <= 1.001) return setZoom(IDENTITY)
    setZoom(clamp(s, (px - c.x) * (1 - k) + k * from.x, (py - c.y) * (1 - k) + k * from.y))
  }

  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
  const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 })

  function onTouchStart(e) {
    const t = e.touches
    if (t.length >= 2) {
      g.current = { ...g.current, mode: 'pinch', dist: dist(t), mid: mid(t), from: zoom, moved: true }
      setGesturing(true)
    } else if (t.length === 1) {
      g.current = {
        ...g.current,
        mode: zoomed ? 'pan' : null,
        from: zoom,
        pt: { x: t[0].clientX, y: t[0].clientY },
        moved: false,
      }
      if (zoomed) setGesturing(true)
    }
  }

  function onTouchMove(e) {
    const t = e.touches
    const s = g.current
    if (s.mode === 'pinch' && t.length >= 2) {
      e.preventDefault()
      const m = mid(t)
      const k = dist(t) / (s.dist || 1)
      const scale = Math.min(MAX_ZOOM, Math.max(1, s.from.s * k))
      const c = centre()
      const kk = scale / s.from.s
      // The midpoint drifting as you pinch is a pan, so carry it through.
      setZoom(clamp(
        scale,
        (s.mid.x - c.x) * (1 - kk) + kk * s.from.x + (m.x - s.mid.x),
        (s.mid.y - c.y) * (1 - kk) + kk * s.from.y + (m.y - s.mid.y),
      ))
    } else if (s.mode === 'pan' && t.length === 1) {
      e.preventDefault()
      const dx = t[0].clientX - s.pt.x
      const dy = t[0].clientY - s.pt.y
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) s.moved = true
      setZoom(clamp(s.from.s, s.from.x + dx, s.from.y + dy))
    }
  }

  function onTouchEnd(e) {
    const s = g.current
    if (e.touches.length === 0) {
      s.mode = null
      setGesturing(false)
      // A gesture that actually moved something ends in a click on the backdrop.
      // Swallow that one click so a pan doesn't close the viewer.
      if (s.moved) s.suppress = Date.now()
      // A pinch that ends at or under 1× snaps back square rather than leaving
      // the photo a hair off-centre and un-pannable.
      if (zoom.s <= 1.01) setZoom(IDENTITY)

      // Double-tap toggles, on the spot you tapped. Only counts if neither tap
      // was really a drag.
      const t = e.changedTouches?.[0]
      if (t && !s.moved) {
        const now = Date.now()
        if (now - s.lastTap < 300) {
          s.lastTap = 0
          zoomAbout(t.clientX, t.clientY, zoomed ? 1 : DOUBLE_TAP_ZOOM)
        } else {
          s.lastTap = now
        }
      }
    }
  }

  // Trackpad pinch arrives as a ctrl-wheel; a plain wheel over a photo people
  // expect to zoom too, so both do.
  function onWheel(e) {
    e.preventDefault()
    const factor = Math.exp(-e.deltaY / (e.ctrlKey ? 100 : 250))
    zoomAbout(e.clientX, e.clientY, zoom.s * factor)
  }

  // Mouse drag to pan, once there's something to pan to.
  function onMouseDown(e) {
    if (!zoomed) return
    e.preventDefault()
    const from = zoom
    const x0 = e.clientX, y0 = e.clientY
    setGesturing(true)
    const move = (ev) => {
      if (Math.abs(ev.clientX - x0) > 3 || Math.abs(ev.clientY - y0) > 3) g.current.suppress = Date.now()
      setZoom(clamp(from.s, from.x + (ev.clientX - x0), from.y + (ev.clientY - y0)))
    }
    const up = () => {
      setGesturing(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // These go on natively rather than through React's props: React registers
  // touchmove and wheel at the root as PASSIVE, where preventDefault is a silent
  // no-op — so a pinch would zoom the whole browser page out from under us and a
  // scroll would run the page behind. No dep array on purpose: each render's
  // handlers must close over the zoom that render drew.
  useEffect(() => {
    const el = imgRef.current
    if (!el) return
    const opts = { passive: false }
    el.addEventListener('touchstart', onTouchStart, opts)
    el.addEventListener('touchmove', onTouchMove, opts)
    el.addEventListener('touchend', onTouchEnd, opts)
    el.addEventListener('touchcancel', onTouchEnd, opts)
    el.addEventListener('wheel', onWheel, opts)
    return () => {
      el.removeEventListener('touchstart', onTouchStart, opts)
      el.removeEventListener('touchmove', onTouchMove, opts)
      el.removeEventListener('touchend', onTouchEnd, opts)
      el.removeEventListener('touchcancel', onTouchEnd, opts)
      el.removeEventListener('wheel', onWheel, opts)
    }
  })

  // Paging is off while zoomed — dragging across a panel must not flip the photo.
  const swipe = useSwipe({
    onLeft: () => go(1),
    onRight: () => go(-1),
    enabled: photos.length > 1 && !zoomed,
  })

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        // Back out of the zoom first — closing the whole viewer when someone
        // only meant to drop back to the full photo loses their place in the set.
        if (zoomed) setZoom(IDENTITY)
        else onClose()
      } else if (e.key === '+' || e.key === '=') {
        const c = centre(); zoomAbout(c.x, c.y, zoom.s * 1.4)
      } else if (e.key === '-' || e.key === '_') {
        const c = centre(); zoomAbout(c.x, c.y, zoom.s / 1.4)
      } else if (e.key === '0') {
        setZoom(IDENTITY)
      } else if (!zoomed && e.key === 'ArrowRight') go(1)
      else if (!zoomed && e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!photo) return null

  const deletable = onDelete && photo.source === 'app'

  return (
    <div data-no-swipe {...swipe}
      className="fixed inset-0 z-[60] bg-black/90 flex flex-col safe-inset"
      // A pan or pinch that finishes over the backdrop must not be read as a tap
      // on it — that would close the viewer at the end of every drag.
      onClick={() => { if (Date.now() - g.current.suppress < 400) return; onClose() }}>
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
          {/* Doubles as the way out of a zoom you can't pinch out of one-handed. */}
          {zoomed && (
            <button onClick={() => setZoom(IDENTITY)}
              className="text-[11px] text-slate-300 tabular-nums border border-white/25 rounded px-1.5 py-0.5">
              {Math.round(zoom.s * 100)}% · reset
            </button>
          )}
          {photos.length > 1 && !zoomed && (
            <span className="text-[11px] text-slate-400 tabular-nums">{index + 1} / {photos.length}</span>
          )}
          <button onClick={onClose} className="text-white" aria-label="Close"><X size={22} /></button>
        </div>
      </div>

      <div className="flex-1 flex items-center min-h-0 overflow-hidden">
        {photos.length > 1 && (
          <button onClick={(e) => { e.stopPropagation(); go(-1) }} disabled={index === 0 || zoomed}
            aria-label="Previous photo"
            className="shrink-0 h-full px-2 text-white/70 disabled:opacity-20 active:text-white">
            <ChevronLeft size={32} />
          </button>
        )}
        {/* stopPropagation so tapping the photo itself doesn't close the viewer —
            only the backdrop does. touch-none keeps the browser from taking the
            gesture for its own page zoom/scroll before we see it. */}
        <img ref={imgRef} src={photo.url} alt=""
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation()
            // A pan can end inside a double-click sequence, and the browser
            // fires dblclick anyway — without this, finishing a drag throws the
            // zoom away and you're back looking at the whole car.
            if (Date.now() - g.current.suppress < 400) return
            zoomAbout(e.clientX, e.clientY, zoomed ? 1 : DOUBLE_TAP_ZOOM)
          }}
          onMouseDown={onMouseDown}
          draggable={false}
          style={{
            transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.s})`,
            transition: gesturing ? 'none' : 'transform 120ms ease-out',
            touchAction: 'none',
            cursor: zoomed ? 'grab' : 'zoom-in',
          }}
          className="flex-1 min-w-0 max-h-full object-contain select-none" />
        {photos.length > 1 && (
          <button onClick={(e) => { e.stopPropagation(); go(1) }} disabled={index === photos.length - 1 || zoomed}
            aria-label="Next photo"
            className="shrink-0 h-full px-2 text-white/70 disabled:opacity-20 active:text-white">
            <ChevronRight size={32} />
          </button>
        )}
      </div>

      <p className="text-center text-[10px] text-slate-500 pb-3">
        {zoomed ? 'drag to move · double-tap to zoom back out'
          : photos.length > 1 ? 'pinch or double-tap to zoom · swipe or use ← → to move through the photos'
            : 'pinch or double-tap to zoom'}
      </p>
    </div>
  )
}
