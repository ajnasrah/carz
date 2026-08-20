// Sort a car's photos the moment its photos arrive, rather than up to a quarter
// of an hour later.
//
// The sweep on /api/photo-sort is a clock: every 15 minutes it looks for cars
// whose gallery changed. That is fine as a backstop and wrong as the only
// trigger — a car photographed and listed inside those 15 minutes goes onto the
// marketplace in whatever order its pictures happened to arrive, which is the
// thing the sorter exists to fix.
//
// So the ingestion points call this. It is deliberately fire-and-forget: a
// gallery that stays unsorted for another few minutes is a cosmetic problem, and
// a photo upload that fails because the sorter was busy is a real one. Nothing
// here is awaited into a caller's critical path, nothing here can throw into it,
// and the cron still catches anything this misses.
//
// Cheap by design: /api/photo-sort exits early when a car has no new photos and
// its ordering already covers what it has, so the common case — the second,
// third and tenth chunk of the same upload — costs one read and no model call.
//
// Env: CRON_SECRET (the endpoint's own gate), VERCEL_URL / SITE_URL.

const SITE = process.env.SITE_URL || 'https://www.carzinc.ai'

export function sortCarPhotos(vin, { waitUntil } = {}) {
  const v = String(vin || '').replace(/[^0-9A-Za-z]/g, '')
  const secret = process.env.CRON_SECRET
  if (v.length < 6 || !secret) return

  const run = fetch(`${SITE}/api/photo-sort?vin=${encodeURIComponent(v)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: '{}',
  })
    .then((r) => (r.ok ? null : r.text().then((t) => console.warn('photo-sort trigger', r.status, t.slice(0, 200)))))
    .catch((e) => console.warn('photo-sort trigger failed for', v, e?.message || e))

  // On the edge runtime the request context can be torn down the moment the
  // response is returned, which would kill an in-flight fetch. waitUntil is what
  // keeps it alive without holding up the response.
  if (typeof waitUntil === 'function') {
    waitUntil(run)
    return Promise.resolve()
  }

  // No waitUntil — a Node function, i.e. the Telegram webhook. It has no way to
  // keep work alive past its response, so wait just long enough for the request
  // to be SENT, then let go. The sort itself runs in the photo-sort function on
  // its own clock; abandoning our end of the call does not stop it, and the
  // webhook must answer Telegram in seconds or be retried.
  return Promise.race([run, new Promise((r) => setTimeout(r, DISPATCH_MS))])
}

const DISPATCH_MS = 600
