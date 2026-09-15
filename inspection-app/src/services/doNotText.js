// The do-not-text list: numbers that replied STOP, "don't text me", "wrong
// number", or swore at us. Filled by outreach_record_reply() from replies to the
// Carz Inc number; the automatic outreach queue and the marketplace's Text best
// buyer button already skip it. This is for the buttons where a person types or
// picks the number themselves.
import { supabase } from './supabase'

const ten = (p) => {
  const d = String(p ?? '').replace(/\D/g, '')
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d
}

// One fetch per page load is plenty: the list changes when a buyer replies, not
// while someone is looking at a screen.
let pending = null
export function fetchDoNotText() {
  pending ||= supabase.rpc('opted_out_phones').then(
    ({ data, error }) => {
      if (error) { pending = null; console.warn('do-not-text list', error.message); return new Set() }
      return new Set((data || []).map((p) => ten(typeof p === 'string' ? p : Object.values(p)[0])))
    },
    () => { pending = null; return new Set() },
  )
  return pending
}

export const isDoNotText = (set, phone) => !!phone && !!set?.has(ten(phone))
