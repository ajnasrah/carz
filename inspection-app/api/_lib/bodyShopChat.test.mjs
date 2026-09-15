import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  stripTags, splitByCar, isStatusNote, planMessage, readParts, matchCarByName, planFinish,
  carForVin, samePart, shopSlugs, isGenericPlace, destinationFor, actionsFor, applyActions,
  isActionable,
} from './bodyShopChat.js'

// Every message below is real, from the body_shop / body_shop_out groups.

const at = (s) => new Date(s)

test('the parts coordinator posts are reports, not arrivals', () => {
  // These moved cars off Jorge's (and one off the front lot).
  assert.ok(isStatusNote('Front sensor part in 9/3 \nNeed front tow cover / eye cap should finish 9_3 Palisade 454760'))
  assert.ok(isStatusNote('690310 \n2023  HYANDAI KONA \n[PARTS DELIVERED INSIDE CAR]'))
  assert.ok(isStatusNote('M5\n112800\n2021 Ford Mustang \nPass. mirror cover'))
  assert.ok(isStatusNote('364318 altima ordered arrive 9/11 \n\n570609 2023 1500 ordered arrive 9/14'))
  assert.ok(isStatusNote('152102\nGood to go'))
  // A bare VIN, or a VIN with a redo instruction, is still a car coming in.
  assert.ok(!isStatusNote('F36462'))
  assert.ok(!isStatusNote('003610\nAt Jorge Redo'))
})

test('coordinator tags are kept but not parsed, and only beside a VIN', () => {
  const t = stripTags('MH\n085581\n2021 Hyandai Sonota \nPass. MIRROR & OUTSIDE COVER')
  assert.deepEqual(t.tags, ['MH'])
  assert.ok(!/\bMH\b/.test(t.body))
  assert.deepEqual(stripTags('Parts***\nPn\n570609\nRear tailgate bumper').tags, ['Pn'])
  // An Audi Q5 is not a tag.
  assert.deepEqual(stripTags('Q5 \nFog light covers - Amazon Wednesday').tags, [])
  // Nor is a reply.
  assert.deepEqual(stripTags('Ok').tags, [])
})

test('two cars in one message stay two cars', () => {
  const segs = splitByCar('364318 altima ordered arrive 9/11 \n\n570609 2023 1500 ordered arrive 9/14')
  assert.deepEqual(segs.map((s) => s.vin6), ['364318', '570609'])
  const plan = planMessage('364318 altima ordered arrive 9/11 // 570609 2023 1500 ordered arrive 9/14',
    { anchor: at('2026-09-08T18:14:00Z') })
  assert.deepEqual(plan.segments.map((s) => [s.vin6, s.signals.ordered, s.etas[0]?.date]),
    [['364318', true, '2026-09-11'], ['570609', true, '2026-09-14']])
})

test('lines before the VIN belong to that car', () => {
  const segs = splitByCar('Being buffed should finish today 9/2 vw 607213 atlas')
  assert.equal(segs.length, 1)
  assert.equal(segs[0].vin6, '607213')
  assert.match(segs[0].text, /buffed/)
})

test('parts by model: part, vendor and delivery slot', () => {
  const parts = readParts('Envision \nRight headlight / Grill - eBay 7/28 - 8/8\nRight fender trim - Jim Keras 7/28\nRight tail light - calling tristate monday',
    { anchor: at('2026-07-25T20:44:00Z'), car: { vehicle_make: 'BUICK', vehicle_model: 'ENVISION' } })
  assert.deepEqual(parts.map((p) => [p.name, p.vendor, p.eta, p.etaLast, p.status]), [
    ['Right headlight', 'eBay', '2026-07-28', '2026-08-08', 'ordered'],
    ['Grill', 'eBay', '2026-07-28', '2026-08-08', 'ordered'],
    ['Right fender trim', 'Jim Keras', '2026-07-28', null, 'ordered'],
    // "calling tristate" is not an order yet.
    ['Right tail light', 'Tri State', null, null, 'needed'],
  ])
})

test('a slot line under several parts speaks for all of them', () => {
  const parts = readParts('Forte \nFront bumper assembly \nBoth headlights \n4 door handles \nFriday - Tuesday Ebay',
    { anchor: at('2026-06-30T22:58:00Z'), car: { vehicle_make: 'KIA', vehicle_model: 'FORTE' } })
  assert.equal(parts.length, 3)
  for (const p of parts) {
    assert.equal(p.vendor, 'eBay')
    assert.equal(p.eta, '2026-07-03')
    assert.equal(p.etaLast, '2026-07-07')
  }
})

