-- costs_visible() was letting everyone through.
--
-- It opened with:
--     IF current_user NOT IN ('anon','authenticated') THEN RETURN true;
-- meaning "a trusted server context always sees cost". But the function is
-- SECURITY DEFINER, so current_user is the function's OWNER, not the caller —
-- it is 'postgres' on every single call. The very first branch therefore
-- returned true for the anon key too, and list_all_inventory happily handed back
-- total_cost to anyone.
--
-- Verified before this fix: an unauthenticated call returned total_cost=7234.
--
-- auth.role() reads the role out of the request's JWT, which is the caller's
-- role and not the definer's. NULL means there is no request at all — a
-- migration or a psql session — which is genuinely trusted.
--
-- The same trap is documented on guard_profile_privileges in
-- 20260818000011, which avoids it by being SECURITY INVOKER. This function
-- cannot be: it must read profiles and api_keys, which the caller cannot.
CREATE OR REPLACE FUNCTION public.costs_visible(p_key text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean; v_role text;
BEGIN
  v_role := COALESCE(auth.role(), '');

  -- No JWT at all: a migration or a direct psql session. Trusted.
  -- service_role: the server acting for itself. Trusted.
  IF v_role NOT IN ('anon', 'authenticated') THEN RETURN true; END IF;

  -- From here the caller is a browser or the extension, and must earn it.
  IF v_role = 'authenticated' THEN
    IF public.is_admin() THEN RETURN true; END IF;
    SELECT COALESCE(p.sold_reports_access, false) INTO ok
    FROM profiles p WHERE p.id = auth.uid();
    IF COALESCE(ok, false) THEN RETURN true; END IF;
  END IF;

  -- The extension's shared key, compared as a digest.
  IF p_key IS NOT NULL AND length(btrim(p_key)) > 0 THEN
    RETURN EXISTS (
      SELECT 1 FROM api_keys k
      WHERE k.name = 'extension_costs'
        AND k.key_sha256 = encode(digest(convert_to(p_key, 'UTF8'), 'sha256'), 'hex')
    );
  END IF;

  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.costs_visible(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.costs_visible(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
