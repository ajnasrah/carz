import { supabase } from './supabase'

// Look up a vehicle by full VIN (17 chars), partial VIN (last 4-7), or stock
// number — across CURRENT inventory AND sold/removed cars. Returns:
//   {
//     vehicle,            // year/make/model/vin/stock (best available source)
//     cost,               // inventory cost row (may be {})
//     location,           // { physical_location, source, updated_at } | null
//     status,             // { state: 'sold'|'inventory'|'unknown', ...marketplace }
//     sale,               // { price, buyer, sold_on, marketplace } | null (sold only)
//     history,            // [] of vehicle_location_history rows, newest first
//   }
// or null if the VIN/stock is not found in ANY source.
//
// Shared by the global search popup and the /vin-check page. This intentionally
// looks past inventory so a SOLD car's VIN still resolves (with its full
// location/status history) instead of reporting "not in inventory".
export async function searchVin(raw) {
  const cleaned = (raw || '').trim().toUpperCase()
  const vinQ = cleaned.replace(/[^A-HJ-NPR-Z0-9]/g, '')
  if (vinQ.length < 4) return null

  // 1. Identify the car from inventory sources (gives year/make/model + cost).
  const inv = await findInventory(cleaned, vinQ)

  // 2. Pull the location/status row. Prefer the inventory stock_number match;
  //    otherwise search vehicle_locations directly (covers cars no longer in
  //    the inventory view but still tracked as sold).
  const loc = await findLocation(inv?.vehicle?.stock_number, vinQ)

  // Nothing anywhere — genuinely unknown VIN.
  if (!inv && !loc) return null

  // Resolve the canonical identifiers to key history off of.
  const stock = inv?.vehicle?.stock_number || loc?.stock_number || null
  const vin = inv?.vehicle?.vehicle_vin || loc?.vin || (vinQ.length === 17 ? vinQ : null)

  // 3. Full timeline. History outlives the car, so key by VIN when we have the
  //    full 17 chars, else by stock number.
  const history = await loadHistory({ vin, stock })

  // 4. Fold status/sale out of the location row (source of truth for sold).
  const { status, sale } = deriveStatus(loc, history, Boolean(inv))

  return {
    vehicle: inv?.vehicle || locToVehicle(loc, history),
    cost: inv?.cost || {},
    location: loc
      ? {
          physical_location: loc.physical_location,
          source: loc.physical_source,
          updated_at: loc.location_updated_at || loc.updated_at,
        }
      : null,
    status,
    sale,
    history,
  }
}

// --- inventory lookup (current stock) --------------------------------------

async function findInventory(cleaned, vinQ) {
  // Stock numbers look like "06-290-26" (contain hyphens).
  if (/-/.test(cleaned)) {
    const { data: byStock } = await supabase
      .from('vehicle_lot_status')
      .select('*')
      .eq('stock_number', cleaned)
      .limit(1)
    if (byStock && byStock.length) return await withCost(byStock[0])
  }

  let query = supabase.from('vehicle_lot_status').select('*')
  if (vinQ.length === 17) query = query.eq('vehicle_vin', vinQ)
  else query = query.or(`last_6_vin.eq.${vinQ},vehicle_vin.ilike.%${vinQ}`)
  const { data: vehicles, error } = await query.limit(5)

  if (!error && vehicles && vehicles.length) return await withCost(vehicles[0])

  // Fallback to the plain inventory table (view may be missing the car).
  let fb = supabase.from('inventory').select('*')
  if (vinQ.length === 17) fb = fb.eq('vehicle_vin', vinQ)
  else fb = fb.or(`last_6_vin.eq.${vinQ},vehicle_vin.ilike.%${vinQ}`)
  const { data: rows } = await fb.limit(5)
  if (rows && rows.length) return { vehicle: rows[0], cost: rows[0] }

  return null
}

async function withCost(vehicle) {
  const { data: costRows } = await supabase
    .from('inventory')
    .select('total_cost, added_costs, buyer, vendor, location_code')
    .eq('stock_number', vehicle.stock_number)
    .limit(1)
  return { vehicle, cost: costRows?.[0] || {} }
}

// --- location / status lookup (covers sold + removed) ----------------------

async function findLocation(stockNumber, vinQ) {
  if (stockNumber) {
    const { data } = await supabase
      .from('vehicle_locations')
      .select('*')
      .eq('stock_number', stockNumber)
      .limit(1)
    if (data && data.length) return data[0]
  }
  // No inventory match — search vehicle_locations by VIN directly.
  let q = supabase.from('vehicle_locations').select('*')
  if (vinQ.length === 17) q = q.eq('vin', vinQ)
  else q = q.ilike('vin', `%${vinQ}`)
  const { data } = await q.limit(1)
  return data?.[0] || null
}

async function loadHistory({ vin, stock }) {
  let q = supabase
    .from('vehicle_location_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  if (vin) q = q.eq('vin', vin)
  else if (stock) q = q.eq('stock_number', stock)
  else return []
  const { data } = await q
  return data || []
}

// Fold the marketplace status columns + history into a display status/sale.
function deriveStatus(loc, history, inInventory) {
  const marketplace = pickSoldMarketplace(loc)
  const soldEvent = history.find((e) => e.event_type === 'marketplace_sold')

  if (marketplace || soldEvent) {
    return {
      status: { state: 'sold', marketplace: marketplace?.name || soldEvent?.marketplace },
      sale: {
        price: loc?.sold_price ?? soldEvent?.sale_price ?? null,
        buyer: loc?.buyer_name ?? soldEvent?.buyer_name ?? null,
        // sold_at is the timestamp; sold_on is a channel string ("smart_auction").
        sold_on: loc?.sold_at || soldEvent?.created_at || null,
        marketplace: marketplace?.name || soldEvent?.marketplace || null,
      },
    }
  }

  if (inInventory) return { status: { state: 'inventory' }, sale: null }
  return { status: { state: 'unknown' }, sale: null }
}

function pickSoldMarketplace(loc) {
  if (!loc) return null
  if (loc.sa_status === 'sold') return { name: 'SmartAuction' }
  if (loc.manheim_status === 'sold') return { name: 'Manheim' }
  if (loc.ove_status === 'sold') return { name: 'OVE' }
  return null
}

// When a car exists only in vehicle_locations/history (not inventory), build a
// minimal vehicle descriptor so the UI still has a VIN + stock to show.
function locToVehicle(loc, history) {
  const src = loc || history[0] || {}
  return {
    stock_number: src.stock_number || null,
    vehicle_vin: loc?.vin || history[0]?.vin || null,
    last_6_vin: (loc?.vin || history[0]?.vin || '').slice(-6) || null,
  }
}
