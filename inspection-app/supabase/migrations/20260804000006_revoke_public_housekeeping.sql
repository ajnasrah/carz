-- Revoke PUBLIC EXECUTE on the housekeeping functions added in ...000005.
--
-- Postgres grants EXECUTE to PUBLIC on every new function, and `anon` is a
-- member of PUBLIC, so `GRANT ... TO authenticated` does not exclude anyone —
-- it just re-states access anon already had. This is the same trap
-- 20260804000003 fixed for vehicle_photos / ensure_body_shop_job; the functions
-- added afterwards reintroduced it.
--
-- Verified before this migration: the anon key could call
-- purge_stale_pending_body_shop_jobs() and DELETE rows.
--
-- RULE FOR ANY FUTURE FUNCTION HERE: a bare CREATE FUNCTION is world-executable.
-- Always REVOKE ... FROM PUBLIC and grant explicitly.

REVOKE EXECUTE ON FUNCTION is_employee()                                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION link_pending_body_shop_jobs()                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION purge_stale_pending_body_shop_jobs(INTEGER)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION body_shop_housekeeping()                     FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION is_employee()                               TO authenticated;
GRANT EXECUTE ON FUNCTION link_pending_body_shop_jobs()               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION purge_stale_pending_body_shop_jobs(INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION body_shop_housekeeping()                    TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
