-- Buyer Match took minutes to open. Two causes, both mine.
--
-- 1. buyer_match_cars() asked buyer_training_rows() for the last sale of a VIN
--    inside a correlated subquery — twice per car. A set-returning function in
--    that position is re-executed for every outer row, so opening the page
--    evaluated the whole 6,188-row union (two table scans, an anti-join and a
--    sort) more than a hundred times. Measured: 2,248 ms for 56 cars, and
--    buyer_match_excluded() called buyer_match_cars() again on top of that for
--    another 3,285 ms.
--
--    A VIN's last sale is one aggregate over two tables. It is computed once
--    here, in a CTE, and joined.
--
-- 2. The page made eleven round trips to build one screen — seven to page the
--    training set, plus a count, plus stats, cars, excluded and demand. Each
--    paged call re-ran the union and re-sorted it, and they all raced each other
--    for the same connections. buyer_match_bootstrap() returns the lot as one
--    JSON document in one call, so the union is evaluated once.
--
-- Returning JSON also sidesteps the 1,000-row cap that started all this: the cap
-- counts result ROWS, and this is one row.

-- ---------------------------------------------------------------------------
-- The last completed sale per VIN, across both sources. One pass.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vehicle_last_sale()
RETURNS TABLE (vin text, sale_date date, channel_label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH all_sales AS (
    SELECT upper(s.vin) AS vin, s.sale_date, 'SmartAuction'::text AS channel_label
    FROM sa_sold_sales s WHERE s.sale_date IS NOT NULL
    UNION ALL
    SELECT upper(b.vin), b.sale_date, c.label
    FROM sold_book b
    JOIN sale_channels c ON c.channel_key = b.channel_key
    WHERE b.sale_date IS NOT NULL
  )
  SELECT DISTINCT ON (vin) vin, sale_date, channel_label
  FROM all_sales
  ORDER BY vin, sale_date DESC;
$$;
REVOKE ALL ON FUNCTION public.vehicle_last_sale() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vehicle_last_sale() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cars, without asking the training set anything.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buyer_match_cars()
RETURNS TABLE (
  vin text, stock_number text, year int, make text, model text, "trim" text,
  odometer int, color text, segment text, buy_now numeric, opening_price numeric,
  location text, detail_url text, price_source text, on_smartauction boolean,
  purchased_on date, last_sold_on date, last_sold_via text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH listings AS (
    SELECT upper(COALESCE(m.full_vin, m.vin)) AS vin, m.stock_number,
           NULLIF(regexp_replace(COALESCE(m.year, ''), '\D', '', 'g'), '')::int    AS year,
           m.make, m.model,
           NULLIF(regexp_replace(COALESCE(m.mileage, ''), '\D', '', 'g'), '')::int AS odometer,
           m.vehicle_color AS color,
           frazer_num(m.buy_now) AS buy_now, m.sa_url, m.price_source
    FROM marketplace_listings() m
    WHERE COALESCE(m.full_vin, m.vin) IS NOT NULL
  ),
  merged AS (
    SELECT l.vin, l.stock_number, l.year, l.make, l.model,
           sac."trim", COALESCE(l.odometer, sac.odometer) AS odometer,
           COALESCE(l.color, sac.color) AS color,
           COALESCE(l.buy_now, sac.buy_now, sac.opening_price) AS buy_now,
           sac.opening_price, sac.location, COALESCE(l.sa_url, sac.detail_url) AS detail_url,
           l.price_source, (sac.vin IS NOT NULL) AS on_smartauction
    FROM listings l
    LEFT JOIN sa_active_cars sac ON upper(sac.vin) = l.vin
    UNION
    SELECT upper(sac.vin), NULL, sac.year, sac.make, sac.model, sac."trim", sac.odometer,
           sac.color, COALESCE(sac.buy_now, sac.opening_price), sac.opening_price,
           sac.location, sac.detail_url, NULL, true
    FROM sa_active_cars sac
    WHERE NOT EXISTS (SELECT 1 FROM listings l2 WHERE l2.vin = upper(sac.vin))
  ),
  dedup AS (SELECT DISTINCT ON (vin) * FROM merged ORDER BY vin, stock_number NULLS LAST),
  bought AS (
    SELECT upper(i.vehicle_vin) AS vin, max(frazer_date(i.purchase_date)) AS purchased_on
    FROM inventory i WHERE i.vehicle_vin IS NOT NULL GROUP BY 1
  )
  SELECT d.vin, d.stock_number, d.year, d.make, d.model, d."trim", d.odometer, d.color,
         sa_segment(d.make, d.model), d.buy_now, d.opening_price, d.location, d.detail_url,
         d.price_source, d.on_smartauction, b.purchased_on, s.sale_date, s.channel_label
  FROM dedup d
  LEFT JOIN bought b ON b.vin = d.vin
  LEFT JOIN vehicle_last_sale() s ON s.vin = d.vin
  WHERE is_staff()
    AND (s.sale_date IS NULL OR (b.purchased_on IS NOT NULL AND b.purchased_on >= s.sale_date));
$$;
REVOKE ALL ON FUNCTION public.buyer_match_cars() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_match_cars() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.buyer_match_excluded()
RETURNS TABLE (vin text, stock_number text, label text, last_sold_on date,
               last_sold_via text, purchased_on date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH all_cars AS (
    SELECT upper(COALESCE(m.full_vin, m.vin)) AS vin, m.stock_number,
           m.year || ' ' || m.make || ' ' || m.model AS label
    FROM marketplace_listings() m
    WHERE COALESCE(m.full_vin, m.vin) IS NOT NULL
  ),
  bought AS (
    SELECT upper(i.vehicle_vin) AS vin, max(frazer_date(i.purchase_date)) AS purchased_on
    FROM inventory i WHERE i.vehicle_vin IS NOT NULL GROUP BY 1
  )
  SELECT a.vin, a.stock_number, a.label, s.sale_date, s.channel_label, b.purchased_on
  FROM all_cars a
  LEFT JOIN bought b ON b.vin = a.vin
  LEFT JOIN vehicle_last_sale() s ON s.vin = a.vin
  WHERE is_staff()
    AND s.sale_date IS NOT NULL
    AND (b.purchased_on IS NULL OR b.purchased_on < s.sale_date);
$$;
REVOKE ALL ON FUNCTION public.buyer_match_excluded() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_match_excluded() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Everything the page opens with, in one document and one union evaluation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buyer_match_bootstrap(p_demand_days int DEFAULT 60)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (SELECT * FROM buyer_training_rows(false, NULL, 0))
  SELECT jsonb_build_object(
    'training',  COALESCE((SELECT jsonb_agg(to_jsonb(x) - 'channel_kind' - 'source') FROM t x), '[]'::jsonb),
    'cars',      COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM buyer_match_cars() c), '[]'::jsonb),
    'excluded',  COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM buyer_match_excluded() e), '[]'::jsonb),
    'demand',    COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM buyer_demand_signals(p_demand_days) d), '[]'::jsonb),
    'channels',  COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM (
                    SELECT t.channel_key, t.channel_label, t.per_buyer_data,
                           count(*) AS sales, count(DISTINCT t.buyer_key) AS buyers,
                           min(t.sale_date) AS first_sale, max(t.sale_date) AS last_sale,
                           round(avg(t.sale_price), 0) AS avg_price
                    FROM t GROUP BY 1,2,3 ORDER BY count(*) DESC) s), '[]'::jsonb),
    -- The page checks this against training's length; a mismatch means the
    -- payload was truncated somewhere and the engine must not run on it.
    'training_count', (SELECT count(*) FROM t)
  )
  WHERE is_staff();
