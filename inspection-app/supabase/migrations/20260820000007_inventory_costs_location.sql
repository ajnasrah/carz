-- inventory_costs() needs to carry location_code.
--
-- The Dashboard selected cost and location_code in one query off `inventory`;
-- moving it to this RPC dropped location_code, and the "Frazer Z / needs
-- dispatch" counts on that page read it. Not cost data, so it is returned
-- unconditionally — it just has to be here, or the page under-counts silently
-- rather than failing, which is the worse outcome.
-- Adding OUT params changes the row type, which CREATE OR REPLACE refuses.
DROP FUNCTION IF EXISTS public.inventory_costs(text);
CREATE OR REPLACE FUNCTION public.inventory_costs(p_key text DEFAULT NULL)
RETURNS TABLE (stock_number text, total_cost numeric, added_costs numeric,
               days_on_lot text, location_code text, vendor text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT i.stock_number,
         CASE WHEN costs_visible(p_key) THEN frazer_num(i.total_cost)  END,
         CASE WHEN costs_visible(p_key) THEN frazer_num(i.added_costs) END,
         i.days_on_lot,
         i.location_code,
         i.vendor
  FROM public.inventory i;
$$;
GRANT EXECUTE ON FUNCTION public.inventory_costs(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
