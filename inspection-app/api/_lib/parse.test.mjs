// Plain-node assertion suite (no test runner in this project).
// Run: node api/_lib/parse.test.mjs
import assert from 'node:assert/strict';
import { parseVehicleEntry, parseMilesToken, scanMilesKeyworded } from './parse.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok -', name); };

console.log('parseMilesToken');
t('bare 3-6 digit', () => assert.equal(parseMilesToken('81263'), 81263));
t('decimal odometer', () => assert.equal(parseMilesToken('81263.1'), 81263));
t('commas', () => assert.equal(parseMilesToken('125,000'), 125000));
t('7-digit odometer (old rule dropped this)', () => assert.equal(parseMilesToken('1250003'), 1250003));
t('k shorthand', () => assert.equal(parseMilesToken('125k'), 125000));
t('decimal k shorthand', () => assert.equal(parseMilesToken('12.5k'), 12500));
t('trailing unit', () => assert.equal(parseMilesToken('81263 mi'), 81263));
t('unit with comma', () => assert.equal(parseMilesToken('81,263 miles'), 81263));
t('rejects junk', () => assert.equal(parseMilesToken('good'), null));
t('rejects too small', () => assert.equal(parseMilesToken('7'), null));
t('rejects empty/null', () => { assert.equal(parseMilesToken(''), null); assert.equal(parseMilesToken(null), null); });

console.log('scanMilesKeyworded');
t('keyworded in free text', () => assert.equal(scanMilesKeyworded('runs great, 81,263 miles, clean'), 81263));
t('mileage: prefix', () => assert.equal(scanMilesKeyworded('mileage: 96500 needs tires'), 96500));
t('k in free text', () => assert.equal(scanMilesKeyworded('about 118k miles'), 118000));
t('ignores untagged numbers', () => assert.equal(scanMilesKeyworded('tires 7/32, year 2019'), null));

console.log('parseVehicleEntry — structured');
t('canonical entry', () => {
  const r = parseVehicleEntry('204055\n66951\ngood\n7');
  assert.equal(r.vin6, '204055'); assert.equal(r.miles, 66951);
  assert.equal(r.condition, 'good'); assert.equal(r.tire_condition, 7);
});
t('7-digit miles line now parses (was dropped -> blank odometer)', () => {
  const r = parseVehicleEntry('696331\n1050000\nGood\n6');
  assert.equal(r.vin6, '696331'); assert.equal(r.miles, 1050000);
});
t('k on miles line', () => {
  const r = parseVehicleEntry('288152\n118k\nFair\n5');
  assert.equal(r.miles, 118000);
});
t('miles with unit on line', () => {
  const r = parseVehicleEntry('489982\n96,500 mi\nGood\n7');
  assert.equal(r.miles, 96500);
});
t('unparseable miles line -> entry kept, miles OMITTED (not dropped, not 0)', () => {
  const r = parseVehicleEntry('266662\nreads broken\nGood\n6');
  assert.ok(r, 'entry should not be null');
  assert.equal(r.vin6, '266662');
  assert.equal(r.condition, 'Good');
  assert.equal('miles' in r, false, 'no miles key so RPC filter (parsed ? miles) skips it');
});
t('miles found on a later line via keyword fallback', () => {
  const r = parseVehicleEntry('123456\nGood condition\n81,263 miles on it\n7');
  assert.equal(r.miles, 81263);
});

console.log('parseVehicleEntry — conversational');
t('keyworded miles', () => {
  const r = parseVehicleEntry('car 123456 has 88,200 miles, runs good');
  assert.equal(r.vin6, '123456'); assert.equal(r.miles, 88200);
});
t('no miles keyword -> miles OMITTED, never 0', () => {
  const r = parseVehicleEntry('123456 clean title ready to sell');
  assert.ok(r);
  assert.equal('miles' in r, false, 'must not default to 0 (would clobber real reading)');
});

console.log(`\n${pass} passing`);
