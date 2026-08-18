-- close_body_shop_job() came out executable by `anon`.
--
-- The migration that created it revoked EXECUTE from PUBLIC, which is the usual
-- guard — but Supabase also carries ALTER DEFAULT PRIVILEGES granting EXECUTE on
-- new public functions to anon, authenticated and service_role, and that grant
-- is explicit, so revoking PUBLIC leaves it standing. Verified against prod with
-- the anon key: the call returned NULL rather than a permission error.
--
-- Nothing in the app calls this as anon — the Telegram webhook uses the service
-- key — so anyone holding the public anon key could mark body shop jobs finished
-- and quietly empty the manager's board.

REVOKE EXECUTE ON FUNCTION close_body_shop_job(TEXT, TIMESTAMPTZ) FROM anon;

NOTIFY pgrst, 'reload schema';
