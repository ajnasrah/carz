// Reading the text log.
//
// Read-only by design: sms_messages grants SELECT and nothing else, and every
// row is written by a cron or the Twilio webhook holding the service key. A
// browser that could write here could forge a reply from anyone on the crew.

import { supabase } from './supabase'

// A fortnight of texts at the current volume is a couple of hundred rows, well
// under the PostgREST 1000-row cap — but the limit is explicit rather than
// implied, because an unbounded select here would silently truncate the day the
// volume grows and the oldest threads would just quietly stop appearing.
const MAX_ROWS = 1000

export async function fetchMessages(limit = MAX_ROWS) {
  const { data, error } = await supabase
    .from('sms_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, MAX_ROWS))
  if (error) throw error
  return data || []
}

// Numbers are compared on their last ten digits. The same person is '+19015624361'
// from the checklist table and whatever Twilio chooses to hand back on an inbound
// message, and a thread that splits in two because of a '+1' is worse than useless.
export function keyOf(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10)
}

// One thread per person, newest thread first, messages inside oldest-first so it
// reads like a conversation rather than a log file.
export function toThreads(messages) {
  const threads = new Map()
  for (const m of messages) {
    const key = keyOf(m.phone)
    if (!key) continue
    if (!threads.has(key)) {
      threads.set(key, { key, phone: m.phone, name: null, messages: [], failed: 0, replies: 0 })
    }
    const t = threads.get(key)
    // Rows arrive newest-first, so the first named row wins — the most recent
    // name we have for this number, not the oldest one on file.
    if (!t.name && m.name) t.name = m.name
    if (m.status === 'failed') t.failed += 1
    if (m.direction === 'in') t.replies += 1
    t.messages.push(m)
  }
  return [...threads.values()]
    .map((t) => ({
      ...t,
      messages: [...t.messages].reverse(),
      last: t.messages[0],
    }))
    .sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at))
}

export function prettyPhone(e164) {
  const d = keyOf(e164)
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164 || ''
}

// "2:14 PM" for today, "Tue 2:14 PM" inside the last week, a date before that.
export function whenLabel(iso) {
  const d = new Date(iso)
  const now = new Date()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return time
  const days = (now - d) / 86400000
  if (days < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

// Twilio's failure text is a JSON blob with a code in it. The code is the part
// worth reading at a glance; the rest is for the console.
export function shortError(error) {
  if (!error) return ''
  const code = String(error).match(/"code"\s*:\s*(\d+)/)?.[1]
  const msg = String(error).match(/"message"\s*:\s*"([^"]+)"/)?.[1]
  if (code && msg) return `${msg} (${code})`
  return String(error).slice(0, 140)
}
