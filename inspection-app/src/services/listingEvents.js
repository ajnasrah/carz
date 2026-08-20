// Demand logging.
//
// Until now nothing anywhere recorded what a buyer was looking for. The
// marketplace search box was React state and the filters were React state, so
// the only thing Buyer Match could reason about was a completed sale — and 28%
// of our SmartAuction sales go to someone who had never bought from us before,
// which means the system was structurally blind to the people most worth
// calling.
//
// Every function here is fire-and-forget. A logging failure must never be
// visible to someone shopping for a car.
import { supabase } from './supabase'

const SESSION_STORAGE_KEY = 'carz_session_key'

// Anonymous and browser-local. Enough to join one visitor's searches into a
// session, not enough to identify anyone.
export function sessionKey() {
  try {
    let k = localStorage.getItem(SESSION_STORAGE_KEY)
    if (!k) {
      k = (crypto?.randomUUID?.() || `s${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/-/g, '')
      localStorage.setItem(SESSION_STORAGE_KEY, k)
    }
    return k
  } catch {
    // Private mode, or storage disabled. Log the event without a session.
    return null
  }
}

function send(event_type, payload = {}) {
  try {
    supabase.rpc('log_listing_event', {
      p_event_type: event_type,
      p_session_key: sessionKey(),
      p_stock_number: payload.stock_number ?? null,
      p_vin: payload.vin ?? null,
      p_query: payload.query ?? null,
      p_filters: payload.filters ?? null,
      p_result_count: payload.result_count ?? null,
      p_source: payload.source ?? null,
      p_buyer_key: payload.buyer_key ?? null,
    }).then(() => {}, () => {})
  } catch { /* never surface a logging failure */ }
}

// A search is only meaningful once someone stops typing, so the caller debounces
// and we drop the one- and two-character prefixes that are just keystrokes.
export function logSearch(query, resultCount, source = 'marketplace') {
  const q = String(query || '').trim()
  if (q.length < 3) return
  send('search', { query: q, result_count: resultCount, source })
}

export function logFilter(filters, resultCount, source = 'marketplace') {
  const clean = Object.fromEntries(
    Object.entries(filters || {}).filter(([, v]) => (Array.isArray(v) ? v.length : v != null && v !== '')),
  )
  if (!Object.keys(clean).length) return
  send('filter', { filters: clean, result_count: resultCount, source })
}

export function logListingView(car, source = 'marketplace', buyerKey = null) {
  if (!car) return
  send('listing_view', {
    stock_number: car.stock_number ?? null,
    vin: car.full_vin || car.vin || null,
    source,
    buyer_key: buyerKey,
  })
}

// A car opened from inside a list we sent someone. This one carries a known
// buyer, which is what makes it worth more than an anonymous browse.
export function logShareView(car, buyerKey) {
  if (!car) return
  send('share_view', {
    stock_number: car.stock_number ?? null,
    vin: car.vin || null,
    source: 'share_list',
    buyer_key: buyerKey || null,
  })
}

export function logReserve(car, buyerKey) {
  send('reserve', {
    stock_number: car?.stock_number ?? null,
    vin: car?.vin || car?.full_vin || null,
    source: 'marketplace',
    buyer_key: buyerKey || null,
  })
}
