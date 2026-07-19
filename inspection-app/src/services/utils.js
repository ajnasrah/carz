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

// Human-friendly relative time for a timestamp string, e.g. "3 days ago",
// "5 hours ago", "just now". Returns '' for missing/invalid input.
export function timeAgo(dateStr) {
  if (!dateStr) return ''
  const then = new Date(dateStr).getTime()
  if (!Number.isFinite(then)) return ''
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.floor(days / 365)
  return `${years} year${years === 1 ? '' : 's'} ago`
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
