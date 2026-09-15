// Buyer Outreach, server side: build a car's buyer lineup, run the queue, send.
//
// The decisions about WHO gets a car live in Postgres (outreach_claim_next and
// friends) under one lock. This file decides WHEN — business hours, the 30
// minute deadline — and does the texting, because Twilio is an HTTP call and
// has no business inside a database transaction.
//
// Order for every send: claim (a row exists) -> text -> record the result. A
// crash between the first two leaves a 'sending' row that outreach_expire()
// writes off after 5 minutes, so a car never waits forever on a text nobody
// knows went out, and never goes to the same buyer twice either.

import { scoreAll } from '../../src/services/buyerMatch.js'
import {
  buildOutreachMessage, businessDeadline, isBusinessTime,
} from '../../src/services/outreachMessage.js'
import { fetchTraining, tenDigits } from './buyerPicks.js'
import { sendSms } from './sms.js'

// How deep a lineup is frozen. The queue texts 5, but buyers at their daily
// limit are skipped rather than waited for, so it needs names in reserve.
export const LINEUP_DEPTH = 15
export const DEFAULT_MAX_OFFERS = 5

const OPEN = ['queued', 'waiting', 'paused']

// Twilio errors that mean "this number will never take a text" rather than
// "try again". Anything else is treated as an outage: the claim is undone and
// the next tick retries, so a Twilio blip doesn't burn a buyer off the lineup.
//   21211 invalid To, 21610 unsubscribed (STOP'd at the carrier), 21612/21614
//   not reachable / not mobile, 30003-30007 unreachable/blocked/filtered.
const PERMANENT = /"code"\s*:\s*(21211|21217|21407|21408|21610|21612|21614|30003|30004|30005|30006|30007)\b/

const num = (x) => (x == null || x === '' ? null : Number(x))

// ---------------------------------------------------------------------------
// Live SmartAuction cars — the only cars outreach will touch.
// ---------------------------------------------------------------------------
export async function liveCars(db) {
  const { data, error } = await db.rpc('buyer_match_cars')
  if (error) throw new Error(`buyer_match_cars: ${error.message}`)
  return (data || []).map((c) => ({
    ...c, vin: String(c.vin || '').toUpperCase(), buy_now: num(c.buy_now), opening_price: num(c.opening_price),
  }))
}

export const isLiveOnSa = (c) => !!c && c.on_smartauction !== false && !!c.detail_url

export function carFields(c) {
  return {
    vin: c.vin,
    stock_number: c.stock_number ?? null,
    year: c.year ?? null,
    make: c.make ?? null,
    model: c.model ?? null,
    trim: c.trim ?? null,
    mileage: c.odometer ?? null,
    price: c.buy_now ?? c.opening_price ?? null,
    sa_url: c.detail_url ?? null,
  }
}

// ---------------------------------------------------------------------------
// Lineups: the same engine and the same "has a real phone" rule as the
// marketplace's Text best buyer, scored across every car so the spread pass
// sees the whole board, then cut to LINEUP_DEPTH for the cars being queued.
// ---------------------------------------------------------------------------
export async function buildLineups(db, cars, vins) {
  const [training, demandRes] = await Promise.all([
    fetchTraining(db),
    db.rpc('buyer_demand_signals', { p_days: 60 }),
  ])
  if (!training.length) throw new Error('no training data - refusing to guess at buyers')
  const demand = demandRes.error ? [] : (demandRes.data || [])
  const textable = (cand) => !cand.is_channel && !!tenDigits(cand.buyer_phone)
  const { cars: scored } = scoreAll(cars, training, { eligible: textable }, demand)
  const want = new Set(vins)
  const out = new Map()
  for (const c of scored) {
    const vin = String(c.vin).toUpperCase()
    if (!want.has(vin)) continue
    out.set(vin, c.candidates.slice(0, LINEUP_DEPTH).map((cand, i) => ({
      rank: i + 1,
      buyer_key: cand.buyer_key,
      buyer_name: cand.buyer_name,
      phone: tenDigits(cand.buyer_phone),
      email: cand.buyer_email || null,
      city: cand.buyer_city || null,
      state: cand.buyer_state || null,
      predicted_price: cand.predicted_price == null ? null : Math.round(cand.predicted_price),
      confidence: cand.confidence || null,
      reason: cand.reason || null,
      total_buys: cand.total_buys ?? null,
      days_since: cand.days_since ?? null,
    })))
  }
  return out
}

