-- costs_visible() could not hash the extension's key.
--
-- digest() lives in pgcrypto, which Supabase installs into the `extensions`
-- schema. The function pins SET search_path = public for safety, so digest() was
-- simply not found: "function digest(bytea, unknown) does not exist", and every
-- keyed call errored out. Masking was already correct — only the way back IN was
-- broken, which is the right way round for a bug like this to fail.
--
-- Same trap as gen_random_bytes() in 20260818000005. Anything from pgcrypto has
-- to be schema-qualified, or the search_path has to say so.
CREATE OR REPLACE FUNCTION public.costs_visible(p_key text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE ok boolean; v_role text;
BEGIN
  v_role := COALESCE(auth.role(), '');

  -- No JWT at all: a migration or a psql session. service_role: the server
  -- acting for itself. Both trusted.
  IF v_role NOT IN ('anon', 'authenticated') THEN RETURN true; END IF;

  IF v_role = 'authenticated' THEN
    IF public.is_admin() THEN RETURN true; END IF;
    SELECT COALESCE(p.sold_reports_access, false) INTO ok
    FROM profiles p WHERE p.id = auth.uid();
    IF COALESCE(ok, false) THEN RETURN true; END IF;
  END IF;

  IF p_key IS NOT NULL AND length(btrim(p_key)) > 0 THEN
    RETURN EXISTS (
      SELECT 1 FROM api_keys k
      WHERE k.name = 'extension_costs'
        AND k.key_sha256 = encode(extensions.digest(convert_to(p_key, 'UTF8'), 'sha256'), 'hex')
    );
  END IF;

  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.costs_visible(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.costs_visible(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
