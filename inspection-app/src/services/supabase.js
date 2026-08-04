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
export async function selectAll(buildQuery, pageSize = 1000) {
  const all = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
  }
  return all
}