// ---------------------------------------------------------------------------
// Sending a claimed offer
// ---------------------------------------------------------------------------
async function patchOffer(db, id, fields) {
  const { error } = await db.from('outreach_offers').update(fields).eq('id', id)
  if (error) console.error('outreach offer update failed', id, error.message)
}

// `claim` is what outreach_claim_next / outreach_claim_next_car returned.
// `car` is the outreach_cars row, refreshed with the live SA price and link.
export async function sendClaim(db, claim, car, { now = new Date() } = {}) {
  const offer = claim.offer
  const body = buildOutreachMessage(car)
  const out = await sendSms(`+1${offer.phone}`, body, { name: offer.buyer_name, source: 'outreach' })

  if (out.sent) {
    await patchOffer(db, offer.id, {
      status: 'sent', body, sent_at: now.toISOString(),
      expires_at: businessDeadline(now).toISOString(), twilio_sid: out.sid || null, error: null,
    })
    return { sent: true, offer_id: offer.id, buyer: offer.buyer_name }
  }

  if (PERMANENT.test(out.reason || '')) {
    // This number can't be texted. Mark it and let the next tick pick the next buyer.
    await patchOffer(db, offer.id, { status: 'failed', body, error: String(out.reason).slice(0, 500) })
    return { sent: false, offer_id: offer.id, permanent: true, reason: out.reason }
  }

  // An outage, not the buyer's fault: undo the claim so the buyer stays in line.
  await db.from('outreach_offers').delete().eq('id', offer.id)
  // The car keeps its status: with no open offer left, the next tick claims again.
  await db.from('outreach_cars').update({
    status_note: `Text did not send, retrying: ${String(out.reason || '').slice(0, 160)}`,
    updated_at: now.toISOString(),
  }).eq('id', car.id)
  return { sent: false, offer_id: offer.id, retry: true, reason: out.reason }
}

// ---------------------------------------------------------------------------
// One pass of the queue. Called every minute by cron, and straight after any
// owner action so a click doesn't wait up to a minute for its effect.
// ---------------------------------------------------------------------------
export async function runTick(db, { now = new Date(), force = false } = {}) {
  const log = { expired: 0, sent: [], skipped: [], stopped: [] }
  const { data: expired, error: expErr } = await db.rpc('outreach_expire')
  if (expErr) throw new Error(`outreach_expire: ${expErr.message}`)
  log.expired = expired || 0

  const { data: open, error } = await db.from('outreach_cars')
    .select('*').in('status', ['queued', 'waiting']).order('added_at')
  if (error) throw new Error(`outreach_cars: ${error.message}`)
  if (!open?.length) return log

  // Business hours gate automatic sends only. Deadlines still expire overnight
  // (they were computed in business time, so they land at 8am anyway).
  if (!force && !isBusinessTime(now)) {
    log.closed = true
    return log
  }

  // Is each car still for sale? Off SmartAuction or pulled from the
  // marketplace (reserved, hidden) means stop before texting anyone about it.
  const live = new Map((await liveCars(db)).map((c) => [c.vin, c]))
  const stocks = open.map((c) => c.stock_number).filter(Boolean)
  const hidden = new Set()
  if (stocks.length) {
    const { data } = await db.from('marketplace_hidden').select('stock_number').in('stock_number', stocks)
    for (const h of data || []) hidden.add(h.stock_number)
  }

  for (const car of open) {
    const sa = live.get(car.vin)
    const reason = !isLiveOnSa(sa) ? 'No longer listed on SmartAuction'
      : (car.stock_number && hidden.has(car.stock_number)) ? 'Taken off the marketplace (reserved or hidden)'
        : null
    if (reason) {
      await db.rpc('outreach_stop', { p_car: car.id })
      await db.from('outreach_cars').update({ status_note: reason }).eq('id', car.id)
      log.stopped.push({ vin: car.vin, reason })
      continue
    }

    const { data: claim, error: claimErr } = await db.rpc('outreach_claim_next', { p_car: car.id })
    if (claimErr) {
      log.skipped.push({ vin: car.vin, error: claimErr.message })
      continue
    }
    if (!claim?.offer) {
      log.skipped.push({ vin: car.vin, skip: claim?.skip })
      continue
    }

    // Text the price and link as they are NOW, and keep the row in step.
    const fresh = { ...car, ...carFields(sa), status: 'waiting' }
    await db.from('outreach_cars').update({ price: fresh.price, sa_url: fresh.sa_url, mileage: fresh.mileage }).eq('id', car.id)
    log.sent.push({ vin: car.vin, ...(await sendClaim(db, claim, fresh, { now })) })
  }
  return log
}

