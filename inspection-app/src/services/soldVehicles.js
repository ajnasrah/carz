import { supabase } from './supabase'
import { toInt } from './utils'

// Auction / wholesale sold cars: rows in vehicle_locations whose SmartAuction,
// Manheim, or OVE status is 'sold'. This is the LIVE sold source (the Frazer
// `sold` table is retail and only populates once the Frazer sync lands). Each
// car keeps its full timeline in vehicle_location_history, so rows are
// clickable through to the history modal.
export async function fetchAuctionSold() {
  const PAGE = 1000
  const locs = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('vehicle_locations')
      .select(
        'stock_number,vin,physical_location,location_updated_at,sa_status,manheim_status,ove_status,sold_price,buyer_name,sold_at',
      )
      .or('sa_status.eq.sold,manheim_status.eq.sold,ove_status.eq.sold')
      .range(from, from + PAGE - 1)
    if (error || !data) break
    locs.push(...data)
    if (data.length < PAGE) break
    from += PAGE
    if (from >= 20000) break // safety cap
  }

  // Enrich with year/make/model + cost from inventory where the car still exists.
  const stocks = [...new Set(locs.map((l) => l.stock_number).filter(Boolean))]
  const byStock = {}
  for (let i = 0; i < stocks.length; i += 200) {
    const batch = stocks.slice(i, i + 200)
    // Vehicle facts off the table; cost through the RPC, which masks it for
    // anyone without sold-reports access.
    const [{ data: inv }, { data: costs }] = await Promise.all([
      supabase
        .from('inventory')
        .select('stock_number,vehicle_year,vehicle_make,vehicle_model,last_6_vin')
        .in('stock_number', batch),
      supabase.rpc('inventory_costs').in('stock_number', batch),
    ])
    const costByStock = new Map((costs || []).map((c) => [c.stock_number, c]))
    for (const row of inv || []) {
      const c = costByStock.get(row.stock_number)
      byStock[row.stock_number] = { ...row, total_cost: c?.total_cost ?? null, added_costs: c?.added_costs ?? null }
    }
  }

  return locs
    .map((l) => {
      const inv = byStock[l.stock_number] || {}
      const channel =
        l.sa_status === 'sold' ? 'SmartAuction' : l.manheim_status === 'sold' ? 'Manheim' : l.ove_status === 'sold' ? 'OVE' : '—'
      const allIn = toInt(inv.total_cost) + toInt(inv.added_costs)
      return {
        stock_number: l.stock_number,
        vin: l.vin,
        last_6_vin: inv.last_6_vin || (l.vin || '').slice(-6),
        vehicle_year: inv.vehicle_year,
        vehicle_make: inv.vehicle_make,
        vehicle_model: inv.vehicle_model,
        channel,
        sale_price: toInt(l.sold_price),
        buyer: l.buyer_name || '—',
        sold_at: l.sold_at,
        all_in_cost: allIn,
        profit: allIn ? toInt(l.sold_price) - allIn : null,
        physical_location: l.physical_location,
      }
    })
    .sort((a, b) => (new Date(b.sold_at).getTime() || 0) - (new Date(a.sold_at).getTime() || 0))
}
