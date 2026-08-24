-- inventory_locations — vehicle_locations narrowed to cars we actually own.
--
-- Inventory.jsx used to do this join over the network, in two steps:
--
--   1. SELECT stock_number FROM inventory          -- ~350 rows, one round trip
--   2. ...wait for it...
--   3. SELECT ... FROM vehicle_locations WHERE stock_number IN (<350 values>)
--
-- Step 2 is the problem. Nothing else on the page could start until step 1 came
-- back, and a Supabase round trip measures ~190ms from a desk and several times
-- that on lot LTE — so the page ate a full extra round trip before it began the
-- work it actually needed. Step 3 then shipped all 350 stock numbers back up as
-- a query string.
--
-- Postgres already knows which stock numbers are in inventory. Doing the join
-- here removes the wait and the giant URL, and the page asks for this in the
-- same Promise.all as everything else.
--
-- Sizing: vehicle_locations is 2,658 rows and inventory is ~350, so this view
-- also stays comfortably under PostgREST's 1,000-row response cap — which is why
-- the page can read it with a plain .select() and no selectAll() paging. If
-- inventory ever passes ~1,000 cars that stops being true and the caller must
-- switch to selectAll(); see services/supabase.js.
--
-- security_invoker so the caller's RLS applies rather than the view owner's.
-- Both underlying tables are readable by anyone today (20260608000001), and no
-- cost or profit column is exposed here, so this view grants nothing new — the
-- flag is here so that stays true if either table is ever locked down.
CREATE OR REPLACE VIEW public.inventory_locations
WITH (security_invoker = true) AS
SELECT
  vl.stock_number,
  vl.physical_location,
  vl.physical_source,
  vl.location_updated_at,
  vl.sa_status,
  vl.manheim_status,
  vl.ove_status,
  vl.sold_on
FROM public.vehicle_locations vl
JOIN public.inventory i ON i.stock_number = vl.stock_number;

GRANT SELECT ON public.inventory_locations TO anon, authenticated;