$$;
REVOKE ALL ON FUNCTION public.buyer_match_bootstrap(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_match_bootstrap(int) TO authenticated, service_role;

DO $$
DECLARE t0 timestamptz; n bigint; j jsonb;
BEGIN
  t0 := clock_timestamp();
  SELECT count(*) INTO n FROM buyer_match_cars();
  RAISE NOTICE 'buyer_match_cars()      % rows in % ms (was 2248)', n, round(extract(epoch from clock_timestamp()-t0)*1000);
  t0 := clock_timestamp();
  SELECT count(*) INTO n FROM buyer_match_excluded();
  RAISE NOTICE 'buyer_match_excluded()  % rows in % ms (was 3285)', n, round(extract(epoch from clock_timestamp()-t0)*1000);
  t0 := clock_timestamp();
  SELECT buyer_match_bootstrap() INTO j;
  RAISE NOTICE 'buyer_match_bootstrap() % training / % cars / % excluded in % ms (replaces 11 round trips)',
    jsonb_array_length(j->'training'), jsonb_array_length(j->'cars'),
    jsonb_array_length(j->'excluded'), round(extract(epoch from clock_timestamp()-t0)*1000);
  RAISE NOTICE 'payload size: % KB', round(length(j::text)/1024.0);
END $$;

NOTIFY pgrst, 'reload schema';
