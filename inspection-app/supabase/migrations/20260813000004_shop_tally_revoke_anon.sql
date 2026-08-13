-- Actually close the tally functions to anon.
--
-- 000003 revoked PUBLIC and stopped there, but 000001 had handed three of these
-- an EXPLICIT "GRANT ... TO anon", and revoking PUBLIC does nothing to an
-- explicit grant. Verified against prod with the anon key: the functions still
-- answered. Revoke the role by name.
REVOKE ALL ON FUNCTION shop_tally() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION shop_tally_now(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION shop_tally_breakdown(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION shop_locations(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION shop_tally() TO authenticated;
GRANT EXECUTE ON FUNCTION shop_tally_now(text) TO authenticated;
GRANT EXECUTE ON FUNCTION shop_tally_breakdown(text) TO authenticated;
GRANT EXECUTE ON FUNCTION shop_locations(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
