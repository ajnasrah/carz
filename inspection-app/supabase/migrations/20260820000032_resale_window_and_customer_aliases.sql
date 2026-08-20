-- Two accuracy bugs the training audit turned up.
--
-- BUG 1 — the de-duplication was dropping real sales.
-- buyer_training_rows() excluded any Frazer row whose VIN also appears in
-- sa_sold_sales, to stop a SmartAuction sale being counted twice. But a VIN
-- legitimately sells more than once: we sell it at UAX, it comes back, and it
-- goes out again on SmartAuction months later. Matching on VIN alone threw the
-- second sale away.
--
-- The gap between the Frazer date and the SmartAuction date for a shared VIN is
-- sharply bimodal, with nothing at all in the 4-7 day band:
--
--     same day 1170 | 1-3d 33 | 4-7d 0 | 8-14d 5 | 15-30d 17
--     -------------------------- 30 days --------------------------
--     31-60d 77 | 61-120d 50 | 121-365d 21
--
-- Below 30 days it is one event recorded by two systems. Above it, it is two
-- sales. 148 real sales were being discarded, and not at random — almost all of
-- them were lane sales, so the lanes were being systematically under-counted.
--
-- BUG 2 — one dealer, several spellings.
-- This is the same fault that was fixed for SmartAuction by keying on phone, but
-- Frazer gives us no phone: "MT MORIAH", "MT. MORIAH", "MT.MORIAH" and "MT.
-- MORIAH AUTO SALES" are one customer with 158 sales, filed as four with 120,
-- 4, 16 and 18. Punctuation and trailing legal forms are stripped mechanically;
-- anything requiring a judgement call goes in customer_aliases by hand rather
-- than being guessed at, because merging two dealers who merely sound alike is
-- worse than leaving them apart.

