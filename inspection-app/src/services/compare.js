// The comparison the dashboard's Inventory-vs-Sold box runs, factored out so
// anything else can be held up against a baseline the same way.
//
// The rules that make it readable are all here: which cars count toward an
// average, and what "worse" means for each number. Recon spend and days on lot
// are averaged the way the Inventory page averages them, so every figure in the
// app agrees with every other one.

export const num = (v) => Number(String(v ?? 0).replace(/[^0-9.-]/g, '')) || 0

// `get` maps a row to { added, days, cost, profit } — whichever it has.
// added_costs is averaged over the cars that actually had recon done (>0);
// counting the untouched ones as zero would drag the number toward nothing and
// stop matching the Inventory page's Avg Add tile.
export function averages(rows, get) {
  let addSum = 0, addN = 0
  let daySum = 0, dayN = 0
  let costSum = 0, costN = 0
  let profitSum = 0, profitN = 0
  for (const r of rows) {
    const { added, days, cost, profit } = get(r)
    const a = num(added)
    if (a > 0) { addSum += a; addN += 1 }
    if (days != null && days !== '') { daySum += num(days); dayN += 1 }
    const c = num(cost)
    if (c > 0) { costSum += c; costN += 1 }
    if (profit != null && profit !== '') { profitSum += num(profit); profitN += 1 }
  }
  return {
    count: rows.length,
    avgAdded: addN ? Math.round(addSum / addN) : null,
    avgDays: dayN ? Math.round(daySum / dayN) : null,
    avgCost: costN ? Math.round(costSum / costN) : null,
    avgProfit: profitN ? Math.round(profitSum / profitN) : null,
    totalProfit: profitN ? Math.round(profitSum) : null,
  }
}

// Split rows by whatever names them — a buyer, a vendor — and average each
// group, plus everyone together as the line to read them against.
//
// minCount exists because a buyer with one car has an "average" that's just
// that car; those rows make the table look busy and say nothing.
export function compareGroups(rows, { keyOf, get, minCount = 1 }) {
  const groups = new Map()
  for (const r of rows) {
    const key = String(keyOf(r) ?? '').trim() || 'UNASSIGNED'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  const out = []
  let hiddenCars = 0
  for (const [label, list] of groups) {
    if (list.length < minCount) { hiddenCars += list.length; continue }
    out.push({ label, ...averages(list, get) })
  }
  out.sort((a, b) => b.count - a.count)
  return { baseline: averages(rows, get), groups: out, hiddenCars }
}

// What each column means, and which direction is bad. Recon spend and age above
// the pack are warnings; profit above the pack is the opposite; what a car cost
// has no honest good or bad direction, so it stays uncoloured.
export const COMPARE_COLUMNS = [
  { key: 'avgAdded', label: 'Avg Add', kind: 'money', worse: 'higher' },
  { key: 'avgDays', label: 'Avg Age', kind: 'days', worse: 'higher' },
  { key: 'avgCost', label: 'Avg Cost', kind: 'money', worse: null },
  { key: 'avgProfit', label: 'Avg Profit', kind: 'money', worse: 'lower' },
]
