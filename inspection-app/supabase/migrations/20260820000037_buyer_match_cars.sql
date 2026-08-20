-- A car we sold and bought back is not a sold car.
--
-- Buyer Match decides what is still for sale by dropping any VIN that appears in
-- the training set. That was survivable when training was SmartAuction only —
-- it cost 3 cars. Now that training covers every channel it costs 13, and seven
-- of those we demonstrably still own:
--
--     2022 VW Tiguan     sold 2026-06-30   bought again 2026-08-05
--     2026 Genesis GV70  sold 2026-06-19   bought again 2026-07-24
--     2017 Tacoma        sold 2026-07-11   bought again 2026-08-19
--     2018 Silverado     sold 2026-07-03   bought again 2026-08-11
--     2024 Blazer        sold 2026-07-25   bought again 2026-08-19
--     2021 F-150         sold 2026-06-30   bought again 2026-08-05
--     2020 Tesla Model 3 sold 2026-07-15   bought again 2026-08-05
--
-- Buying a car back at auction is ordinary in this business, and 217 VINs in the
-- book have sold more than once. "Has ever been sold" is therefore the wrong
-- test. The right one is whether the last sale came after the last acquisition.
--
-- The rule is applied here rather than in the page and the API separately,
-- because those two had already drifted into two copies of the same merge.

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
  -- A car listed on SmartAuction but not yet stocked in Frazer is still ours.
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
  dedup AS (
    SELECT DISTINCT ON (vin) * FROM merged ORDER BY vin, stock_number NULLS LAST
  ),
  facts AS (
    SELECT d.*,
           -- What Frazer says we paid for it, most recently.
           (SELECT max(frazer_date(i.purchase_date)) FROM inventory i
             WHERE upper(i.vehicle_vin) = d.vin)                        AS purchased_on,
           (SELECT max(t.sale_date) FROM buyer_training_rows(true, NULL, 0) t
             WHERE t.vin = d.vin)                                       AS last_sold_on,
           (SELECT t.channel_label FROM buyer_training_rows(true, NULL, 0) t
             WHERE t.vin = d.vin ORDER BY t.sale_date DESC LIMIT 1)      AS last_sold_via
    FROM dedup d
  )
  SELECT vin, stock_number, year, make, model, "trim", odometer, color,
         sa_segment(make, model), buy_now, opening_price, location, detail_url,
         price_source, on_smartauction, purchased_on, last_sold_on, last_sold_via
  FROM facts
  WHERE is_staff()
    AND (
      last_sold_on IS NULL                       -- never sold
      OR (purchased_on IS NOT NULL AND purchased_on >= last_sold_on)   -- bought back since
    );
$$;
REVOKE ALL ON FUNCTION public.buyer_match_cars() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_match_cars() TO authenticated, service_role;

-- The ones it drops, so "why is that car missing" has an answer.
CREATE OR REPLACE FUNCTION public.buyer_match_excluded()
RETURNS TABLE (vin text, stock_number text, label text, last_sold_on date,
               last_sold_via text, purchased_on date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH all_cars AS (
    SELECT upper(COALESCE(m.full_vin, m.vin)) AS vin, m.stock_number,
           m.year || ' ' || m.make || ' ' || m.model AS label
    FROM marketplace_listings() m
    WHERE COALESCE(m.full_vin, m.vin) IS NOT NULL
  )
  SELECT a.vin, a.stock_number, a.label,
         (SELECT max(t.sale_date) FROM buyer_training_rows(true, NULL, 0) t WHERE t.vin = a.vin),
         (SELECT t.channel_label FROM buyer_training_rows(true, NULL, 0) t WHERE t.vin = a.vin ORDER BY t.sale_date DESC LIMIT 1),
         (SELECT max(frazer_date(i.purchase_date)) FROM inventory i WHERE upper(i.vehicle_vin) = a.vin)
  FROM all_cars a
  WHERE is_staff()
    AND NOT EXISTS (SELECT 1 FROM buyer_match_cars() c WHERE c.vin = a.vin);
$$;
REVOKE ALL ON FUNCTION public.buyer_match_excluded() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_match_excluded() TO authenticated, service_role;

-- Clear the rows left by the save_recommendations and demand-logging smoke tests.
DELETE FROM public.recommendation_history WHERE vin LIKE 'SMOKETEST%';
DELETE FROM public.listing_events WHERE query = 'silverado' AND result_count = 4;

DO $$
DECLARE r record; n bigint; m bigint;
BEGIN
  SELECT count(*) INTO n FROM public.buyer_match_cars();
  SELECT count(*) INTO m FROM public.buyer_match_excluded();
  RAISE NOTICE 'sellable cars: %, excluded as sold: %', n, m;
  FOR r IN SELECT * FROM public.buyer_match_excluded() ORDER BY last_sold_on DESC NULLS LAST LOOP
    RAISE NOTICE '  EXCLUDED % — sold % via % (last bought %)',
      rpad(COALESCE(r.label, r.vin), 34), r.last_sold_on, r.last_sold_via, COALESCE(r.purchased_on::text, 'never');
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
