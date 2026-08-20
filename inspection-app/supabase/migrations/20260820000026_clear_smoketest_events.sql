-- Remove the row left by the log_listing_event() smoke test.
--
-- Verifying the write path meant actually writing, with the anon key, exactly as
-- a visitor would. It worked (204, and the read-back was correctly refused), but
-- the demand log is a record of what real customers looked for and a fake search
-- for "silverado 2020" would sit in demand_searches() forever.
DELETE FROM public.listing_events WHERE session_key = 'smoketest-abc';

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.listing_events;
  RAISE NOTICE 'listing_events now holds % row(s)', n;
END $$;
