# Carz Inc Shop Ops System — Plan v0.1

*Tekmetric replacement. Car-centric recon ops built into the existing inspection-app (React 19 + Supabase).*

**Drafted:** 2026-04-21 — open for redline.

---

## 1. The Decision: Build, Not Buy

Tekmetric is built for **retail shops billing customers** (DVI, estimates, payment processing, markup matrix, customer CRM). Carz Inc is an **internal recon cost center** — the "customer" of every RO is Carz Inc itself. What you need: per-car cost/time rollup into `inventory.added_costs`, Amex reconciliation, and procedure playbooks. Tekmetric can't do any of those at any price.

One-time cost: ~117 hours of build for Phase A (per Option A sliced schedule below). Tekmetric saved: $4,800/yr and continuing. Payback: well under a year.

---

## 1.5 — This Is Not A Standalone App

**Critical constraint: the shop ops system must flow hand-in-hand with the existing inventory management system.** Not bolted on, not a separate tool — an extension of the same Supabase + React PWA (`inspection-app`) that already drives inventory, lot tracking, inspections, dispatch, and sold reports.

### Concrete integration points

| Existing system | Shop ops integration |
|---|---|
| `inventory` table (stock_number PK, VIN, Y/M/M, `added_costs`, `days_on_lot`) | All RO data keys off `stock_number`. `vehicle_recon_costs` view rolls up actual spend from `parts_orders` + labor, pushed to `inventory.added_costs`. |
| **Inventory page** (card list sorted by days on lot) | Each card gains: open-RO badge, which shop(s), in-shop days, budget gauge ($847/$2000), tech avatars. Existing sort/filter logic unchanged. |
| **Lot Walk** + `vehicle_locations` (`physical_location` values like `body_shop`, `mechanic_section`) | An active RO automatically sets the car's `physical_location`. When outbound inspection signs off, flips to `on_lot` or `detail`. One source of truth for where a car is. |
| **Inbound inspection** (existing, will be extended) | Inspection output feeds template recommendations — "trans shutter noted" → suggests trans-shutter playbook. Qasim accepts or overrides. Damage entries auto-seed body RO lines. |
| **Outbound inspection** (existing test drive + sign-off) | Becomes the gate between "recon done" and "ready to detail." Sign-off flips car status and updates `inventory` accordingly. |
| **Dashboard** (existing stats: stuck, missing, needs dispatch) | Gains: Open ROs, Over-Budget Cars, Disposition Reviews, Composite Performance Index, Qasim's flag inbox count. |
| **Dispatch / auction-as-is kick-out** | Disposition Review's "send to auction" uses the existing dispatch workflow. No new auction plumbing. |
| **Sold Reports** | Recon cost + time (from `vehicle_recon_costs`) flows into cost basis. Every car's recon story is retrievable post-sale. |
| **Marketplace** (existing public listings) | A car only becomes marketplace-eligible after outbound inspection sign-off. Automatic state transition. |
| **Amex-only expense workflow** | `amex_transactions` reconciliation is an extension of the existing Amex expense work, not a parallel system. |
| **Frazer ingest** (Power Automate → `frazer-ingest` edge function) | Untouched. Cars still land via Frazer; shop ops system picks them up from `inventory` once ingested. When Frazer is eventually retired, the system keeps running — we have `inventory` already. |

### What this means architecturally

- **No second database.** Same Supabase project, same `inventory` table, same auth.
- **No second domain.** Everything served from the same PWA at one URL.
- **No data migration from Day 1** — the shop ops layer reads existing inventory directly.
- **Existing features aren't rewritten.** Lot Walk, Inventory, Sold Reports, Marketplace continue working unchanged; they gain new badges/joins that pull from shop-ops tables.
- **Single bottom nav** — tech sees `/my-jobs` as their primary tab; Qasim sees `/shop` + his flag inbox; Abdullah sees the composite dashboard. The app surfaces what you need based on role.

Anywhere in this plan where a new screen is mentioned, it's an addition to the existing PWA. The schema migrations are additive. The existing inspection flow extends for inbound/outbound rather than being replaced.

---

## 2. Operating Model (Source of Truth)

### Car journey
1. Buy → delivered
2. **Inbound inspection** (new flow, built alongside this system — PWA)
3. Park in mechanic or body shop
4. Load into system
5. **Qasim reviews** → picks procedure template(s) → assigns lines to techs by specialty
6. Techs execute lines; Start/Stop clock per line
7. **Outbound inspection** — already set up today, and stays that way:
   - Mechanic cars: test drive + mechanical checks + **Abdullah or Qasim signs off**
   - Body cars: visual inspection (panels, paint, alignment, finish) + sign-off
   - Both cars: whichever is more thorough; effectively the mechanical flow plus the visual check
