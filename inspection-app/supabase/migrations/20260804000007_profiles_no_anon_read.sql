-- Stop the anon key from reading staff PII.
--
-- 20260706000002 set profiles_select to USING (true) with the note "public read
-- is not a hole" — reasoning that the column guard blocks privileged WRITES.
-- True, but it's a read problem: the anon key ships inside the client bundle, so
-- anyone who opens devtools on the public marketplace can pull every employee's
-- name, phone number, role and approval status.
--
-- Verified before this migration: an unauthenticated client using the publishable
-- anon key could SELECT from profiles and get rows back.
--
-- New rule:
--   anon                 -> nothing
--   a marketplace buyer  -> their own row only
--   staff / admin        -> everyone (rosters, the Admin panel, the tech picker)
--
-- Audited every profiles read in the app before changing this:
--   AuthContext.doLoadProfile  .eq('id', userId)      own row      ok
--   Marketplace.jsx:93         .eq('id', user.id)     own row      ok
--   Setup.jsx:63               .eq('id', user.id)     own row      ok
--   Admin.jsx                  all rows               is_admin()   ok
--   bodyShop.fetchTechs        all rows               is_employee() ok
--   adminSetup.ensurePrimaryAdmin  reads by phone — its only import is COMMENTED
--                                  OUT in AuthContext, so it never runs.
-- is_admin() and is_employee() are SECURITY DEFINER, so this policy can call
-- them without recursing into profiles' own RLS.

DROP POLICY IF EXISTS "profiles_select" ON profiles;

CREATE POLICY "profiles_select"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR public.is_admin()
    OR public.is_employee()
  );

NOTIFY pgrst, 'reload schema';
