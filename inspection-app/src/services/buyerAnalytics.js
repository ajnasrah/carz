// Buyer analytics for the SmartAuction "Buyers" view: monthly top-buyer series +
// per-buyer breakdowns across calendar periods (MTD / QTD / YTD / last 90d / last
// full year / all-time). Metric of record is CARS BOUGHT (count); dollars ride
// along as a secondary value for tooltips.
//
// Input: sa_sold_sales rows (one per VIN) with buyer_name / sale_date / sale_price.
// Calendar periods are anchored to the real calendar (today), since MTD/YTD are
// "to date" concepts — unlike the rolling momentum in buyerTrends.js.

import { buyerKey } from './buyerTrends'

const DAY = 86400000
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parseDay(iso) {
  if (!iso) return null
  const t = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z')
  return Number.isFinite(t) ? t : null
}
function todayUTC() {
  return Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
}
function monthKeyOf(t) {
  const d = new Date(t)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// Oldest→newest list of the last `n` calendar months ending at ref's month.
function monthList(refT, n) {
  const d = new Date(refT)
  const y = d.getUTCFullYear(), m = d.getUTCMonth()
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const t = Date.UTC(y, m - i, 1)  // Date.UTC rolls negative months into prior years
    const dd = new Date(t)
    out.push({
      key: `${dd.getUTCFullYear()}-${String(dd.getUTCMonth() + 1).padStart(2, '0')}`,
      label: `${MON[dd.getUTCMonth()]}${dd.getUTCMonth() === 0 || i === n - 1 ? ` '${String(dd.getUTCFullYear()).slice(2)}` : ''}`,
    })
  }
  return out
}

// Calendar-period ranges [start, end) as epoch ms, relative to ref (today).
function periodRanges(refT) {
  const d = new Date(refT), Y = d.getUTCFullYear(), M = d.getUTCMonth()
  const end = refT + DAY  // include today
  return {
    mtd: { label: 'MTD', start: Date.UTC(Y, M, 1), end },
    qtd: { label: 'QTD', start: Date.UTC(Y, Math.floor(M / 3) * 3, 1), end },
    ytd: { label: 'YTD', start: Date.UTC(Y, 0, 1), end },
    d90: { label: 'Last 90d', start: refT - 89 * DAY, end },
    lastYear: { label: 'Last Year', start: Date.UTC(Y - 1, 0, 1), end: Date.UTC(Y, 0, 1) },
    all: { label: 'All-time', start: -Infinity, end: Infinity },
  }
}
export const PERIOD_ORDER = ['mtd', 'qtd', 'ytd', 'd90', 'lastYear', 'all']

export function computeBuyerAnalytics(sold, { months = 12, topN = 6, refIso } = {}) {
  const refT = refIso ? parseDay(refIso) : todayUTC()
  const monthsArr = monthList(refT, months)
  const monthIndex = new Map(monthsArr.map((mo, i) => [mo.key, i]))
  const ranges = periodRanges(refT)
  const marketByMonth = monthsArr.map(() => ({ count: 0, spend: 0 }))
  const map = new Map()

  for (const r of sold) {
    const t = parseDay(r.sale_date)
    if (t == null) continue
    const key = buyerKey(r)
    if (!key) continue
    const price = Number(r.sale_price) || 0

    let b = map.get(key)
    if (!b) {
      b = {
        key, name: (r.buyer_name || '').trim(),
        email: r.buyer_email || null, phone: r.buyer_phone || null, state: r.buyer_state || null,
        total: 0, totalSpend: 0,
        byMonth: monthsArr.map(() => ({ count: 0, spend: 0 })),
        periodTotals: Object.fromEntries(PERIOD_ORDER.map((k) => [k, { count: 0, spend: 0 }])),
      }
      map.set(key, b)
    }
    b.total++; b.totalSpend += price

    const mi = monthIndex.get(monthKeyOf(t))
    if (mi != null) {
      b.byMonth[mi].count++; b.byMonth[mi].spend += price
      marketByMonth[mi].count++; marketByMonth[mi].spend += price
    }
    for (const rk of PERIOD_ORDER) {
      const rg = ranges[rk]
      if (t >= rg.start && t < rg.end) { b.periodTotals[rk].count++; b.periodTotals[rk].spend += price }
    }
  }

  const buyers = [...map.values()]
  for (const b of buyers) b.windowCount = b.byMonth.reduce((s, m) => s + m.count, 0)

  // Top buyers over the visible month window → fixed series for the stacked chart.
  // Color follows the ENTITY (assigned once here by rank), never repainted by filters.
  const topBuyers = buyers.filter((b) => b.windowCount > 0)
    .sort((a, b) => b.windowCount - a.windowCount).slice(0, topN)
  const usedIds = new Set()
  const seriesDefs = topBuyers.map((b, i) => {
    let id = b.name || b.key
    while (usedIds.has(id)) id += ' '  // disambiguate rare name collisions
    usedIds.add(id)
    return { id, name: b.name, key: b.key, colorIndex: i }
  })

  const monthlySeries = monthsArr.map((mo, i) => {
    const row = { month: mo.label, key: mo.key, _total: marketByMonth[i].count }
    let top = 0
    for (const sd of seriesDefs) { const c = map.get(sd.key).byMonth[i].count; row[sd.id] = c; top += c }
    row.Other = Math.max(0, marketByMonth[i].count - top)
    return row
  })

  // Per-period leaderboards.
  const periods = {}
  for (const rk of PERIOD_ORDER) {
    const list = buyers
      .map((b) => ({ key: b.key, name: b.name, state: b.state, email: b.email, phone: b.phone, ...b.periodTotals[rk] }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count || b.spend - a.spend)
    periods[rk] = {
      label: ranges[rk].label,
      totalCount: list.reduce((s, x) => s + x.count, 0),
      totalSpend: list.reduce((s, x) => s + x.spend, 0),
      buyerCount: list.length,
      buyers: list,
    }
  }

  return {
    asOf: new Date(refT).toISOString().slice(0, 10),
    months: monthsArr, monthlySeries, seriesDefs, marketByMonth,
    periods, periodOrder: PERIOD_ORDER,
    buyersByKey: map,
  }
}

// One buyer's monthly series (for the drill-down chart), oldest→newest.
export function buyerMonthlySeries(analytics, key) {
  const b = analytics.buyersByKey.get(key)
  if (!b) return []
  return analytics.months.map((mo, i) => ({ month: mo.label, key: mo.key, cars: b.byMonth[i].count, spend: b.byMonth[i].spend }))
}