8. Hand off to detail crew
9. Photos → list → sell

Sign-off is the gate. Nothing flips to "ready for detail" until signed.

### Shape of the operation
- ~350 cars rotating; ~175 in recon at any time
- 7-day target days-in-shop per car
- Current: 10-15 new ROs/day (~70-105/wk); target ~25/day to hit the 7-day SLA
- Both shops on-site, same address
- Car split: ~40% both shops / ~35% mech-only / ~20% body-only / ~5% clean-and-go
- 10 techs, specialized

### Qasim is the chokepoint
Single point of control for: procedure selection, tech assignment, parts ordering, final QC sign-off. Implications:
- Techs have no parts UI. They flag needs up to Qasim.
- Techs don't self-assign.
- **His entire workflow must run one-handed on a phone from bed.** The `/shop` command center is the most important screen in the app.
- Escalation: if Qasim doesn't respond to a flag in N hours → ping Abdullah.
- Backup `manager` role: Abdullah (or a delegate) can legitimately step in with Qasim's full permissions.

### Tech specialties
Trans / Engine-general / Electrical-diagnostics / Brakes-suspension / AC-HVAC / Body-paint / Body-panel-PDR / Interior-upholstery. Techs can carry multiple. Playbook lines carry `required_specialty` to filter Qasim's tech picker.

---

## 3. The Core Concept: Procedure Playbooks

Qasim doesn't make up work per car — he runs playbooks by symptom. Example (transmission):

```
Transmission symptoms:
├─ Shutter        → service trans (fluid + filter)
├─ Hard shift     → reprogram
├─ Slipping/noisy → service trans + change filter
└─ Totally gone   → price replacement via car-part.com
   ├─ >$2k  → try to sell as-is at auction first
   │          (unless shops are slow — then override)
   └─ <$2k  → order trans + fluid → install
```

**10-15 total templates** across subsystems (trans, engine, electrical, brakes/susp, AC, body-paint, body-panel, interior, inbound inspection, outbound QC, plus a few more). Authored collaboratively with Abdullah over time — not a Day 1 deliverable. Seed initial playbooks from JSON/SQL, build authoring UI later.

**Multi-stack:** one car commonly gets multiple templates (e.g., trans + brakes + AC). Lines append to the same RO per shop (one mechanic RO, one body RO per car).

**Templates carry parts seeds.** "Service trans" auto-resolves fluid qty + type + filter PN for that specific car via the VIN-aware spec cache (see §5).

**Template versioning:** cars lock to the version in effect when applied. Template edits don't destabilize in-flight work.

---

## 4. The $2,000 Recon Budget

Hard business rule: **total recon cost per car should not exceed $2,000** (parts + external services). Over-budget = default path is "sell as-is at auction first."

**Capacity override:** when shops are slow and techs would otherwise be idle, repair anyway — fixing beats selling low when there's nothing else to do.

**System behavior:**
- Every car has a live budget gauge: spent / $2,000.
- Applying a template or adding a line → system projects the incremental cost. If total would exceed $2k, car is flagged for **Disposition Review**.
- Disposition Review card on Qasim's dashboard shows: projected cost, estimated resale delta, **current shop capacity %** inline (don't make him switch screens), and two actions:
  - "Send to auction as-is" → triggers the existing dispatch flow
  - "Override — continue repair" → logs reason + Qasim/Abdullah sign-off
- Amex-matched actuals reconcile the budget as they land (real spend, not just estimates).

Not a hard block. A prompt for explicit decision.

---

## 5. VIN-Aware Parts Specs (The Compounding Win)

"Service trans" on a 2020 RAV4 needs to know: WS fluid, 4.2 qt, filter PN 35330-0W040. Today Qasim looks that up in AllData every time.

**Three-tier strategy (builds compounding value):**

1. **Internal spec cache** (Day 1). Table `vehicle_specs` keyed by Y/M/M/engine, arbitrary `spec_type` (trans_fluid, oil, brake_pads, wipers, battery, etc.) with `value` + `source`. Starts empty. First car of each Y/M/M seeds it; every subsequent car auto-fills.
2. **AllData Chrome extension** (Phase B). Same pattern as your SmartAuction extension. On any AllData labor/specs page, "Send to Carz cache" button captures the value with one click.
3. **PartsTech / RepairLink APIs** (later) as fallback VIN-based lookups.

