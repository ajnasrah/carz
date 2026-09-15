// "Upload inventory list" on Walk Lot: pictures of an auction's inventory in,
// car locations out.
//
// api/auction-list-read.js reads each picture and says what cars are on it. It
// never decides which are OURS — that happens here, against inventory, and
// nothing is written until the walker taps Update. The model reads characters;
// inventory is the judge. Same split as the wash-line key tags (api/_lib/keytag.js).
//
// Matching is deliberately strict, because a picture of an auction's run list
// shows every seller's cars and a loose match marks somebody else's car as ours:
//   found  — the full VIN matches a car we own, exactly or with ONE character
//            misread. Two real VINs one character apart would also need the
//            same check digit, so a 1-off hit is the misread, not another car.
//            Ticked by default.
//   check  — a VIN fragment or stock number that lands on exactly one car whose
//            make/model agree with the row. Likely ours, NOT ticked: the walker
//            looks before it moves. Last-6 alone collides across sellers.
//   notFound — everything else.

import { supabase } from './supabase'
import { isSamePlace } from './locationLabels'
import { API_BASE_URL } from '../native/platform'

// ---------------------------------------------------------------- images

// Phone photos are 4-12 MB. Shrink to something that uploads on one bar of
// signal but keeps VIN characters legible, and re-encode as JPEG so HEIC and
// friends arrive as a type the API accepts.
const MAX_EDGE = 2400

export async function prepareImage(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error(`Could not open ${file.name || 'image'}`))
      el.src = url
    })
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'           // transparent PNG screenshots → white, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
    return { media_type: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Read one picture. Returns { vehicles[], note }.
export async function readInventoryImage(file, auctionName) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Sign in again')

  const { media_type, data } = await prepareImage(file)
  const res = await fetch(`${API_BASE_URL}/api/auction-list-read`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ image: data, media_type, auction: auctionName }),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error || `Read failed (${res.status})`)
  return out
}

// ---------------------------------------------------------------- matching

// VINs have no I, O or Q — a read one is a 1 or a 0.
export function cleanVin(s) {
  return String(s || '').toUpperCase()
    .replace(/I/g, '1').replace(/[OQ]/g, '0')
    .replace(/[^A-HJ-NPR-Z0-9]/g, '')
}

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// Make and model must not contradict. Auction lists abbreviate ("CHEV",
// "VOLK"), so it's a 4-character prefix test either way round.
function describes(read, car) {
  const overlaps = (a, b) => {
    a = norm(a); b = norm(b)
    if (!a || !b) return true
    return a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4))
  }
  return overlaps(read.make, car.vehicle_make) && overlaps(read.model, car.vehicle_model)
}

// Does the row actually SAY a make or model? A fragment agreeing with nothing
// written is not corroboration.
const hasDescription = (read) => !!(norm(read.make) || norm(read.model))

function oneOff(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false
  return diff === 1
}

