-- Why is the load hanging at the POST?
--
-- The symptom — the HTTP call sits there and nothing lands — is what a blocked
-- TRUNCATE looks like. frazer-ingest truncates `sold` before inserting, TRUNCATE
-- needs an ACCESS EXCLUSIVE lock, and anything holding even a read lock on that
-- table (an idle-in-transaction session left by an earlier failed run, a report
-- still streaming) will make it wait rather than fail.
--
-- Aggregate diagnostics only: who is blocking, for how long, doing what kind of
-- statement. No table data goes through this.
CREATE OR REPLACE FUNCTION public.db_blockers()
RETURNS TABLE (pid int, state text, waiting_on text, minutes numeric, query_start timestamptz, snippet text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.pid,
         a.state,
         COALESCE(a.wait_event_type || ':' || a.wait_event, ''),
         round(EXTRACT(epoch FROM (now() - COALESCE(a.query_start, a.state_change))) / 60.0, 1),
         a.query_start,
         left(regexp_replace(a.query, '\s+', ' ', 'g'), 90)
  FROM pg_stat_activity a
  WHERE a.datname = current_database()
    AND a.pid <> pg_backend_pid()
    AND a.state IS DISTINCT FROM 'idle'
  ORDER BY a.query_start NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION public.db_blockers() TO anon, authenticated;

-- Anything holding a lock on the sold table specifically.
CREATE OR REPLACE FUNCTION public.sold_locks()
RETURNS TABLE (pid int, mode text, granted boolean, state text, minutes numeric, snippet text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.pid, l.mode, l.granted, a.state,
         round(EXTRACT(epoch FROM (now() - COALESCE(a.query_start, a.state_change))) / 60.0, 1),
         left(regexp_replace(COALESCE(a.query, ''), '\s+', ' ', 'g'), 90)
  FROM pg_locks l
  JOIN pg_class c ON c.oid = l.relation
  LEFT JOIN pg_stat_activity a ON a.pid = l.pid
  WHERE c.relname IN ('sold', 'sold_book', 'sold_clean')
  ORDER BY l.granted, l.pid;
$$;
GRANT EXECUTE ON FUNCTION public.sold_locks() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