Extends beyond fluids — tire sizes, battery groups, oil spec, brake pads by axle, etc. Any recurring parts decision.

---

## 6. Tech-Side Workflow

Techs work from phones. Mobile-first. i18n required (EN / ES / AR with RTL for Arabic).

**`/my-jobs`** — every tech's primary screen:
- Lines assigned to them, sorted by car age
- Big **Start / Stop** button per line (one clock running at a time — switching auto-stops prior)
- Status dropdown: in progress / waiting parts / waiting person / done
- Note thread per line
- **Flag to Qasim** button on every line AND on the car header
  - Photo strongly encouraged, voice memo optional with auto-transcribe + translate to Qasim's language
  - Tech sees status back: "Qasim reviewing" → "Added to RO" or "Dismissed: …"
- Parts tracking surfaced when line is `waiting_parts` (vendor, order #, ETA, tap-through to carrier tracking)

### Clock = Payroll Policy
Techs must Start/Stop. Enforcement: **no tracked hours = no pay.**
- Offline queue (shop Wi-Fi gaps can't cost a tech money) — non-negotiable
- Anti-tamper: techs can't edit their own historical entries; only managers
- Auto-close with confirmation at end of day ("you've been clocked 9h — confirm or adjust")
- Tech sees their own daily/weekly hours in real time so payroll expectations match
- **i18n isn't cosmetic** — if a Spanish or Arabic tech can't read "close your clock," they lose money. Translation is fairness.

Weekly payroll CSV export per tech, with clickable drill-down to car/line.

---

## 7. Qasim-Side Workflow

Phone-first. Every action from bed.

**`/shop`** — the command center:
- Car list sorted by days-in-shop DESC
- Filter chips: All / Mechanic / Body / Both / Waiting Parts / Over Budget / Stuck ≥7d
- Each row: Y/M/M, stock, days in shop, active RO chips, assigned tech avatars, budget gauge
- Top of page: **unread flags inbox** (unmissable, push-notified)
- Bottom sheet actions: apply template, assign tech (filtered by specialty), order parts

**`/shop/:stock`** — per-car:
- Two RO panels (mechanic + body), tabbed on phone
- Live cost rollup + budget gauge
- Line list with inline: assign / status / notes / flag-resolution / parts link
- Activity log

**`/workload`** — "are my techs stacked?":
- One column per tech, showing active lines, open book hours, oldest line age
- Color coded: <2h queued = red, 2-8h = green, >8h = yellow
- Reassign by dragging (desktop) / long-press (mobile)

**`/parts`** — ordering (Qasim only):
- Current draft parts orders per RO
- One-click vendor deep links with VIN prefilled: **PartsTech (70% volume, the priority)**, car-part.com (20%), Amazon (5%), eBay (5%)
- When the PartsTech API lands (late Phase A), orders go direct — no deep link needed
- Templates pre-seed parts lists so ordering is usually one click

**`/amex`** — reconciliation:
- Upload Amex CSV → three-column view: auto-matched / ambiguous / unmatched
- Matches by amount + date window + merchant regex (accounting for PartsTech routing to AUTOZONE/NAPA/OREILLY/WORLDPAC)
- Unmatched Amex = mystery spend to investigate; unmatched parts orders = vendor shipped but no charge yet

---

## 8. Analytics

**`/dashboard` hero — Composite Performance Index** (MTD vs. prior-month daily average):

| Component | Direction | Scoring (normalized to 100) |
|---|---|---|
| Cars completed/day | higher = better | `(MTD_cars / MTD_days) / prior_month_daily_avg × 100` |
| Avg days-in-shop | lower = better, 7d target | `min(100, 7 / actual × 100)` |
| Efficiency % (book/actual) | higher = better | direct ratio, capped at 120 |
| Recon spend per car | lower = better | `prior_month_avg / MTD_avg × 100` |

**Composite = average of the four.** 100 = matching last month's pace. Arrow + color + delta.

Below the hero: all four components displayed individually with their own deltas, so the composite is honest and you can see WHY it moved. Equal weights initially; tune later from data.

**`/performance`** — per-tech scorecard. All five metrics tracked per tech: hours logged / efficiency vs book / jobs closed / comeback rate / cars completed. Trend indicators week-over-week. Sortable leaderboard of all 10 techs. Click a tech → drill to their job history with per-job over/under vs book.

---

## 9. Integrations

### Parts — volume-weighted priority

| Vendor | Volume | Approach | Phase |
|---|---|---|---|
| **PartsTech** (routes to AutoZone/NAPA/O'Reilly/WorldPac) | 70% | **Real API** — VIN-based search, order placement, order status | Late Phase A |
| car-part.com | 20% | Chrome extension to capture part + price from site; email parser | Early Phase B |
| Amazon | 5% | Deep-link search + email parser for confirmations | Early Phase B |
| eBay | 5% | Deep-link search + email parser for confirmations | Early Phase B |
| RepairLink | ~0% | Shop account exists but unused today — skip unless usage grows | n/a |

PartsTech's Amex merchant strings come through as the sub-supplier name, so the matcher has to know the supplier mapping.

### AllData Pro
No public API. Chrome extension (Phase B) captures book hours + spec data from AllData pages with one click into: (a) the RO line's `book_hours`, (b) the `vehicle_specs` cache.

### Amex
Custom CSV ingest → `amex_transactions` table → auto-match to `parts_orders` by amount ± $1 / ±5 day window / merchant regex. Ambiguous flagged for manual resolution. Unmatched flagged for Abdullah to investigate.

---

## 10. Data Model (high-level)

```
profiles                              -- existing, extended
  + language ('en'|'es'|'ar')
  + shop_role ('tech'|'manager'|'admin'|'inspector')
  + specialties array                 -- trans, engine, electrical, etc.

procedures                            -- NEW: the playbook catalog
  id, name, subsystem, version,
  decision_tree jsonb,                -- symptom → branch → lines + parts
  active bool

repair_orders                         -- NEW
  id, stock_number FK, vin, type ('mechanic'|'body'),
  status, opened_at, closed_at,
  labor_minutes_cached, parts_cents_cached,
  source_inspection_id FK

ro_lines                              -- NEW
  id, ro_id FK, procedure_id FK nullable (which playbook seeded it),
  description_en/es/ar, source_lang,
  assigned_to_user_id FK,
  status, blocked_on_user_id FK nullable, waiting_parts_order_id FK nullable,
  book_hours, actual_minutes (cached sum),
  required_specialty

ro_line_time_entries                  -- NEW: the clock
  id, ro_line_id FK, user_id FK,
  started_at, ended_at, stopped_reason
  UNIQUE one-open-per-user constraint

ro_flags                              -- NEW: flag-to-Qasim
  id, ro_line_id FK nullable, stock_number FK,
  from_user_id, to_user_id (usually Qasim),
  body, photo_url, audio_url, transcript,
  status ('open'|'added_to_ro'|'dismissed'),
  escalated_at, resolved_by_user_id

parts_orders                          -- NEW
  id, ro_id FK nullable, stock_number FK,
  vendor, sub_supplier (for PartsTech routing),
  external_order_number, status,
  ordered_at, expected_delivery, tracking_url, carrier,
  expected_cents, actual_cents

parts_order_items                     -- NEW
  id, parts_order_id FK, part_number, description,
  qty, unit_cents, line_cents, fitment_vin

amex_transactions                     -- NEW
  id, posted_date, amount_cents, merchant_raw,
  matched_parts_order_id FK nullable, match_confidence

vehicle_specs                         -- NEW: the compounding cache
  id, year, make, model, engine_code nullable,
  spec_type (trans_fluid, oil, battery, etc.),
  value (fluid type, qty, PN, size),
  source ('manual'|'extension'|'api'),
  first_seen_at, verified_by_user_id

dispositions                          -- NEW: auction-as-is decisions
  id, stock_number FK, decided_by_user_id,
  decided_at, projected_cost_cents,
  capacity_percent, reason,
  outcome ('auction_as_is'|'override_repair')

--- views ---
car_recon_rollup      -- stock, book_hours, actual_hours, hours_gap,
                        parts_cents, jobs_open, jobs_done, days_in_shop
tech_performance      -- user_id, week, all 5 metrics, trends
composite_performance -- MTD + prior-month-avg + delta, 4 components
```

Unique indexes:
- `one_active_ro_per_type_per_car` on `repair_orders(stock_number, type) WHERE status != 'closed'`
- `one_running_clock_per_user` on `ro_line_time_entries(user_id) WHERE ended_at IS NULL`

---

## 11. Option A: Sliced Delivery

Each slice is independently useful. Stop after any of them if the signal is wrong; continue if it's right.

### Slice 1 — Core loop (~38h)
Ships the thing that actually changes how the shop runs.

- Schema + migrations + triggers
- `/shop` car-centric hub (Qasim command center, mobile-first)
- `/shop/:stock` per-car view with both RO panels
- `ro_lines` CRUD with line-level assignment
- **Start/Stop clock** with offline queue, anti-tamper, auto-close
- Budget gauge + $2k overrun flag
- Basic disposition review path

After Slice 1, techs are clocking time against cars and Qasim is running the shop from this app.

### Slice 2 — Tech surface + Flag-to-Qasim (~28h)
- `/my-jobs` — tech home screen, mobile-first
- EN/ES/AR i18n chrome + RTL pass
- Auto-translate edge function for user content (labor descriptions, notes)
- **Flag to Qasim** end-to-end (line + car-header flags, photo, voice memo, Qasim inbox, triage, status echo back to tech)
- Push notifications for flags
- Phone collection for the 10 techs

After Slice 2, the verbal-shop-noise workflow dies. All tech-to-Qasim comms run through the app.

### Slice 3 — Templates + Playbooks (~20h)
- `procedures` schema + JSON-seeded initial templates
- Qasim's template picker (bottom sheet, multi-select, apply to car)
- Decision-tree runner (symptom → branch → spawn lines)
- `vehicle_specs` cache with manual-fill-on-first-miss
- Template-seeded parts lists per car

After Slice 3, Qasim stops scoping work line-by-line. He picks playbooks.

### Slice 4 — Parts + Amex + Analytics (~31h)
- `/parts` Qasim-only screen with deep links (PartsTech/car-part/Amazon/eBay)
- PartsTech API integration (real ordering + status)
- Email ingestion edge function for car-part/Amazon/eBay confirmations
- `/amex` CSV upload + reconciliation UI
- `/performance` per-tech scorecard
- `/dashboard` Composite Performance Index + components

After Slice 4, Phase A is feature-complete.

### Phase B (additive, when pain justifies)
- AllData Pro Chrome extension (~12h)
- RepairLink API (~12h) — only if usage grows
- Tekmetric cutover / data migration (~TBD hrs)
- Template authoring UI (when 10-15 templates stabilize)

**Phase A total: ~117h.** Slice 1 alone (~38h) is enough to know if the whole direction is right.

---

## 12. Open Questions (Not Blocking Planning)

- **Who picks the template?** Inbound inspector recommends → Qasim confirms, OR Qasim alone once car arrives? Affects inbound inspection flow design.
- **Composite weighting tuning.** Equal weights initially, but let's revisit after 60 days of real data.
- **Both-shops car sequencing.** Body → mechanic, or mechanic → body? Matters for workflow hand-off, probably body first (paint cure, avoid mechanical tests on fresh panels) — confirm.
- **Body tech sign-off.** Does body tech marking done move the car straight to detail, or is there a (currently absent) body walk-around worth adding later?
- **Flag escalation timing.** How many hours before unanswered flag → ping Abdullah? 2? 4? Per-flag tunable?
- **Detail crew workflow.** Is detail a role in the app (status transitions, tracked hours) or just the physical handoff?
- **Tekmetric migration.** Cutover hard or run parallel for N weeks? Does in-flight RO data need to come over, or start fresh at go-live?
- **Tech phones.** 10 phones to collect. Holdouts → email+password fallback.
- **Translation vendor.** DeepL has a 500k char/mo free tier that covers this comfortably. Confirm OK before implementation.

---

## 13. What This Gives You That Tekmetric Can't

- **Per-car cost + time rollup** into `inventory.added_costs` driving resale price. Tekmetric is customer-invoice-shaped and can't do this.
- **$2k recon budget enforcement** with shop-capacity-aware override. A bespoke disposition trigger, not a generic threshold.
- **Procedure playbooks** specific to Carz Inc symptomatics (trans decision tree, etc.) — not a generic job catalog.
- **Amex reconciliation** as first-class, tying real spend to specific cars.
- **Flag-to-Qasim** kills the verbal upward-reporting problem.
- **Compounding spec cache** — every car makes the next car faster.
- **Multilingual tech UX at the payroll-source-of-truth level** — EN/ES/AR with RTL, because miscommunication costs a tech money.
- **A PWA you own.** No per-seat pricing, no feature gates, no migration risk if the vendor pivots.

---

*Ready for redline. Call out anything that looks wrong and we'll revise before cutting any code.*
