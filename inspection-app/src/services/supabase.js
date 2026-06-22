import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

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
