-- sold_rows() was granted to anon. Close it.
--
-- 20260820000006 revoked `sold` from anon and moved the reads to sold_rows(),
-- which masks cost behind costs_visible(). That is right about cost and wrong
-- about everyone else: the function still returns first_name, last_name,
-- vehicle_vin, sale_date and sales_price for every car we have ever sold, and it
-- was granted EXECUTE to anon.
--
-- VITE_SUPABASE_ANON_KEY ships inside the browser bundle and inside the Chrome
-- extension, so "anon" is anyone who opens devtools. I confirmed this by paging
-- all 6,463 rows with nothing but the key from .env — every customer name and
-- every sale price, no sign-in. This is the same class of hole 20260820000016
-- was written to close, reopened four migrations later by the fix for a
-- different problem.
--
-- Nothing legitimate loses access. The only three callers are signed-in app
-- screens: ExecutiveDashboard.jsx, soldReports.js (twice). The extension, which
-- genuinely has no sign-in, does not touch it.
REVOKE ALL ON FUNCTION public.sold_rows(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sold_rows(text) TO authenticated, service_role;

-- inventory_costs() went out in the same migration with the same grant. Its cost
-- columns are masked, but it still enumerates the whole lot to the public key.
REVOKE ALL ON FUNCTION public.inventory_costs(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_costs(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
