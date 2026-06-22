# SmartAuction Buyer-Match Engine — Spec & Roadmap

Recommends the top-3 likely buyers for each active SmartAuction car, learned from the daily
sold reports (which carry full buyer contact). Surfaces them on a dashboard with one-click
outreach. Lives inside **inspection-app** (Supabase + React), fed by the SmartAuction Chrome
extension.

## Why this works (validated against 1,037 real sold rows)
- **82% of sales volume comes from 144 repeat buyers** — a strong, learnable signal.
- Buyers have **distinct signatures**: Superior Auto buys cheap/high-mileage (~$10.5k, 90–155k mi);
  Joe Myers buys premium (~$25k, low miles); Rusty Eck is high-volume Ford-heavy across all prices.
- Predictive features: **make affinity + segment + price band + mileage band + geography**.

## Data model (`migrations/20260621000001_sa_buyer_match.sql`)
- `sa_sold_sales` — training data, one row per sold car, deduped by VIN. Grows daily.
- `sa_active_cars` — current active inventory (replaced each upload).
- `sa_recommendations` — cached top-N per active car, recomputed on upload.
- `sa_segment(make,model)` — SQL classifier kept in sync with the JS one.

## Algorithm (`src/services/buyerMatch.js`)
1. **buildModel(sold)** → per-buyer profile: make/segment counts, price & mileage medians,
   per-segment **premium** (buyer median ÷ segment median, shrunk toward 1.0 by sample size,
   clamped 0.8–1.2), geography, contact.
2. **CMV (Comparable Market Value)** per active car = `0.6·BuyNow + 0.4·median(comparable sales)`,
   comps tiered make+yr+mi → seg+yr+mi → make+seg → seg. Buy Now is the strongest per-car anchor.
3. **Relevance gate** — drop buyers who never buy this make/segment, or whose price/mileage bands
   don't fit. (Prevents "Joe Myers for everything.")
4. **predicted_price** = CMV × buyer premium  *(the display $)*.
5. **Ranking score** — **business priority chosen: 1) top dollar  2) proven buyer  3) spread.**
   - `score = predicted_price × trustMult` — **price is primary**; trust only *discounts* it.
   - `trustMult = trustFloor + (1−trustFloor)·trust`, `trust = evidence/(evidence+trustK)`,
     `evidence = 2·makeCount + segCount`. So a lone overpayer (low evidence) can't outrank a
     proven buyer offering a similar price, but a clearly higher bid still wins.
   - **Spread pass** (global, in `recommendAll`): count provisional #1 picks, penalize over-used
     buyers (`perRepeat`, capped at `maxPenalty`) so the next-best strong-dollar buyer can take #1.

### Why trust still discounts (not dominates)
Literal "highest price likely" with no trust surfaced 1-time buyers who once overpaid (40/53 #1
picks low-confidence). The trust *discount* + spread keep #1 picks to buyers with real evidence
(6–17 buys) while still leading with the top-dollar bidder — the chosen balance.

### Tunable knobs (`DEFAULT_CONFIG`)
- `trustFloor` ↓ → price dominates more; ↑ → proven buyers protected more.
- `trustK` ↑ → more buying evidence required before a high bid is trusted.
- `spread.perRepeat` / `maxPenalty` → how hard to spread outreach across the buyer base.
- `spread.enabled:false` → pure top-dollar→proven (no fair-share).

Validation of this default: top buyer is #1 on 16/53 cars (vs 20/53 with spread off), 20 distinct
#1 picks, #1 picks pay ~20% over market, pred/CMV median 1.10.

## Validation checklist — status
| # | Check | Result |
|---|-------|--------|
| 1–2 | Repeat-buyer signal / distinct profiles | ✅ 82% volume, clean signatures |
| 3 | Every car gets ≥3 buyers | ✅ 53/55; 2 cold-start (Mullen EV, exotic) |
| 4 | No collapse to one buyer | ✅ top-3 stay diverse; #1 tunable (knob above) |
| 5 | Sane predicted prices | ✅ pred/CMV 0.80–1.20, median 1.00 (was broken pre-CMV) |
| 6 | Segment mapping | ✅ matching; pricing uses price-tier so Escalade≠Equinox |
| 7 | Trustworthy reasons | ✅ "Bought 64 Ford…"; low-conf #1 picks 2/53 |
| 8 | Cold-start | ⚠️ 2 cars with no make/segment history → see roadmap |

## Build roadmap
- [x] DB schema migration — `migrations/20260621000001_sa_buyer_match.sql`
- [x] Scoring engine (validated against real data) — `src/services/buyerMatch.js`
- [x] This spec
- [x] **Ingest / data layer** — `src/services/buyerMatchData.js`: CSV parse, column mapping,
      Supabase load + save (sold upsert-by-VIN, active replace-snapshot, recommendations cache).
