-- RESTORE `sold` to the shape the app and the daily Frazer flow expect.
--
-- WHAT I GOT WRONG, so nobody repeats it
-- 20260819000004 dropped and recreated `sold` after concluding it was an empty,
-- unusable stub. Both halves of that conclusion were wrong:
--
--   1. Row count. Probed with the ANON key, `sold` reports 0 rows — because it
--      is RLS-protected and has no anon policy. The app reads it as a signed-in
--      user. An empty count under anon means "not visible", not "not there".
--
--   2. Columns. I probed for vin / sale_price / net_profit / customer, got
--      "column does not exist", and read that as missing data. The columns are
--      really vehicle_vin / sales_price / profit_on_sale / first_name+last_name.
--      The data was all there under Frazer's own names.
--
-- `sold` is the live profit book, loaded by Power Automate, and it is what
-- SoldReports.jsx reads through services/soldReports.js. The CASCADE also took
-- the `sold_clean` view, which was never in a migration.
--
-- The rows come back on the next Frazer load: frazer-ingest truncates and
-- reloads the FULL export every run, which is how this table has always been
-- filled. This migration restores the schema so that load lands instead of
-- erroring on a missing column.

DROP TRIGGER IF EXISTS sold_to_book ON public.sold;
DROP TABLE IF EXISTS public.sold CASCADE;

-- Columns are deliberately generous. frazer-ingest maps every CSV header to a
-- column and one unknown column fails the whole 500-row batch, so a spare column
-- costs nothing and a missing one costs the load.
CREATE TABLE public.sold (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_number        TEXT,
  vehicle_vin         TEXT,
  last_6_vin          TEXT,
  vehicle_year        TEXT,
  vehicle_make        TEXT,
  vehicle_model       TEXT,
  vehicle_color       TEXT,
  vehicle_source      TEXT,
  vehicle_notes       TEXT,
  mileage             TEXT,
  engine              TEXT,
  buyer               TEXT,
  vendor              TEXT,
  first_name          TEXT,
  last_name           TEXT,
  customer            TEXT,
  location_code       TEXT,
  original_cost       TEXT,
  total_cost          TEXT,
  added_costs         TEXT,
  sales_price         TEXT,
  profit_on_sale      TEXT,
  net_profit          TEXT,
  days_on_lot         TEXT,
  purchase_date       TEXT,
  sale_date           TEXT,
  title_in            TEXT,
  title_number        TEXT,
  tag                 TEXT,
  gl_purchase_account TEXT,
  purchase_notes      TEXT,
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sold_stock  ON public.sold (stock_number);
CREATE INDEX IF NOT EXISTS sold_vin    ON public.sold (vehicle_vin);
CREATE INDEX IF NOT EXISTS sold_date   ON public.sold (sale_date);

-- Same posture as before: readable by a signed-in user, not by anon. This is the
-- profit book; it should never have been readable with the public key.
ALTER TABLE public.sold ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sold_read ON public.sold;
CREATE POLICY sold_read ON public.sold
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.sold TO authenticated;
REVOKE ALL ON public.sold FROM anon;

-- The typed projection the reports read. Text in, numbers out.
CREATE OR REPLACE VIEW public.sold_clean AS
  SELECT
    s.stock_number,
    NULLIF(regexp_replace(COALESCE(s.vehicle_year, ''), '[^0-9]', '', 'g'), '')::int   AS year,
    s.vehicle_make  AS make,
    s.vehicle_model AS model,
    NULLIF(regexp_replace(COALESCE(s.mileage, ''), '[^0-9]', '', 'g'), '')::int        AS mileage,
    public.frazer_date(s.sale_date)                                                    AS sale_date,
    NULLIF(regexp_replace(COALESCE(s.days_on_lot, ''), '[^0-9\-]', '', 'g'), '')::int  AS days_on_lot,
    public.frazer_num(s.original_cost)                                                 AS original_cost,
    public.frazer_num(s.total_cost)                                                    AS total_cost,
    public.frazer_num(s.sales_price)                                                   AS sales_price,
    public.frazer_num(COALESCE(s.profit_on_sale, s.net_profit))                        AS profit
  FROM public.sold s;
GRANT SELECT ON public.sold_clean TO authenticated;

-- Ledger feed, on the real column names this time. sold is truncate-reload, so
-- sold_book is what keeps history across exports.
CREATE OR REPLACE FUNCTION public.sold_to_book()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_vin text; v_date date;
BEGIN
  v_vin  := upper(NULLIF(btrim(COALESCE(NEW.vehicle_vin, '')), ''));
  v_date := frazer_date(NEW.sale_date);
  IF v_vin IS NULL OR v_date IS NULL THEN RETURN NEW; END IF;

  INSERT INTO sold_book (
    vin, stock_number, year, make, model, odometer, sale_date, sale_price,
    total_cost, added_costs, net_profit, days_on_lot, buyer, vendor, customer, title_in)
  VALUES (
    v_vin, NULLIF(btrim(COALESCE(NEW.stock_number,'')),''),
    frazer_num(NEW.vehicle_year)::int, NEW.vehicle_make, NEW.vehicle_model,
    frazer_num(NEW.mileage)::int, v_date, frazer_num(NEW.sales_price),
    frazer_num(NEW.total_cost), frazer_num(NEW.added_costs),
    frazer_num(COALESCE(NEW.profit_on_sale, NEW.net_profit)),
    frazer_num(NEW.days_on_lot)::int, NEW.buyer, NEW.vendor,
    NULLIF(btrim(COALESCE(NEW.customer, '') || ' '
      || COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')), ''),
    NEW.title_in)
  ON CONFLICT (vin, sale_date) DO UPDATE SET
    stock_number = COALESCE(EXCLUDED.stock_number, sold_book.stock_number),
    sale_price = COALESCE(EXCLUDED.sale_price, sold_book.sale_price),
    total_cost = COALESCE(EXCLUDED.total_cost, sold_book.total_cost),
    added_costs = COALESCE(EXCLUDED.added_costs, sold_book.added_costs),
    net_profit = COALESCE(EXCLUDED.net_profit, sold_book.net_profit),
    days_on_lot = COALESCE(EXCLUDED.days_on_lot, sold_book.days_on_lot),
    buyer = COALESCE(EXCLUDED.buyer, sold_book.buyer),
    vendor = COALESCE(EXCLUDED.vendor, sold_book.vendor),
    customer = COALESCE(EXCLUDED.customer, sold_book.customer),
    title_in = COALESCE(EXCLUDED.title_in, sold_book.title_in),
    updated_at = NOW();
  RETURN NEW;
END $$;

CREATE TRIGGER sold_to_book AFTER INSERT ON public.sold
  FOR EACH ROW EXECUTE FUNCTION public.sold_to_book();

NOTIFY pgrst, 'reload schema';
