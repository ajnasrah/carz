-- Sold Reports was timing out because the gate was being asked once per cell.
--
-- `costs_visible()` is plpgsql: it calls is_admin() and then reads `profiles`
-- for the caller. It is marked STABLE, which promises the answer won't change
-- inside one statement — but STABLE is not memoisation. Postgres re-evaluates
-- it for every row it appears in, and it appears in FOUR masked columns.
--
-- So one read of sold_clean over ~6,400 sold cars is ~25,000 plpgsql calls,
-- each doing two lookups on profiles. Then selectAll() pages the result eight
-- ranges at a time IN PARALLEL, and each range re-runs the whole thing — and
-- the Sold Reports page opens sold_clean and sold_rows() together. Sixteen
-- concurrent full scans, ~400,000 gate evaluations, one page load. That is the
-- "canceling statement due to statement timeout" (57014), and the slowness
-- underneath it on the loads that did squeak through.
--
-- The fix is to ask once. Wrapping the call in a scalar subquery that
-- references nothing from the outer row makes it an InitPlan: Postgres runs it
-- a single time per statement and reuses the boolean for every row. This is the
-- same trick Supabase documents for auth.uid() in RLS policies, for the same
-- reason. Nothing about WHO sees WHAT changes here — the CASE arms, the
-- argument, and the grants are identical. Only the number of times the question
-- is asked changes.
--
-- Numbers below are per statement, over ~6,400 sold rows:
--   sold_clean       4 calls/row  → 1
--   sold_rows()      4 calls/row  → 1
--   inventory_costs() 2 calls/row → 1   (same shape, same bug, ~350 rows)

-- Definition carried forward verbatim from 20260820000039_sold_clean_definer
-- (security_invoker = false, and see that migration for why) — the only edit is
-- the (SELECT ...) wrapper on each gate.
CREATE OR REPLACE VIEW public.sold_clean
WITH (security_invoker = false) AS
  SELECT
    s.stock_number,
    NULLIF(regexp_replace(COALESCE(s.vehicle_year, ''), '[^0-9]', '', 'g'), '')::int   AS year,
    s.vehicle_make  AS make,
    s.vehicle_model AS model,
    NULLIF(regexp_replace(COALESCE(s.mileage, ''), '[^0-9]', '', 'g'), '')::int        AS mileage,
    public.frazer_date(s.sale_date)                                                    AS sale_date,
    NULLIF(regexp_replace(COALESCE(s.days_on_lot, ''), '[^0-9\-]', '', 'g'), '')::int  AS days_on_lot,
    CASE WHEN (SELECT public.costs_visible()) THEN public.frazer_num(s.original_cost) END AS original_cost,
    CASE WHEN (SELECT public.costs_visible()) THEN public.frazer_num(s.total_cost)    END AS total_cost,
    public.frazer_num(s.sales_price)                                                   AS sales_price,
    CASE WHEN (SELECT public.costs_visible())
         THEN public.frazer_num(COALESCE(s.profit_on_sale, s.net_profit)) END          AS profit
  FROM public.sold s;

REVOKE ALL ON public.sold_clean FROM anon, PUBLIC;
GRANT SELECT ON public.sold_clean TO authenticated;

-- Signature and column list carried forward verbatim from
-- 20260820000040_sold_rows_full (type_of_sale and synced_at included).
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
         CASE WHEN (SELECT costs_visible(p_key)) THEN frazer_num(s.total_cost)  END,
         CASE WHEN (SELECT costs_visible(p_key)) THEN frazer_num(s.added_costs) END,
         frazer_num(s.sales_price),
         CASE WHEN (SELECT costs_visible(p_key))
              THEN frazer_num(COALESCE(s.profit_on_sale, s.net_profit)) END,
         nullif(regexp_replace(COALESCE(s.days_on_lot, ''), '[^0-9\-]', '', 'g'), '')::int
  FROM public.sold s;
$$;
-- Grants as 20260820000027 left them: anon was deliberately taken off both of
-- these (they enumerate every car and every customer name we have), so this
-- restates that rather than the original line from ...0006.
REVOKE ALL ON FUNCTION public.sold_rows(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sold_rows(text) TO authenticated, service_role;

-- Same shape, same bug: Inventory and the extension both read this one.
-- Signature carried forward verbatim from 20260821000002_inventory_costs_buyer
-- (location_code, vendor and buyer included) — CREATE OR REPLACE cannot change
-- a function's row type, and the shorter list from ...0006 would try to.
CREATE OR REPLACE FUNCTION public.inventory_costs(p_key text DEFAULT NULL)
RETURNS TABLE (stock_number text, total_cost numeric, added_costs numeric,
               days_on_lot text, location_code text, vendor text, buyer text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT i.stock_number,
         CASE WHEN (SELECT costs_visible(p_key)) THEN frazer_num(i.total_cost)  END,
         CASE WHEN (SELECT costs_visible(p_key)) THEN frazer_num(i.added_costs) END,
         i.days_on_lot,
         i.location_code,
         i.vendor,
         i.buyer
  FROM public.inventory i;
$$;
REVOKE ALL ON FUNCTION public.inventory_costs(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_costs(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