- [x] **UI page** `src/pages/BuyerMatch.jsx` — route `/buyer-match`, nav tab 🎯 Buyers. Upload
      active + sold CSV (works before tables exist), top-3 buyers per car w/ confidence + reason +
      copy email/phone + Draft-email (mailto) / Text (sms) outreach. Spread toggle live.
- [x] **Chrome extension upload** — `scrapers/smartauction-extension/lib/buyer-match-uploader.js`
      + "🎯 Buyer Match" section in `popup.html`. Two file inputs (Active List / Sold List) push
      SmartAuction Inventory Results exports straight to `sa_active_cars` (snapshot, replaced) and
      `sa_sold_sales` (upsert by VIN, accumulates). Same Supabase project/anon key as the rest of
      the extension. Note: only the *Inventory Results* export carries buyer email/phone — the
      inventory-management page DOM does not, so this stays a file-upload (not a page-scrape).
- [ ] **Extension auto-scrape (optional later)** — trigger the Inventory Results export + push
      without manual file pick.
- [ ] **Cold-start fallback** — for makes/segments with no history, match on price+mileage only and
      label clearly. (Currently shows "no buyer history … (cold start)".)
- [ ] **Outreach log** — track who was contacted about which car (close the loop: did the
      recommended buyer actually buy?).

## Audit pass (post-build hardening)
Found and fixed:
- **Recency** (was unimplemented despite the design) — `buildModel` now parses `sale_date`; each
  buyer gets `recencyMult` ∈ [0.85, 1.0] (120-day half-life) folded into the score, so an active
  buyer outranks a stale one at the same price. An outreach list should favor reachable buyers.
- **Cold-start** — the 2 Mullen EVs got zero buyers (no one ever bought that make/segment). Added a
  relaxed fallback pass (price+mileage only, labeled low-confidence) → every car now gets ≥3 buyers.
- **CMV weak-tier bug** — a $6.5k micro-EV was priced ~$14k because the only comps were the
  Tesla-dominated "ev" segment median. Now when only the weakest (segment-only) comp tier matches,
  CMV leans 80/20 on the car's own Buy Now.
- **Dead `sa_recommendations` table** — `saveRecommendations` was never called. The page now caches
  picks there after each upload (queryable for the extension / a future public marketplace surface).
- Lint cleaned in `BuyerMatch.jsx`.

Verified non-issues: buyer names are clean (323 distinct, 0 would merge, 0 blank); live schema
matches the mappers (full-payload anon inserts succeed on all 3 tables incl. FK cascade).

### Geography (added)
`STATE_CENTROIDS` + haversine → `geoMult ∈ [0.90, 1.05]` folded into the score: a closer buyer
(cheaper transport) is a stronger lead. Car state parsed from `location` ("Memphis, TN"→TN),
buyer state from history. Neutral (1.0) when either is unknown. Reason now shows distance
("TX, ~801mi"). Shifted the #1 pick on 7/55 cars without overriding top-dollar.

### Public marketplace surface (added)
`src/pages/Listings.jsx` at public route `/listings` (no auth, bottom-nav hidden). Lists
`sa_active_cars` as a browsable grid (year/make/model, mileage, drivetrain, color, location, Buy
Now, link to the SmartAuction detail page). **Buyer recommendations are intentionally NOT shown**
— that's internal intel. Internal `/buyer-match` header links out to it for sharing.

### Microscope fix
CMV could comp a $6.5k micro-EV against $30k Teslas (same "ev" segment + year + mileage). Added a
**price-band filter**: comps must fall within [0.5×, 2×] Buy Now. Mullen CMV $13.9k → $7.8k; normal
cars unaffected (pred/CMV still 0.80–1.20).

Known remaining limits (not blockers):
- Active replace is clear-then-insert (not transactional) — small window where active is empty mid-upload.
- Geography is state-centroid level (not zip/lat-long precise) and US-only.
- Public surface lives in inspection-app (not the separate carz-site project); link/embed from there.
- Extension upload is manual file-pick, not auto-scrape.
- CLI migration history is out of sync with the DB (pre-existing); migration was applied directly.

## To activate
1. Apply the migration (Supabase SQL editor or `supabase db push`).
2. Open **🎯 Buyers** → upload the SmartAuction active list + a sold export. Recommendations render
   instantly (computed client-side); data also persists so daily sold uploads keep training.

## Daily training loop
Extension scrapes sold report → upsert `sa_sold_sales` (dedupe VIN) → rebuild profiles →
recompute recommendations. More data = sharper premiums and tighter bands.
