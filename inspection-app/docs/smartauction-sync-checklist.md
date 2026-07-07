# SmartAuction ⇄ Marketplace Sync — Build Checklist

Two features:
- **A.** Save damages typed into the auto-fill extension → Supabase (per car) → show on the marketplace website.
- **B.** Upload the SmartAuction **InventoryResults** CSV in the extension to: update prices, hide sold cars, and add active cars that aren't showing.

Source report used for reference: `~/Downloads/InventoryResults (4).csv` (1,434 rows; active + sold + removed + held; `Seller = Carz Sale and Lease LLC`).

---

## Key facts (already true today — no work needed)

- Extension (`scrapers/smartauction-extension/`) is already a Supabase client: anon key + `supabase.co` host permission (`popup.js:54`), already writes `sa_active_cars`, `sa_sold_sales`, `vehicle_locations`, and can `UPDATE inspections` (`popup.js:572`).
- Extension manual damages live in `damages[]` (`popup.js:12`, shape `{panel, type, description, verbatim, category}`), saved only to `chrome.storage.local` (`saveSession()` `popup.js:4287`).
- Marketplace shows damages from `inspections.checklist.exterior[panelId].damages[]` / `.interior[zoneId].damages[]`, shape `{type, size, count, note, photos:[{url,path}]}` (IDs + enums in `src/services/inspectionFlow.js`; rendered in `src/pages/MarketplaceListing.jsx`).
- Existing active-list uploader: `src/services/buyerMatchData.js` (`mapActiveRow`, `saveActive` = delete-all-then-insert), UI at `src/pages/BuyerMatch.jsx`; extension twin at `lib/buyer-match-uploader.js`.
- Marketplace gate: RPC `marketplace_listings()` (`supabase/migrations/20260622000009_marketplace_sa_active.sql`) = `FROM inventory` shown when inspection-complete **OR** in `sa_active_cars` **OR** has ready-to-sell photo.
- Hide mechanism: table `marketplace_hidden` + RPCs `hide_marketplace_car` / `unhide_marketplace_car`; filtering is **client-side** in `src/pages/Marketplace.jsx` (`hidden` Set).
- Sold flag: `vehicle_locations.sa_status` (`'active'|'hold'|'sold'|'removed'|'expired'`) — currently NOT read by the list RPC, so it does not drop cars off the grid yet.
- VIN→stock lookup already exists: RPC `inventory_stocks_by_vins`.

---

## ⚠️ Decisions needed before building (blockers)

- [ ] **D1 — Where do extension damages attach?** SA cars often have no PWA inspection row. Choose:
  - **(a) Upsert an `inspections` row per car** (by VIN/stock), write damages into `checklist`, set `completed_at` so it shows. *Reuses all existing display + gate. Recommended.*
  - (b) New `listing_damages` table + change both marketplace RPCs to merge it. More code, cleaner separation.
- [ ] **D2 — "Add active cars not showing" — how?** Marketplace is `FROM inventory`; SA-active VINs missing from `inventory` can't appear. Choose:
  - **(a) Relax the gate**: change `marketplace_listings()` to also emit `sa_active_cars` rows with no inventory match (photos/details limited). *Fastest full coverage.*
  - (b) Auto-create `inventory` stubs from the active upload. Keeps single source but pollutes inventory.
- [ ] **D3 — Hide-sold mechanism?** Choose:
  - **(a)** Set `vehicle_locations.sa_status='sold'` + add `AND vl.sa_status IS DISTINCT FROM 'sold'` to `marketplace_listings()`. *Durable, reversible.*
  - (b) Call `hide_marketplace_car(stock)` per sold VIN (reuses existing hide, admin-only).
- [ ] **D4 — Does the report include other sellers?** If yes, filter rows to `Seller = "Carz Sale and Lease LLC"` before syncing.
- [ ] **D5 — Photos for extension damages?** Manual damages may have no photos. OK to display damage text-only on marketplace? (Current UI handles missing photos.)

---

## FEATURE A — Extension damages → Supabase → website

