-- Lock the intake internals to service_role, then assert it.
--
-- 20260817000005 said REVOKE ALL ... FROM PUBLIC, which is not enough on
-- Supabase: the project's default privileges grant EXECUTE on new functions in
-- `public` to anon and authenticated DIRECTLY, not through PUBLIC, so those
-- grants survived the revoke and every one of these was callable with the
-- browser's anon key. Revoke from the roles by name.
REVOKE ALL ON FUNCTION intake_nearest_vin(text, text, timestamptz, int, int) FROM anon, authenticated;
REVOKE ALL ON FUNCTION parked_photos_to_retry(timestamptz, int) FROM anon, authenticated;
REVOKE ALL ON FUNCTION guessed_photos_to_recheck(timestamptz, int) FROM anon, authenticated;
REVOKE ALL ON FUNCTION sa_queue_reopen_on_intake(text, timestamptz) FROM anon, authenticated;

-- The webhook reaches these four through PostgREST as service_role; if any
-- EXECUTE grant were missing, nearestVin() would log and return null on every
-- call and the photo-binding fix would quietly do nothing. Fail the migration
-- rather than find that out from lost photos.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'intake_nearest_vin(text,text,timestamptz,int,int)',
    'parked_photos_to_retry(timestamptz,int)',
    'guessed_photos_to_recheck(timestamptz,int)',
    'sa_queue_reopen_on_intake(text,timestamptz)'
  ] LOOP
    IF NOT has_function_privilege('service_role', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot EXECUTE %', fn;
    END IF;
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can EXECUTE % — should be service_role only', fn;
    END IF;
    IF has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated can EXECUTE % — should be service_role only', fn;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
