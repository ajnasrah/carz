// Buyer Outreach, client side. Everything goes through /api/outreach: the
// tables hold buyer phones and have no policies, and every action here texts a
// customer, so the browser only ever asks.

import { supabase } from './supabase'
import { API_BASE_URL } from '../native/platform'

export async function outreachCall(action, payload = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sign in again')
  const res = await fetch(`${API_BASE_URL}/api/outreach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Outreach failed (${res.status})`)
  return body
}

export const OFFER_LABEL = {
  sending: 'Sending',
  sent: 'Texted',
  replied: 'Replied',
  expired: 'No reply',
  failed: 'Did not send',
  cancelled: 'Cancelled',
  sold: 'Bought it',
  opted_out: 'Opted out',
}

export const CAR_LABEL = {
  queued: 'In line',
  waiting: 'Waiting on buyer',
  paused: 'Buyer replied',
  exhausted: 'No taker',
  sold: 'Sold',
  stopped: 'Stopped',
}

// Group the flat board into one object per car, with its lineup and texts.
export function shapeBoard(board) {
  if (!board) return { needsYou: [], active: [], done: [] }
  const cands = new Map(), offers = new Map()
  for (const c of board.candidates || []) {
    if (!cands.has(c.car_id)) cands.set(c.car_id, [])
    cands.get(c.car_id).push(c)
  }
  for (const o of board.offers || []) {
    if (!offers.has(o.car_id)) offers.set(o.car_id, [])
    offers.get(o.car_id).push(o)
  }
  const threads = new Map()
  for (const m of board.threads || []) {
    if (!threads.has(m.phone10)) threads.set(m.phone10, [])
    threads.get(m.phone10).push(m)
  }
  const cars = (board.cars || []).map((car) => {
    const lineup = cands.get(car.id) || []
    const texts = offers.get(car.id) || []
    const byPhone = new Map(texts.map((o) => [o.phone, o]))
    const open = texts.filter((o) => o.status === 'sent' || o.status === 'sending')
    const replied = texts.filter((o) => o.status === 'replied' && !o.resolved_at)
    const counted = texts.filter((o) => o.status !== 'failed').length
    return {
      ...car,
      lineup: lineup.map((c) => ({ ...c, offer: byPhone.get(c.phone) || null })),
      offers: texts,
      open,
      replied,
      counted,
      threadFor: (phone) => threads.get(phone) || [],
    }
  })
  return {
    needsYou: cars.filter((c) => c.status === 'paused'),
    active: cars.filter((c) => c.status === 'queued' || c.status === 'waiting'),
    done: cars.filter((c) => ['exhausted', 'sold', 'stopped'].includes(c.status)),
  }
}

export const money = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? `$${Math.round(n).toLocaleString()}` : '-'
}

export const carName = (c) => [c.year, c.make, c.model, c.trim].filter(Boolean).join(' ') || c.vin

export function prettyPhone(p) {
  const d = String(p || '').replace(/\D/g, '').slice(-10)
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p || ''
}

export function timeLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const today = d.toDateString() === new Date().toDateString()
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return today ? t : `${d.toLocaleDateString([], { weekday: 'short' })} ${t}`
}

// "12m left", "until 8:15 AM" once it crosses into tomorrow's hours.
export function deadlineLabel(iso, now = Date.now()) {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return 'time is up'
  const mins = Math.ceil(ms / 60000)
  return mins <= 45 ? `${mins}m left` : `until ${timeLabel(iso)}`
}
