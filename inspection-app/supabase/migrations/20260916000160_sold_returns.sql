-- A car that sold and came back is for sale again.
--
-- "Sellable" means the last sale is not newer than the last purchase
-- (buyer_match_universe), and nothing anywhere said a sale could be undone. So a
-- returned car stayed sold forever: off Buyer Match, no Text-best-buyer picks,
-- while sitting on the marketplace with a price on it. The 2021 RAM 1500
-- (06-243-26) sold to Mt Moriah on 07-24, came back, and is at ADESA now.
--
-- Two ways a sale stops counting from here:
--   * sold_book.is_arbitration — already set by the channel resolver, and until
--     now read by buyer_training_rows() but NOT by vehicle_last_sale(), so an
--     arbitrated car was excluded from training and still counted as sold
--   * sold_returns — a person saying so. It is its own table on purpose: the
--     Frazer load upserts sold_book and would overwrite a flag set by hand.

CREATE TABLE IF NOT EXISTS public.sold_returns (
  vin         text        NOT NULL,
  sale_date   date,                 -- NULL = whatever the latest sale of this VIN is
  note        text,
  marked_by   uuid        DEFAULT auth.uid(),
  returned_at timestamptz NOT NULL DEFAULT now()
);
-- Not a primary key over (vin, sale_date): NULL means "every sale of this VIN",
-- and a NULL cannot sit in a primary key. One row per VIN per date instead, with
-- the all-sales row kept unique on its own.
CREATE UNIQUE INDEX IF NOT EXISTS sold_returns_vin_date
  ON public.sold_returns (vin, sale_date) WHERE sale_date IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sold_returns_vin_all
  ON public.sold_returns (vin) WHERE sale_date IS NULL;
ALTER TABLE public.sold_returns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sold_returns FROM anon, authenticated;
GRANT SELECT ON public.sold_returns TO authenticated;
DROP POLICY IF EXISTS "staff read" ON public.sold_returns;
CREATE POLICY "staff read" ON public.sold_returns FOR SELECT TO authenticated USING (public.is_staff());

-- Is this sale one that stuck?
CREATE OR REPLACE FUNCTION public.sale_stuck(p_vin text, p_sale_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM sold_returns r
     WHERE upper(r.vin) = upper(p_vin)
       AND (r.sale_date IS NULL OR r.sale_date = p_sale_date)
  );
$$;

-- The last sale that actually stuck. Arbitrated and returned sales are skipped,
-- so the car falls back to its previous real sale, or to no sale at all — which
-- is what makes it sellable again.
CREATE OR REPLACE FUNCTION public.vehicle_last_sale()
RETURNS TABLE(vin text, sale_date date, channel_label text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH all_sales AS (
    SELECT upper(s.vin) AS vin, s.sale_date, 'SmartAuction'::text AS channel_label
    FROM sa_sold_sales s WHERE s.sale_date IS NOT NULL
    UNION ALL
    SELECT upper(b.vin), b.sale_date, c.label
    FROM sold_book b
    JOIN sale_channels c ON c.channel_key = b.channel_key
    WHERE b.sale_date IS NOT NULL AND NOT b.is_arbitration
  )
  SELECT DISTINCT ON (vin) vin, sale_date, channel_label
  FROM all_sales a
  WHERE public.sale_stuck(a.vin, a.sale_date)
  ORDER BY vin, sale_date DESC;
$$;

-- Mark / unmark, staff only. p_sale_date NULL covers every sale of that VIN,
-- which is what you want when a car comes back and you do not have the date to
-- hand.
CREATE OR REPLACE FUNCTION public.mark_sale_returned(p_vin text, p_note text DEFAULT NULL, p_sale_date date DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_staff() THEN RAISE EXCEPTION 'staff only' USING ERRCODE = '42501'; END IF;
  UPDATE sold_returns SET note = p_note, returned_at = now(), marked_by = auth.uid()
   WHERE vin = upper(btrim(p_vin)) AND sale_date IS NOT DISTINCT FROM p_sale_date;
  IF NOT FOUND THEN
    INSERT INTO sold_returns (vin, sale_date, note, marked_by)
    VALUES (upper(btrim(p_vin)), p_sale_date, p_note, auth.uid());
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.mark_sale_returned(text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_sale_returned(text, text, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.unmark_sale_returned(p_vin text, p_sale_date date DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_staff() THEN RAISE EXCEPTION 'staff only' USING ERRCODE = '42501'; END IF;
  DELETE FROM sold_returns
   WHERE upper(vin) = upper(btrim(p_vin))
     AND (p_sale_date IS NULL OR sale_date IS NOT DISTINCT FROM p_sale_date);
END $$;
REVOKE ALL ON FUNCTION public.unmark_sale_returned(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unmark_sale_returned(text, date) TO authenticated, service_role;

-- Training must not learn from a sale that came back either: the buyer did not
-- keep the car, and reading it as a win is how a dealer who returns cars gets
-- recommended more of them. Body is 20260820000021's, plus one WHERE.
CREATE OR REPLACE FUNCTION public.buyer_training_rows(p_include_arbitration boolean DEFAULT false, p_limit integer DEFAULT NULL::integer, p_offset integer DEFAULT 0)
 RETURNS TABLE(source text, channel_key text, channel_label text, channel_kind text, per_buyer_data boolean, vin text, year integer, make text, model text, odometer integer, segment text, sale_date date, sale_price numeric, buyer_key text, buyer_name text, buyer_email text, buyer_phone text, buyer_city text, buyer_state text, buyer_detail text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    UNION ALL

    SELECT
      'outreach'::text, 'smartauction'::text, 'SmartAuction'::text, 'online_auction'::text, true,
      upper(o.vin), o.year, o.make, o.model, o.mileage,
      sa_segment(o.make, o.model),
      (o.sold_at AT TIME ZONE 'America/Chicago')::date, o.price,
      o.buyer_key, o.buyer_name, o.buyer_email, o.buyer_phone, o.buyer_city, o.buyer_state,
      'buyer outreach'::text
    FROM outreach_sales o
    WHERE is_staff()
      AND NOT EXISTS (
        SELECT 1 FROM sa_sold_sales s3
        WHERE upper(s3.vin) = upper(o.vin)
          AND s3.sale_date IS NOT NULL
          AND abs(s3.sale_date - (o.sold_at AT TIME ZONE 'America/Chicago')::date) <= 30)
      AND NOT EXISTS (
        SELECT 1 FROM sold_book b3
        WHERE upper(b3.vin) = upper(o.vin)
          AND b3.sale_date IS NOT NULL
          AND abs(b3.sale_date - (o.sold_at AT TIME ZONE 'America/Chicago')::date) <= 30)
  )
  SELECT source, channel_key, channel_label, channel_kind, per_buyer_data,
         vin, year, make, model, odometer, segment, sale_date, sale_price,
         buyer_key, buyer_name, buyer_email, buyer_phone, buyer_city,
         buyer_state, buyer_detail
  FROM unioned
  -- A sale that came back is not evidence of what this buyer keeps. Same rule
  -- as vehicle_last_sale(); see migration 20260916000160.
  WHERE public.sale_stuck(vin, sale_date)
  -- (sale_date, vin, buyer_key) is unique enough to page on: a VIN can sell
  -- twice, but not to two buyers on one day.
  ORDER BY sale_date, vin, buyer_key
  LIMIT p_limit OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$
;

NOTIFY pgrst, 'reload schema';
