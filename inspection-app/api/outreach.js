// Buyer Outreach: the queue runner and the owner's buttons.
//
//   GET  (cron, every minute)               expire deadlines, text the next buyers
//   POST { action: 'board' }                everything the Outreach page draws
//   POST { action: 'preview', vins }        lineups for cars, nothing saved
//   POST { action: 'add', vins }            queue cars (live on SmartAuction only)
//   POST { action: 'next_buyer', car_id }   a reply was handled; carry on
//   POST { action: 'next_car', offer_id }   text this buyer their best other car now
//   POST { action: 'sold', car_id, offer_id, price }
//   POST { action: 'stop', car_id }
//   POST { action: 'tick' }                 run the queue now
//
// Admin only: these texts go to customers from the company number, and the
// board holds every buyer's phone. Cron comes in on CRON_SECRET.
//
// Env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_KEY, CRON_SECRET,
//               TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM,
//               OUTREACH_ALERT_PHONE (defaults to the owner)

import { createClient } from '@supabase/supabase-js'
import { appCors } from './_lib/cors.js'
import { sendSms } from './_lib/sms.js'
import {
  buildLineups, carFields, isLiveOnSa, liveCars, readBoard, runTick, sendClaim,
  DEFAULT_MAX_OFFERS,
} from './_lib/outreach.js'

export const config = { maxDuration: 120 }

const OWNER_PHONE = process.env.OUTREACH_ALERT_PHONE || '+19018319661'

// Who is calling. Three different failures, three different answers: a stale
// login (sign in again), an auth check that didn't come back (try again), and a
// real non-admin. They all used to say "Admins only", which sent the owner
// looking for a permissions problem that wasn't there.
async function adminFromToken(db, token) {
  if (!token) return { status: 401, error: 'Sign in again' }
  let user = null, authError = null
  for (let attempt = 0; attempt < 2 && !user; attempt++) {
    const { data, error } = await db.auth.getUser(token)
    user = data?.user || null
    authError = error
    // A rejected token won't get better on a retry; a network blip might.
    if (error?.status === 401 || error?.status === 403) break
  }
  if (!user?.id) {
    console.warn('outreach auth failed:', authError?.status, authError?.message)
    return authError && ![401, 403].includes(authError.status)
      ? { status: 503, error: 'Could not check your login just now. Try again.' }
      : { status: 401, error: 'Your login expired. Sign in again.' }
  }
  const owner = ['9018319661', '19018319661'].includes(String(user.phone || '').replace(/\D/g, ''))
  if (owner) return { user }
  const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role === 'admin') return { user }
  console.warn('outreach refused non-admin:', user.id)
  return { status: 403, error: 'Admins only' }
}

const pretty = (p) => {
  const d = String(p || '').replace(/\D/g, '').slice(-10)
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p
}

class Refusal extends Error {}
const refuse = (msg) => { throw new Refusal(msg) }

// Postgres RAISE EXCEPTION from our functions is a message meant for the owner.
function rpcError(error) {
  if (!error) return
  if (error.code === 'P0001') refuse(error.message)
  throw new Error(error.message)
}

