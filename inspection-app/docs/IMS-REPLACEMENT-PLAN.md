# Carz Inc IMS — Frazer Replacement Plan

**Status:** Phase 1 not started. Awaiting Supabase Pro upgrade (Step 0).
**Owner:** Abdullah
**Last updated:** 2026-04-21

---

## 1. What we're building

A **wholesale-first, integration-native Inventory Management System** (`carzinc.ai`) that replaces Frazer DMS across every day-to-day workflow at Carz Inc. The IMS becomes the authoritative source for inventory, deals, titles, and floor-plan tracking. Frazer is retired in phases over 3–6 months.

The IMS is not a feature clone of Frazer. It's a re-framing of the same work around three principles that Frazer violates:

1. **API-first everything.** Every write/read is callable programmatically. No CSV uploads anywhere in the primary workflow.
2. **Wholesale-centric.** ~95% of Carz Inc volume is B2B wholesale. The IMS optimizes for that first. BHPH, retail compliance, and consumer-credit rules are scoped out of MVP and treated as optional fallbacks.
3. **Data safety as a hard constraint.** Every schema change is backed up, idempotent, dual-written, soft-deleted, and audited. We cannot lose a deal, a title, or a payment under any circumstance.

---

## 2. Why (the problems we're solving)

| Frazer pain | Cost today | IMS fix |
|---|---|---|
| Not integratable — every marketplace upload is manual | ~5 hrs/wk = ~$12K/yr in labor | IMS writes queue → Chrome extension auto-fills SA/MH/OVE/ADESA |
| CSV round-trip to Power Automate → Supabase (hourly at best) | Stale inventory data | Live writes to IMS are the source |
| Can't share records with outside tools (QB, compliance, tag+title service) | Manual double-entry | IMS exposes REST endpoints for each record |
| Stock # reuse silently rolls old data forward onto new cars | Confused staleness metrics | Explicit `vehicle_id` UUID separate from stock number; stock reuse detected and logged |
| Zero audit trail on location/status changes | "Who moved this car?" is unanswerable | `ims_audit_log` logs every high-value write with user/before/after |
| $4K/yr license + time tax | ~$16.5K/yr total burden | Payback in year 1 vs one-time build cost |

---

## 3. Non-negotiables

### Data safety (hard rules — never break)

- **Supabase Pro + PITR enabled** — required before any Phase 1 write. 7–14 day rewind window is the last-resort backstop.
- **Dual-write during transitions** — every new Phase writes to BOTH the new IMS schema and the existing Frazer-backed tables until cut-over is verified for 30 days.
- **Idempotent + resumable migrations** — every bulk write is re-runnable without duplicates or loss.
- **Soft delete, never hard delete** — every table has `deleted_at TIMESTAMPTZ`. No row ever disappears; it gets hidden.
- **Audit trail on all high-value writes** — `ims_audit_log` records who/when/before/after for: inventory entry, deal creation, deal edits, payments, title status changes, floor-plan advances/curtailments.
- **Backup before destructive ops** — any schema migration, bulk update, or delete-by-criteria runs after a fresh `pg_dump` and is tested on a staging branch first.
- **No big-bang cut-overs** — phase out Frazer module by module with 30-day parallel runs. Single module flip per cut-over.

### Scope discipline

