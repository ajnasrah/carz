// A buyer's rooftops — the places a car can be billed to.
//
// Read and written straight from the client, unlike reservations: these rows
// belong to the buyer, decide nothing on their own, and RLS pins profile_id to
// auth.uid() so one buyer can't file a location under another's account. It is
// only when a car is reserved that a location matters, and that goes through
// /api/reserve-car, which re-checks the location really belongs to the caller.
import { supabase } from './supabase'

export async function fetchBillingLocations(profileId) {
  if (!profileId) return []
  const { data, error } = await supabase
    .from('buyer_billing_locations')
    .select('id, label, address, city, state, zip, billing_name, billing_phone, billing_email, is_default')
    .eq('profile_id', profileId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

export async function addBillingLocation(profileId, loc) {
  const { data, error } = await supabase
    .from('buyer_billing_locations')
    .insert({
      profile_id: profileId,
      label: String(loc.label || '').trim(),
      address: loc.address?.trim() || null,
      city: loc.city?.trim() || null,
      state: loc.state?.trim() || null,
      zip: loc.zip?.trim() || null,
      billing_name: loc.billing_name?.trim() || null,
      billing_phone: loc.billing_phone?.trim() || null,
      billing_email: loc.billing_email?.trim() || null,
      is_default: !!loc.is_default,
    })
    .select('id, label, address, city, state, zip, billing_name, billing_phone, billing_email, is_default')
  if (error) throw new Error(error.message)
  return data?.[0] || null
}

export async function deleteBillingLocation(id) {
  const { error } = await supabase.from('buyer_billing_locations').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// "Brunswick — 120 Altama Ave, Brunswick, GA" — one line, for a picker or an
// invoice. The label alone is what the buyer recognises; the address is what
// makes it unambiguous when two stores are named after the same town.
export function locationLine(loc) {
  if (!loc) return ''
  const where = [loc.address, loc.city, loc.state].filter(Boolean).join(', ')
  return where ? `${loc.label} — ${where}` : loc.label
}
