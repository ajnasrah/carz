-- is_staff() has to answer for three kinds of caller, not one.
--
-- As written it only checked `profiles` for auth.uid(), which is right for a
-- signed-in person and wrong for everything else:
--
--   * /api/buyer-recommendations connects with the SERVICE key. auth.uid() is
--     NULL there, so every staff-gated function would have returned zero rows and
--     the endpoint would have quietly reported an empty book instead of failing.
--   * A migration or psql session has no JWT at all, so the diagnostics below
--     could not read what they had just written.
--
-- The discriminator is the JWT role claim, which PostgREST always sets — even for
-- anon. No claim at all therefore means a direct database connection, which is
-- already privileged. current_user is NOT usable here: inside a SECURITY DEFINER
-- function it is the owner, so testing it would return true for everyone.

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE claim_role text;
BEGIN
  BEGIN
    claim_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN others THEN
    claim_role := NULL;
  END;
  IF claim_role IS NULL THEN
    BEGIN
      claim_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
    EXCEPTION WHEN others THEN
      claim_role := NULL;
    END;
  END IF;

  -- Trusted server-side callers.
  IF claim_role = 'service_role' THEN RETURN true; END IF;
  -- No claim => not a PostgREST request at all => a direct database session.
  IF claim_role IS NULL THEN RETURN true; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND COALESCE(approval_status, 'approved') = 'approved'
      AND (role = 'admin' OR account_type = 'employee')
  );
END $$;
REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;

-- Prove the training view actually resolves, and show what Buyer Match will see.
DO $$
DECLARE r record; total bigint; buyers bigint;
BEGIN
  SELECT count(*), count(DISTINCT buyer_key) INTO total, buyers FROM public.buyer_training_rows();
  RAISE NOTICE 'buyer_training_rows: % sales, % distinct buyers', total, buyers;
  FOR r IN SELECT * FROM public.buyer_training_stats() LOOP
    RAISE NOTICE '  % | % sales | % buyers | % .. % | avg $%',
      rpad(r.channel_label, 22), lpad(r.sales::text, 5), lpad(r.buyers::text, 4),
      r.first_sale, r.last_sale, r.avg_price;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
