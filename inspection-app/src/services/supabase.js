import { createClient } from '@supabase/supabase-js'
import { authStorage } from '../native/storage'

// .trim() is load-bearing, not defensive tidying. Env values pulled from Vercel
// arrive with a trailing carriage return, and it gets inlined into the bundle at
// build time. The damage is silent and total:
//
//   • the anon key becomes "<jwt>\r"  → every request fails "Invalid API key"
//   • the URL becomes "…supabase.co\r" and the URL parser rewrites the backslash
//     to a slash, so requests go to …supabase.co/r/auth/v1/otp — a path that
//     doesn't exist, which reports the same misleading "Invalid API key"
//
// Nothing in the error points at whitespace, so this reads like a broken key or
// a dead SMS provider and sends you hunting in the wrong place. Trim at every
// env boundary — see also services/ghlSync.js.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

// authStorage is undefined on web, so the client keeps its localStorage default
// and existing browser sessions stay valid. Inside the native shell it swaps in
// a Preferences-backed store — WKWebView's localStorage is evictable, which was
// logging the crew out mid-shift and forcing a fresh SMS OTP on a phone that
// may have one bar out on the lot. See src/native/storage.js.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    ...(authStorage ? { storage: authStorage } : {}),
    persistSession: true,
    autoRefreshToken: true,
  },
})

// PostgREST caps an unbounded .select() at 1000 rows. Tables like
// vehicle_locations have outgrown that, so loading the whole table into a
// lookup map silently dropped rows and miscounted (e.g. dispatched cars
// appearing as "needs dispatch"). selectAll pages past the cap.
//
// Pass a thunk that returns a FRESH query builder each call — .range() must be
// applied to a clean builder per page.
//   const rows = await selectAll(() =>
//     supabase.from('vehicle_locations').select('stock_number, physical_location'))
// Pages are fetched a batch at a time, not one after another.
//
// PostgREST caps a response at 1000 rows, so anything table-sized needs several
// requests. Asking for them in a chain makes the whole thing latency-bound: the
// Sold Reports page pulls ~6,400 sold rows from two tables, and each page waited
// on the one before it — measured at ~500ms per page over seven pages, twice
// over. On the lot, where a round trip costs several times what it does on a
// desk, that ladder is most of the wait.
//
// A batch of eight covers a 6,400-row table in one round trip. Verified against
// the live `sold` table signed in: sequential and batched return the identical
// 6,397-row multiset — same rows, same counts, nothing skipped or doubled — in
// 1,604ms versus 450ms. The multiset check matters because these queries have no
// unique ORDER BY, so offsets are only as stable as Postgres's plan; the length
// check below is the guard if that ever stops holding.
export async function selectAll(buildQuery, pageSize = 1000, batch = 8) {
  const all = []
  for (let base = 0; ; base += pageSize * batch) {
    const offsets = Array.from({ length: batch }, (_, i) => base + i * pageSize)
    const pages = await Promise.all(offsets.map(async (from) => {
      const { data, error } = await buildQuery().range(from, from + pageSize - 1)
      if (error) throw error
      return data || []
    }))
    for (const p of pages) all.push(...p)
    // A short page anywhere in the batch means the table ended inside it, so
    // there is nothing after this batch to ask for.
    if (pages.some((p) => p.length < pageSize)) break
  }
  return all
}