test('parts with a VIN: needed, received, and what is not a part', () => {
  const anchor = at('2026-09-03T16:05:00Z')
  const p1 = readParts('Front sensor part in 9/3\nNeed front tow cover / eye cap should finish 9_3 Palisade', { anchor })
  assert.deepEqual(p1.map((p) => [p.name, p.status]), [
    ['Front sensor', 'received'], ['Front tow cover', 'needed'], ['Eye cap', 'needed'],
  ])
  const p2 = readParts("2018 gmc Yukon still needs bumper ordered... the bumper from Qasim didn't fit correctly.  Taillight is in car",
    { anchor, car: { vehicle_make: 'GMC', vehicle_model: 'YUKON' } })
  assert.deepEqual(p2.map((p) => [p.name, p.status]), [['Bumper', 'needed'], ['Taillight', 'received']])
  // A fault and a question are not parts to buy.
  assert.deepEqual(readParts('radio and control panel don’t work', { anchor }), [])
  assert.deepEqual(readParts('Does need new taillight?', { anchor }), [])
  assert.deepEqual(readParts('2021 mustang confirm if pass mirror cover ordered and pass headlight', { anchor }), [])
})

test('the car is found by name only when exactly one open job fits', () => {
  const cars = [
    { id: 'kona', vin6: '029697', vehicle_year: '2023', vehicle_make: 'HYUNDAI', vehicle_model: 'KONA' },
    { id: 'c1', vin6: '540043', vehicle_year: '2022', vehicle_make: 'TOYOTA', vehicle_model: 'CAMRY' },
    { id: 'c2', vin6: '111111', vehicle_year: '2019', vehicle_make: 'TOYOTA', vehicle_model: 'CAMRY' },
    { id: 'path', vin6: '232472', vehicle_year: '2020', vehicle_make: 'NISSAN', vehicle_model: 'PATHFINDER' },
    { id: 'rav', vin6: '222222', vehicle_year: '2021', vehicle_make: 'TOYOTA', vehicle_model: 'RAV4' },
    { id: 'rogue', vin6: '596017', vehicle_year: '2016', vehicle_make: 'NISSAN', vehicle_model: 'ROGUE' },
  ]
  assert.equal(matchCarByName('Kona\nRear bumper assembly - Tristate Thursday', cars)?.id, 'kona')
  assert.equal(matchCarByName('Camry \nMirror - Amazon Friday', cars), null)        // two Camrys
  assert.equal(matchCarByName('2019 Camry mirror eta 8/21', cars)?.id, 'c2')        // the year decides
  assert.equal(matchCarByName('Rav 4 \nMirror blinker - Tuesday Amazon', cars)?.id, 'rav')
  assert.equal(matchCarByName('Nissan rouge part ordered', cars)?.id, 'rogue')      // misspelt
  // A model we don't have open must not become the one Nissan we do.
  assert.equal(matchCarByName('Nissan Ariya\nRight headlight - eBay 7/22', cars.filter((c) => c.id === 'path')), null)
})

test('decisions: a hold, an instruction, and a question', () => {
  const s = (t) => planMessage(t).segments[0].signals
  assert.ok(s('Traverse as is no parts').hold)
  assert.ok(s('dont fix this its going to copart').hold)
  assert.ok(!s('omar jamal copart?').hold)
  assert.ok(!s('Touch up no paint').hold)
  assert.ok(s('Touch up no paint').instruction)
  assert.ok(s('Don’t send George').instruction)
})

test('body_shop_out: "still missing" is not finished', () => {
  assert.deepEqual(planFinish('78419\nStill missing the fender liner', ['078419']),
    { finish: [], blocked: [{ vin6: '078419', text: 'Still missing the fender liner' }] })
  assert.deepEqual(planFinish('152102 good to go', ['152102']), { finish: ['152102'], blocked: [] })
  assert.deepEqual(planFinish('Good to go \n430130', ['430130']).finish, ['430130'])
  const two = planFinish('219899\nGood to go\n043481\nwaiting on the bumper', ['219899', '043481'])
  assert.deepEqual(two.finish, ['219899'])
  assert.deepEqual(two.blocked.map((b) => b.vin6), ['043481'])
})

test('a VIN typed with a dropped digit finds the one car in the shop it can be', () => {
  const cars = [{ id: 'a', vin6: '578419' }, { id: 'b', vin6: '123456' }]
  assert.equal(carForVin('078419', cars, '78419\nStill missing the fender liner')?.id, 'a')
  assert.equal(carForVin('078419', [...cars, { id: 'c', vin6: '978419' }], '78419'), null)
  assert.equal(carForVin('078419', cars, '078419'), null)  // typed as six: no guessing
})

test('the same part typed two ways is one part', () => {
  assert.ok(samePart('Ac line', 'Mazda a/c line'))
  assert.ok(samePart('Front tow cover', 'Front tow hook cover'))
  assert.ok(samePart('Front sensor', 'Chrome front passenger grillle sensor'))
  assert.ok(samePart('Tail light', 'Rear pass. Taillight'))
  assert.ok(!samePart('Front bumper', 'Front bumper bracket'))   // a bracket is not a bumper
  assert.ok(!samePart('Headlight', 'Mirror cover'))
})

