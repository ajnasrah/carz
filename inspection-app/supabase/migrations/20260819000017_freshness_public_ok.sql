-- Freshness is a health signal, not data. Counts and dates only — no row, no
-- money, no name. Keeping it reachable without a session is the difference
-- between noticing a broken sync and finding out three weeks later.
CREATE OR REPLACE FUNCTION public.sync_health()
RETURNS TABLE (feed text, rows bigint, latest text, updated timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'sold'::text,      count(*), max(sale_date),          max(synced_at)     FROM sold
  UNION ALL
  SELECT 'sold_book',       count(*), max(sale_date)::text,    max(updated_at)    FROM sold_book
  UNION ALL
  SELECT 'inventory',       count(*), NULL,                    max(synced_at)     FROM inventory
  UNION ALL
  SELECT 'sa_sold_sales',   count(*), max(sale_date)::text,    max(ingested_at)   FROM sa_sold_sales;
$$;
REVOKE ALL ON FUNCTION public.sync_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_health() TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
