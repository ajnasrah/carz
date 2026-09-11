// Reading and editing the daily checklist texts.
//
// Written straight through PostgREST rather than an endpoint: unlike reserving a
// car, there is nothing here a client could decide wrongly. Every policy on
// sms_checklists is gated on is_admin(), so a non-admin session — a buyer, an
// inspector — reads an empty list and writes nothing. The database is the gate;
// the screen only hides what the database would refuse anyway.

import { supabase } from './supabase'

const NOT_ADMIN = 'Nothing changed - your account may not have admin rights in the database'

export const DAYS = [
  { iso: 1, label: 'Mon' },
  { iso: 2, label: 'Tue' },
  { iso: 3, label: 'Wed' },
  { iso: 4, label: 'Thu' },
  { iso: 5, label: 'Fri' },
  { iso: 6, label: 'Sat' },
  { iso: 7, label: 'Sun' },
]

export const WEEKDAYS = [1, 2, 3, 4, 5]

export async function fetchChecklists() {
  const { data, error } = await supabase
    .from('sms_checklists')
    .select('*')
    .order('send_at')
  if (error) throw error
  return data || []
}

// The roster to pick a person from. Typing a phone number by hand is how a
// reminder ends up going to a stranger every morning, so the screen offers the
// people who already have accounts and only falls back to typing.
export async function fetchStaff() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, phone, role')
    .order('name')
  if (error) throw error
  return (data || []).filter((p) => p.name && p.phone)
}

// profiles stores '19018319661'; Twilio needs '+19018319661'. Anything already
// in E.164 passes through untouched.
export function toE164(phone) {
  const d = String(phone || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return `+${d}`
}

export function prettyPhone(e164) {
  const d = String(e164 || '').replace(/\D/g, '').replace(/^1/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164 || ''
}

// '16:30:00' -> '4:30 PM'. What the crew's phone will say, not what Postgres stores.
export function prettyTime(time) {
  const [h, m] = String(time || '').split(':')
  const hour = Number(h)
  if (Number.isNaN(hour)) return time || ''
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${m} ${ampm}`
}

// Exactly what the cron will build, so the screen can show the real text rather
// than a description of it. Kept in step with buildMessage() in api/sms-checklist.js.
export function previewMessage({ name, items }) {
  const list = (items || []).map((s) => String(s).trim()).filter(Boolean)
  if (!list.length) return ''
  const head = `Carz Inc - ${name || 'Name'}:`
  if (list.length === 1) return `${head}\n${list[0]}`
  return [head, ...list.map((s, i) => `${i + 1}. ${s}`)].join('\n')
}

// A text is billed per 160-character segment — 70 if it carries anything outside
// the GSM alphabet, and one em dash or curly quote pasted from a document is
// enough to do it. Shown on the editor so a list quietly costing four texts a
// day is visible while it's being written, not on the Twilio invoice.
export function segments(text) {
  const len = (text || '').length
  if (!len) return 0
  const unicode = /[^ -~\n\r]/.test(text)
  const single = unicode ? 70 : 160
  const multi = unicode ? 67 : 153
  return len <= single ? 1 : Math.ceil(len / multi)
}

export async function saveChecklist(row) {
  const payload = {
    name: row.name?.trim(),
    phone: toE164(row.phone),
    title: row.title?.trim() || null,
    items: (row.items || []).map((s) => String(s).trim()).filter(Boolean),
    send_at: row.send_at,
    days: [...(row.days || [])].sort((a, b) => a - b),
    active: row.active !== false,
  }
  if (!payload.name) throw new Error('Give it a name')
  if (!/^\+\d{11,}$/.test(payload.phone)) throw new Error('That phone number does not look right')
  if (!payload.items.length) throw new Error('Add at least one thing to do')
  if (!payload.days.length) throw new Error('Pick at least one day')

  // .select() on every write, and a check that something came back.
  //
  // RLS FILTERS A WRITE, IT DOES NOT REFUSE ONE. A session the database does not
  // consider an admin updates zero rows and gets back no error — the Admin panel
  // shipped a delete button that reported success and removed nothing for exactly
  // this reason. Counting the returned rows is the only way to tell "saved" from
  // "silently dropped".
  const { data, error } = row.id
    ? await supabase.from('sms_checklists').update(payload).eq('id', row.id).select('id')
    : await supabase.from('sms_checklists').insert(payload).select('id')
  if (error) throw error
  if (!data?.length) throw new Error(NOT_ADMIN)
  return data[0]
}

export async function setActive(id, active) {
  const { data, error } = await supabase
    .from('sms_checklists').update({ active }).eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error(NOT_ADMIN)
}

export async function deleteChecklist(id) {
  const { data, error } = await supabase
    .from('sms_checklists').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error(NOT_ADMIN)
}
