# WhatsApp Cloud API — Quick Setup

Official Cloud API, **one dedicated number per station** (no groups, no scraping).
Full granular checklist: `../WHATSAPP_API_MIGRATION_CHECKLIST.md`.

> Callback URL is **`https://www.carzinc.ai/api/whatsapp`** (the function is `api/whatsapp.js`).
> The old `/api/webhook/whatsapp` path does NOT exist and will 404.

## 1. Vercel env vars (set all five)
```bash
vercel env add WHATSAPP_VERIFY_TOKEN production   # your invented string
vercel env add WHATSAPP_APP_SECRET production     # Meta App → Settings → Basic
vercel env add WHATSAPP_ACCESS_TOKEN production    # PERMANENT system-user token
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_KEY production      # service_role, NOT anon
```
Repeat with `preview` if you test on preview deploys. See `.env.whatsapp.example`.

> ⚠️ Do NOT use the dev-console **temporary** token (expires in 24h). Create a
> System User (Business Settings → Users) and generate a permanent token with
> `whatsapp_business_messaging` + `whatsapp_business_management`.

## 2. Run the migration
Apply `supabase/migrations/20260621000002_whatsapp_inbound.sql`, then seed your
real numbers and workers:
```sql
INSERT INTO wa_station_numbers (phone_number_id, display_number, station, location_code, label) VALUES
  ('<PHONE_NUMBER_ID_1>', '+1 901 555 0101', 'body_shop', 'body_shop',        'Carz Body Shop'),
  ('<PHONE_NUMBER_ID_2>', '+1 901 555 0102', 'mechanic',  'mechanic_section', 'Carz Mechanic'),
  ('<PHONE_NUMBER_ID_3>', '+1 901 555 0103', 'ready',     NULL,               'Carz Ready'),
  ('<PHONE_NUMBER_ID_4>', '+1 901 555 0104', 'seller',    NULL,               'Carz Seller Intake');

INSERT INTO wa_allowed_senders (wa_phone, worker_name, station) VALUES
  ('19015551234', 'Osama', 'body_shop');   -- E.164 digits, no '+'
```

## 3. Configure the webhook in Meta
WhatsApp → Configuration → Webhook → Edit:
- **Callback URL**: `https://www.carzinc.ai/api/whatsapp`
- **Verify Token**: the value you set for `WHATSAPP_VERIFY_TOKEN`
- Click **Verify and Save** → subscribe to the **messages** field.

## 4. Deploy
```bash
cd "/Users/abdullahabunasrah/Desktop/carz inc/inspection-app"
vercel --prod --archive=tgz
```

## 5. Test
From an **allow-listed** number, message the **seller** number:
```
021216
75000
Good
8.5
```
Then check Supabase `wa_inbound_messages` for a row with `vin6=021216`,
`processed=true`. Send a photo to a **body_shop**/**mechanic** number with the
VIN in the caption → check `vehicle_locations.physical_location` updated.

## Troubleshooting
- **Webhook won't verify** → token mismatch, or you didn't deploy after adding env. Verify token is read from env now.
- **POSTs rejected (401)** → `WHATSAPP_APP_SECRET` missing/wrong (signature check).
- **Message ignored** → sender not in `wa_allowed_senders`, or `phone_number_id` not in `wa_station_numbers`.
- **Photo not saved** → no VIN in caption and no recent VIN message from that sender (10-min session window).
