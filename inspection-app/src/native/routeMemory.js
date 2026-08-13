import { store } from './storage'
import { isNative } from './platform'
import { onAppStateChange } from './appState'

// Switching to Telegram to read a VIN and coming back should land you where you
// were — same page, same filters, same spot in the list. iOS routinely kills a
// backgrounded WKWebView under memory pressure, and when it does the app cold
// starts on the dashboard, losing whatever the crew was halfway through.
//
// So: remember the last route (path + query, which is where the pages keep
// their filter state) plus scroll depth, and replay it on the next cold launch.

const KEY = 'lastRoute'

// A phone discards a backgrounded page and reloads it on return — that's true of
// the native shell (iOS kills the WKWebView under memory pressure) AND of the
// home-screen PWA, which is how most of the crew actually opens this. Gating
// this on isNative() alone meant the people hitting the problem hardest got
// none of the fix.
//
// Still not a plain desktop tab: a desktop browser doesn't discard the page, so
// there's nothing to restore, and jumping someone who typed carzinc.ai onto
// yesterday's filtered list would be a surprise, not a service.
const isStandalonePWA = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    window.navigator?.standalone === true)

export const canRemember = () => isNative() || isStandalonePWA()

// Older than this and "where I was" is stale — a new shift, a new problem.
// Restoring yesterday's filtered list would be noise, not help.
const MAX_AGE_MS = 12 * 60 * 60 * 1000

// Auth/onboarding screens are decided by the router from live state, and the
// inspection/camera flows own their own resume story (an in-flight inspection
// is keyed by id and may already be submitted). Never replay either.
const SKIP = [/^\/login/, /^\/setup/, /^\/pending/, /^\/inspect\//]

export function isRestorable(path) {
  if (!path || path === '/') return false
  return !SKIP.some((re) => re.test(path))
}

export async function rememberRoute(path, scrollY = 0) {
  if (!canRemember() || !isRestorable(path)) return
  try {
    await store.set(KEY, JSON.stringify({ path, scrollY, at: Date.now() }))
  } catch {
    /* a convenience, never worth breaking navigation over */
  }
}

export async function forgetRoute() {
  if (!canRemember()) return
  await store.remove(KEY).catch(() => {})
}

// Returns { path, scrollY } or null.
export async function recallRoute() {
  if (!canRemember()) return null
  try {
    const raw = await store.get(KEY)
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (!isRestorable(saved?.path)) return null
    if (!saved.at || Date.now() - saved.at > MAX_AGE_MS) return null
    return { path: saved.path, scrollY: saved.scrollY || 0 }
  } catch {
    return null
  }
}

// Fires whenever the app leaves the foreground — the last moment we're
// guaranteed to run before the OS may discard the page.
export function onAppPause(cb) {
  return onAppStateChange((isActive) => {
    if (!isActive) cb()
  })
}
