-- TEMPORARY audit helper (dropped by the next migration). Returns the live security
-- state of the profiles table as JSON so we can verify the hardening from the client.
CREATE OR REPLACE FUNCTION public._audit_profiles_security()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'policies', (
      SELECT jsonb_agg(jsonb_build_object(
        'name', policyname, 'cmd', cmd, 'roles', roles::text,
        'using', qual, 'check', with_check
      ) ORDER BY cmd, policyname)
      FROM pg_policies WHERE schemaname='public' AND tablename='profiles'
    ),
    'triggers', (
      SELECT jsonb_agg(jsonb_build_object('name', tgname, 'enabled', tgenabled))
      FROM pg_trigger WHERE tgrelid='public.profiles'::regclass AND NOT tgisinternal
    ),
    'func_security', (
      SELECT jsonb_object_agg(proname, prosecdef)
      FROM pg_proc WHERE proname IN ('is_admin','guard_profile_privileges')
    ),
    'check_constraints', (
      SELECT jsonb_object_agg(conname, pg_get_constraintdef(oid))
      FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND contype='c'
    ),
    'rls_enabled', (
      SELECT relrowsecurity FROM pg_class WHERE oid='public.profiles'::regclass
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public._audit_profiles_security() TO anon, authenticated;
