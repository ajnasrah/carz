# WhatsApp Cloud API — Deploy & Run Runbook

The single source of truth for standing up the official WhatsApp pipeline that
replaced the `whatsapp-web.js` scraper. Architecture:

```
Worker texts a per-station number
        │  (official Cloud API)
        ▼
Vercel Edge webhook  inspection-app/api/whatsapp.js
        │  verify signature → parse VIN → store
        ▼
Supabase   wa_inbound_messages (data)  +  wa-photos bucket (photos)
        │                              +  vehicle_locations (body/mechanic moves)
        ▼
Mac puller  scrapers/whatsapp_pull.py  (launchd, every 60s)
        ▼
seller_group_output/{vin6}  →  ~/Desktop/SA Photos  →  SmartAuction extension
```

- One **dedicated number per station** (seller, ready, body_shop, mechanic). The
  inbound number = the location. No groups (8-cap rules them out), no scraping.
- Only **seller/ready** photos feed listings; body/mechanic are location-only.
- Full prerequisite checklist: `WHATSAPP_API_MIGRATION_CHECKLIST.md`.

---

## Files in this build
| File | Role |
|---|---|
| `inspection-app/api/whatsapp.js` | Edge webhook (verify, signature, parse, media→Storage, location) |
| `inspection-app/api/_lib/whatsapp.js` | Parsing, signature (HMAC), media download helpers |
| `inspection-app/supabase/migrations/20260621000002_whatsapp_inbound.sql` | Tables + `wa-photos` bucket + RLS |
| `inspection-app/supabase/migrations/20260621000003_location_recency_guard.sql` | "Newest wins" location trigger |
| `scrapers/whatsapp_pull.py` | Mac puller (Supabase → local folders → SA Photos) |
| `scrapers/com.carzinc.whatsapp-pull.plist` | launchd agent for the puller |
| `inspection-app/.env.whatsapp.example` | Env var reference |

---

## ONE-TIME SETUP

### 1. Meta prerequisites (start early — multi-day lead times)
See `WHATSAPP_API_MIGRATION_CHECKLIST.md` §1–3. You need: verified Meta Business,
a WhatsApp Business Account, one registered number per station (each gives a
**phone_number_id**), a **permanent System User token**, and the **App Secret**.
> ⚠️ Not the 24h dev-console token. Not the test number for production.

### 2. Vercel env vars (project: inspection-app)
```bash
cd "/Users/abdullahabunasrah/Desktop/carz inc/inspection-app"
vercel env add WHATSAPP_VERIFY_TOKEN production    # an invented string
vercel env add WHATSAPP_APP_SECRET production       # Meta App → Settings → Basic
vercel env add WHATSAPP_ACCESS_TOKEN production      # permanent System User token
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_KEY production        # service_role (NOT anon)
```
(Repeat with `preview` if you test on preview deploys.)

### 3. Run the migrations
Apply both, in order, to the Supabase project:
- `20260621000002_whatsapp_inbound.sql`
- `20260621000003_location_recency_guard.sql`

### 4. Seed your numbers + workers (after numbers are registered)
```sql
INSERT INTO wa_station_numbers (phone_number_id, display_number, station, location_code, label) VALUES
  ('<PHONE_NUMBER_ID_1>', '+1 901 555 0101', 'body_shop', 'body_shop',        'Carz Body Shop'),
  ('<PHONE_NUMBER_ID_2>', '+1 901 555 0102', 'mechanic',  'mechanic_section', 'Carz Mechanic'),
  ('<PHONE_NUMBER_ID_3>', '+1 901 555 0103', 'ready',     NULL,               'Carz Ready'),
  ('<PHONE_NUMBER_ID_4>', '+1 901 555 0104', 'seller',    NULL,               'Carz Seller Intake');

INSERT INTO wa_allowed_senders (wa_phone, worker_name, station) VALUES
  ('19015551234', 'Osama', 'body_shop');   -- E.164 digits, NO '+'
```
> `location_code` must match the values the Inventory editor uses (e.g.
> `body_shop`, `mechanic_section`). Unlisted senders are ignored by the webhook.

### 5. Deploy the webhook
```bash
cd "/Users/abdullahabunasrah/Desktop/carz inc/inspection-app"
vercel --prod --archive=tgz
```

### 6. Point Meta at the webhook
Meta dashboard → WhatsApp → Configuration → Webhook → Edit:
- **Callback URL**: `https://carzinc.ai/api/whatsapp`   ← note: NOT `/api/webhook/whatsapp`
- **Verify Token**: your `WHATSAPP_VERIFY_TOKEN`
- Click **Verify and Save** → subscribe to the **messages** field.

