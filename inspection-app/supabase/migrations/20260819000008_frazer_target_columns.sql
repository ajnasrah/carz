-- Let the ingest ask what columns the target actually has.
--
-- frazer-ingest builds a row object from every CSV header and inserts it, so ONE
-- header without a matching column fails the whole 500-row batch and the sync
-- lands nothing. That is a hair trigger on a feed we do not control: Frazer adds
-- a column to its export and the profit book silently stops updating, which is
-- most of how we got here.
--
-- With this the function can drop what it cannot store and load the rest, and
-- report what it skipped so a real new column gets noticed rather than guessed at.
CREATE OR REPLACE FUNCTION public.frazer_target_columns(p_target text)
RETURNS TABLE (column_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.column_name::text
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = p_target
    AND p_target IN ('inventory', 'sold');   -- never a general schema reader
$$;
REVOKE ALL ON FUNCTION public.frazer_target_columns(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.frazer_target_columns(text) TO service_role;
NOTIFY pgrst, 'reload schema';
