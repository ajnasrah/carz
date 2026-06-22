-- SmartAuction Buyer-Match Engine
-- Training data (sold reports w/ buyer contact), active inventory, and cached recommendations.
-- Theory validated against 1,037 sold rows: 82% of volume from 144 repeat buyers,
-- distinct learnable signatures (make affinity + price band + mileage band + geography).

-- ---------------------------------------------------------------------------
-- 1. TRAINING DATA — one row per sold car, deduped by VIN. Grows daily.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sa_sold_sales (
    vin             text PRIMARY KEY,
    year            int,
    make            text,
    model           text,
    trim            text,
    drivetrain      text,
    odometer        int,
    color           text,
    segment         text,          -- truck/suv/car/van/ev (computed on ingest)
    price_tier      text,          -- compact/midsize/fullsize/luxury within segment
    sale_date       date,
    sale_price      numeric,
    -- buyer (the label we learn from)
    buyer_name      text NOT NULL,
    buyer_email     text,
    buyer_phone     text,
    buyer_city      text,
    buyer_state     text,
    buyer_zip       text,
    seller          text,
    source          text DEFAULT 'smartauction',
    ingested_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sa_sold_buyer   ON sa_sold_sales(buyer_name);
CREATE INDEX IF NOT EXISTS idx_sa_sold_make    ON sa_sold_sales(make);
CREATE INDEX IF NOT EXISTS idx_sa_sold_segment ON sa_sold_sales(segment);
CREATE INDEX IF NOT EXISTS idx_sa_sold_date    ON sa_sold_sales(sale_date);

-- ---------------------------------------------------------------------------
-- 2. ACTIVE INVENTORY — current SmartAuction active list (replace on each upload).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sa_active_cars (
    vin             text PRIMARY KEY,
    year            int,
    make            text,
    model           text,
    trim            text,
    drivetrain      text,
    odometer        int,
    color           text,
    segment         text,
    price_tier      text,
    buy_now         numeric,       -- our asking / strongest per-car value anchor
    opening_price   numeric,
    location        text,
    auction_end     timestamptz,
    detail_url      text,
    uploaded_at     timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. RECOMMENDATIONS — cached top-N buyers per active car. Recomputed on upload.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sa_recommendations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    active_vin      text REFERENCES sa_active_cars(vin) ON DELETE CASCADE,
    rank            int,                 -- 1,2,3
    buyer_name      text,
    buyer_email     text,
    buyer_phone     text,
    buyer_state     text,
    predicted_price numeric,            -- CMV x buyer premium (display $)
    score           numeric,            -- confidence-weighted composite (ranking key)
    confidence      text,               -- high/medium/low (sample support)
    reason          text,               -- human-readable "why this buyer"
    computed_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sa_reco_active ON sa_recommendations(active_vin, rank);

-- ---------------------------------------------------------------------------
-- 4. Segment classifier — shared by ingest so SQL and JS agree.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sa_segment(make text, model text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH m AS (SELECT lower(coalesce(make,'') || ' ' || coalesce(model,'')) AS s)
  SELECT CASE
    WHEN (SELECT s FROM m) ~ '(silverado|sierra|f-?150|f-?250|f-?350|ram 1500|ram 2500|tundra|tacoma|ranger|colorado|canyon|frontier|titan|ridgeline|gladiator|maverick|super duty|1500|2500|3500)' THEN 'truck'
    WHEN (SELECT s FROM m) ~ '(transit|express|promaster|sienna|odyssey|carnival|pacifica|caravan|sprinter)' THEN 'van'
    WHEN (SELECT s FROM m) ~ '(tesla|model 3|mach-e|ev6|id\.4|lyriq|mullen|ioniq|bolt|leaf)' THEN 'ev'
    WHEN (SELECT s FROM m) ~ '(tahoe|suburban|yukon|expedition|explorer|escape|equinox|traverse|blazer|pilot|highlander|4runner|rav4|cr-?v|rogue|pathfinder|murano|telluride|palisade|santa fe|sorento|wrangler|grand cherokee|cherokee|compass|renegade|bronco|edge|nautilus|cx-9|cx-5|outlander|ascent|atlas|tiguan|durango|acadia|enclave|escalade|navigator|q5|x5|gx|rx|kona|tucson|seltos|encore|trailblazer|envision|corsair|aviator)' THEN 'suv'
    ELSE 'car'
  END;
$$;

-- ---------------------------------------------------------------------------
-- RLS — authenticated app users read/write (mirrors existing tables).
-- ---------------------------------------------------------------------------
ALTER TABLE sa_sold_sales      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_active_cars     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_recommendations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "rw sold"   ON sa_sold_sales      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "rw active" ON sa_active_cars     FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "rw reco"   ON sa_recommendations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
