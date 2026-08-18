// Shared buyer lists — create one, read one back.
//
// Both sides go through SECURITY DEFINER functions rather than the table:
// creating is employees-only (a buyer signed into the marketplace must not be
// able to mint pages), and reading is open to anon by design, because the whole
// point is that a buyer opens the link without an account. The table itself
// stays unreachable, so knowing one slug doesn't let anyone enumerate what we
// quoted every other buyer.
import { supabase } from './supabase'

export async function createBuyerShareList({ buyerName, buyerKey, email, phone, vins, note }) {
  const { data, error } = await supabase.rpc('create_buyer_share_list', {
    p_buyer_name: buyerName,
    p_vins: vins,
    p_buyer_key: buyerKey ?? null,
    p_buyer_email: email ?? null,
    p_buyer_phone: phone ?? null,
    p_note: note ?? null,
  })
  if (error) throw new Error(error.message)
  return data                                  // the slug
}

// Returns { buyer_name, note, created_at, cars: [...] }, or null when the slug
// is unknown. A list whose cars have all sold comes back with an empty `cars`
// rather than a 404 — that difference is what lets the page say "these are gone"
// instead of "this link is wrong".
export async function fetchBuyerShareList(slug) {
  const { data, error } = await supabase.rpc('buyer_share_list', { p_slug: slug })
  if (error) throw new Error(error.message)
  if (!data || !data.length) return null
  const { buyer_name, note, created_at } = data[0]
  return {
    buyer_name,
    note,
    created_at,
    cars: data.map((r) => ({
      vin: r.vin,
      year: r.year,
      make: r.make,
      model: r.model,
      trim: r.trim,
      odometer: r.odometer,
      color: r.color,
      buy_now: r.buy_now == null ? null : Number(r.buy_now),
      detail_url: r.detail_url,
      listing_id: r.listing_id,
    })),
  }
}

// Fire-and-forget. Never let a counter failure break the page a buyer is trying
// to read.
export function markBuyerShareListOpened(slug) {
  supabase.rpc('buyer_share_list_opened', { p_slug: slug }).then(() => {}, () => {})
}
