-- buyer_training_rows() was being silently truncated to 1,000 rows.
--
-- PostgREST caps an unbounded result at 1,000, RPCs included. So every caller —
-- the Buyer Match page and /api/buyer-recommendations — asked for the whole
-- training set and got the first thousand rows of it, with no error and no
-- warning. The Buyer Match header read "1,000 sales · 298 buyers" against a real
-- 6,188 and 646.
--
-- Worse than the count: the union puts SmartAuction first, so those 1,000 rows
-- were ALL SmartAuction. The multi-channel training this whole change exists to
-- provide was being thrown away at the last step, and the engine was quietly
-- back to one channel — with fewer rows than it had before.
--
-- The Range header does not help: PostgREST ignores it on an RPC POST (asking
-- for 1000-1999 returns 0-999). ?limit=&offset= does work, but relies on the
-- client remembering to send them. So paging becomes part of the function's own
-- contract, which cannot be forgotten, and gets a deterministic ORDER BY —
-- without one, paging an unordered union can repeat and skip rows.

CREATE OR REPLACE FUNCTION public.buyer_training_rows(
  p_include_arbitration boolean DEFAULT false,
  p_limit int DEFAULT NULL,
  p_offset int DEFAULT 0)
RETURNS TABLE (
  source text, channel_key text, channel_label text, channel_kind text,
  per_buyer_data boolean, vin text, year int, make text, model text,
  odometer int, segment text, sale_date date, sale_price numeric,
  buyer_key text, buyer_name text, buyer_email text, buyer_phone text,
  buyer_city text, buyer_state text, buyer_detail text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH sa AS (
    SELECT s.*, regexp_replace(COALESCE(s.buyer_phone, ''), '\D', '', 'g') AS d
    FROM sa_sold_sales s
    WHERE is_staff()
  ),
  unioned AS (
    SELECT
      'smartauction'::text AS source, 'smartauction'::text AS channel_key,
      'SmartAuction'::text AS channel_label, 'online_auction'::text AS channel_kind,
      true AS per_buyer_data,
      upper(sa.vin) AS vin, sa.year, sa.make, sa.model, sa.odometer,
      COALESCE(sa.segment, sa_segment(sa.make, sa.model)) AS segment,
      sa.sale_date, sa.sale_price,
      CASE
        WHEN length(sa.d) = 10 THEN 'p:' || sa.d
        WHEN length(sa.d) = 11 AND left(sa.d, 1) = '1' THEN 'p:' || right(sa.d, 10)
        WHEN sa.buyer_email LIKE '%@%' THEN 'e:' || lower(btrim(sa.buyer_email))
        ELSE 'n:' || lower(btrim(regexp_replace(COALESCE(sa.buyer_name, ''), '\s+', ' ', 'g')))
      END AS buyer_key,
      sa.buyer_name, sa.buyer_email, sa.buyer_phone, sa.buyer_city, sa.buyer_state,
      NULL::text AS buyer_detail
    FROM sa
    WHERE sa.buyer_name IS NOT NULL AND btrim(sa.buyer_name) <> ''

    UNION ALL

    SELECT
      'frazer'::text, b.channel_key, c.label, c.kind, c.per_buyer_data,
      upper(b.vin), b.year, b.make, b.model, b.odometer,
      sa_segment(b.make, b.model),
      b.sale_date, b.sale_price,
      CASE WHEN c.per_buyer_data
           THEN 'n:' || lower(btrim(regexp_replace(b.buyer_label, '\s+', ' ', 'g')))
           ELSE 'c:' || b.channel_key END,
      b.buyer_label, NULL::text, NULL::text, NULL::text, b.customer_state,
      b.buyer_detail
    FROM sold_book b
    JOIN sale_channels c ON c.channel_key = b.channel_key
    WHERE is_staff()
      AND b.channel_key <> 'smartauction'
      AND b.buyer_label IS NOT NULL AND btrim(b.buyer_label) <> ''
      AND b.sale_date IS NOT NULL
      AND (p_include_arbitration OR NOT b.is_arbitration)
      AND NOT EXISTS (
        SELECT 1 FROM sa_sold_sales s2
        WHERE upper(s2.vin) = upper(b.vin)
          AND s2.sale_date IS NOT NULL
          AND abs(s2.sale_date - b.sale_date) <= 30)
  )
  SELECT source, channel_key, channel_label, channel_kind, per_buyer_data,
         vin, year, make, model, odometer, segment, sale_date, sale_price,
         buyer_key, buyer_name, buyer_email, buyer_phone, buyer_city,
         buyer_state, buyer_detail
  FROM unioned
  -- (sale_date, vin, buyer_key) is unique enough to page on: a VIN can sell
  -- twice, but not to two buyers on one day.
  ORDER BY sale_date, vin, buyer_key
  LIMIT p_limit OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;
REVOKE ALL ON FUNCTION public.buyer_training_rows(boolean, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_training_rows(boolean, int, int) TO authenticated, service_role;

-- The old 1-argument signature would still resolve for existing callers and go
-- on being capped, which is precisely the silent failure being fixed.
DROP FUNCTION IF EXISTS public.buyer_training_rows(boolean);

-- The total, so a client can prove it received everything rather than assuming.
CREATE OR REPLACE FUNCTION public.buyer_training_count(p_include_arbitration boolean DEFAULT false)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*) FROM buyer_training_rows(p_include_arbitration, NULL, 0);
$$;
REVOKE ALL ON FUNCTION public.buyer_training_count(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_training_count(boolean) TO authenticated, service_role;

DO $$
DECLARE a bigint; b bigint; c bigint; ch text;
BEGIN
  SELECT buyer_training_count() INTO a;
  SELECT count(*) INTO b FROM buyer_training_rows(false, 1000, 0);
  SELECT count(*) INTO c FROM buyer_training_rows(false, 1000, 6000);
  SELECT string_agg(DISTINCT t.channel_key, ',') INTO ch FROM buyer_training_rows(false, 1000, 0) t;
  RAISE NOTICE 'total %, first page %, last page %', a, b, c;
  RAISE NOTICE 'channels present in the FIRST page (was smartauction only): %', ch;
END $$;

NOTIFY pgrst, 'reload schema';