### A1. Data model (pick per D1)
- [ ] If D1(a): confirm `inspections` upsert key (VIN last6 / full VIN / stock_number) and that anon key can upsert (RLS check).
- [ ] Write a mapper `extensionDamage → checklistDamage`: `{panel,type,description}` → PWA `{type, size, count, note}` + correct snake_case panel/zone ID. Reverse of `lib/inspection-transform.js` maps (`PWA_EXTERIOR_TO_SA` / `PWA_INTERIOR_TO_SA`).
- [ ] Decide `size`/`count` defaults (extension only captures free-text description today).

### A2. Extension write path
- [ ] In `popup.js`, on damage add/edit/commit (`addDamage` `popup.js:3357`), also push to Supabase for the current car.
- [ ] Build target `checklist.exterior[panelId].damages[]` / `.interior[zoneId].damages[]` and PATCH `inspections.checklist` (or new RPC `upsert_listing_damages(vin, damages jsonb)` — SECURITY DEFINER, safer than raw table PATCH).
- [ ] Debounce/save-on-commit so we don't write on every keystroke.
- [ ] Handle "no car selected / no VIN yet" gracefully.

### A3. Backend
- [ ] Add RPC `upsert_listing_damages(p_vin text, p_damages jsonb)` (definer) — resolves VIN→inspection row (creating if D1a), merges damages into `checklist`, sets `completed_at` if newly created. Migration in `inspection-app/supabase/migrations/`.
- [ ] `GRANT EXECUTE ... TO anon`.

### A4. Website display
- [ ] Verify damages appear on `MarketplaceListing.jsx` condition report (should "just work" if shape + IDs are correct).
- [ ] Add a small "damages from SA listing" indicator if useful.

### A5. Verify
- [ ] Type a dent in the extension → confirm row in `inspections.checklist` → confirm it renders on `carzinc.ai/marketplace/:id`.

---

## FEATURE B — InventoryResults CSV sync (prices / hide sold / add active)

### B1. Parser (extend existing)
- [ ] Extend `buyerMatchData.js` (and/or `lib/buyer-match-uploader.js`) to parse the **full InventoryResults** columns, not just active ones. Derive a `status` per row:
  - `sold` = `Sale Date` & `Sale Price` & `Buyer Name` present
  - `removed` = `Removal Date`/`Removal Reason` present
  - `hold` = `Hold Date`/`Hold Reason` present
  - `active` = has `Days Remaining`, none of the above
- [ ] Apply D4 seller filter.

### B2. Update prices for all cars
- [ ] For every row, upsert `sa_active_cars` price fields (`buy_now`, `opening_price`) keyed by `vin` — but NOT delete-all (report ≠ current active snapshot). Consider `on_conflict=vin` upsert of prices only.
- [ ] Decide: should sold/removed cars be pruned from `sa_active_cars`? (They should stop being "active".)

### B3. Hide sold cars (pick per D3)
- [ ] Collect sold VINs → `inventory_stocks_by_vins` → stock numbers.
- [ ] D3(a): upsert `vehicle_locations.sa_status='sold'`, `sold_on='smart_auction'`, `sold_at`, `sold_price`, `buyer_name`; then add `AND vl.sa_status IS DISTINCT FROM 'sold'` gate to `marketplace_listings()` (new migration).
- [ ] D3(b) alt: call `hide_marketplace_car(stock)` for each sold stock.
- [ ] Confirm sold cars drop off `carzinc.ai/marketplace`.

### B4. Add active cars not showing (pick per D2)
- [ ] Determine active VINs missing from the marketplace result.
- [ ] D2(a): update `marketplace_listings()` to also surface unmatched `sa_active_cars` rows (new migration; decide fields shown w/o inventory/inspection).
- [ ] D2(b) alt: insert `inventory` stubs for missing active VINs.
- [ ] Confirm all active SA cars now appear.

### B5. Extension UI
- [ ] Add an "Upload InventoryResults" control in the side panel (reuse `parseUploadFile` `popup.js:1041` + `XLSXParser`), with a summary after upload: `X prices updated · Y hidden (sold) · Z added`.

### B6. Verify (with the real file)
- [ ] Upload `InventoryResults (4).csv`; confirm counts and spot-check 1 sold (gone), 1 active-new (now shows), 1 price change (updated) on `carzinc.ai/marketplace`.

---

## Suggested order
1. Decisions D1–D5.
2. Feature B first (higher daily value: prices + hide sold + coverage) — mostly extends existing uploader.
3. Feature A (damages) second — needs the mapper + display verification.
