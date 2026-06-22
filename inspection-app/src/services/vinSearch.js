import { supabase } from './supabase'

// Look up a vehicle in CURRENT inventory by full VIN (17 chars), partial VIN
// (last 4-7), or stock number. Returns { vehicle, cost } or null if not found.
// Shared by the global search popup and the /vin-check page.
export async function searchVin(raw) {
  const cleaned = (raw || '').trim().toUpperCase()
  const vinQ = cleaned.replace(/[^A-HJ-NPR-Z0-9]/g, '')
  if (vinQ.length < 4) return null

  // Stock numbers look like "06-290-26" (contain hyphens) — if the raw input
  // has hyphens, try a stock-number match first.
  if (/-/.test(cleaned)) {
    const { data: byStock } = await supabase
      .from('vehicle_lot_status')
      .select('*')
      .eq('stock_number', cleaned)
      .limit(1)
    if (byStock && byStock.length) return withCost(byStock[0])
  }

  // VIN search against the inventory view (full VIN or tail match)
  let query = supabase.from('vehicle_lot_status').select('*')
  if (vinQ.length === 17) query = query.eq('vehicle_vin', vinQ)
  else query = query.or(`last_6_vin.eq.${vinQ},vehicle_vin.ilike.%${vinQ}`)
  const { data: vehicles, error } = await query.limit(5)

  if (error || !vehicles || vehicles.length === 0) {
    // Fallback to the plain inventory table (view may be missing)
    let fb = supabase.from('inventory').select('*')
    if (vinQ.length === 17) fb = fb.eq('vehicle_vin', vinQ)
    else fb = fb.or(`last_6_vin.eq.${vinQ},vehicle_vin.ilike.%${vinQ}`)
    const { data: inv } = await fb.limit(5)
    if (!inv || inv.length === 0) return null
    return { vehicle: inv[0], cost: inv[0] }
  }

  return withCost(vehicles[0])
}

async function withCost(vehicle) {
  const { data: costRows } = await supabase
    .from('inventory')
    .select('total_cost, added_costs, buyer, vendor, location_code')
    .eq('stock_number', vehicle.stock_number)
    .limit(1)
  return { vehicle, cost: costRows?.[0] || {} }
}
