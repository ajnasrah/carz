-- The public key could read the entire profit ledger. Close it.
--
-- VITE_SUPABASE_ANON_KEY ships inside the browser bundle and inside the Chrome
-- extension, so "anon" means anyone who opens devtools. With it you could read:
--
--   sold_book               6,463 rows: cost, sale price, net profit, customer
--   sold_clean              the same, typed
--   vehicle_purchase_source which consignor every car came from
--   vendor_performance()    336 vendors with total profit
--   run_list_lane_study()   549 rows of lane economics
--
-- Some of that is mine from today; sold_clean predates me and was worse, because
-- a view runs as its OWNER unless told otherwise and so bypassed the RLS on
-- `sold` entirely — the base table was locked and the view handed the same rows
-- out anyway. security_invoker fixes that properly.
--
-- Nothing legitimate loses access: the extension (which genuinely has no sign-in)
-- touches none of these, and the only consumer of sold_clean is the signed-in
-- web app.

-- ---- tables -------------------------------------------------------------
DROP POLICY IF EXISTS sold_book_read ON public.sold_book;
CREATE POLICY sold_book_read ON public.sold_book
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.sold_book FROM anon;
GRANT SELECT ON public.sold_book TO authenticated;

DROP POLICY IF EXISTS vps_read ON public.vehicle_purchase_source;
CREATE POLICY vps_read ON public.vehicle_purchase_source
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.vehicle_purchase_source FROM anon;
GRANT SELECT ON public.vehicle_purchase_source TO authenticated;

-- ---- the view ----------------------------------------------------------
-- security_invoker: run as the caller, so the RLS on `sold` actually applies
-- instead of being bypassed by the view's owner.
ALTER VIEW public.sold_clean SET (security_invoker = true);
REVOKE ALL ON public.sold_clean FROM anon, PUBLIC;
GRANT SELECT ON public.sold_clean TO authenticated;

-- ---- reporting functions ------------------------------------------------
-- SECURITY DEFINER, so a grant to anon is a grant to the whole internet.
REVOKE ALL ON FUNCTION public.vendor_performance()            FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.seller_performance(int)         FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.run_list_lane_study(text, int)  FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.sold_book_freshness()           FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.sold_load_status()              FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.ready_to_sell_unmatched()       FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.ready_to_sell_stuck_photos()    FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.vendor_performance()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_performance(int)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_list_lane_study(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sold_book_freshness()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.sold_load_status()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.ready_to_sell_unmatched()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.ready_to_sell_stuck_photos()   TO authenticated;

-- Diagnostics read pg_stat_activity, which carries other sessions' SQL text.
REVOKE ALL ON FUNCTION public.db_blockers() FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.sold_locks()  FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.db_blockers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sold_locks()  TO authenticated;

-- NOT CHANGED, deliberately: run_list_observations stays anon-readable. It is
-- another session's table, the extension writes to it with the anon key and has
-- no sign-in to fall back on, and revoking SELECT there risks breaking a live
-- feature I do not own. It does expose which cars we look at and how we grade
-- them — worth closing, but as its own decision, not folded into this one.

NOTIFY pgrst, 'reload schema';