test('places: vendor slugs are never overwritten by the generic body shop', () => {
  for (const s of ['jorge', 'andys_auto', 'tri_state_glass', 'pat_jared', 'summit_tire']) assert.ok(!isGenericPlace(s), s)
  for (const s of ['front', 'front_lot', 'on_lot', 'unknown', null, 'daa', 'manheim_denver', 'mechanic_section']) assert.ok(isGenericPlace(s), s)
  const shops = shopSlugs([{ location_code: 'kia_gossett' }, { location_code: 'front' }, { location_code: 'adesa' }])
  assert.ok(shops.has('kia_gossett') && shops.has('jorge') && shops.has('andys_auto'))
  assert.ok(!shops.has('front') && !shops.has('adesa'))
})

test('which shop: only when the words send the car somewhere', async () => {
  const kw = { jorge: 'jorge', andy: 'andys_auto', tristate: 'tri_state_glass', pro: 'pro_auto', front: 'front', washline: 'wash_line' }
  const match = async (_db, text) => {
    const flat = String(text).toLowerCase().replace(/[^a-z]/g, '')
    for (const [k, v] of Object.entries(kw)) if (flat.includes(k)) return v
    return null
  }
  const shops = shopSlugs(Object.values(kw).map((location_code) => ({ location_code })))
  const dest = (t) => {
    const seg = planMessage(t).segments[0]
    return destinationFor(null, seg, { matchDestination: match, shops, locationCode: 'body_shop' })
  }
  assert.equal(await dest('I ask Amera n she told me to take it to Jorge'), 'jorge')
  assert.equal(await dest('Ionk if u want me to take it to Andy'), null)
  assert.equal(await dest('Back from tri state'), 'body_shop')
  assert.equal(await dest('Pro auto'), 'pro_auto')
  assert.equal(await dest('Front bumper - Monday eBay'), null)
  assert.equal(await dest('Don’t send George'), null)
})

// A tiny stand-in for the Supabase client: enough to prove the writes are
// idempotent on source_ref.
function fakeDb() {
  const tables = { body_shop_job_events: [], body_shop_parts: [], body_shop_jobs: [{ id: 'j1', status: 'intake' }] }
  const q = (table) => {
    const state = { table, filters: [], patch: null, op: 'select', rows: null }
    const run = () => {
      const t = tables[table]
      if (state.op === 'upsert') {
        const out = []
        for (const r of state.rows) {
          if (t.some((x) => x.source_ref === r.source_ref)) continue
          const row = { id: `${table}:${t.length}`, ...r }
          t.push(row); out.push(row)
        }
        return { data: out, error: null }
      }
      const hit = t.filter((x) => state.filters.every((f) => f(x)))
      if (state.op === 'update') { for (const x of hit) Object.assign(x, state.patch); return { data: hit, error: null } }
      return { data: hit, error: null }
    }
    const api = {
      select() { return api },
      upsert(rows) { state.op = 'upsert'; state.rows = Array.isArray(rows) ? rows : [rows]; return api },
      update(p) { state.op = 'update'; state.patch = p; return api },
      eq(k, v) { state.filters.push((x) => x[k] === v); return api },
      neq(k, v) { state.filters.push((x) => x[k] !== v); return api },
      in(k, v) { state.filters.push((x) => v.includes(x[k])); return api },
      not(k, _op, v) { const list = String(v).replace(/[()]/g, '').split(','); state.filters.push((x) => !list.includes(x[k])); return api },
      then(res, rej) { return Promise.resolve(run()).then(res, rej) },
    }
    return api
  }
  return { tables, from: q, rpc: async () => ({ data: null, error: null }) }
}

test('replaying a message writes nothing the second time', async () => {
  const db = fakeDb()
  const car = { id: 'j1', vin6: '214313', status: 'intake', vehicle_make: 'TOYOTA', vehicle_model: 'TACOMA', notes: null }
  const text = 'Pm\n214313\n2023 Toyota Tacoma\n-Driver rear chrome bumper insert\nTraverse as is no parts'
  const plan = planMessage(text, { anchor: at('2026-09-08T20:11:00Z') })
  const seg = plan.segments[0]
  assert.ok(isActionable(seg))
  const acts = actionsFor(seg, car, { plan, messageId: 'tg_1_19394', at: '2026-09-08T20:11:00Z', binding: 'vin' })
  assert.ok(acts.every((a) => a.source_ref.startsWith('bsc:tg_1_19394:0:')))
  assert.deepEqual(acts.find((a) => a.type === 'note').tags, ['Pm'])
  assert.equal(acts.find((a) => a.type === 'note').note, text)            // verbatim

  const first = await applyActions(db, car, acts, { messageId: 'tg_1_19394', at: '2026-09-08T20:11:00Z', vin6: '214313' })
  assert.ok(first.some((a) => a.type === 'part'))
  assert.ok(first.some((a) => a.type === 'hold'))
  const counts = () => Object.fromEntries(Object.entries(db.tables).map(([k, v]) => [k, v.length]))
  const before = counts()
  const second = await applyActions(db, { ...car, status: 'intake' }, acts, { messageId: 'tg_1_19394', at: '2026-09-08T20:11:00Z', vin6: '214313' })
  assert.deepEqual(second, [])
  assert.deepEqual(counts(), before)
  assert.equal(db.tables.body_shop_jobs[0].status, 'on_hold')
})