const carLabel = (c) => [c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ')
const readLabel = (r) => [r.year, r.make, r.model].filter(Boolean).join(' ')

function matchOne(read, inventory, byVin, byStock) {
  const vin = cleanVin(read.vin)

  if (vin.length === 17) {
    const exact = byVin.get(vin)
    if (exact) return { kind: 'found', car: exact, how: 'VIN' }
    const near = inventory.filter((c) => oneOff(vin, cleanVin(c.vehicle_vin)))
    if (near.length === 1) return { kind: 'found', car: near[0], how: 'VIN (1 character misread)' }
  }

  // A fragment: the list only shows part of the VIN, or the full read missed
  // by more than one character. Try the last 8, then the last 6.
  if (vin.length >= 6 && hasDescription(read)) {
    for (const n of [8, 6]) {
      if (vin.length < n) continue
      const tail = vin.slice(-n)
      const hits = inventory.filter((c) => cleanVin(c.vehicle_vin).endsWith(tail) && describes(read, c))
      if (hits.length === 1) {
        return { kind: 'check', car: hits[0], how: `last ${n} of VIN + ${readLabel(read)}` }
      }
      if (hits.length) break          // two of our cars fit — don't guess
    }
  }

  // Stock number with no VIN to contradict it. Other sellers' stock numbers
  // can be ours by coincidence, so it needs the description too.
  const stock = norm(read.stock_number)
  if (stock && !vin) {
    const car = byStock.get(stock)
    if (car && hasDescription(read) && describes(read, car)) {
      return { kind: 'check', car, how: `stock # + ${readLabel(read)}` }
    }
  }

  return { kind: 'notFound' }
}

// Every read from every picture → three lists, deduped across pictures so
// overlapping screenshots don't count a car twice.
export function matchReads(reads, inventory) {
  const byVin = new Map()
  const byStock = new Map()
  for (const c of inventory) {
    const v = cleanVin(c.vehicle_vin)
    if (v.length === 17) byVin.set(v, c)
    if (c.stock_number) byStock.set(norm(c.stock_number), c)
  }

  const matched = new Map()           // stock_number → entry (found beats check)
  const notFound = new Map()
  for (const read of reads) {
    const m = matchOne(read, inventory, byVin, byStock)
    if (m.kind === 'notFound') {
      const key = cleanVin(read.vin) || norm(read.stock_number) || norm(readLabel(read))
      if (key && !notFound.has(key)) {
        notFound.set(key, { vin: cleanVin(read.vin) || null, stock_number: read.stock_number || null, label: readLabel(read) })
      }
      continue
    }
    const prev = matched.get(m.car.stock_number)
    if (!prev || (prev.kind === 'check' && m.kind === 'found')) {
      matched.set(m.car.stock_number, { kind: m.kind, how: m.how, car: m.car, label: carLabel(m.car) })
    }
  }

  const all = [...matched.values()]
  return {
    found: all.filter((e) => e.kind === 'found'),
    check: all.filter((e) => e.kind === 'check'),
    notFound: [...notFound.values()],
  }
}

// ---------------------------------------------------------------- reading locations

// Current physical_location for a set of stocks. Chunked: a long `in` list
// blows the URL length before it hits the row cap.
export async function fetchLocations(stocks) {
  const out = new Map()
  for (let i = 0; i < stocks.length; i += 150) {
    const { data, error } = await supabase
      .from('vehicle_locations')
      .select('stock_number, physical_location')
      .in('stock_number', stocks.slice(i, i + 150))
    if (error) throw error
    for (const r of data || []) out.set(r.stock_number, r.physical_location)
  }
  return out
}

// Cars we already have marked at this auction. Whatever of these the pictures
// didn't show is worth a look — sold, moved, or just not in the screenshots.
export async function fetchCarsAtLocation(location) {
  const { data, error } = await supabase
    .from('vehicle_locations')
    .select('stock_number')
    .eq('physical_location', location)
    .range(0, 999)
  if (error) throw error
  return (data || []).map((r) => r.stock_number)
}

// ---------------------------------------------------------------- writing

// Mark the confirmed cars at the auction.
//
// A car already marked there is NOT rewritten: location_updated_at is how long
// it has stood at that auction, and restamping it on every upload hides the
// car that's been sitting at a yard for three weeks.
export async function applyAuctionLocations({ cars, location, auctionName, imageCount }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated — sign in first')

  const current = await fetchLocations(cars.map((c) => c.stock_number))
  const moves = cars.filter((c) => !isSamePlace(current.get(c.stock_number), location))
  const now = new Date().toISOString()

  if (moves.length) {
    const { error } = await supabase.from('vehicle_locations').upsert(
      moves.map((c) => ({
        stock_number: c.stock_number,
        vin: c.vehicle_vin || '',
        physical_location: location,
        physical_source: 'auction_photo',
        location_updated_at: now,
        updated_at: now,
        notes: { auction_photo: true, auction: auctionName, images: imageCount, uploaded_by: user.id },
      })),
      { onConflict: 'stock_number' },
    )
    if (error) throw error
  }
  return { moved: moves.length, alreadyThere: cars.length - moves.length }
}
