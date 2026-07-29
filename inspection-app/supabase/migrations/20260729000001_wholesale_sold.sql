-- Wholesale sold book — the profit/velocity side of our sold cars.
--
-- sa_sold_sales already tracks WHO bought each car (buyer-match training data),
-- but carries no economics. The Frazer sold export is the only source for
-- net profit, total/added cost and days on lot, which is what the Target Buy
-- List scorer needs to decide whether a run-list car is worth bidding on.
--
-- Upserted by VIN from the extension's Target Buy List uploader, so re-uploading
-- an overlapping export is safe and history accumulates past any single export
-- window.

CREATE TABLE IF NOT EXISTS wholesale_sold (
    vin             text PRIMARY KEY,
    year            int,
    make            text,
    model           text,
    odometer        int,
    sale_date       date,
    sale_price      numeric,
    total_cost      numeric,
    added_costs     numeric,
    net_profit      numeric,
    days_on_lot     int,
    buyer           text,          -- our buyer: OMAR / A J / TONY / ...
    vendor          text,          -- where we bought it
    customer        text,          -- who we sold it to
    title_in        text,
    ingested_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ws_make_model ON wholesale_sold(make, model);
CREATE INDEX IF NOT EXISTS idx_ws_sale_date  ON wholesale_sold(sale_date);
CREATE INDEX IF NOT EXISTS idx_ws_buyer      ON wholesale_sold(buyer);

-- RLS — mirrors the other app tables (anon/authenticated read+write).
ALTER TABLE wholesale_sold ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "rw wholesale_sold" ON wholesale_sold
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
