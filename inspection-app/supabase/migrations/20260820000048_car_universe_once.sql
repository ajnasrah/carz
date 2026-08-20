-- Stop building the car list twice.
--
-- marketplace_listings() costs ~1,000 ms — it assembles a photo map per car — and
-- buyer_match_cars() and buyer_match_excluded() each call it. The bootstrap calls
-- both, so two thirds of what is left of the page's server time was the same
-- listing query run twice.
--
-- One function now decides the universe and marks each car sellable or not, and
-- the other two are thin views over it so existing callers keep working.
CREATE OR REPLACE FUNCTION public.buyer_match_universe()
RETURNS TABLE (
  vin text, stock_number text, year int, make text, model text, "trim" text,
  odometer int, color text, segment text, buy_now numeric, opening_price numeric,
  location text, detail_url text, price_source text, on_smartauction boolean,
  purchased_on date, last_sold_on date, last_sold_via text,
  label text, sellable boolean)
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
         d.price_source, d.on_smartauction, b.purchased_on, s.sale_date, s.channel_label,
         COALESCE(d.year::text, '') || ' ' || COALESCE(d.make, '') || ' ' || COALESCE(d.model, ''),
         -- Sellable unless the last sale is more recent than the last purchase.
         (s.sale_date IS NULL OR (b.purchased_on IS NOT NULL AND b.purchased_on >= s.sale_date))
  FROM dedup d
  LEFT JOIN bought b ON b.vin = d.vin
  LEFT JOIN vehicle_last_sale() s ON s.vin = d.vin
  WHERE is_staff();
$$;
REVOKE ALL ON FUNCTION public.buyer_match_universe() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_match_universe() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.buyer_match_cars()
RETURNS TABLE (
  vin text, stock_number text, year int, make text, model text, "trim" text,
  odometer int, color text, segment text, buy_now numeric, opening_price numeric,
  location text, detail_url text, price_source text, on_smartauction boolean,
  purchased_on date, last_sold_on date, last_sold_via text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.vin, u.stock_number, u.year, u.make, u.model, u."trim", u.odometer, u.color,
         u.segment, u.buy_now, u.opening_price, u.location, u.detail_url,
         u.price_source, u.on_smartauction, u.purchased_on, u.last_sold_on, u.last_sold_via
  FROM buyer_match_universe() u WHERE u.sellable;
$$;
REVOKE ALL ON FUNCTION public.buyer_match_cars() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_match_cars() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.buyer_match_excluded()
RETURNS TABLE (vin text, stock_number text, label text, last_sold_on date,
               last_sold_via text, purchased_on date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.vin, u.stock_number, u.label, u.last_sold_on, u.last_sold_via, u.purchased_on
  FROM buyer_match_universe() u WHERE NOT u.sellable;
$$;
REVOKE ALL ON FUNCTION public.buyer_match_excluded() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_match_excluded() TO authenticated, service_role;

-- Bootstrap: one universe, one training pass.
CREATE OR REPLACE FUNCTION public.buyer_match_bootstrap(p_demand_days int DEFAULT 60)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (SELECT * FROM buyer_training_rows(false, NULL, 0)),
       u AS (SELECT * FROM buyer_match_universe())
  SELECT jsonb_build_object(
    'training', COALESCE((SELECT jsonb_agg(to_jsonb(x) - 'channel_kind' - 'source') FROM t x), '[]'::jsonb),
    'cars', COALESCE((SELECT jsonb_agg(to_jsonb(c) - 'label' - 'sellable') FROM u c WHERE c.sellable), '[]'::jsonb),
    'excluded', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'vin', e.vin, 'stock_number', e.stock_number, 'label', e.label,
                    'last_sold_on', e.last_sold_on, 'last_sold_via', e.last_sold_via,
                    'purchased_on', e.purchased_on)) FROM u e WHERE NOT e.sellable), '[]'::jsonb),
    'demand', COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM buyer_demand_signals(p_demand_days) d), '[]'::jsonb),
    'channels', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM (
                    SELECT t.channel_key, t.channel_label, t.per_buyer_data,
                           count(*) AS sales, count(DISTINCT t.buyer_key) AS buyers,
                           min(t.sale_date) AS first_sale, max(t.sale_date) AS last_sale,
                           round(avg(t.sale_price), 0) AS avg_price
                    FROM t GROUP BY 1,2,3 ORDER BY count(*) DESC) s), '[]'::jsonb),
    'training_count', (SELECT count(*) FROM t)
  )
  WHERE is_staff();
$$;
REVOKE ALL ON FUNCTION public.buyer_match_bootstrap(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_match_bootstrap(int) TO authenticated, service_role;

DO $$
DECLARE t0 timestamptz; j jsonb; i int;
BEGIN
  FOR i IN 1..2 LOOP
    t0 := clock_timestamp();
    SELECT buyer_match_bootstrap() INTO j;
    RAISE NOTICE 'pass %: bootstrap % ms — % training, % cars, % excluded, % KB',
      i, round(extract(epoch from clock_timestamp()-t0)*1000),
      jsonb_array_length(j->'training'), jsonb_array_length(j->'cars'),
      jsonb_array_length(j->'excluded'), round(length(j::text)/1024.0);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
