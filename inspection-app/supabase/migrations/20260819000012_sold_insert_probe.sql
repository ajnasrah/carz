-- Is the slow part the database or the function?
--
-- Times a realistic bulk insert into `sold` — the same shape frazer-ingest does,
-- 500 rows a chunk — then removes them. If this is milliseconds, nothing about
-- the table explains a POST that hangs, and the cost is in the function or in
-- Power Automate retrying a failed call.
DO $$
DECLARE t0 timestamptz; ms numeric; n int;
BEGIN
  SELECT count(*) INTO n FROM public.sold;
  RAISE NOTICE 'sold currently holds % rows', n;

  t0 := clock_timestamp();
  INSERT INTO public.sold (stock_number, vehicle_vin, vehicle_year, vehicle_make,
                           vehicle_model, mileage, sale_date, total_cost,
                           sales_price, profit_on_sale, days_on_lot, vendor, buyer)
  SELECT 'PROBE-' || g, 'PROBEVIN' || lpad(g::text, 9, '0'), '2020', 'PROBE',
         'PROBE', '50000', '2026-08-19', '10000', '12000', '2000', '30', 'PROBE', 'PROBE'
  FROM generate_series(1, 2000) g;
  ms := EXTRACT(epoch FROM (clock_timestamp() - t0)) * 1000;
  RAISE NOTICE '2000-row insert took % ms', round(ms);

  t0 := clock_timestamp();
  DELETE FROM public.sold WHERE stock_number LIKE 'PROBE-%';
  RAISE NOTICE 'cleanup took % ms', round(EXTRACT(epoch FROM (clock_timestamp() - t0)) * 1000);

  t0 := clock_timestamp();
  PERFORM public.frazer_truncate('sold');
  RAISE NOTICE 'truncate took % ms', round(EXTRACT(epoch FROM (clock_timestamp() - t0)) * 1000);
END $$;