### 7. Activate the Mac puller
```bash
# store the service_role key once (local, non-git):
mkdir -p ~/Library/Application\ Support/CarzInc
echo 'SUPABASE_SERVICE_KEY=eyJ...service_role...' >> ~/Library/Application\ Support/CarzInc/.env

# start it (runs now + every 60s):
launchctl load ~/Library/LaunchAgents/com.carzinc.whatsapp-pull.plist
```

---

## TESTING — three layers, increasing setup

### Layer 1 — Offline logic (no setup, run anytime)
Validates VIN parsing + signature verification (HMAC cross-checked against
Node's, i.e. exactly what Meta computes):
```bash
node inspection-app/api/_lib/whatsapp.test.mjs   # expect "13 passed, 0 failed"
```

### Layer 2 — Webhook → Supabase (no Meta, no real phone)
Fires a SIGNED synthetic webhook at the endpoint. Needs: migrations applied,
the `phoneNumberId` seeded in `wa_station_numbers`, the `from` in
`wa_allowed_senders`, and `WHATSAPP_APP_SECRET` exported locally.
```bash
cd "/Users/abdullahabunasrah/Desktop/carz inc/inspection-app"
# against production (after deploy):
WHATSAPP_APP_SECRET=<secret> node test-whatsapp-webhook.mjs \
  https://carzinc.ai/api/whatsapp <PHONE_NUMBER_ID> 19015551234 $'021216\n75000\nGood\n8.5'
# or locally first:  vercel dev   → target http://localhost:3000/api/whatsapp
```
Then: `select * from wa_inbound_messages order by received_at desc limit 1;`
Try a bad secret too → expect HTTP 401 (signature rejection works).

### Layer 3 — Full end-to-end smoke test (real Meta + real number)
1. **Handshake** — step 6's "Verify and Save" returns green. (If not → token mismatch or not deployed.)
2. **Inbound text** — from an allow-listed number, text the **seller** number:
   ```
   021216
   75000
   Good
   8.5
   ```
   → Supabase `wa_inbound_messages` has a row, `vin6=021216`, `processed=true`.
3. **Photo** — send a photo to the **seller** number captioned `021216`.
   → object appears in the `wa-photos/021216/` bucket.
4. **Location** — send `021216` to the **body_shop** number.
   → `vehicle_locations.physical_location` for that car = `body_shop`.
5. **Puller** — `tail -f ~/Library/Logs/carzinc-whatsapp-pull.log` shows
   `+1 vehicles / +1 photos`; the photo lands in `seller_group_output/021216/`.
6. **Extension** — the SmartAuction extension lists the car with its photo.

---

## DAY-TO-DAY OPS

**Watch the puller:**
```bash
tail -f ~/Library/Logs/carzinc-whatsapp-pull.log
```

**Manual pull (debug):**
```bash
cd "/Users/abdullahabunasrah/Desktop/carz inc/scrapers"
python3 whatsapp_pull.py            # one-shot
python3 whatsapp_pull.py --watch 30 # foreground, every 30s
```

**Add a worker / number:** just `INSERT` into `wa_allowed_senders` /
`wa_station_numbers`. No redeploy needed.

**Stop / restart the puller:**
```bash
launchctl unload ~/Library/LaunchAgents/com.carzinc.whatsapp-pull.plist
launchctl load   ~/Library/LaunchAgents/com.carzinc.whatsapp-pull.plist   # after edits
```

---

## TROUBLESHOOTING
| Symptom | Likely cause |
|---|---|
| Webhook won't verify (red in Meta) | `WHATSAPP_VERIFY_TOKEN` mismatch, or didn't redeploy after adding env |
| All POSTs 401 | `WHATSAPP_APP_SECRET` missing/wrong (signature check) |
| Message ignored, no row | Sender not in `wa_allowed_senders`, or `phone_number_id` not in `wa_station_numbers` |
| Photo not stored | Sent to a body/mechanic number (intake-only), or no VIN in caption + no recent VIN from that sender (10-min session) |
| Location didn't change | Car not found by last-6 in `inventory`, or an existing **newer** location wins (by design) |
| Puller logs "SUPABASE_SERVICE_KEY not set" | Add it to `~/Library/Application Support/CarzInc/.env` |
| Stale Super Dispatch flipped a car | Shouldn't happen now — dispatch stamps the real pickup/created date; verify the row's dates parsed |

---

## KNOWN LIMITATIONS (by design / deferred)
- **Hard media failure** (after 3 retries) → photo lost until the worker re-sends (a re-send is a new message → reprocesses cleanly).
- **`wa-photos` bucket isn't auto-pruned** after listing — grows slowly; add cleanup later if needed.
- **UAX/DAA/ADESA run-lists still stamp `now()`** (only Super Dispatch was fixed) — safe for same-day exports; fix if you ever upload an old auction list.
- **Not load-tested** for large webhook batches (many images in one delivery process sequentially).
