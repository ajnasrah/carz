// Reserving a car from the public marketplace.
//
// Goes through /api/reserve-car rather than writing from here: reserving pulls
// the car off the marketplace, so a client that could do it directly could take
// any car off the market, or reserve one in somebody else's name. The endpoint
// resolves the buyer from their session token and decides everything itself.

import { supabase } from './supabase'
import { API_BASE_URL } from '../native/platform'

// Where to send someone who pressed Reserve without an account. Stashed in
// sessionStorage rather than a query string because the sign-in round trip is an
// SMS code — the user may finish it on a different tab, and a lost query param
// would drop them on a generic marketplace with no idea which car they wanted.
export function rememberReserveTarget(pathname) {
  try { sessionStorage.setItem('reserveAfterSignup', pathname) } catch { /* private mode */ }
}

export async function reserveCar(stockNumber, billingLocationId = null) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw Object.assign(new Error('Sign in to reserve a car'), { needsAuth: true })

  const res = await fetch(`${API_BASE_URL}/api/reserve-car`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ stock_number: stockNumber, billing_location_id: billingLocationId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw Object.assign(new Error(body?.error || `Could not reserve (${res.status})`), {
      // The endpoint refuses until the dealership and billing contact exist, and
      // says which are missing — that's a trip back to setup, not a failure.
      needsProfile: body?.needsProfile || null,
      // A buyer with several rooftops has to say which one to invoice. The
      // endpoint returns the list, so this is a question to ask, not an error.
      needsLocation: body?.needsLocation || null,
      alreadyYours: !!body?.alreadyYours,
      taken: res.status === 409,
    })
  }
  return body
}

// Is this car already spoken for, and was it us? Readable directly — the select
// policy on car_reservations covers your own rows, and admins see all of them.
export async function myReservation(stockNumber) {
  if (!stockNumber) return null
  const { data, error } = await supabase
    .from('car_reservations')
    .select('id, status, created_at, buyer_name, dealer_name')
    .eq('stock_number', stockNumber)
    .in('status', ['reserved', 'confirmed'])
    .limit(1)
  if (error) return null   // not signed in, or no visibility — treat as unknown
  return data?.[0] || null
}

// ---------------------------------------------------------------------------
// Owner side
// ---------------------------------------------------------------------------

// Every open reservation, newest first. Admin-only by RLS — a buyer reading this
// gets back their own rows and nothing else, which is what the marketplace uses
// to say "you reserved this".
export async function openReservations() {
  const { data, error } = await supabase
    .from('car_reservations')
    .select('id, stock_number, vin, buyer_name, dealer_name, buyer_phone, buyer_email, '
          + 'billing_name, billing_phone, billing_email, billing_location_label, billing_address, '
          + 'price, status, notified, notify_error, created_at')
    .in('status', ['reserved', 'confirmed'])
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

// Confirm keeps the car hidden (it is sold); release puts it back on the
// marketplace. Both happen in one statement server-side so a release can never
// half-apply and strand a car nobody can see.
export async function decideReservation(id, status) {
  const { error } = await supabase.rpc('decide_car_reservation', { p_id: id, p_status: status })
  if (error) throw new Error(error.message)
}
