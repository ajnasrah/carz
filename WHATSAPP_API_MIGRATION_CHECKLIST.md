# WhatsApp Cloud API Migration Checklist — Carz Inc

**Goal:** Replace the `whatsapp-web.js` group scraper with the **official WhatsApp Cloud API**, using a **dedicated business number per station** (1:1 intake). The inbound number deterministically encodes the location. No scraping, no QR, no ban risk, webhook never drops.

**Why not groups:** Official Groups API caps at 8 participants/group; all our groups exceed that. Third-party "group APIs" (Wassenger/whapi) are hosted scraping — same inconsistency, don't use.

**Decided architecture:**
- Station number → location mapping (replaces group-name matching).
- Public webhook on Vercel (`inspection-app/api/whatsapp.js`, currently a stub) does ALL ingestion.
- Media saved to **Supabase Storage** (cloud function can't write to the Mac).
- The Mac **pulls** photos from Supabase into `~/Desktop/SA Photos` for the SmartAuction extension.
- Reuse existing VIN parsing + queue logic; retire the Node/Puppeteer scraper.

Legend: `[ ]` todo · `[~]` partial/exists-but-needs-work · `[!]` blocker/gotcha

---

## 0. Decisions to lock before any setup
- [ ] Confirm final list of **stations** and their station code: `seller`, `body_shop`, `mechanic`, `ready` (match existing `physical_location` codes in Supabase).
- [ ] Decide **one number per station** (cleanest — number = location) vs. **one shared number + station keyword in message** (cheaper, but reintroduces parsing/ambiguity). Recommend one-number-per-station.
- [ ] Count stations → that's how many phone numbers you provision (likely 3–4).
- [ ] Confirm each station's intake really is just "VIN + miles + condition + photos" (so 1:1 DM loses nothing vs. the group thread).
- [ ] Decide who owns the Meta Business account (must be a real admin — Abdullah).

---

## 1. Meta / Facebook business prerequisites
- [ ] Create/confirm a **Meta Business Portfolio** at business.facebook.com (Carz Inc).
- [!] Complete **Meta Business Verification** (legal business name, address, phone, EIN/docs). This gates higher messaging limits and removes "unverified" caps. Can take days — **start first**.
- [ ] Create a **Meta App** (type: Business) at developers.facebook.com.
- [ ] Add the **WhatsApp** product to the app.
- [ ] Create/confirm a **WhatsApp Business Account (WABA)** under the portfolio.
- [ ] Add a **payment method** to the WABA (conversation billing; intake is cheap but a card is required to leave sandbox).
- [ ] Set the **Display Name** for each number (e.g. "Carz Inc — Body Shop"); display names go through Meta approval — submit early.

---

## 2. Phone numbers (one per station)
- [!] Each number must **NOT already be registered on consumer WhatsApp or WhatsApp Business app.** A number in use by the existing scraper/app **cannot** be reused until fully deregistered. Plan fresh numbers.
- [ ] Acquire numbers that can receive an SMS/voice **OTP** for registration (Twilio, a SIM, Google Voice often rejected — verify it can receive the Meta OTP).
- [ ] Register & verify each number in the WhatsApp Manager → get its **Phone Number ID** (the API uses the ID, not the raw number).
- [ ] Record the mapping in config: `PHONE_NUMBER_ID → station_code`. This is the source of truth for location.
- [ ] Set each number's **profile** (business name, category "Automotive", logo, address) so workers see a trusted contact.
- [ ] Note the **messaging tier/limit** for each number (starts at 250/1k unique recipients/day; rises after verification + quality). Intake volume is low so fine, but record it.

---

## 3. Access tokens & app permissions
- [!] Do **NOT** ship the 24-hour dev-console token (current example links to it — it dies daily).
- [ ] Create a **System User** (Business Settings → Users → System Users), type **Admin**.
- [ ] Generate a **permanent System User token** scoped to the WABA.
- [ ] Grant scopes: `whatsapp_business_messaging` (send/receive) and `whatsapp_business_management` (config).
- [ ] If the app is in **Development mode**, submit for **App Review** / advanced access on `whatsapp_business_messaging` before going live to real workers.
- [ ] Store the token in **Vercel env only** — never in git. (See §6 secrets.)
- [ ] Capture the **Meta App Secret** (App → Settings → Basic) — needed for webhook signature verification.

---

## 4. Webhook endpoint (Vercel) — rebuild `inspection-app/api/whatsapp.js`
Current file is a stub (logs + 200, hardcoded token, no processing). Rebuild it.

### 4a. Verification (GET)
- [~] Keep the `hub.mode` / `hub.challenge` handshake.
- [!] Read the verify token from **`process.env.WHATSAPP_VERIFY_TOKEN`**, not the hardcoded `'carz_whatsapp_verify_2024'` (currently `whatsapp.js:10`).
- [ ] Return `challenge` as **text/plain 200**; 403 on mismatch.

### 4b. Signature verification (POST) — security-critical
- [!] Verify the `X-Hub-Signature-256` header = `sha256=HMAC(appSecret, rawBody)`. Reject if absent/mismatch. Without this, anyone can POST fake "car sold / moved" payloads.
- [!] Disable Vercel's body parser so you get the **raw bytes** for HMAC: `export const config = { api: { bodyParser: false } }`, then read the raw stream and `JSON.parse` yourself. (HMAC over re-serialized JSON will not match.)
- [ ] Use a **constant-time** compare (`crypto.timingSafeEqual`).

### 4c. Message processing (POST)
- [ ] Parse `entry[].changes[].value`.
- [ ] Branch on `value.messages` (inbound) vs `value.statuses` (delivery/read receipts) vs `value.errors`. **Ignore statuses/errors** for ingestion (don't treat them as junk messages).
- [!] **Idempotency:** dedup on `message.id`. WhatsApp **retries** if you don't 200 within ~5s, and can redeliver. Keep a seen-set (Supabase table or KV) keyed by message id.
- [!] **Return 200 fast (< 5s).** Do heavy work (media download, Supabase writes) **after** acknowledging, or in a queue — otherwise Meta retries and you double-process.
- [ ] Map `metadata.phone_number_id` → station code → location. This replaces `GROUP_NAMES` matching.
- [!] **Sender allowlist:** only accept messages from known worker numbers (`message.from`). Drop everything else (spammers WILL text the number). Keep the allowlist in Supabase so you can add workers without redeploy.
- [ ] Text messages → run existing VIN/miles/condition parse (port `parse_vehicle_entry` logic).
- [ ] Image messages → download media (§5), associate to a VIN (§4d), store.
- [ ] Log unparseable messages somewhere reviewable (don't silently drop).

### 4d. Photo ↔ VIN association (the hard part)
- [!] 1:1 webhooks arrive **individually and without guaranteed order** — you lose the scraper's "current_vin6 across consecutive messages" trick.
- [ ] Maintain **per-sender conversation state** (Supabase: `wa_session{from, last_vin6, expires_at}`): when a worker sends a VIN, remember it; attach subsequent photos from that sender within a time window (e.g. 10 min).
- [ ] Prefer **VIN in the photo caption** when present (most reliable) — instruct workers to caption the first photo.
- [ ] If a photo arrives with no known VIN and no caption → park it in an "unassigned" bucket + (optional) auto-reply asking for the VIN.
- [ ] Apply the existing **exclude-word VIN filter** (`whatsapp_server.py:187`) so model years/prices/phone fragments aren't mistaken for VINs.

---

## 5. Media handling → Supabase Storage
- [!] A Vercel function **cannot** write to your Mac. Media must land in cloud storage; the Mac pulls it later.
- [ ] Create a **Supabase Storage bucket** (e.g. `wa-photos`, private).
- [ ] Webhook flow: `GET /{media_id}` (with bearer token) → get the short-lived URL → `GET` the binary (media URLs expire ~5 min, require the token) → upload to `wa-photos/{vin6}/photo_NNN.jpg`.
- [ ] Map MIME type → correct extension (don't hardcode `.jpg`; jpeg/png/webp differ).
- [ ] Add retry/backoff on media download (network + token-expiry failures).
- [ ] De-dupe photos per VIN (hash or sequence) so retried webhooks don't double-upload.
- [ ] Record photo count + storage paths on the vehicle's queue/DB row.

---

## 6. Secrets & config hygiene
- [!] **Rotate the Supabase anon key** — it's hardcoded in `scrapers/whatsapp_server.py:65` and committed to git history. Treat as leaked.
- [!] Server-side writes must use the **`service_role`** key (held only in Vercel env), not the anon key (RLS likely blocks anon writes to `vehicle_locations` — current location updates may be silently failing).
- [ ] Add to Vercel env (Production + Preview): `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN` (permanent), `WHATSAPP_APP_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `WA_PHONE_MAP` (json: phone_number_id→station).
- [!] Reconcile env var **names** — `scrapers/whatsapp_api.py:28-29` reads `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_ID`, but `.env.whatsapp.example` and the webhook use `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`. Pick one set everywhere or it runs with empty creds.
- [ ] Bump Graph API version from **v17.0** (`whatsapp_api.py:27`, deprecated) to a current version (v21.0+). Pin it in one constant.
- [ ] Add `whatsapp_session/` and any token files to `.gitignore` (confirm none are tracked).

---

## 7. Supabase / data model
- [ ] Table `wa_inbound_messages` (id, from, phone_number_id, station, type, body, media_path, vin6, raw_json, received_at) — audit log + idempotency source.
- [ ] Table `wa_allowed_senders` (phone, worker_name, station, active).
- [ ] Table `wa_sessions` (from, last_vin6, expires_at) for photo association.
- [ ] Confirm `vehicle_locations` write path: VIN-last-6 lookup currently does `ilike.%{vin6}` and blindly takes `vehicles[0]` (`whatsapp_server.py:123`) — **fix the multi-match risk** (two VINs sharing last 6 → wrong car updated). Prefer full-VIN match when available; flag ambiguous matches instead of guessing.
- [ ] Set **RLS policies** so only the service role writes; anon can't.
- [ ] Decide whether the **queue** stays as `queue.json` on the Mac or migrates into Supabase (cloud webhook can't touch `queue.json` on the Mac — likely must move queue state to Supabase, or have the Mac poll Supabase and update local queue).

---

## 8. The Mac-side pull (feeds the SmartAuction extension)
- [ ] Build a small local poller (replaces `whatsapp_server.py`'s scrape trigger) that:
  - [ ] Polls Supabase for new queued vehicles + their photos.
  - [ ] Downloads photos from `wa-photos/{vin6}` into `~/Library/Application Support/CarzInc/seller_group_output/{vin6}`.
  - [ ] Preserves the existing `/vehicle/<vin6>/photos` → `~/Desktop/SA Photos` copy behavior the extension depends on.
- [ ] Keep the extension's expected endpoints (`/status`, `/queue`, `/vehicle/...`) working — point them at the new local poller, not the scraper.
- [ ] Preserve the **auto-purge on status change** behavior (do NOT add retention/archive — per project rule).
- [ ] Respect the **timestamp rule**: don't bump `vehicle_locations` timestamps on re-uploads at the same status (7d-stuck = missing signal).

---

## 9. Outbound messages (if you send confirmations back to workers)
- [!] Free-form text only works **inside the 24-hour window** since the worker's last message. Outside it you MUST use a **pre-approved template**.
- [ ] If sending "✅ VIN 123456 received, 6 photos" confirmations → fine (within window).
- [ ] If sending proactive nudges ("you haven't sent photos") → create + get **template approval** first.
- [ ] Implement the 24h-window check before any send; fall back to template.

---

## 10. Worker rollout (behavior change)
- [!] This is the real cost: workers stop posting in the **group** and start messaging a **number**.
- [ ] Save each station number as a contact and distribute (e.g. "Carz Body Shop") to the right workers.
- [ ] One-line instruction sheet: "Send the VIN (last 6) first, then the photos. Caption the first photo with the VIN."
- [ ] Pick a **cutover date**; run old group + new number in **parallel** for ~1 week.
- [ ] Identify a fallback for workers who keep posting in the old group during transition (manual sweep).

---

## 11. Testing & verification
- [ ] Webhook GET verification returns the challenge (Meta "Verify and Save" succeeds).
- [ ] Send a real text from an allowed number → row in `wa_inbound_messages`, VIN parsed, queue entry created.
- [ ] Send from a **non-allowlisted** number → dropped.
- [ ] Send a forged POST without a valid signature → **rejected** (signature check works).
- [ ] Send VIN then 5 photos → all 5 land under the right `vin6` in Storage, count correct.
- [ ] Send photos to **each** station number → correct location code set in `vehicle_locations`.
- [ ] Force a duplicate `message.id` → no double-processing (idempotency works).
- [ ] Kill the function mid-process → Meta retry → still ends in correct single state.
- [ ] Mac poller pulls new photos into `SA Photos` → extension lists the car.
- [ ] End-to-end: worker text → webhook → Supabase → Mac pull → extension upload to SmartAuction.

---

## 12. Cutover & decommission
- [ ] Confirm parallel run is clean for the agreed window.
- [ ] Announce old groups are intake-dead (keep for chatter if desired, just not monitored).
- [ ] Stop & remove the scraper: `scrapers/whatsapp_client.js`, `whatsapp-web.js` dependency, the `whatsapp_session/` Puppeteer profile.
- [ ] Retire/replace `scrapers/whatsapp_api.py` (dead, never imported) and the scrape-trigger paths in `whatsapp_server.py`.
- [ ] Document the new architecture in README + a memory note.

---

## 13. Ops & monitoring (don't skip)
- [ ] Alert if **no inbound message in N hours** during business hours (number/webhook may be down).
- [ ] Monitor Meta **webhook delivery failures** (Meta disables webhooks after repeated non-200s).
- [ ] Track **number quality rating** in WhatsApp Manager (low quality → rate limits / number flagged).
- [ ] Set a reminder for **token health** (system user token is permanent but can be revoked; app secret rotations break signature check).
- [ ] Log + dashboard: messages in, VINs parsed, photos stored, location updates, unassigned bucket size.
- [ ] Budget note: conversation pricing is low for inbound-driven intake, but confirm monthly estimate after volume is known.

---

## Reused vs. retired (existing code)
**Reuse (port the logic):**
- `whatsapp_server.py` → `parse_vehicle_entry`, VIN normalize/exclude-words, `update_vehicle_location`, queue endpoints for the extension.
- `queue_manager.py` → whole module (status lifecycle, purge-on-status, cross-check, SA CSV sync) — keep, possibly back it with Supabase.

**Retire:**
- `scrapers/whatsapp_client.js` (Puppeteer/whatsapp-web.js) — the scraper.
- `whatsapp_session/` — Puppeteer auth profile.
- `scrapers/whatsapp_api.py` — dead standalone, fold its Cloud API send/download into the new webhook + Mac poller with fixed env names + current Graph version.
- Scrape-trigger code path in `whatsapp_server.py` (`trigger_whatsapp_scrape`, the Node `:7750` calls).

---

### Top blockers to start TODAY (long lead times)
1. Meta **Business Verification** (days).
2. Acquire **fresh phone numbers** that can receive the OTP and aren't on WhatsApp already.
3. **Display name** approval per number.
4. **App Review** for `whatsapp_business_messaging` if leaving Development mode.
