// Horizontal swipe on a touch screen, for paging between records.
//
// Deliberately conservative about what counts as a swipe, because the screens
// that use this are full of things a finger does for other reasons:
//
//   · a gesture that moves more up/down than across is a scroll, not a swipe
//   · a gesture that starts on an input, a slider or anything marked
//     [data-no-swipe] (photo viewer, side-scrolling chip rows) is that thing's
//   · a second finger means pinch-zoom on a photo
//
// Returns props to spread onto the element that should listen.

import { useRef } from 'react'

const DISTANCE = 60   // px across before it counts
const RATIO    = 1.5  // and it must be this much more across than down

export default function useSwipe({ onLeft, onRight, enabled = true } = {}) {
  const start = useRef(null)

  if (!enabled) return {}

  return {
    onTouchStart(e) {
      if (e.touches.length !== 1) { start.current = null; return }
      // An opted-out region blocks the listeners ABOVE it, not its own. A photo
      // viewer marks itself [data-no-swipe] so the page behind it stops paging
      // cars, and still swipes its own photos with these same handlers.
      const opted = e.target.closest?.('input, textarea, select, [data-no-swipe]')
      if (opted && opted !== e.currentTarget) {
        start.current = null
        return
      }
      const t = e.touches[0]
      start.current = { x: t.clientX, y: t.clientY }
    },
    onTouchMove(e) {
      // A second finger mid-gesture (pinching a photo) cancels it.
      if (e.touches.length !== 1) start.current = null
    },
    onTouchEnd(e) {
      const s = start.current
      start.current = null
      if (!s) return
      const t = e.changedTouches?.[0]
      if (!t) return
      const dx = t.clientX - s.x
      const dy = t.clientY - s.y
      if (Math.abs(dx) < DISTANCE || Math.abs(dx) < Math.abs(dy) * RATIO) return
      if (dx < 0) onLeft?.()
      else onRight?.()
    },
  }
}
