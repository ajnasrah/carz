// Fire a SIGNED synthetic WhatsApp webhook at your endpoint — tests the full
// webhook → Supabase path with no Meta and no real phone.
//
// Needs WHATSAPP_APP_SECRET (same value as in Vercel) in the environment so the
// X-Hub-Signature-256 matches what the handler verifies.
//
// Usage:
//   WHATSAPP_APP_SECRET=... node test-whatsapp-webhook.mjs <targetUrl> <phoneNumberId> <fromNumber> "<text>"
// Examples:
//   # local dev (vercel dev)
//   WHATSAPP_APP_SECRET=xxx node test-whatsapp-webhook.mjs http://localhost:3000/api/whatsapp 1111 19015551234 $'021216\n75000\nGood\n8.5'
//   # production
//   WHATSAPP_APP_SECRET=xxx node test-whatsapp-webhook.mjs https://carzinc.ai/api/whatsapp 1111 19015551234 "021216"
//
// NOTE: the phoneNumberId must exist in wa_station_numbers and the fromNumber in
// wa_allowed_senders, or the handler will (correctly) ignore the message.

import crypto from 'node:crypto';

const [target, phoneNumberId, from, text] = process.argv.slice(2);
const secret = process.env.WHATSAPP_APP_SECRET;

if (!target || !phoneNumberId || !from || !text || !secret) {
  console.error('Missing args. Usage:\n  WHATSAPP_APP_SECRET=... node test-whatsapp-webhook.mjs <url> <phoneNumberId> <from> "<text>"');
  process.exit(1);
}

const body = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA_TEST',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '0000000000', phone_number_id: phoneNumberId },
        contacts: [{ profile: { name: 'Test Worker' }, wa_id: from }],
        messages: [{
          from,
          id: 'wamid.TEST_' + crypto.randomUUID(),
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: 'text',
          text: { body: text },
        }],
      },
    }],
  }],
};

const raw = JSON.stringify(body);
const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');

const res = await fetch(target, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
  body: raw,
});

console.log(`POST ${target}`);
console.log(`message id: ${body.entry[0].changes[0].value.messages[0].id}`);
console.log(`status: ${res.status}`);
console.log(`response: ${await res.text()}`);
console.log('\nNow check Supabase: select * from wa_inbound_messages order by received_at desc limit 1;');
