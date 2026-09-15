// The buyer book. Two staff-only calls: the list, and one buyer's whole record.
//
// Everything here already existed in pieces — purchases in buyer_training_rows()
// (every channel, not just SmartAuction), texts in sms_messages, pitches in
// buyer_pitches, queue offers in outreach_offers, do-not-text in
// outreach_opt_outs. This is the one place they are read together.
import { supabase } from './supabase'

// All of them by default: 652 buyers is one small page, and a book you have to
// search before it shows anything is a search box, not a book.
export async function fetchBuyers(q = '', limit = 1000) {
  const { data, error } = await supabase.rpc('buyer_crm_list', { p_q: q || null, p_limit: limit })
  if (error) throw new Error(error.message)
  return (data || []).map((b) => ({
    ...b,
    spend_365: b.spend_365 == null ? 0 : Number(b.spend_365),
    channels: b.channels || [],
  }))
}

export async function fetchBuyer(key) {
  const { data, error } = await supabase.rpc('buyer_crm_detail', { p_key: key })
  if (error) throw new Error(error.message)
  if (!data) return null
  return {
    ...data,
    purchases: data.purchases || [],
    texts: data.texts || [],
    // One list, because "what have we put in front of him" is one question:
    // a Text tap on the marketplace and a queued outreach text both count.
    contacts: [
      ...(data.pitches || []).map((p) => ({ ...p, kind: 'pitch', at: p.pitched_at })),
      ...(data.offers || []).map((o) => ({ ...o, kind: 'offer', at: o.created_at })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at))),
  }
}

export const money = (n) => {
  const v = Number(n)
  return Number.isFinite(v) && v !== 0 ? `$${Math.round(v).toLocaleString()}` : '—'
}

export function sinceLabel(date) {
  if (!date) return 'never'
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
