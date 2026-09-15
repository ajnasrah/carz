import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildOutreachMessage, businessDeadline, isBusinessTime, gsmSafe, segmentCount,
} from '../../src/services/outreachMessage.js'

// Memphis is UTC-5 in September (CDT).
const cdt = (s) => new Date(`${s}-05:00`)

test('business hours are Mon-Sat 8am-6pm Memphis', () => {
  assert.equal(isBusinessTime(cdt('2026-09-15T08:00:00')), true)   // Tue open
  assert.equal(isBusinessTime(cdt('2026-09-15T07:59:00')), false)
  assert.equal(isBusinessTime(cdt('2026-09-15T17:59:00')), true)
  assert.equal(isBusinessTime(cdt('2026-09-15T18:00:00')), false)
  assert.equal(isBusinessTime(cdt('2026-09-19T12:00:00')), true)   // Sat
  assert.equal(isBusinessTime(cdt('2026-09-20T12:00:00')), false)  // Sun
})

test('30 minutes inside the day is 30 minutes', () => {
  assert.equal(businessDeadline(cdt('2026-09-15T10:00:00')).getTime(), cdt('2026-09-15T10:30:00').getTime())
})

test('the clock stops overnight', () => {
  // 5:45pm Tue: 15 minutes today, 15 tomorrow morning.
  assert.equal(businessDeadline(cdt('2026-09-15T17:45:00')).getTime(), cdt('2026-09-16T08:15:00').getTime())
})

test('and over Sunday', () => {
  assert.equal(businessDeadline(cdt('2026-09-19T17:50:00')).getTime(), cdt('2026-09-21T08:20:00').getTime())
})

test('a manual send at night starts counting at 8am', () => {
  assert.equal(businessDeadline(cdt('2026-09-15T22:10:00')).getTime(), cdt('2026-09-16T08:30:00').getTime())
})

test('the message says it is AI, warns about the 30 minutes, and is GSM-7', () => {
  const body = buildOutreachMessage({
    year: 2021, make: 'FORD', model: 'F-150', trim: 'XLT — SuperCrew', mileage: '48210',
    price: 32500, vin: '1ftfw1e50mfa12345', sa_url: 'https://www.smartauction.com/x?id=1',
  })
  assert.match(body, /our AI matches dealers/)
  assert.match(body, /2021 FORD F-150 XLT - SuperCrew, 48,210 mi/)
  assert.match(body, /\$32,500 Buy Now/)
  assert.match(body, /VIN 1FTFW1E50MFA12345/)
  assert.match(body, /https:\/\/www\.smartauction\.com\/x\?id=1/)
  assert.match(body, /Reply within 30 min or we'll offer it to the next best match\. Reply STOP to opt out\.$/)
  assert.equal(/[^\x20-\x7E\n]/.test(body), false)
  assert.ok(segmentCount(body) <= 3)
})

test('no price or miles leaves the lines out rather than printing $0', () => {
  const body = buildOutreachMessage({ year: 2019, make: 'JEEP', model: 'CHEROKEE', vin: 'V', price: null })
  assert.doesNotMatch(body, /\$0|Buy Now| mi\n/)
})

test('gsmSafe drops what GSM-7 cannot carry', () => {
  assert.equal(gsmSafe('Café “quoted” …'), 'Caf "quoted" ...')
})
