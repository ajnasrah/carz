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

  // A partial VIN (not a stock #, not the full 17 chars) is a "contains anywhere"
  // search and can hit several cars. Gather them first; if more than one matches,
  // hand the caller a { multiple: [...] } list to disambiguate in the popup. When
  // exactly one matches, pin to its full VIN / stock and resolve normally.
  const isStock = /-/.test(cleaned)
  if (!isStock && vinQ.length !== 17) {
    const candidates = await gatherCandidates(vinQ)
    if (candidates.length === 0) return null
    if (candidates.length > 1) return { multiple: candidates }
    const only = candidates[0]
    const pin =
      only.vehicle_vin && only.vehicle_vin.length === 17
        ? only.vehicle_vin
        : only.stock_number && /-/.test(only.stock_number)
          ? only.stock_number
          : null
    if (pin && pin.toUpperCase() !== cleaned) return await searchVin(pin)
    // else: fall through and resolve the single partial match directly.
  }

  // 1. Identify the car from inventory sources (gives year/make/model + cost).
  const inv = await findInventory(cleaned, vinQ)

  // 2. Pull the location/status row. Prefer the inventory stock_number match;
  //    otherwise search vehicle_locations directly (covers cars no longer in
  //    the inventory view but still tracked as sold).
  const invLast6 =
    inv?.vehicle?.last_6_vin ||
    (inv?.vehicle?.vehicle_vin || '').slice(-6) ||
    (vinQ.length >= 6 ? vinQ.slice(-6) : null)
  const loc = await findLocation(inv?.vehicle?.stock_number, vinQ, invLast6)

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

  const vehicle = inv?.vehicle || locToVehicle(loc, history)

  return {
    vehicle,
    cost: inv?.cost || {},
    // A sold car keeps its last known location. Prefer the live row; if that's
    // been wiped, fall back to the newest history event that names one. Either
    // fallback sets `last_known` so the UI can say "last seen at" rather than
    // claiming the car is sitting there right now.
    location: resolveLocation(loc, history),
    status,
    sale,
    history,
    // 5. First "main" photo + live marketplace (SmartAuction) listing link.
    media: await loadMedia(vehicle),
  }
}

// --- candidate gathering (partial VIN → possibly many cars) -----------------

