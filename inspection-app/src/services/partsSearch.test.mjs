import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeVehicle, buildQuery, carLabel, VENDORS } from './partsSearch.js'

// The exact bug that was reported: the body shop's parts list passes a board
// row, whose columns are vehicle_* — the search came out as the part name only.
test('a board row still produces a full year/make/model query', () => {
  const boardRow = {
    vehicle_year: '2021', vehicle_make: 'CHEVROLET', vehicle_model: 'SILVERADO 1500',
    vin: '1GCUYDED0MZ169058', stock_number: '06-180-26',
  }
  const car = normalizeVehicle(boardRow)
  assert.equal(buildQuery(car, 'Front passenger door'),
    '2021 CHEVROLET SILVERADO 1500 Front passenger door')
  assert.equal(car.vin, '1GCUYDED0MZ169058')
})

test('a hand-built object still works', () => {
  const car = normalizeVehicle({ year: 2019, make: 'Chevrolet', model: 'Camaro', vin: 'X' })
  assert.equal(buildQuery(car, 'Headlight'), '2019 Chevrolet Camaro Headlight')
})

test('a car not in inventory searches the part alone, without stray spaces', () => {
  const car = normalizeVehicle({ vehicle_year: null, vehicle_make: null, vehicle_model: null })
  assert.equal(buildQuery(car, 'Core support'), 'Core support')
  assert.equal(carLabel(car), '')
})

test('no part named yet searches the car alone', () => {
  const car = normalizeVehicle({ vehicle_year: '2021', vehicle_make: 'FORD', vehicle_model: 'MUSTANG' })
  assert.equal(buildQuery(car, ''), '2021 FORD MUSTANG')
})

test('a missing vehicle never throws', () => {
  assert.equal(buildQuery(normalizeVehicle(null), 'Bumper'), 'Bumper')
  assert.equal(normalizeVehicle(undefined).vin, '')
})

test('the keyword vendors carry the whole query into the URL', () => {
  const q = '2021 CHEVROLET SILVERADO 1500 Front passenger door'
  for (const key of ['ebay', 'amazon']) {
    const v = VENDORS.find((x) => x.key === key)
    const url = v.url({ q })
    assert.ok(url.includes(encodeURIComponent(q)), `${key} must carry the full query`)
    assert.ok(!v.needsLogin)
  }
})

test('the login-only vendors are marked as such', () => {
  for (const key of ['partstech', 'repairlink']) {
    assert.ok(VENDORS.find((x) => x.key === key).needsLogin, `${key} needs a login`)
  }
})
