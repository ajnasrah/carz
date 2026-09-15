import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tenDigits, textablePicks } from './buyerPicks.js'

test('tenDigits accepts 10 digits or a leading 1, nothing else', () => {
  assert.equal(tenDigits('(316) 655-1656'), '3166551656')
  assert.equal(tenDigits('1-316-655-1656'), '3166551656')
  assert.equal(tenDigits('655-1656'), null)
  assert.equal(tenDigits(null), null)
  assert.equal(tenDigits('(999) 999-9999'), null)
  assert.equal(tenDigits('123-456-7890'), null)
})

test('only buyers with a phone are picked, never a lane', () => {
  const sale = (i, extra) => ({
    vin: `V${i}`, year: 2019, make: 'JEEP', model: 'CHEROKEE', odometer: 90000, segment: 'suv',
    sale_date: '2026-09-01', sale_price: 9000, channel_key: 'direct', ...extra,
  })
  const training = [
    // The heaviest Jeep buyer has no number — Frazer's usual shape.
    ...Array.from({ length: 30 }, (_, i) => sale(i, { buyer_key: 'n:mt moriah', buyer_name: 'MT MORIAH' })),
    ...Array.from({ length: 4 }, (_, i) => sale(100 + i, {
      channel_key: 'smartauction', buyer_name: 'RUSTY ECK FORD, INC', buyer_phone: '316-655-1656',
    })),
    ...Array.from({ length: 50 }, (_, i) => sale(200 + i, { buyer_key: 'c:uax', buyer_name: 'UAX', channel_key: 'uax' })),
  ]
  const cars = [{ vin: 'abc123', stock_number: 'S1', year: 2019, make: 'JEEP', model: 'CHEROKEE', odometer: 88000, buy_now: 9500 }]
  const rows = textablePicks(cars, training)
  assert.ok(rows.length >= 1)
  assert.equal(rows[0].buyer_name, 'RUSTY ECK FORD, INC')
  assert.equal(rows[0].buyer_phone, '3166551656')
  assert.equal(rows[0].vin, 'ABC123')
  assert.equal(rows[0].stock_number, 'S1')
  assert.ok(rows.every((r) => r.buyer_phone && !r.buyer_key.startsWith('c:')))
})