export default async function handler(req, res) {
  if (appCors(req, res)) return
  res.setHeader('Content-Type', 'application/json')
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'server not configured' })
  }
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  const secret = process.env.CRON_SECRET

  // The cron. Never open without a secret configured: this sends texts.
  if (req.method === 'GET') {
    if (!secret || (bearer !== secret && req.query?.secret !== secret)) {
      return res.status(401).json({ error: 'unauthorized' })
    }
    try {
      return res.status(200).json(await runTick(db, { force: req.query?.force === '1' }))
    } catch (e) {
      console.error('outreach tick failed:', e?.message || e)
      return res.status(500).json({ error: String(e?.message || e) })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST' })
  const auth = await adminFromToken(db, bearer)
  if (!auth.user) return res.status(auth.status).json({ error: auth.error })
  const user = auth.user

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const action = body.action

  try {
    if (action === 'board') {
      return res.status(200).json(await readBoard(db))
    }

    if (action === 'preview' || action === 'add') {
      const vins = [...new Set((body.vins || []).map((v) => String(v).trim().toUpperCase()).filter(Boolean))]
      if (!vins.length) refuse('Pick at least one car')
      if (vins.length > 60) refuse('Up to 60 cars at a time')
      const cars = await liveCars(db)
      const byVin = new Map(cars.map((c) => [c.vin, c]))
      const notLive = vins.filter((v) => !isLiveOnSa(byVin.get(v)))
      if (notLive.length) refuse(`Not live on SmartAuction: ${notLive.join(', ')}`)

      const lineups = await buildLineups(db, cars, vins)
      if (action === 'preview') {
        return res.status(200).json({ lineups: Object.fromEntries(lineups) })
      }

      const max = Math.min(15, Math.max(1, Number(body.max_offers) || DEFAULT_MAX_OFFERS))
      const added = [], refused = []
      for (const vin of vins) {
        const lineup = lineups.get(vin) || []
        if (!lineup.length) { refused.push({ vin, reason: 'No buyers with a phone number match this car' }); continue }
        const { data, error } = await db.rpc('outreach_add_car', {
          p_car: carFields(byVin.get(vin)), p_candidates: lineup, p_actor: user.id, p_max: max,
        })
        if (error) refused.push({ vin, reason: error.message })
        else added.push({ vin, id: data, buyers: lineup.length })
      }
      const tick = added.length ? await runTick(db) : null
      return res.status(200).json({ added, refused, tick })
    }

    if (action === 'next_buyer') {
      rpcError((await db.rpc('outreach_resume', { p_car: body.car_id })).error)
      return res.status(200).json({ ok: true, tick: await runTick(db) })
    }

    if (action === 'stop') {
      rpcError((await db.rpc('outreach_stop', { p_car: body.car_id })).error)
      return res.status(200).json({ ok: true })
    }

    if (action === 'next_car') {
      const { data: claim, error } = await db.rpc('outreach_claim_next_car', {
        p_offer: Number(body.offer_id), p_actor: user.id,
      })
      rpcError(error)
      if (!claim?.offer) refuse('No other queued car matches this buyer')
      const { data: car } = await db.from('outreach_cars').select('*').eq('id', claim.offer.car_id).single()
      const sa = (await liveCars(db)).find((c) => c.vin === car.vin)
      if (!isLiveOnSa(sa)) {
        await db.from('outreach_offers').delete().eq('id', claim.offer.id)
        refuse(`${[car.year, car.make, car.model].join(' ')} is no longer on SmartAuction`)
      }
      const fresh = { ...car, ...carFields(sa) }
      const sent = await sendClaim(db, claim, fresh)
      if (!sent.sent) refuse(`Text did not send: ${String(sent.reason || '').slice(0, 200)}`)
      return res.status(200).json({ ok: true, car: fresh, buyer: claim.offer.buyer_name })
    }

    if (action === 'sold') {
      const price = Number(String(body.price ?? '').replace(/[^0-9.]/g, ''))
      if (!(price > 0)) refuse('Enter the sale price')
      const { data: sale, error } = await db.rpc('outreach_sell', {
        p_car: body.car_id, p_offer: Number(body.offer_id), p_price: price, p_actor: user.id,
      })
      rpcError(error)

      // Recorded and hidden first; the text is best-effort on top.
      const place = [sale.buyer_city, sale.buyer_state].filter(Boolean).join(', ')
      const alert = [
        'Carz Inc - SOLD via Buyer Outreach',
        sale.car,
        `VIN ${sale.vin}`,
        `Price $${Math.round(sale.price).toLocaleString('en-US')}`,
        '',
        `Buyer: ${sale.buyer_name}`,
        `Phone: ${pretty(sale.buyer_phone)}`,
        sale.buyer_email ? `Email: ${sale.buyer_email}` : null,
        place || null,
      ].filter((l) => l != null).join('\n')
      const text = await sendSms(OWNER_PHONE, alert, { name: 'Owner', source: 'outreach-sold' })
      return res.status(200).json({ ok: true, sale, alerted: text.sent, alert_error: text.sent ? null : text.reason })
    }

    if (action === 'tick') {
      return res.status(200).json(await runTick(db, { force: body.force === true }))
    }

    return res.status(400).json({ error: `unknown action: ${action}` })
  } catch (e) {
    if (e instanceof Refusal) return res.status(400).json({ error: e.message })
    console.error('outreach failed:', action, e?.message || e)
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
