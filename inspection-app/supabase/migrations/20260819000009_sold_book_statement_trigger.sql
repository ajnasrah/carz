-- Merge sold -> sold_book once per batch, not once per row.
--
-- The FOR EACH ROW trigger added in 20260819000006 ran an INSERT .. ON CONFLICT
-- for every single row of the load. On a ~4,500 row export that is 4,500 separate
-- statements bolted onto what used to be a plain bulk insert, and it turned a
-- fast sync into a slow one — the load got noticeably longer the moment it
-- shipped, which is exactly what was reported.
--
-- A statement-level trigger with a transition table does the same merge as ONE
-- set-based upsert per 500-row chunk: nine statements for the whole export
-- instead of four and a half thousand.
DROP TRIGGER IF EXISTS sold_to_book ON public.sold;
DROP FUNCTION IF EXISTS public.sold_to_book();

CREATE OR REPLACE FUNCTION public.sold_to_book_stmt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO sold_book (
    vin, stock_number, year, make, model, odometer, sale_date, sale_price,
    total_cost, added_costs, net_profit, days_on_lot, buyer, vendor, customer, title_in)
  -- DISTINCT ON: a single export can list one VIN twice on the same date, and
  -- ON CONFLICT cannot touch the same row twice in one statement.
  SELECT DISTINCT ON (vin, sale_date) * FROM (
    SELECT
      upper(NULLIF(btrim(COALESCE(n.vehicle_vin, '')), ''))            AS vin,
      NULLIF(btrim(COALESCE(n.stock_number, '')), '')                  AS stock_number,
      frazer_num(n.vehicle_year)::int                                  AS year,
      n.vehicle_make                                                   AS make,
      n.vehicle_model                                                  AS model,
      frazer_num(n.mileage)::int                                       AS odometer,
      frazer_date(n.sale_date)                                         AS sale_date,
      frazer_num(n.sales_price)                                        AS sale_price,
      frazer_num(n.total_cost)                                         AS total_cost,
      frazer_num(n.added_costs)                                        AS added_costs,
      frazer_num(COALESCE(n.profit_on_sale, n.net_profit))             AS net_profit,
      frazer_num(n.days_on_lot)::int                                   AS days_on_lot,
      n.buyer, n.vendor,
      NULLIF(btrim(COALESCE(n.customer, '') || ' '
        || COALESCE(n.first_name, '') || ' ' || COALESCE(n.last_name, '')), '') AS customer,
      n.title_in
    FROM new_rows n
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
  RETURN NULL;
END $$;

CREATE TRIGGER sold_to_book_stmt
  AFTER INSERT ON public.sold
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.sold_to_book_stmt();

NOTIFY pgrst, 'reload schema';
