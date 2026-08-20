-- Remove the no-argument overloads.
--
-- Adding list_all_inventory(p_key text) alongside the existing
-- list_all_inventory() left two candidates, and PostgREST refuses to guess:
-- PGRST203, "could not choose the best candidate function". Both callers send an
-- empty body, so the single-parameter version with its DEFAULT covers them
-- unchanged — the old ones just have to go, or nothing resolves.
--
-- This is also the safer shape to keep: the surviving function is the one that
-- masks cost unless the caller proves it may see it. Leaving a no-argument
-- version around would leave a way to ask for the same rows without the check.
DROP FUNCTION IF EXISTS public.list_all_inventory();
DROP FUNCTION IF EXISTS public.list_all_sold();

NOTIFY pgrst, 'reload schema';
