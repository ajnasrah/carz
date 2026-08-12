import { App } from '@capacitor/app'
import { store } from './storage'
import { isNative } from './platform'

// Switching to Telegram to read a VIN and coming back should land you where you
// were — same page, same filters, same spot in the list. iOS routinely kills a
// backgrounded WKWebView under memory pressure, and when it does the app cold
// starts on the dashboard, losing whatever the crew was halfway through.
//
// So: remember the last route (path + query, which is where the pages keep
// their filter state) plus scroll depth, and replay it on the next cold launch.

const KEY = 'lastRoute'

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
  if (!isNative() || !isRestorable(path)) return
  try {
    await store.set(KEY, JSON.stringify({ path, scrollY, at: Date.now() }))
  } catch {
    /* a convenience, never worth breaking navigation over */
  }
}

export async function forgetRoute() {
  if (!isNative()) return
  await store.remove(KEY).catch(() => {})
}

// Returns { path, scrollY } or null.
export async function recallRoute() {
  if (!isNative()) return null
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
// guaranteed to run before the OS may kill us. visibilitychange covers the
// web/PWA case and the odd Android path where appStateChange doesn't fire.
export function onAppPause(cb) {
  const onVisibility = () => {
    if (document.hidden) cb()
  }
  document.addEventListener('visibilitychange', onVisibility)

  let handle
  let cancelled = false
  if (isNative()) {
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) cb()
    })
      .then((h) => {
        if (cancelled) h.remove?.()
        else handle = h
      })
      .catch(() => {})
  }

  return () => {
    cancelled = true
    document.removeEventListener('visibilitychange', onVisibility)
    handle?.remove?.()
  }
}
