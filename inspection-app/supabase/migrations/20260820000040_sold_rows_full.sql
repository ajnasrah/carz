-- sold_rows() needs the last two columns the Sold page reads.
--
-- type_of_sale and synced_at were left out, so the page could not move off the
-- table entirely — and it has to, because `sold` no longer grants profit to
-- anyone. Adding them here is what lets Sold.jsx read one masked source instead
-- of stitching a table select together with an RPC call.
DROP FUNCTION IF EXISTS public.sold_rows(text);
CREATE OR REPLACE FUNCTION public.sold_rows(p_key text DEFAULT NULL)
RETURNS TABLE (
  stock_number text, vehicle_vin text, last_6_vin text,
  vehicle_year text, vehicle_make text, vehicle_model text,
  sale_date text, buyer text, vendor text, first_name text, last_name text,
  type_of_sale text, synced_at timestamptz,
  total_cost numeric, added_costs numeric, sales_price numeric,
  profit_on_sale numeric, days_on_lot int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT s.stock_number, s.vehicle_vin, s.last_6_vin,
         s.vehicle_year, s.vehicle_make, s.vehicle_model,
         s.sale_date, s.buyer, s.vendor, s.first_name, s.last_name,
         s.type_of_sale, s.synced_at,
         CASE WHEN costs_visible(p_key) THEN frazer_num(s.total_cost)  END,
         CASE WHEN costs_visible(p_key) THEN frazer_num(s.added_costs) END,
         frazer_num(s.sales_price),
         CASE WHEN costs_visible(p_key)
              THEN frazer_num(COALESCE(s.profit_on_sale, s.net_profit)) END,
         nullif(regexp_replace(COALESCE(s.days_on_lot, ''), '[^0-9\-]', '', 'g'), '')::int
  FROM public.sold s;
$$;
GRANT EXECUTE ON FUNCTION public.sold_rows(text) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
