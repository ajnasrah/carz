-- Did the Frazer sold load actually land?
--
-- `sold` is authenticated-only and correctly so — it is the profit book. But
-- that also means there is no way to answer "did today's sync work?" without
-- signing in, which is exactly the blindness that let this table sit broken.
-- Counts and timestamps only; no row ever leaves through this.
CREATE OR REPLACE FUNCTION public.sold_load_status()
RETURNS TABLE (rows bigint, last_synced timestamptz, latest_sale text,
               with_profit bigint, with_vin bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*),
         max(synced_at),
         max(sale_date),
         count(*) FILTER (WHERE COALESCE(profit_on_sale, net_profit) IS NOT NULL),
         count(*) FILTER (WHERE vehicle_vin IS NOT NULL)
  FROM public.sold;
$$;
GRANT EXECUTE ON FUNCTION public.sold_load_status() TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
