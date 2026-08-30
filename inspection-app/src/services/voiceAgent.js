// Talking to the voice agent, and applying what it proposes.
//
// The split matters: api/voice-agent.js does the understanding and the reading,
// and this file does the writing. The agent never touches the database — it
// hands back a proposal, the person taps Confirm, and the write happens HERE,
// through the same table and the same shape the bulk location editor uses. So a
// spoken move and a tapped move produce identical rows, and the history trigger
// cannot tell them apart.

import { supabase } from './supabase'

// One turn. `messages` is the running thread in Anthropic shape; the endpoint
// returns the assistant/tool blocks it added so the next turn can carry them.
export async function askAgent(messages) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Sign in again')

  const res = await fetch('/api/voice-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Agent failed (${res.status})`)
  return data          // { say, proposals[], messages[] }
}

// Commit one confirmed move.
//
// physical_source is 'voice' so the timeline can say where a move came from,
// and location_updated_at is now() — which for a spoken update genuinely IS the
// event time, unlike a run-list upload describing something that happened days
// ago. The history row writes itself off the trigger.
export async function applyMove(proposal) {
  if (proposal?.kind !== 'location_move') throw new Error('Not a move')
  const now = new Date().toISOString()

  const { error } = await supabase.from('vehicle_locations').upsert({
    stock_number: String(proposal.stock_number).trim(),
    vin: proposal.vin || '',
    physical_location: proposal.to,
    physical_source: 'voice',
    location_updated_at: now,
    updated_at: now,
    notes: {
      voice: true,
      said: proposal.note || null,
      moved_at: now,
    },
  }, { onConflict: 'stock_number' })

  if (error) throw error
  return true
}
