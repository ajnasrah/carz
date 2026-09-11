// The wash line's unreadable key tags.
//
// Cars leave the wash line by having their paper key tag photographed — Claude
// reads the VIN off the tag and the car finishes itself. About three in ten tags
// can't be read (glare, a thumb over the number, a tag folded in half), and when
// that happens the bot asks the group which car it is. Nobody ever answers: 57
// photos were asked about over three and a half weeks and not one got a reply.
// Every one of those cars stayed unfinished, still showing as in the shop.
//
// So the questions come here instead, where they are a list rather than a
// message that scrolls away. Somebody looks at the photo, reads the tag, types
// the last 6, and the car finishes.
//
// Everything goes through api/washline-queue.js rather than straight at the
// table: finishing a car closes its body shop AND mechanic jobs and moves it to
// the front line, which is service-role work, and the endpoint shares the exact
// finishCar the Telegram webhook uses so the two can't drift.

import { supabase } from './supabase'
import { API_BASE_URL } from '../native/platform'

async function authHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sign in again and retry')
  return { Authorization: `Bearer ${token}` }
}

async function call(path, init = {}) {
  const res = await fetch(`${API_BASE_URL}/api/washline-queue${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...(init.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Failed (${res.status})`)
  return body
}

// Oldest first — the longest-unfinished car is the one most likely to be sitting
// on the front line already while the board still says it's at the shop.
export async function fetchWashLineQueue() {
  const body = await call('')
  return body.items || []
}

// The photo itself. It isn't in our storage yet — a parked picture is only a
// Telegram file_id until somebody says whose car it is — so it comes through the
// endpoint, which needs the staff token. That rules out a plain <img src>, hence
// the blob URL; callers must revoke it (see the effect in WashLine.jsx).
//
// Resolves to null when Telegram has aged the file out, which is permanent: the
// row can still be dismissed, it just can't be looked at any more.
export async function fetchWashLinePhoto(messageId) {
  const res = await fetch(
    `${API_BASE_URL}/api/washline-queue?photo=${encodeURIComponent(messageId)}`,
    { headers: await authHeaders() })
  if (res.status === 410 || res.status === 404) return null
  if (!res.ok) throw new Error(`Could not load the photo (${res.status})`)
  return URL.createObjectURL(await res.blob())
}

// Name the car. Closes its body shop and mechanic jobs, files the photo under
// it, and moves it to the front line — the same thing that would have happened
// if the key tag had been readable.
export async function finishWashLineCar(messageId, vin6) {
  return call('', {
    method: 'POST',
    body: JSON.stringify({ message_id: messageId, vin6 }),
  })
}

// Take it off the list without claiming a car finished — a duplicate shot, a
// photo of nothing, a tag for a car somebody already handled by hand. The row
// stays in the message log; it just stops asking to be dealt with.
export async function dismissWashLinePhoto(messageId) {
  return call('', {
    method: 'POST',
    body: JSON.stringify({ message_id: messageId, action: 'dismiss' }),
  })
}
