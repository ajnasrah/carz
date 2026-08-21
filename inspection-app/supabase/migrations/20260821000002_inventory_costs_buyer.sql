-- Cost went dark for everyone, admins included, and one view never went dark at all.
--
-- 20260820000001 revoked total_cost/added_costs from `anon` and `authenticated`
-- and handed them back through inventory_costs(). The Inventory page never got
-- the memo: it still selected total_cost straight off the table. Grants are
-- per-ROLE, so that select is 42501 for an admin exactly as it is for an
-- inspector — the page swallowed the error and drew $0 on every card. The gate
-- was working; the only door left standing was locked to everyone.
--
-- Two things here, both needed before the page can be pointed at the RPC:

-- 1. inventory_costs() has to carry `buyer`.
-- The page read stock_number, total_cost, added_costs, buyer, vendor and
-- location_code in ONE query. vendor and location_code arrived in
-- 20260820000007; buyer is the last one missing, and the buyer filter dropdown
-- is built from it. Not cost data, so it comes back unconditionally.
-- Adding an OUT param changes the row type, which CREATE OR REPLACE refuses.
DROP FUNCTION IF EXISTS public.inventory_costs(text);
CREATE OR REPLACE FUNCTION public.inventory_costs(p_key text DEFAULT NULL)
RETURNS TABLE (stock_number text, total_cost numeric, added_costs numeric,
               days_on_lot text, location_code text, vendor text, buyer text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT i.stock_number,
         CASE WHEN costs_visible(p_key) THEN frazer_num(i.total_cost)  END,
         CASE WHEN costs_visible(p_key) THEN frazer_num(i.added_costs) END,
         i.days_on_lot,
         i.location_code,
         i.vendor,
         i.buyer
  FROM public.inventory i;
$$;
GRANT EXECUTE ON FUNCTION public.inventory_costs(text) TO anon, authenticated;

-- 2. inventory_with_locations was handing cost to the PUBLIC key.
-- A view with no security_invoker runs as its OWNER, so the revoke on the table
-- never reached it. Verified with the anon key against production:
--   GET /rest/v1/inventory_with_locations?select=stock_number,total_cost
--   → [{"stock_number":"08-089-26","total_cost":"7234"}]
-- which is the same hole 20260820000001 was written to close, one join away.
-- Nothing in the repo reads this view, so it could simply be dropped — but a
-- view is cheap and something outside the repo may lean on it, so it gets the
-- same CASE the rest of the money wears. Masked to NULL, not revoked, so a
-- caller without access sees blanks instead of an error.
-- CREATE OR REPLACE cannot change a view's column list, and i.* has to be
-- spelled out to wrap the two money columns, so this is a DROP and recreate.
-- Same columns, same order, same names as before — only total_cost and
-- added_costs change, and only for callers who may not see them.
DROP VIEW IF EXISTS public.inventory_with_locations;
CREATE VIEW public.inventory_with_locations AS
SELECT
  i.stock_number, i.vehicle_year, i.vehicle_make, i.vehicle_model, i.vehicle_vin,
  i.mileage, i.vehicle_color, i.vehicle_source, i.days_on_lot, i.buyer,
  i.location_code,
  CASE WHEN public.costs_visible() THEN i.total_cost END  AS total_cost,
  i.engine, i.purchase_date, i.vehicle_notes, i.vendor, i.title_in,
  i.title_number,
  CASE WHEN public.costs_visible() THEN i.added_costs END AS added_costs,
  i.tag, i.gl_purchase_account, i.purchase_notes, i.last_6_vin, i.synced_at,
  COALESCE(vl.physical_location, 'unknown') AS current_physical_location,
  vl.physical_source,
  vl.location_updated_at,
  vl.sa_status,
  vl.sa_updated_at,
  vl.manheim_status,
  vl.manheim_updated_at,
  vl.ove_status,
  vl.ove_updated_at,
  vl.sold_on,
  vl.sold_at,
  vl.sold_price,
  vl.buyer_name,
  vl.notes AS location_notes
FROM public.inventory i
LEFT JOIN public.vehicle_locations vl USING (stock_number);
GRANT SELECT ON public.inventory_with_locations TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
