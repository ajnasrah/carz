// Carz Inc service worker — minimal version that ONLY caches the app shell
// (HTML, JS, CSS from our own origin). NEVER caches Supabase API responses.
//
// The previous version cached EVERY fetch via "network-first, fall-back-to-cache"
// which broke API requests when the cache contained a stale 401/empty response
// from before the user was logged in. Bumping CACHE_NAME forces the activate
// handler below to delete all old caches.

// Bumped to v5 on 2026-08-18. The cache holds the app shell, and the shell names
// its JS by content hash — so a stale cached index.html points at bundles that no
// longer exist on the server, and the page comes up blank rather than merely old.
// Network-first means that only bites when a fetch fails, but the recovery was
// manual (clear the site data), which is not something you can ask a buyer to do.
// Changing this file at all is what makes browsers install a new worker; the
// activate handler below then deletes every carz-inspect-* cache that isn't this
// one, so the bad shell clears itself on the next load.
const CACHE_NAME = 'carz-inspect-v5'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Pre-cache the app shell so the first offline load works
      cache.addAll(['/', '/index.html'])
    )
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      // Only delete OUR old caches, not caches from other apps on same origin
      Promise.all(
        names
          .filter((n) => n.startsWith('carz-inspect-') && n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // CRITICAL: never touch cross-origin requests (Supabase, fonts, CDNs).
  // Let the browser handle them directly with no SW interception.
  if (url.origin !== self.location.origin) return

  // Don't intercept anything except GETs
  if (event.request.method !== 'GET') return

  // Skip Vite dev server endpoints
  if (url.pathname.startsWith('/@vite/') || url.pathname.startsWith('/@react-refresh')) return

  // Network-first for same-origin assets — always fetch fresh JS, fall back
  // to cache only when actually offline
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        }
        return response
      })
      .catch(() => caches.match(event.request)),
  )
})
