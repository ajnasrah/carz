// Buyer performance trends: bucket each buyer's purchases into rolling 30-day
// periods (period 0 = most recent) so we can see who is buying MORE or LESS over
// time. Feeds the "Buyers" view on the Buyer Match page.
//
// Input rows come from sa_sold_sales (via fetchSoldSales) — one row per VIN with
// buyer_name / sale_date / sale_price. Anchored to the most recent sale in the
// data (not literal "today") so it stays meaningful even if uploads lag a day.

const DAY = 86400000

// Parse an ISO 'YYYY-MM-DD' sale_date to a UTC epoch (ms). null if unparseable.
function parseDay(iso) {
  if (!iso) return null
  const t = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z')
  return Number.isFinite(t) ? t : null
}

// Stable buyer identity — phone → email → name. MUST mirror the GHL edge
// function so a buyer is counted as one entity across sales.
export function buyerKey(r) {
  const digits = String(r.buyer_phone || '').replace(/\D/g, '')
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (ten.length === 10) return `p:${ten}`
  const email = String(r.buyer_email || '').trim().toLowerCase()
  if (email.includes('@') && email.length > 3) return `e:${email}`
  const name = String(r.buyer_name || '').trim().toLowerCase().replace(/\s+/g, ' ')
  return name ? `n:${name}` : null
}

// Human labels for each period index (0 = most recent window).
export function periodLabels(periods, periodDays) {
  return Array.from({ length: periods }, (_, i) =>
    i === 0 ? `0–${periodDays}d` : `${i * periodDays}–${(i + 1) * periodDays}d`)
}

// Percent change of the most recent window vs the prior one, guarding /0.
function pctChange(last, prev) {
  if (prev > 0) return Math.round(((last - prev) / prev) * 100)
  return last > 0 ? 100 : 0
}

export function computeBuyerTrends(sold, { periodDays = 30, periods = 6 } = {}) {
  const span = periodDays * DAY
  const emptyPeriods = () => Array.from({ length: periods }, () => ({ count: 0, spend: 0 }))

  // Anchor to the newest sale in the dataset so period 0 is the latest real window.
  let maxT = null
  for (const r of sold) {
    const t = parseDay(r.sale_date)
    if (t != null && (maxT == null || t > maxT)) maxT = t
  }
  if (maxT == null) {
    return { asOf: null, periodDays, periods, market: emptyPeriods(), buyers: [], activeCount: 0, upCount: 0, downCount: 0 }
  }
  const anchor = maxT + DAY  // maxT falls inside period 0

  const market = emptyPeriods()
  const map = new Map()

  for (const r of sold) {
    const t = parseDay(r.sale_date)
    if (t == null) continue
    const idx = Math.floor((anchor - t) / span)  // 0 = most recent
    if (idx < 0 || idx >= periods) continue
    const key = buyerKey(r)
    if (!key) continue
    const price = Number(r.sale_price) || 0

    let b = map.get(key)
    if (!b) {
      b = {
        key, buyer_name: (r.buyer_name || '').trim(),
        buyer_email: r.buyer_email || null, buyer_phone: r.buyer_phone || null,
        buyer_state: r.buyer_state || null,
        periods: emptyPeriods(), total: 0, totalSpend: 0,
      }
      map.set(key, b)
    }
    b.periods[idx].count++
    b.periods[idx].spend += price
    b.total++
    b.totalSpend += price
    market[idx].count++
    market[idx].spend += price
  }

  const buyers = [...map.values()].map((b) => {
    const last = b.periods[0]
    const prev = b.periods[1]
    const deltaCount = last.count - prev.count
    // Categorize momentum for the badge.
    let trend = 'flat'
    if (last.count > 0 && prev.count === 0) trend = 'new'          // started / returned
    else if (last.count === 0 && prev.count > 0) trend = 'cooling' // stopped buying
    else if (deltaCount > 0) trend = 'up'
    else if (deltaCount < 0) trend = 'down'
    return {
      ...b,
      last30: last.count, prev30: prev.count, last30Spend: last.spend,
      deltaCount, deltaPct: pctChange(last.count, prev.count), trend,
    }
  })
  // Rank by recent activity, then lifetime volume.
  buyers.sort((a, b) => b.last30 - a.last30 || b.total - a.total)

  const activeCount = buyers.filter((b) => b.last30 > 0 || b.prev30 > 0).length
  const upCount = buyers.filter((b) => b.trend === 'up' || b.trend === 'new').length
  const downCount = buyers.filter((b) => b.trend === 'down' || b.trend === 'cooling').length

  return {
    asOf: new Date(maxT).toISOString().slice(0, 10),
    periodDays, periods, market, buyers, activeCount, upCount, downCount,
  }
}
