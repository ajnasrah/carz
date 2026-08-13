// Buying pace against selling pace — are we taking cars in faster than we move
// them out, week over week and month over month.
//
// Selling is the easy half: sold_clean.sale_date, one row per car that left.
//
// Buying is the awkward half, because there is no purchases table. A car we
// bought is in exactly one of two places:
//
//   * still on the lot  → inventory.purchase_date (Frazer's own field, MM/DD/YY)
//   * already gone      → sale_date − days_on_lot, which is Frazer's own
//                         arithmetic run backwards and lands on the buy date
//
// That union is COMPLETE for any window, which is the thing worth knowing: a
// car bought inside the window that has since sold must also have sold inside
// the window, because it cannot sell before we buy it. So one sold pull covers
// the sold half of the buys and the whole of the sells, and no buy goes
// uncounted just because the car turned quickly.
//
// Both reads go through selectAll — inventory is 350 rows today and the sold
// window is a couple of thousand, and an unbounded PostgREST select silently
// stops at 1000, which here would read as "we stopped buying in April".

import { supabase, selectAll } from './supabase'
import { mmddyyToIso } from './soldReports'

// Bar counts are chosen so the narrow phone card stays legible: 8 weekly
// columns fit at ~36px each, 6 monthly at ~50px. `lookbackDays` is how far the
// buy/sell history has to reach to fill that many complete periods.
export const PACE_MODES = [
  { key: 'week', label: 'Weekly', periods: 8, lookbackDays: 70 },
  { key: 'month', label: 'Monthly', periods: 6, lookbackDays: 200 },
]

export const PACE_MODE_KEY = 'dashPaceMode'

const MAX_LOOKBACK = Math.max(...PACE_MODES.map((m) => m.lookbackDays))

const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

// Local calendar date, not toISOString() — west of UTC that rolls the day back
// and drops a car into the previous week.
function toYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shiftDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00`)
  d.setDate(d.getDate() + days)
  return toYmd(d)
}

// Weeks run Monday→Sunday. A Sunday-start week splits the weekend, and the
// weekend is when most of the retail selling actually happens — half a sales
// push landing in each of two buckets would make the pace look smoother than
// it is.
export function periodStart(ymd, mode) {
  if (mode === 'month') return `${ymd.slice(0, 7)}-01`
  const d = new Date(`${ymd}T00:00:00`)
  return toYmd(new Date(d.setDate(d.getDate() - ((d.getDay() + 6) % 7))))
}

function prevPeriodStart(start, mode) {
  const d = new Date(`${start}T00:00:00`)
  if (mode === 'month') d.setMonth(d.getMonth() - 1)
  else d.setDate(d.getDate() - 7)
  return toYmd(d)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function periodLabel(start, mode) {
  const [, m, d] = start.split('-')
  return mode === 'month' ? MONTHS[Number(m) - 1] : `${Number(m)}/${Number(d)}`
}

// Spoken form for the hero line and the screen-reader label.
export function periodTitle(start, mode) {
  const [y, m, d] = start.split('-')
  return mode === 'month'
    ? `${MONTHS[Number(m) - 1]} ${y}`
    : `Week of ${MONTHS[Number(m) - 1]} ${Number(d)}`
}

// `buyer` is OUR buyer — the person who went and got the car — not the customer
// who took it off the lot. It sits on inventory and on the raw sold table, but
// not on the sold_clean view, so the sold side needs a stock_number → buyer map
// alongside. Two thin columns over the whole table beats chunked ?in=(…) joins
// across a 200-day window's worth of stock numbers.
export const UNASSIGNED = 'UNASSIGNED'
const buyerOf = (v) => String(v ?? '').trim().toUpperCase() || UNASSIGNED

// One fetch covers both modes; switching Weekly/Monthly re-buckets in memory,
// the same way the Inventory vs Sold window picker re-slices rather than
// round-trips.
export async function fetchBuySellPace() {
  const cutoff = shiftDays(toYmd(new Date()), -MAX_LOOKBACK)

  const [invRows, soldRows, buyerRows] = await Promise.all([
    selectAll(() => supabase.from('inventory').select('stock_number, purchase_date, buyer')),
    selectAll(() =>
      supabase
        .from('sold_clean')
        .select('stock_number, sale_date, days_on_lot')
        .gte('sale_date', cutoff),
    ),
    selectAll(() => supabase.from('sold').select('stock_number, buyer')),
  ])

  const soldBuyer = new Map(buyerRows.map((r) => [r.stock_number, r.buyer]))

  const buys = []
  const sells = []
  let undatedBuys = 0

  for (const r of invRows) {
    const iso = mmddyyToIso(r.purchase_date)
    if (isYmd(iso)) buys.push({ d: iso, buyer: buyerOf(r.buyer) })
    else undatedBuys += 1
  }

  for (const r of soldRows) {
    const sale = String(r.sale_date || '').slice(0, 10)
    if (!isYmd(sale)) continue
    const buyer = buyerOf(soldBuyer.get(r.stock_number))
    sells.push({ d: sale, buyer })
    // No days_on_lot means no way back to the buy date. Counted rather than
    // dropped in silence — a pace chart that quietly omits cars reads as a
    // slowdown that never happened.
    const dol = Number(r.days_on_lot)
    if (Number.isFinite(dol) && dol >= 0) buys.push({ d: shiftDays(sale, -Math.round(dol)), buyer })
    else undatedBuys += 1
  }

  return { buys, sells, undatedBuys }
}

// → [{ start, label, title, bought, sold, net, current }] oldest first, the
// last entry being the period we're currently inside (and therefore partial).
export function bucketPace(pace, mode) {
  const spec = PACE_MODES.find((m) => m.key === mode) || PACE_MODES[0]
  const today = toYmd(new Date())

  const starts = []
  for (let s = periodStart(today, mode), i = 0; i < spec.periods; i++, s = prevPeriodStart(s, mode)) {
    starts.unshift(s)
  }

  const rows = starts.map((start) => ({
    start,
    label: periodLabel(start, mode),
    title: periodTitle(start, mode),
    bought: 0,
    sold: 0,
    byBuyer: new Map(),
  }))
  const slot = new Map(starts.map((s, i) => [s, i]))

  const tally = (row, buyer, field) => {
    let b = row.byBuyer.get(buyer)
    if (!b) { b = { buyer, bought: 0, sold: 0 }; row.byBuyer.set(buyer, b) }
    b[field] += 1
  }

  if (pace) {
    for (const { d, buyer } of pace.buys) {
      const i = slot.get(periodStart(d, mode))
      if (i == null) continue
      rows[i].bought += 1
      tally(rows[i], buyer, 'bought')
    }
    for (const { d, buyer } of pace.sells) {
      const i = slot.get(periodStart(d, mode))
      if (i == null) continue
      rows[i].sold += 1
      tally(rows[i], buyer, 'sold')
    }
  }

  return rows.map((r, i) => ({
    ...r,
    net: r.bought - r.sold,
    current: i === rows.length - 1,
    // Worst offender first: whoever is putting the most cars on the lot beyond
    // what came off it. Ties break on volume so a busy buyer sitting at even
    // outranks a quiet one, and the name breaks the rest so the order is stable
    // between renders rather than shuffling on every hover.
    buyers: [...r.byBuyer.values()]
      .map((b) => ({ ...b, net: b.bought - b.sold }))
      .sort((a, b) =>
        b.net - a.net ||
        (b.bought + b.sold) - (a.bought + a.sold) ||
        a.buyer.localeCompare(b.buyer)),
  }))
}