// ---------------------------------------------------------------------------
// The board the Outreach page draws.
// ---------------------------------------------------------------------------
export async function readBoard(db) {
  const since = new Date(Date.now() - 14 * 86400000).toISOString()
  const [openRes, closedRes] = await Promise.all([
    db.from('outreach_cars').select('*').in('status', OPEN).order('added_at'),
    db.from('outreach_cars').select('*').not('status', 'in', `(${OPEN.join(',')})`)
      .gte('updated_at', since).order('updated_at', { ascending: false }).limit(100),
  ])
  if (openRes.error) throw new Error(openRes.error.message)
  const cars = [...(openRes.data || []), ...(closedRes.data || [])]
  const ids = cars.map((c) => c.id)

  let candidates = [], offers = []
  if (ids.length) {
    const [cRes, oRes] = await Promise.all([
      db.from('outreach_candidates').select('*').in('car_id', ids).order('rank'),
      db.from('outreach_offers').select('*').in('car_id', ids).order('created_at'),
    ])
    if (cRes.error) throw new Error(cRes.error.message)
    if (oRes.error) throw new Error(oRes.error.message)
    candidates = cRes.data || []
    offers = oRes.data || []
  }

  // Texts both ways for anyone holding or answering a car right now — the
  // conversation the owner is deciding on.
  const hot = [...new Set(offers
    .filter((o) => ['sent', 'replied'].includes(o.status) && !o.resolved_at)
    .map((o) => o.phone))]
  let threads = []
  if (hot.length) {
    const since3 = new Date(Date.now() - 3 * 86400000).toISOString()
    const { data } = await db.from('sms_messages')
      .select('id, direction, phone, body, status, created_at, source')
      .gte('created_at', since3)
      .or(hot.map((p) => `phone.like.*${p}`).join(','))
      .order('created_at').limit(500)
    threads = (data || []).map((m) => ({ ...m, phone10: String(m.phone || '').replace(/\D/g, '').slice(-10) }))
  }

  // Cars that can be added: live on SmartAuction, not already open, never sold
  // through outreach, not pulled from the marketplace.
  const [all, soldRes, picksRes, hiddenRes, optRes] = await Promise.all([
    liveCars(db),
    db.from('outreach_sales').select('vin'),
    db.from('marketplace_buyer_picks').select('vin, rank, buyer_name, confidence').eq('rank', 1),
    db.from('marketplace_hidden').select('stock_number'),
    db.from('outreach_opt_outs').select('phone', { count: 'exact', head: true }),
  ])
  const openVins = new Set((openRes.data || []).map((c) => c.vin))
  const soldVins = new Set((soldRes.data || []).map((s) => s.vin))
  const hiddenStocks = new Set((hiddenRes.data || []).map((h) => h.stock_number))
  const topPick = new Map((picksRes.data || []).map((p) => [p.vin, p]))
  // Scoped to the cars on offer: an unscoped read of every offer ever sent
  // would hit PostgREST's silent 1,000-row cap within weeks.
  const offeredCount = new Map()
  const liveVins = all.filter(isLiveOnSa).map((c) => c.vin)
  if (liveVins.length) {
    const { data: offeredRows } = await db.from('outreach_offers').select('vin').in('vin', liveVins).limit(1000)
    for (const r of offeredRows || []) offeredCount.set(r.vin, (offeredCount.get(r.vin) || 0) + 1)
  }

  const available = all
    .filter((c) => isLiveOnSa(c) && !openVins.has(c.vin) && !soldVins.has(c.vin)
      && !(c.stock_number && hiddenStocks.has(c.stock_number)))
    .map((c) => ({
      ...carFields(c),
      top_buyer: topPick.get(c.vin)?.buyer_name || null,
      top_confidence: topPick.get(c.vin)?.confidence || null,
      already_offered: offeredCount.get(c.vin) || 0,
    }))
    .sort((a, b) => (b.top_buyer ? 1 : 0) - (a.top_buyer ? 1 : 0) || String(a.make).localeCompare(String(b.make)))

  const texts24h = offers.filter((o) => o.sent_at && new Date(o.sent_at) >= new Date(Date.now() - 86400000)).length

  return {
    now: new Date().toISOString(),
    business_open: isBusinessTime(new Date()),
    cars, candidates, offers, threads, available,
    opt_outs: optRes.count || 0,
    texts_24h: texts24h,
  }
}
