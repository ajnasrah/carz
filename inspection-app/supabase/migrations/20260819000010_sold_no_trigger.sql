-- Get the Frazer sold load back to exactly what it was: a truncate and a bulk
-- insert into a bare table. No triggers, no extra indexes, nothing of mine in
-- the path.
--
-- I attached a trigger to build sold_book, then made it statement-level when the
-- run got slower, and it was STILL slower — because any work inside the load is
-- work the load did not do before. The ledger is my idea; it has no business
-- costing the daily sync a second. It runs out of band instead, against the same
-- rows, after they land.
DROP TRIGGER IF EXISTS sold_to_book_stmt ON public.sold;
DROP TRIGGER IF EXISTS sold_to_book ON public.sold;
DROP FUNCTION IF EXISTS public.sold_to_book_stmt();
DROP FUNCTION IF EXISTS public.sold_to_book();

-- These were mine too. A truncate-and-reload table pays for every index on every
-- row inserted, and nothing queries `sold` by these columns — the reports read
-- sold_clean and pull the whole table.
DROP INDEX IF EXISTS public.sold_stock;
DROP INDEX IF EXISTS public.sold_vin;
DROP INDEX IF EXISTS public.sold_date;

-- The same merge, callable on its own. Idempotent: run it as often as you like.
CREATE OR REPLACE FUNCTION public.merge_sold_to_book()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  INSERT INTO sold_book (
    vin, stock_number, year, make, model, odometer, sale_date, sale_price,
    total_cost, added_costs, net_profit, days_on_lot, buyer, vendor, customer, title_in)
  SELECT DISTINCT ON (vin, sale_date) * FROM (
    SELECT
      upper(NULLIF(btrim(COALESCE(s.vehicle_vin, '')), ''))            AS vin,
      NULLIF(btrim(COALESCE(s.stock_number, '')), '')                  AS stock_number,
      frazer_num(s.vehicle_year)::int                                  AS year,
      s.vehicle_make                                                   AS make,
      s.vehicle_model                                                  AS model,
      frazer_num(s.mileage)::int                                       AS odometer,
      frazer_date(s.sale_date)                                         AS sale_date,
      frazer_num(s.sales_price)                                        AS sale_price,
      frazer_num(s.total_cost)                                         AS total_cost,
      frazer_num(s.added_costs)                                        AS added_costs,
      frazer_num(COALESCE(s.profit_on_sale, s.net_profit))             AS net_profit,
      frazer_num(s.days_on_lot)::int                                   AS days_on_lot,
      s.buyer, s.vendor,
      NULLIF(btrim(COALESCE(s.customer, '') || ' '
        || COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')), '') AS customer,
      s.title_in
    FROM public.sold s
  ) z
  WHERE z.vin IS NOT NULL AND z.sale_date IS NOT NULL
  ON CONFLICT (vin, sale_date) DO UPDATE SET
    stock_number = COALESCE(EXCLUDED.stock_number, sold_book.stock_number),
    sale_price   = COALESCE(EXCLUDED.sale_price,   sold_book.sale_price),
    total_cost   = COALESCE(EXCLUDED.total_cost,   sold_book.total_cost),
    added_costs  = COALESCE(EXCLUDED.added_costs,  sold_book.added_costs),
    net_profit   = COALESCE(EXCLUDED.net_profit,   sold_book.net_profit),
    days_on_lot  = COALESCE(EXCLUDED.days_on_lot,  sold_book.days_on_lot),
    buyer        = COALESCE(EXCLUDED.buyer,        sold_book.buyer),
    vendor       = COALESCE(EXCLUDED.vendor,       sold_book.vendor),
    customer     = COALESCE(EXCLUDED.customer,     sold_book.customer),
    title_in     = COALESCE(EXCLUDED.title_in,     sold_book.title_in),
    updated_at   = NOW();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.merge_sold_to_book() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_sold_to_book() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
