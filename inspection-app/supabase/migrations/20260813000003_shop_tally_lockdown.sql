-- Close the tally functions to anon.
--
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, so adding "GRANT ... TO
-- authenticated" changed nothing — a signed-out caller could read the shop
-- counts and, through shop_tally(), write a snapshot row. Neither is dangerous
-- (the numbers are computed server-side from our own data, not from anything the
-- caller supplies) but none of it is public business, and a write reachable
-- without a login is not a thing to leave lying around.
--
-- The lesson that keeps repeating in this schema: the grant that matters is the
-- REVOKE. See feedback on PUBLIC EXECUTE in the marketplace functions.

REVOKE ALL ON FUNCTION shop_tally() FROM PUBLIC;
REVOKE ALL ON FUNCTION shop_tally_now(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION shop_tally_breakdown(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION shop_locations(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION shop_tally() TO authenticated;
GRANT EXECUTE ON FUNCTION shop_tally_now(text) TO authenticated;
GRANT EXECUTE ON FUNCTION shop_tally_breakdown(text) TO authenticated;
GRANT EXECUTE ON FUNCTION shop_locations(text) TO authenticated;

-- The daily table is aggregate counts, but it's internal too.
REVOKE ALL ON shop_tally_daily FROM anon;
DROP POLICY IF EXISTS shop_tally_read ON shop_tally_daily;
CREATE POLICY shop_tally_read ON shop_tally_daily
  FOR SELECT TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
