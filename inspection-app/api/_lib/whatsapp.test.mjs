// Offline tests for the WhatsApp lib — no Meta, no Supabase, no network.
//   node inspection-app/api/_lib/whatsapp.test.mjs
import assert from 'node:assert';
import crypto from 'node:crypto';
import { parseVehicleEntry, extractVin6, verifySignature } from './whatsapp.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓', name); }
  catch (e) { fail++; console.log('  ✗', name, '\n      ', e.message); }
}

console.log('parseVehicleEntry — structured');
await t('full 4-line entry', () => {
  const r = parseVehicleEntry('021216\n75000\nGood\n8.5\nrear bumper scratch');
  assert.equal(r.vin6, '021216');
  assert.equal(r.miles, 75000);
  assert.equal(r.condition, 'Good');
  assert.equal(r.tire_condition, 8.5);
  assert.equal(r.notes, 'rear bumper scratch');
});
await t('5-char VIN left-padded', () => {
  assert.equal(parseVehicleEntry('F1216\n50000\nFair').vin6, '0F1216');
});
await t('second line not a number => null', () => {
  assert.equal(parseVehicleEntry('021216\nhello there\nGood'), null);
});

console.log('parseVehicleEntry — conversational');
await t('vin after a leading word + miles + condition', () => {
  const r = parseVehicleEntry('needs detail on 123456, 75000 miles, runs good');
  assert.equal(r.vin6, '123456');
  assert.equal(r.miles, 75000);
  assert.equal(r.condition, 'Good');
});
await t('no VIN => null', () => {
  assert.equal(parseVehicleEntry('please bring it to the front'), null);
});

console.log('extractVin6');
await t('skips excluded leading word', () => {
  assert.equal(extractVin6('PHOTOS 456789'), '456789');
});
await t('skips word with no digit', () => {
  assert.equal(extractVin6('black bumper'), null);
});
await t('plain VIN', () => {
  assert.equal(extractVin6('021216'), '021216');
});
await t('7-char numeric -> last 6', () => {
  assert.equal(extractVin6('1234567'), '234567');
});
await t('letter-prefixed 7-char -> last 6 (team right-aligns to last digit)', () => {
  assert.equal(extractVin6('P086793'), '086793');
  assert.equal(parseVehicleEntry('P086793\n88264\nGood').vin6, '086793');
});

console.log('verifySignature (cross-checked vs Node HMAC = what Meta sends)');
const secret = 'test_app_secret_123';
const bodyStr = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: 'wamid.X', from: '19015551234', type: 'text', text: { body: '021216' } }] } }] }] });
const metaSig = 'sha256=' + crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');

await t('valid signature accepted', async () => {
  assert.equal(await verifySignature(bodyStr, metaSig, secret), true);
});
await t('tampered body rejected', async () => {
  assert.equal(await verifySignature(bodyStr + ' ', metaSig, secret), false);
});
await t('wrong secret rejected', async () => {
  assert.equal(await verifySignature(bodyStr, metaSig, 'wrong'), false);
});
await t('missing signature rejected', async () => {
  assert.equal(await verifySignature(bodyStr, null, secret), false);
});

// allow async asserts above to settle
await new Promise((r) => setTimeout(r, 50));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
