import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeReport } from './mechanicChat.js'

// The gate that decides whether a message is worth a model call at all. Most of
// this group's traffic is a bare VIN or a one-word acknowledgement.
test('a real report is read', () => {
  assert.ok(looksLikeReport('No A/C\nSuspension squeaking.\n114843'))
  assert.ok(looksLikeReport('needs front brakes and rotors'))
  assert.ok(looksLikeReport('se escucha un ruido en la suspension'))
})

test('a bare VIN is not a report', () => {
  assert.ok(!looksLikeReport('505894'))
  assert.ok(!looksLikeReport('114843'))
  assert.ok(!looksLikeReport('1GCUYDED0MZ169058'))
})

test('acknowledgements are not reports', () => {
  for (const t of ['done', 'ok', 'ready', '👍', '', null, undefined]) {
    assert.ok(!looksLikeReport(t), `${JSON.stringify(t)} must not be read`)
  }
})

test('a VIN plus one real fault is still a report', () => {
  assert.ok(looksLikeReport('114843 no ac'))
})
