import { useState, useEffect, useRef, useCallback } from 'react'

// A stale-while-revalidate cache in front of Supabase reads.
//
// The app had no read cache at all, so every navigation re-pulled whole tables.
// Inventory alone costs several round trips and a few hundred KB; walking into a
// car and pressing back paid the whole bill again. Measured from a desk, one
// Supabase round trip is ~190ms (58ms TLS + ~130ms server) and the first request
// after an idle period was 3.0s. On the lot, on one bar of LTE, each of those is
// several times worse — which is where "why is this thing so slow" comes from.
//
// The rule here: a cached page paints IMMEDIATELY from whatever we last saw, and
// the fresh copy lands underneath it a moment later. Nobody waits on the network
// to look at a list they were just looking at.
//
// This is deliberately ~100 lines rather than react-query. Every page in this app
// reads through hand-written `load()` functions with page-specific shaping logic;
// adopting a query library means rewriting all of them at once. This wraps them
// where they stand.

const store = new Map()   // key -> { data, at, error }
const inflight = new Map() // key -> Promise, so two mounts share one request

// Bounded so a long shift on the lot can't grow the map without limit. Entries
// are page-sized (a few hundred KB at worst), and the app has ~40 routes.
const MAX_ENTRIES = 60

function remember(key, data) {
  // Map preserves insertion order, so the first key is the oldest write.
  if (store.size >= MAX_ENTRIES && !store.has(key)) {
    store.delete(store.keys().next().value)
  }
  store.set(key, { data, at: Date.now() })
}

export function peek(key) {
  return store.get(key) || null
}

export function invalidate(key) {
  store.delete(key)
  inflight.delete(key)
}

// Mutations rarely touch exactly one cached read. Editing a car's location
// changes what Inventory, the Dashboard and Lot Walk would each show, so those
// call sites invalidate by prefix rather than naming every key.
export function invalidatePrefix(prefix) {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k)
  for (const k of [...inflight.keys()]) if (k.startsWith(prefix)) inflight.delete(k)
}

// Sign-out MUST clear this. Cost and profit are gated by role — inventory_costs()
// hands real numbers to an admin and nulls to everyone else — so a cached admin
// read left in memory across a user switch would show the next person money they
// are not allowed to see. AuthContext calls this on signOut and on any change of
// user id. See src/context/AuthContext.jsx.
export function clearCache() {
  store.clear()
  inflight.clear()
}

// Read through the cache. Returns cached data when it is younger than `ttl`,
// otherwise fetches. Concurrent callers for the same key share one request.
export async function cachedQuery(key, fetcher, { ttl = 60_000, force = false } = {}) {
  if (!force) {
    const hit = store.get(key)
    if (hit && Date.now() - hit.at < ttl) return hit.data
  }
  const pending = inflight.get(key)
  if (pending) return pending

  const p = (async () => {
    const data = await fetcher()
    remember(key, data)
    return data
  })().finally(() => inflight.delete(key))

  inflight.set(key, p)
  return p
}

// The hook the pages use.
//
//   const { data, loading, refreshing, reload } = useCachedQuery('inventory', load)
//
// `loading` is true only when there is nothing to show yet — a cache hit paints
// straight away and reports `refreshing` instead, so the page can show a quiet
// indicator rather than blanking out a list the user is already reading.
//
// `fetcher` is held in a ref: it is redefined on every render, and depending on
// its identity would refetch forever. `key` is the dependency that matters.
export function useCachedQuery(key, fetcher, { ttl = 60_000, enabled = true } = {}) {
  const cached = enabled ? store.get(key) : null
  const [data, setData] = useState(cached ? cached.data : null)
  const [loading, setLoading] = useState(enabled && !cached)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  // Guards a resolved fetch from writing into a component that has since
  // unmounted or moved to a different key.
  const activeKey = useRef(key)

  const run = useCallback(async (force) => {
    const hit = store.get(key)
    const fresh = hit && Date.now() - hit.at < ttl

    if (hit) {
      setData(hit.data)
      setLoading(false)
      if (fresh && !force) return          // nothing to do; cache is current
      setRefreshing(true)                  // paint stale, fetch underneath
    } else {
      setLoading(true)
    }

    try {
      const next = await cachedQuery(key, () => fetcherRef.current(), { ttl, force: true })
      if (activeKey.current !== key) return
      setData(next)
      setError(null)
    } catch (e) {
      if (activeKey.current !== key) return
      // A failed refresh keeps the stale data on screen. Out on the lot a
      // dropped request is normal, and blanking the list over one is worse
      // than showing a list that is a minute old.
      setError(e)
      if (!store.has(key)) setData(null)
    } finally {
      if (activeKey.current === key) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [key, ttl])

  useEffect(() => {
    if (!enabled) return
    activeKey.current = key
    run(false)
    return () => { activeKey.current = null }
  }, [key, enabled, run])

  const reload = useCallback(() => run(true), [run])

  return { data, loading, refreshing, error, reload, setData }
}