-- ---------------------------------------------------------------------------
-- 1. Manual merges. Deliberately empty of guesses — buyer_training_audit()
--    surfaces candidates and a person decides.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_aliases (
  variant   text PRIMARY KEY,   -- as it appears in Frazer, normalised
  canonical text NOT NULL,      -- what it should be counted as
  note      text
);
ALTER TABLE public.customer_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_aliases_read ON public.customer_aliases;
CREATE POLICY customer_aliases_read ON public.customer_aliases FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.customer_aliases TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Mechanical name normalisation for named customers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_customer(p_name text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE s text; prev text;
BEGIN
  s := btrim(regexp_replace(upper(COALESCE(p_name, '')), '\s+', ' ', 'g'));
  IF s = '' THEN RETURN NULL; END IF;
  -- "SMITH AUTO DBA BOB'S CARS" — the trading name is the tail, but Frazer
  -- truncates at 25 characters so it is usually cut off. Keep the legal name.
  s := btrim(regexp_replace(s, '\mDBA\M.*$', '', 'g'));
  s := regexp_replace(s, '[.,''&/]', ' ', 'g');
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  -- Strip legal forms, but only where they trail: "CO" inside "CO OP MOTORS" is
  -- not a suffix. Loop so "UNITED TRADERS INC LLC" fully reduces.
  LOOP
    prev := s;
    s := btrim(regexp_replace(s, '\s(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|LTD|LP|LLP|COMPANY)$', '', 'g'));
    EXIT WHEN s = prev OR s = '';
  END LOOP;
  RETURN NULLIF(btrim(s), '');
END $$;
REVOKE ALL ON FUNCTION public.normalize_customer(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_customer(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Resolver: apply normalisation, then any hand-written alias.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_sale_channel(p_customer text)
RETURNS TABLE (channel_key text, buyer_label text, buyer_detail text, is_arbitration boolean)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  u text; base text; paren text; arb boolean;
  ch public.sale_channels%ROWTYPE;
  hit text; rest text; canon text;
BEGIN
  u := btrim(regexp_replace(upper(COALESCE(p_customer, '')), '\s+', ' ', 'g'));
  IF u = '' THEN
    RETURN QUERY SELECT 'unknown'::text, NULL::text, NULL::text, false;
    RETURN;
  END IF;

  paren := NULLIF(btrim(COALESCE(substring(u from '\(([^)]*)\)'), substring(u from '\((.*)$'))), '');
  base  := btrim(regexp_replace(regexp_replace(u, '\(.*$', '', 'g'), '\s+', ' ', 'g'));
  arb   := (u ~ '(^|\s)ARB(ITRATION)?(\s|$)');
  base  := btrim(regexp_replace(base, '(^|\s)ARB(ITRATION)?(\s|$)', ' ', 'g'));
  IF base = '' THEN base := u; END IF;

  SELECT a.channel_key INTO hit
  FROM public.sale_channel_aliases a
  WHERE (a.match_type = 'exact'    AND base = a.pattern)
     OR (a.match_type = 'prefix'   AND base LIKE a.pattern || '%')
     OR (a.match_type = 'contains' AND base LIKE '%' || a.pattern || '%')
  ORDER BY a.priority, length(a.pattern) DESC
  LIMIT 1;

  -- Named customers get their spelling settled before they become an identity.
  IF hit IS NULL OR hit IN ('carz_jackson', 'direct') THEN
    canon := normalize_customer(CASE WHEN hit = 'carz_jackson'
                                     THEN btrim(regexp_replace(base, '^CARZ JACKSON', '', 'g'))
                                     ELSE base END);
    SELECT ca.canonical INTO rest FROM public.customer_aliases ca WHERE ca.variant = canon;
    canon := COALESCE(rest, canon);
  END IF;

  IF hit IS NULL THEN
    RETURN QUERY SELECT 'direct'::text, canon, paren, arb;
    RETURN;
  END IF;

  SELECT * INTO ch FROM public.sale_channels WHERE public.sale_channels.channel_key = hit;

  IF hit = 'smartauction' THEN
    RETURN QUERY SELECT hit, NULL::text, paren, arb;
  ELSIF hit = 'carz_jackson' THEN
    RETURN QUERY SELECT hit, canon, paren, arb;
  ELSIF ch.per_buyer_data THEN
    RETURN QUERY SELECT hit, canon, paren, arb;
  ELSE
    RETURN QUERY SELECT hit, ch.label, paren, arb;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.resolve_sale_channel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_sale_channel(text) TO authenticated, service_role;

-- Re-resolve everything already in the ledger against the new rules.
-- The LATERAL has to sit inside a sub-select: an UPDATE ... FROM cannot join
-- laterally against its own target table.
WITH resolved AS (
  SELECT s.id, r.channel_key, r.buyer_label, r.buyer_detail, r.is_arbitration
  FROM public.sold_book s
  CROSS JOIN LATERAL public.resolve_sale_channel(s.customer) r
)
UPDATE public.sold_book b
SET channel_key = x.channel_key, buyer_label = x.buyer_label,
    buyer_detail = x.buyer_detail, is_arbitration = COALESCE(x.is_arbitration, false),
    updated_at = NOW()
FROM resolved x
WHERE b.id = x.id
  AND (b.channel_key IS DISTINCT FROM x.channel_key
       OR b.buyer_label IS DISTINCT FROM x.buyer_label);

-- ---------------------------------------------------------------------------
-- 4. Training rows: same VIN inside 30 days is one event, outside it is two.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buyer_training_rows(p_include_arbitration boolean DEFAULT false)
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
  )
  SELECT
    'smartauction'::text, 'smartauction'::text, 'SmartAuction'::text,
    'online_auction'::text, true,
    upper(sa.vin), sa.year, sa.make, sa.model, sa.odometer,
    COALESCE(sa.segment, sa_segment(sa.make, sa.model)),
    sa.sale_date, sa.sale_price,
    CASE
      WHEN length(sa.d) = 10 THEN 'p:' || sa.d
      WHEN length(sa.d) = 11 AND left(sa.d, 1) = '1' THEN 'p:' || right(sa.d, 10)
      WHEN sa.buyer_email LIKE '%@%' THEN 'e:' || lower(btrim(sa.buyer_email))
      ELSE 'n:' || lower(btrim(regexp_replace(COALESCE(sa.buyer_name, ''), '\s+', ' ', 'g')))
    END,
    sa.buyer_name, sa.buyer_email, sa.buyer_phone, sa.buyer_city, sa.buyer_state,
    NULL::text
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
    -- The same car reported by both systems within a month is one sale. Further
    -- apart than that, the car came back and sold again, and both are real.
    AND NOT EXISTS (
      SELECT 1 FROM sa_sold_sales s2
      WHERE upper(s2.vin) = upper(b.vin)
        AND s2.sale_date IS NOT NULL
        AND abs(s2.sale_date - b.sale_date) <= 30);
$$;
REVOKE ALL ON FUNCTION public.buyer_training_rows(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_training_rows(boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Surface merge candidates instead of guessing at them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_merge_candidates(p_min_sales int DEFAULT 8)
RETURNS TABLE (stem text, identities bigint, sales bigint, spellings text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH named AS (
    SELECT buyer_label, count(*) AS n
    FROM sold_book
    WHERE channel_key IN ('direct', 'carz_jackson')
      AND buyer_label IS NOT NULL AND is_staff()
    GROUP BY 1
  ),
  -- Two identities are candidates when one's first two words are the other's.
  stems AS (
    SELECT buyer_label, n,
           (regexp_split_to_array(buyer_label, ' '))[1] || ' ' ||
           COALESCE((regexp_split_to_array(buyer_label, ' '))[2], '') AS stem
    FROM named
  )
  SELECT btrim(stem), count(*), sum(n),
         string_agg(buyer_label || ' (' || n || ')', ' + ' ORDER BY n DESC)
  FROM stems
  WHERE btrim(stem) <> ''
  GROUP BY btrim(stem)
  HAVING count(*) > 1 AND sum(n) >= p_min_sales
  ORDER BY sum(n) DESC;
$$;
REVOKE ALL ON FUNCTION public.customer_merge_candidates(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_merge_candidates(int) TO authenticated, service_role;

DO $$
DECLARE r record; n bigint; b bigint;
BEGIN
  SELECT count(*), count(DISTINCT buyer_key) INTO n, b FROM public.buyer_training_rows();
  RAISE NOTICE 'training rows now: % sales, % customers', n, b;
  RAISE NOTICE '--- customers that may be the same dealer typed differently ---';
  FOR r IN SELECT * FROM public.customer_merge_candidates(8) LIMIT 12 LOOP
    RAISE NOTICE '  % sales across % spellings: %', lpad(r.sales::text, 4), r.identities, r.spellings;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
