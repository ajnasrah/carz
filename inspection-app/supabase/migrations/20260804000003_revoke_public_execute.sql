-- Actually close the hole 20260804000002 tried to close.
--
-- PostgreSQL grants EXECUTE on every new function to PUBLIC by default, and
-- `anon` is a member of PUBLIC. So `REVOKE ... FROM anon` changed nothing:
-- verified after that migration, the anon key could still call vehicle_photos()
-- and enumerate car-history paths for any car, and still call
-- ensure_body_shop_job() to create jobs.
--
-- The revoke has to name PUBLIC. Explicit grants are then re-issued to the roles
-- that genuinely need them.

REVOKE EXECUTE ON FUNCTION vehicle_photos(TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION vehicle_photos(TEXT, TEXT) TO authenticated, service_role;

-- Only the Telegram webhook (service key) opens jobs automatically; the app
-- creates walk-ins by inserting into body_shop_jobs under RLS instead.
REVOKE EXECUTE ON FUNCTION ensure_body_shop_job(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION ensure_body_shop_job(TEXT, TIMESTAMPTZ) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
