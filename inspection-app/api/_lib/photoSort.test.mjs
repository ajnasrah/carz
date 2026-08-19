// Plain-node assertion suite (no test runner in this project).
// Run: node api/_lib/photoSort.test.mjs
//
// The sort, not the model. Whether a photo is labelled correctly is a question
// for the eval in docs/photo-sort-eval.md; what has to hold every time is that
// the SAME labels always produce the SAME gallery, which is the entire reason
// the ordering lives in code instead of in the prompt.
import assert from 'node:assert/strict';
import { sortPhotos, SLOT_ORDER, LABELS } from './photoSort.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok -', name); };

const tags = (o) => new Map(Object.entries(o).map(([u, l]) => [u, { label: l, quality: 'good' }]));

console.log('sortPhotos');

t('hero angles lead, close-ups follow', () => {
  const urls = ['a', 'b', 'c', 'd'];
  const { ordering } = sortPhotos(urls, tags({
    a: 'damage_closeup', b: 'exterior_front_quarter', c: 'tire_tread', d: 'interior_dash',
  }));
  assert.deepEqual(ordering, ['b', 'd', 'a', 'c']);
});

t('stable within a slot — a walkaround stays a walkaround', () => {
  const urls = ['w1', 'w2', 'w3'];
  const { ordering } = sortPhotos(urls, tags({ w1: 'wheel', w2: 'wheel', w3: 'wheel' }));
  assert.deepEqual(ordering, ['w1', 'w2', 'w3']);
});

t('unlabelled photos sit behind labelled ones, never dropped', () => {
  const urls = ['x', 'a'];
  const { ordering } = sortPhotos(urls, tags({ a: 'interior_seats' }));
  assert.deepEqual(ordering, ['a', 'x']);
});

t('junk sinks to the bottom but stays in the gallery', () => {
  const urls = ['j', 'f'];
  const { ordering, hidden } = sortPhotos(urls, tags({ j: 'junk', f: 'exterior_front' }));
  assert.deepEqual(ordering, ['f', 'j']);
  assert.deepEqual(hidden, []);
});

t('nothing is ever hidden automatically, not even "unusable"', () => {
  const m = new Map([['u', { label: 'junk', quality: 'unusable' }], ['f', { label: 'exterior_front', quality: 'good' }]]);
  const { hidden, unusable, ordering } = sortPhotos(['u', 'f'], m);
  assert.deepEqual(hidden, []);
  assert.deepEqual(unusable, ['u']);
  assert.equal(ordering.length, 2);
});

t('every photo comes back exactly once', () => {
  const urls = Array.from({ length: 30 }, (_, i) => `p${i}`);
  const m = new Map(urls.map((u, i) => [u, { label: SLOT_ORDER[i % SLOT_ORDER.length], quality: 'good' }]));
  const { ordering } = sortPhotos(urls, m);
  assert.equal(ordering.length, urls.length);
  assert.equal(new Set(ordering).size, urls.length);
});

t('same labels, same gallery — whatever order they arrived in', () => {
  const labels = { a: 'exterior_rear', b: 'exterior_front_quarter', c: 'wheel', d: 'interior_cluster' };
  const first = sortPhotos(['a', 'b', 'c', 'd'], tags(labels)).ordering;
  const again = sortPhotos(['d', 'c', 'b', 'a'], tags(labels)).ordering;
  assert.deepEqual(first, again);
});

console.log('house order');

t('every label the model can return has a slot', () => {
  for (const l of LABELS) assert.ok(SLOT_ORDER.includes(l), `${l} missing from SLOT_ORDER`);
  assert.equal(SLOT_ORDER.length, LABELS.length);
});

t('a buyer sees the car before its paperwork', () => {
  const before = (a, b) => assert.ok(SLOT_ORDER.indexOf(a) < SLOT_ORDER.indexOf(b), `${a} should precede ${b}`);
  before('exterior_front_quarter', 'exterior_rear');
  before('exterior_rear', 'interior_dash');
  before('interior_cargo', 'damage_closeup');
  before('damage_closeup', 'vin_or_label');
  before('vin_or_label', 'junk');
});

console.log(`\n${pass} passed`);
