// Shared utility functions used across multiple pages

export function toInt(v) {
  if (!v) return 0
  const n = parseInt(String(v).replace(/,/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

export function toMoney(v) {
  const n = toInt(v)
  if (!n) return '—'
  return n < 0 ? `-$${Math.abs(n).toLocaleString()}` : `$${n.toLocaleString()}`
}

export function countDamages(checklist) {
  let count = 0
  const exterior = checklist?.exterior || {}
  const interior = checklist?.interior || {}
  Object.values(exterior).forEach((panel) => {
    count += panel.damages?.length || 0
  })
  Object.values(interior).forEach((zone) => {
    count += zone.damages?.length || 0
  })
  return count
}
