// Nothing an inspector records is allowed to depend on having signal.
//
// A test drive is the one part of this job that deliberately leaves the lot, and
// the old failure was `alert('Save failed — please retry')` shown to somebody who
// is driving. Whatever they had just found was then gone, which is
// indistinguishable from forgetting it — the exact problem this whole piece of
// work exists to fix.
//
// So writes are queued locally first and replayed when the network comes back.
//
// The queue holds INTENT, not the finished JSON: "add this finding to this
// check", not "here is what the whole check should look like". Replaying stored
// JSON would clobber anything recorded after it — a queued copy of the findings
// array from ten minutes ago would delete every finding added since. Intent
// replays correctly against whatever the server holds now.

const DB_NAME = 'carz-capture'
const DB_VERSION = 1
const STORE = 'ops'

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no indexedDB'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        // autoIncrement gives us the replay order for free, and order matters:
        // an update to a finding must never be applied before the add.
        db.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function tx(mode, fn) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const store = t.objectStore(STORE)
    const out = fn(store)
    t.oncomplete = () => resolve(out?.result !== undefined ? out.result : out)
    t.onerror = () => reject(t.error)
  })
}

export async function enqueue(op) {
  try {
    await tx('readwrite', (s) => s.add({ ...op, at: Date.now() }))
    notify()
    return true
  } catch {
    // No IndexedDB (private mode, an old webview). Nothing else we can do —
    // the caller surfaces the failure rather than pretending it saved.
    return false
  }
}

export async function pending() {
  try {
    return await tx('readonly', (s) => new Promise((res) => {
      const out = []
      s.openCursor().onsuccess = (e) => {
        const c = e.target.result
        if (c) { out.push(c.value); c.continue() } else res(out)
      }
    }))
  } catch {
    return []
  }
}

export async function pendingCount() {
  return (await pending()).length
}

async function remove(seq) {
  try { await tx('readwrite', (s) => s.delete(seq)) } catch { /* nothing to do */ }
}

// ---------------------------------------------------------------- listeners

const listeners = new Set()

export function onQueueChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify() {
  pendingCount().then((n) => listeners.forEach((fn) => fn(n)))
}

// ---------------------------------------------------------------- draining

let draining = false

// Replays every queued op in the order it was recorded. `handlers` maps an op
// kind to a function; the caller supplies them so this file stays ignorant of
// inspections, findings and Supabase.
//
// A failed op stops the drain and stays at the head of the queue. Skipping it
// and carrying on would apply later ops out of order — an update landing before
// its add — and the queue exists precisely to preserve that order.
export async function drain(handlers) {
  if (draining) return { done: 0, left: await pendingCount() }
  draining = true
  let done = 0
  try {
    const ops = await pending()
    for (const op of ops) {
      const handler = handlers[op.kind]
      if (!handler) { await remove(op.seq); continue }   // unknown kind, drop it
      try {
        await handler(op)
        await remove(op.seq)
        done += 1
      } catch {
        break   // still offline, or the server said no — try again later
      }
    }
  } finally {
    draining = false
    notify()
  }
  return { done, left: await pendingCount() }
}

// Drain whenever the browser says the network is back, and once on load in case
// it came back while the app was closed.
export function startAutoDrain(handlers) {
  const run = () => { drain(handlers).catch(() => {}) }
  window.addEventListener('online', run)
  const timer = setInterval(() => { if (navigator.onLine) run() }, 30000)
  run()
  return () => {
    window.removeEventListener('online', run)
    clearInterval(timer)
  }
}