- **Wholesale first, always.** Retail-only features (Buyer's Guide, Red Flags Rule compliance, BHPH amortization, payment ledgers, collections) are Phase 3 optional. Don't build in MVP.
- **No Frazer deepening.** Any new integration (valuations, vehicle history, marketplace syndication) goes direct to the vendor API, not through Frazer's add-on layer.
- **Mobile-first UI.** Abdullah buys cars at auctions. The Buy-a-Car form must work well on a phone held one-handed at a noisy lane.

---

## 4. Three-phase plan

### Phase 1 — Wholesale pipeline (2–3 weeks)

**Goal:** IMS owns inventory. Every car bought is entered in IMS, not Frazer.

**Deliverables:**

1. **Buy-a-Car form** — VIN decode (NHTSA free API), 8–12 photos to Supabase Storage, vendor dropdown (OpenLane, Manheim, UAX, DAA, ADESA, private), cost + tax + doc fee capture, auto-assign stock number.
2. **Sell-a-Car form** — pick car, pick dealer, price + fees, auto-generate wholesale Bill-of-Sale PDF + invoice + TN odometer disclosure.
3. **B2B Dealer records** — once-per-dealer entry with EIN, license copy (file upload), address, contact. Reusable across deals.
4. **Title tracker** — inbound status (ordered → received → in-hand), outbound (mailed to dealer, tracking #, delivered). Staleness alerts at >30 days.
5. **SmartAuction listing queue** — IMS writes `ims_listings` row with status `queued`; existing Chrome extension consumes on next SA visit and auto-fills the listing form.
6. **Dual-write to Frazer** — every IMS inventory entry also writes to a Frazer-format CSV on disk that Power Automate continues to ingest. Audit cron compares IMS inventory to Frazer inventory daily and emails deltas.

**Exit criteria:**
- 7 consecutive days of zero-delta between IMS inventory and Frazer inventory
- PITR restore drill successful (restore to a separate project, verify data integrity)
- All team members trained on the Buy-a-Car and Sell-a-Car forms

### Phase 2 — Books + floor plan + state forms (2–3 weeks)

**Goal:** Every IMS deal produces all downstream paperwork and posts to accounting automatically.

**Deliverables:**

1. **QuickBooks sync** — deal closes → GJ entry auto-posts (revenue, COGS, fees, floor-plan payoff). Pick QuickBooks Online REST API.
2. **Tennessee state forms** — TN title transfer (Form RV-F1301201), dealer invoice, odometer disclosure. PDF generation per deal.
3. **Floor-plan tracker** — per-car NG/AFC attribution, advance amount, curtailment schedule (days since advance → what's due), payoff quote refresh, audit status. V1 is manual entry; V2 (Phase 2.5) adds API/scrape auto-refresh for NextGear + AFC portals.
4. **Deal reporting** — daily/weekly/monthly P&L by buyer, vendor, customer, vehicle type. Expands the existing Sold Reports tabs.

**Exit criteria:**
- Every deal writes to QB within 5 minutes
- Floor-plan curtailment calendar generates warnings ≥7 days before due
- TN title transfer PDF accepted by TN DMV on the first try

### Phase 3 — Optional: retail fallback + advanced compliance (1–2 weeks when triggered)

**Goal:** Handle the rare retail customer without BHPH complexity.

**Deliverables:**

1. **Retail deal form** — simple cash sale, no financing, no BHPH.
2. **Buyer's Guide PDF** — FTC requirement for used-car retail sales.
3. **TN sales tax collection** (retail only — wholesale is tax-exempt between dealers).

**Triggered only when:** retail volume exceeds 5 deals/month OR a specific deal justifies it.

---

## 5. Data model (Phase 1 schema sketch)

All tables in the `public` schema. All have `id UUID`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`, `deleted_at TIMESTAMPTZ NULL`, `created_by UUID`, `updated_by UUID`.

### `ims_vehicles`
Authoritative vehicle record. The permanent identity; stock numbers can be reused but `id` never is.
```
id                    UUID PK
vin                   TEXT NOT NULL        -- 17-char
stock_number          TEXT                 -- Frazer stock; may be reused over time
last_6_vin            TEXT                 -- denormalized
vehicle_year          INT
vehicle_make          TEXT
vehicle_model         TEXT
vehicle_color         TEXT
mileage               INT
status                TEXT                 -- in_inventory | sold | scrapped
sold_vehicle_id       UUID                 -- FK to ims_deals if status=sold
```

### `ims_purchases`
One row per acquisition. A car bought twice (rare) is two rows.
```
id                    UUID PK
vehicle_id            UUID FK ims_vehicles
purchase_date         DATE
vendor                TEXT                 -- OpenLane, Manheim, UAX, DAA, ADESA, private
vendor_ref            TEXT                 -- auction lane/run, private seller name
base_cost             NUMERIC
buyer_fees            NUMERIC              -- auction fees, pack, etc.
transport_cost        NUMERIC
total_cost            NUMERIC GENERATED    -- base+buyer_fees+transport
added_costs           NUMERIC DEFAULT 0    -- recon, fees added after purchase
floor_plan_lender     TEXT                 -- NEXTGEAR | AFC | CASH
floor_plan_advance    NUMERIC
floor_plan_advance_date DATE
notes                 TEXT
photos                JSONB                -- array of { path, uploaded_at }
```

### `ims_deals`
One row per sale.
```
id                    UUID PK
deal_number           TEXT UNIQUE
vehicle_id            UUID FK ims_vehicles
dealer_id             UUID FK ims_dealers
sale_date             DATE
sale_price            NUMERIC
doc_fee               NUMERIC
sales_tax             NUMERIC              -- 0 for wholesale
total                 NUMERIC GENERATED
payment_method        TEXT                 -- ACH | check | wire | cash
payment_ref           TEXT
status                TEXT                 -- pending | complete | cancelled
bill_of_sale_pdf_path TEXT                 -- Supabase Storage path
invoice_pdf_path      TEXT
odo_disclosure_pdf_path TEXT
```

### `ims_dealers`
B2B customer/vendor entities.
```
id                    UUID PK
name                  TEXT
ein                   TEXT
license_number        TEXT
license_expires       DATE
license_copy_path     TEXT                 -- PDF upload in Storage
address               TEXT
city                  TEXT
state                 TEXT
zip                   TEXT
phone                 TEXT
email                 TEXT
primary_contact       TEXT
notes                 TEXT
```

### `ims_title_events`
Immutable event log for title movement per vehicle.
```
id                    UUID PK
vehicle_id            UUID FK ims_vehicles
event_type            TEXT                 -- ordered | received | mailed_out | delivered | lost | replaced
event_date            DATE
tracking_number       TEXT
destination           TEXT                 -- ims_dealers.id as UUID or free-text
notes                 TEXT
```
Status is derived from the latest event, not stored.

### `ims_listings`
Marketplace listing queue.
```
id                    UUID PK
vehicle_id            UUID FK ims_vehicles
marketplace           TEXT                 -- SMART_AUCTION | MANHEIM | OVE | ADESA
status                TEXT                 -- queued | posting | listed | sold | removed
asking_price          NUMERIC
listed_at             TIMESTAMPTZ
removed_at            TIMESTAMPTZ
external_listing_id   TEXT                 -- SA listing number once posted
notes                 JSONB
```

### `ims_floor_plan`
Per-car floor plan state, one row per {vehicle, lender} combination.
```
id                    UUID PK
vehicle_id            UUID FK ims_vehicles
lender                TEXT                 -- NEXTGEAR | AFC
account_number        TEXT
advance_date          DATE
advance_amount        NUMERIC
curtailment_schedule  JSONB                -- [{ days: 30, pct: 10 }, …]
next_curtailment_due  DATE
next_curtailment_amt  NUMERIC
payoff_quote          NUMERIC
payoff_quote_at       TIMESTAMPTZ
audit_last_seen       DATE                 -- last audit where the car was present
status                TEXT                 -- active | paid_off
```

### `ims_audit_log`
Append-only trail of high-value writes. Never deleted.
```
id                    UUID PK
table_name            TEXT
row_id                UUID
action                TEXT                 -- INSERT | UPDATE | DELETE | SOFT_DELETE
before                JSONB
after                 JSONB
user_id               UUID
at                    TIMESTAMPTZ DEFAULT NOW()
```
Populated via Postgres triggers on each tracked table.

---

## 6. Integrations (Phase 1 targets)

| Integration | Purpose | Status |
|---|---|---|
| **NHTSA vPIC API** | Free VIN decode during Buy-a-Car | To integrate |
| **SmartAuction** | Auto-listing via existing Chrome extension | Already exists; wire IMS → extension queue |
| **Supabase Storage** | Photos (8–12 per car) + license PDFs + Bill-of-Sale PDFs | Available now, no setup |
| **Manheim MMR / Black Book / JD Power** | Pricing at Buy-a-Car time | Already have direct API subscriptions per earlier decision |
| **QuickBooks Online** | Phase 2 | Later |
| **NextGear dealer API** | Phase 2.5 — auto-refresh payoffs + curtailments | Later |
| **AFC portal** | Phase 2.5 — same, via scrape since their API is locked | Later |

---

## 7. Team workflow changes

### Before IMS (today)
1. Buy a car at auction
2. Email invoice to self
3. Manually enter in Frazer (10+ fields, ~5 min)
4. Upload photos to Frazer (separate flow)
5. Manually list on SA / MH / OVE / ADESA (15+ min each × 4 marketplaces)
6. Sell car: manually create BOS in Word, save PDF, email
7. Manually enter sale in Frazer
8. Manually post to QB

### After IMS (Phase 1)
1. Buy a car at auction → **open Buy-a-Car form on phone at the lane** (2 min)
2. Photos from phone (1 min)
3. Toggle "List on SA" → extension auto-fills when you next open SA (0 min from your side)
4. Sell car → Sell-a-Car form → BOS PDF auto-generated, emailed to dealer
5. Deal auto-logs to IMS

### After IMS (Phase 2)
Same as above, plus: QB posts automatically. TN title transfer PDF auto-generated. Floor-plan curtailment calendar sends you a reminder 7 days before each payment is due.

---

## 8. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Data loss during migration | Low | Catastrophic | PITR + 30-day dual-write + daily delta audit + pg_dump before destructive ops |
| IMS goes down during business hours | Medium | High | Frazer stays warm as a read-only fallback for 6 months post cut-over |
| State compliance gap (TN-specific form change) | Low-medium | Medium (rejected title) | Keep Frazer's form library accessible; manual review of first ~20 IMS-generated titles |
| Team resistance to new workflow | Medium | Medium | Mobile-first UI is chosen specifically because it's *faster* than Frazer, not just different; train + measure |
| SmartAuction breaks the extension again | Medium | Medium | IMS listing queue persists; when SA/extension is broken, queue waits. Team can still manually list in the meantime |
| Chrome extension distribution (team needs to install) | High | Low | Already solved — team has it today |

---

## 9. Success criteria

Phase 1 is "done" when ALL of these are true:

- [ ] Buy-a-Car form completes a new inventory entry in ≤3 minutes on a phone
- [ ] Sell-a-Car form produces a signed-ready BOS PDF in ≤2 minutes
- [ ] 7 consecutive days of zero delta between IMS and Frazer inventory
- [ ] PITR restore drill successful on a cloned project
- [ ] All team members have done one Buy and one Sell via the IMS
- [ ] SA listing queue has successfully auto-populated ≥5 listings via the extension

Phase 2 is "done" when:

- [ ] QB posts a sample deal correctly end-to-end
- [ ] TN DMV accepts an IMS-generated title transfer on first submission
- [ ] Floor-plan curtailment calendar has warned at least once about an upcoming payment
- [ ] Frazer is downgraded from "source" to "export target" — IMS is primary

Phase 3 is "done" when triggered by retail volume; not scheduled.

---

## 10. Timeline

| When | Milestone |
|---|---|
| Today | Plan approved. Supabase Pro upgrade blocker identified. |
| Day 1 (after Pro upgrade) | Schema migration + PITR verification |
| Day 2–3 | Buy-a-Car form live in dev |
| Day 4–5 | Buy-a-Car form live in prod (dual-write starts) |
| Day 6–7 | Dealer records + Sell-a-Car form in dev |
| Day 8–10 | Sell-a-Car live in prod; Title tracker added |
| Day 11–14 | SA listing queue + extension wire-up + dual-run monitoring |
| Day 15+ | Phase 1 hardening, team training, 30-day dual-run observation |
| Day 45+ | If dual-run clean, start Phase 2 (QB + state forms) |
| Day ~90 | Phase 2 complete; Frazer downgraded to export target |
| Day ~120 | Phase 3 (retail fallback) if needed |
| Day ~180 | Frazer subscription cancelled. IMS is the system of record. |

---

## Appendix: Decisions log

- **2026-04-11**: Chose to subscribe directly to Black Book + JD Power APIs instead of through Frazer's add-on (don't deepen Frazer dependency)
- **2026-04-21**: Committed to full IMS build. Wholesale-first. 95% B2B / 5% retail / 0% BHPH in MVP. Supabase Pro upgrade required before Phase 1.
- **2026-04-21**: Chose SmartAuction as Phase 1 auto-listing priority (highest volume)
- **2026-04-21**: Chose NextGear + AFC dual floor-plan tracking for Phase 2
