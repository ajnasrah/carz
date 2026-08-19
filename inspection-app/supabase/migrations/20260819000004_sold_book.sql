-- A sold book that Frazer can actually fill, and that keeps its history.
--
-- WHAT WAS WRONG
-- `sold` existed as the Power Automate target (frazer-ingest?target=sold) but was
-- never created by a migration and never received a row: no vin, no sales_price,
-- no net_profit, no customer. Nothing could join to it and nothing could be
-- earned from it. Meanwhile every profit figure in the system — the Target Buy
-- List's "Avg $", the vendor study, seller performance — came from
-- `wholesale_sold`, which was hand-loaded ONCE on 2026-07-29 and never again.
--
-- THE TRUNCATE PROBLEM
-- frazer-ingest truncates the target before each load, which is right for
-- inventory (a snapshot of what we own) and wrong for sold (a ledger). A
-- truncate-reload sold table would only ever hold whatever window the last
-- export covered, and the July history would vanish on the first sync.
--
-- So there are two tables. `sold` is the landing pad, shaped exactly like the
-- Frazer CSV and safe to truncate. `sold_book` is the ledger: a trigger merges
-- every landed row into it by (vin, sale_date), so history accumulates across
-- exports no matter how narrow any single one is. Everything reads sold_book.

-- ---------------------------------------------------------------------------
-- 1. Landing pad. Columns are the normalised Frazer sold headers — the ingest
--    maps header -> column by name and the INSERT fails on any column it cannot
--    find, so this is deliberately generous: every inventory column (the sold
--    export is the same report plus the sale) alongside the sale fields.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.sold CASCADE;
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
  buyer               TEXT,          -- our buyer: OMAR / A J / TONY
  vendor              TEXT,          -- where we bought it
  customer            TEXT,          -- who we sold it to
  location_code       TEXT,
  total_cost          TEXT,
  added_costs         TEXT,
  sales_price         TEXT,
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
ALTER TABLE public.sold ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sold_read ON public.sold;
CREATE POLICY sold_read ON public.sold FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.sold TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The ledger. Typed, deduped, and never truncated.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sold_book (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin           TEXT NOT NULL,
  stock_number  TEXT,
  year          INT,
  make          TEXT,
  model         TEXT,
  odometer      INT,
  sale_date     DATE,
  sale_price    NUMERIC,
  total_cost    NUMERIC,
  added_costs   NUMERIC,
  net_profit    NUMERIC,
  days_on_lot   INT,
  buyer         TEXT,
  vendor        TEXT,
  customer      TEXT,
  title_in      TEXT,
  source        TEXT NOT NULL DEFAULT 'frazer',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- A VIN can genuinely sell twice (a car that came back), so the key is the pair.
CREATE UNIQUE INDEX IF NOT EXISTS sold_book_vin_date ON public.sold_book (vin, sale_date);
CREATE INDEX IF NOT EXISTS sold_book_sale_date ON public.sold_book (sale_date DESC);
CREATE INDEX IF NOT EXISTS sold_book_vendor    ON public.sold_book (vendor);
ALTER TABLE public.sold_book ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sold_book_read ON public.sold_book;
CREATE POLICY sold_book_read ON public.sold_book FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.sold_book TO anon, authenticated;

-- Money and dates arrive as text from a CSV: "$1,234.00", "8/5/2026", "".
CREATE OR REPLACE FUNCTION public.frazer_num(t text)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(regexp_replace(COALESCE(t, ''), '[^0-9.\-]', '', 'g'), '')::numeric;
$$;
CREATE OR REPLACE FUNCTION public.frazer_date(t text)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF COALESCE(btrim(t), '') = '' THEN RETURN NULL; END IF;
  BEGIN RETURN t::date; EXCEPTION WHEN others THEN NULL; END;
  BEGIN RETURN to_date(t, 'MM/DD/YYYY'); EXCEPTION WHEN others THEN RETURN NULL; END;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Landing -> ledger. Runs per inserted row, so a Power Automate load merges
--    itself with no second call to remember.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sold_to_book()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_vin text; v_date date;
BEGIN
  v_vin  := upper(NULLIF(btrim(COALESCE(NEW.vehicle_vin, '')), ''));
  v_date := frazer_date(NEW.sale_date);
  -- No VIN or no date and the row cannot be keyed or trusted; it stays in the
  -- landing table where it can be inspected, and out of the ledger.
  IF v_vin IS NULL OR v_date IS NULL THEN RETURN NEW; END IF;

  INSERT INTO sold_book (
    vin, stock_number, year, make, model, odometer, sale_date, sale_price,
    total_cost, added_costs, net_profit, days_on_lot, buyer, vendor, customer, title_in)
  VALUES (
    v_vin, NULLIF(btrim(COALESCE(NEW.stock_number,'')),''),
    frazer_num(NEW.vehicle_year)::int, NEW.vehicle_make, NEW.vehicle_model,
    frazer_num(NEW.mileage)::int, v_date, frazer_num(NEW.sales_price),
    frazer_num(NEW.total_cost), frazer_num(NEW.added_costs), frazer_num(NEW.net_profit),
    frazer_num(NEW.days_on_lot)::int, NEW.buyer, NEW.vendor, NEW.customer, NEW.title_in)
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

DROP TRIGGER IF EXISTS sold_to_book ON public.sold;
CREATE TRIGGER sold_to_book AFTER INSERT ON public.sold
  FOR EACH ROW EXECUTE FUNCTION public.sold_to_book();

-- ---------------------------------------------------------------------------
-- 4. Carry the July history across before anything is dropped. Marked so it is
--    always clear which rows predate the automated feed.
-- ---------------------------------------------------------------------------
INSERT INTO public.sold_book
  (vin, year, make, model, odometer, sale_date, sale_price, total_cost,
   added_costs, net_profit, days_on_lot, buyer, vendor, customer, title_in, source)
SELECT upper(w.vin), w.year, w.make, w.model, w.odometer, w.sale_date, w.sale_price,
       w.total_cost, w.added_costs, w.net_profit, w.days_on_lot, w.buyer, w.vendor,
       w.customer, w.title_in, 'wholesale_sold_import'
FROM public.wholesale_sold w
WHERE w.vin IS NOT NULL AND w.sale_date IS NOT NULL
ON CONFLICT (vin, sale_date) DO NOTHING;

NOTIFY pgrst, 'reload schema';