const labelOf = (r) =>
  [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(' ') || null

// A chat-sourced location row: the Telegram/WhatsApp groups name cars by last 6
// only, so a car nobody has reconciled to inventory is stored as
// "unknown:<last 6>" with a blank VIN. 41% of vehicle_locations looks like this.
const CHAT_STOCK = /^unknown:/i
const isChatStock = (s) => CHAT_STOCK.test(s || '')
const chatLast6 = (s) => (s || '').replace(CHAT_STOCK, '').toUpperCase()

// 482 location rows literally say "unknown". That's not a place, it's the
// absence of one, so it must not block the last-known fallbacks the way a real
// location does — otherwise the car reports "Unknown" while the chat row next
// to it knows exactly where it sat.
const hasLocation = (v) => Boolean(v) && String(v).trim().toLowerCase() !== 'unknown'

// Fold chat-only rows into the real car when we can see they're the same
// vehicle. "unknown:334120" and stock 03-231-26 / VIN ...JG334120 are one car,
// and showing both in the picker makes it look like we own two. The chat row's
// stock is kept on the survivor as `chat_stock` — it's the row that still knows
// where the car physically was, which the real row often doesn't.
function mergeChatTwins(list) {
  const real = list.filter((c) => !isChatStock(c.stock_number))
  const out = [...real]
  for (const c of list.filter((c) => isChatStock(c.stock_number))) {
    const last6 = chatLast6(c.stock_number)
    const owner = real.find(
      (r) =>
        (r.vehicle_vin || '').toUpperCase().endsWith(last6) ||
        (r.last_6_vin || '').toUpperCase() === last6,
    )
    if (owner) {
      if (!owner.chat_stock) owner.chat_stock = c.stock_number
      continue
    }
    out.push({ ...c, last_6_vin: c.last_6_vin || last6, chat_stock: c.stock_number })
  }
  return out
}

// Every distinct car whose VIN CONTAINS vinQ anywhere, across inventory + the
// location table (so sold/removed cars surface too). Keyed by stock (stable id)
// when present, else by VIN, so the same car from two sources dedupes to one.
async function gatherCandidates(vinQ) {
  const map = new Map()
  const add = (vin, stock, label) => {
    const key = stock ? `S:${stock}` : `V:${vin || ''}`
    const prev = map.get(key)
    if (!prev) {
      map.set(key, {
        vehicle_vin: vin || null,
        stock_number: stock || null,
        last_6_vin: (vin || '').slice(-6) || null,
        label: label || null,
      })
    } else {
      if (!prev.vehicle_vin && vin) prev.vehicle_vin = vin
      if (!prev.last_6_vin && vin) prev.last_6_vin = vin.slice(-6)
      if (!prev.label && label) prev.label = label
    }
  }

  const { data: inv } = await supabase
    .from('vehicle_lot_status')
    .select('stock_number, vehicle_vin, last_6_vin, vehicle_year, vehicle_make, vehicle_model')
    .or(`last_6_vin.ilike.%${vinQ}%,vehicle_vin.ilike.%${vinQ}%`)
    .limit(25)
  for (const r of inv || []) add(r.vehicle_vin, r.stock_number, labelOf(r))

  const { data: locs } = await supabase
    .from('vehicle_locations')
    .select('stock_number, vin')
    .ilike('vin', `%${vinQ}%`)
    .limit(25)
  for (const r of locs || []) add(r.vin, r.stock_number, null)

  // Chat-sourced rows have a blank VIN, so the query above can never see them —
  // their last 6 lives in the stock number instead ("unknown:334120"). Without
  // this, a car the groups have been moving for months is unfindable by last 6,
  // and a sold car whose own row lost its location shows no location at all.
  const { data: byStock } = await supabase
    .from('vehicle_locations')
    .select('stock_number, vin')
    .ilike('stock_number', `%${vinQ}%`)
    .limit(25)
  for (const r of byStock || []) add(r.vin, r.stock_number, null)

  return mergeChatTwins([...map.values()])
}

// --- media (photo + marketplace link) --------------------------------------

async function loadMedia(v) {
  if (!v) return null
  const vin = v.vehicle_vin || null
  const last6 = v.last_6_vin || (vin ? vin.slice(-6) : null)
  const stock = v.stock_number || null
  const { data } = await supabase.rpc('vehicle_media', {
    p_vin: vin,
    p_last6: last6,
    p_stock: stock,
  })
  const row = data?.[0]
  if (!row) return null
  return { photo: row.first_photo || null, listingUrl: row.sa_url || null }
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
  else query = query.or(`last_6_vin.ilike.%${vinQ}%,vehicle_vin.ilike.%${vinQ}%`)
  const { data: vehicles, error } = await query.limit(5)

  if (!error && vehicles && vehicles.length) return await withCost(vehicles[0])

  // Fallback to the plain inventory table (view may be missing the car).
  // Named columns, not `*`: the money columns are revoked, so a `select=*` is
  // refused outright. Cost comes back through withCost() like every other path.
  let fb = supabase
    .from('inventory')
    .select('stock_number, vehicle_vin, last_6_vin, vehicle_year, vehicle_make, vehicle_model, vehicle_color, mileage, days_on_lot')
  if (vinQ.length === 17) fb = fb.eq('vehicle_vin', vinQ)
  else fb = fb.or(`last_6_vin.ilike.%${vinQ}%,vehicle_vin.ilike.%${vinQ}%`)
  const { data: rows } = await fb.limit(5)
  if (rows && rows.length) return await withCost(rows[0])

  return null
}

async function withCost(vehicle) {
  // Cost is masked unless the caller may see it — the RPC decides, not us.
  const { data: costRows } = await supabase
    .rpc('inventory_costs')
    .eq('stock_number', vehicle.stock_number)
    .limit(1)
  return { vehicle, cost: costRows?.[0] || {} }
}

// --- location / status lookup (covers sold + removed) ----------------------

async function findLocation(stockNumber, vinQ, last6) {
  let row = null
  if (stockNumber) {
    const { data } = await supabase
      .from('vehicle_locations')
      .select('*')
      .eq('stock_number', stockNumber)
      .limit(1)
    if (data && data.length) row = data[0]
  }
  if (!row) {
    // No inventory match — search vehicle_locations by VIN directly.
    let q = supabase.from('vehicle_locations').select('*')
    if (vinQ.length === 17) q = q.eq('vin', vinQ)
    else q = q.ilike('vin', `%${vinQ}%`)
    const { data } = await q.limit(1)
    row = data?.[0] || null
  }

  // A retired car's own row often has physical_location NULL — 78 rows are in
  // that state, 45 of them the legacy `sold_or_gone` import. The chat twin
  // ("unknown:<last 6>") was written by the Telegram groups and still knows
  // where the car physically sat, so borrow the location from it.
  if (!hasLocation(row?.physical_location) && last6) {
    const { data } = await supabase
      .from('vehicle_locations')
      .select('*')
      .eq('stock_number', `unknown:${last6}`)
      .limit(1)
    const twin = data?.[0]
    if (hasLocation(twin?.physical_location)) {
      row = row
        ? {
            ...row,
            physical_location: twin.physical_location,
            physical_source: twin.physical_source,
            location_updated_at: twin.location_updated_at || twin.updated_at,
            last_known: true,
          }
        : twin
    }
  }
  return row
}

// "Where is this car, and failing that, where was it last?" in priority order:
// the live row (already merged with its chat twin by findLocation), then the
// newest history event naming a place, then whatever the row said even if that
// was only "unknown" — so the Last Tracked timestamp still shows.
function resolveLocation(loc, history) {
  if (hasLocation(loc?.physical_location)) {
    return {
      physical_location: loc.physical_location,
      source: loc.physical_source,
      updated_at: loc.location_updated_at || loc.updated_at,
      last_known: Boolean(loc.last_known),
    }
  }
  const fromHistory = lastKnownFromHistory(history)
  if (fromHistory) return fromHistory
  if (!loc) return null
  return {
    physical_location: loc.physical_location || null,
    source: loc.physical_source,
    updated_at: loc.location_updated_at || loc.updated_at,
    last_known: false,
  }
}

// Last resort for "where was this car?": the newest history event that names a
// location. History outlives the car, so this still answers for a car whose
// location row was wiped and that never had a chat twin.
function lastKnownFromHistory(history) {
  const e = (history || []).find((h) => hasLocation(h.new_location))
  if (!e) return null
  return {
    physical_location: e.new_location,
    source: e.location_source || e.event_type,
    updated_at: e.created_at,
    last_known: true,
  }
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

  // `sold_or_gone` is a retired import (45 rows, all stamped Mar–Apr 2026, no
  // price or buyer). It carries no marketplace flag, so without this the car
  // came back as state "unknown" — which reads as "we lost it" rather than
  // "it's gone because we sold it".
  if (!marketplace && !soldEvent && loc?.physical_source === 'sold_or_gone') {
    return { status: { state: 'sold', marketplace: null }, sale: null }
  }

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
