-- Two things the merge pass exposed.
--
-- 1. "CARZ JACKSON SMART AUCTIO" is a car from the Jackson lot that sold on
--    SmartAuction. The resolver matched CARZ JACKSON first — correct by the
--    rule, wrong by intent — and then treated the remainder, "SMART AUCTIO", as
--    the name of a retail customer. The prefix merge then dutifully folded
--    "SMART" into "SMART AUCTIO" as though they were one walk-in buyer.
--    The remainder should be re-resolved: if it names a lane, the sale belongs
--    to that lane.
--
-- 2. customer_merge_candidates() grouped on any word of six or more letters,
--    which includes CHEVROLET — so Chuck Hutton, Dobbs Brothers, Jim Keras and
--    Thornton were offered as one merge candidate. A shared franchise is not a
--    shared owner. Marque names are excluded.

CREATE OR REPLACE FUNCTION public.resolve_sale_channel(p_customer text)
RETURNS TABLE (channel_key text, buyer_label text, buyer_detail text, is_arbitration boolean)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  u text; base text; paren text; arb boolean;
  ch public.sale_channels%ROWTYPE;
  hit text; rest text; canon text; tail text; tail_hit text;
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

  -- Our own store forwarding a car to a lane: the lane is the counterparty, not
  -- a customer called "SMART AUCTIO".
  IF hit = 'carz_jackson' THEN
    tail := btrim(regexp_replace(base, '^CARZ JACKSON', '', 'g'));
    IF tail <> '' THEN
      SELECT a.channel_key INTO tail_hit
      FROM public.sale_channel_aliases a
      WHERE a.channel_key <> 'carz_jackson'
        AND ((a.match_type = 'exact'  AND tail = a.pattern)
          OR (a.match_type = 'prefix' AND tail LIKE a.pattern || '%'))
      ORDER BY a.priority, length(a.pattern) DESC
      LIMIT 1;
      IF tail_hit IS NOT NULL THEN
        hit  := tail_hit;
        base := tail;
      END IF;
    END IF;
  END IF;

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

-- Undo the bad merge; it named a marketplace as a retail customer.
DELETE FROM public.customer_aliases WHERE variant = 'SMART' AND canonical = 'SMART AUCTIO';

CREATE OR REPLACE FUNCTION public.customer_merge_candidates(p_min_sales int DEFAULT 8)
RETURNS TABLE (stem text, identities bigint, sales bigint, spellings text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH named AS (
    SELECT buyer_label AS label, count(*) AS n
    FROM sold_book
    WHERE channel_key IN ('direct', 'carz_jackson')
      AND buyer_label IS NOT NULL AND is_staff()
    GROUP BY 1
  ),
  stems AS (
    SELECT label, n, btrim((regexp_split_to_array(label, ' '))[1] || ' ' ||
           COALESCE((regexp_split_to_array(label, ' '))[2], '')) AS stem
    FROM named
    UNION ALL
    SELECT n2.label, n2.n, w.word
    FROM named n2
    CROSS JOIN LATERAL unnest(regexp_split_to_array(n2.label, ' ')) AS w(word)
    WHERE length(w.word) >= 6
      -- Generic trade words, and marques: sharing a franchise is not sharing an
      -- owner, so CHEVROLET must not group four unrelated dealerships.
      AND w.word NOT IN (
        'AUTOMOTIVE','MOTORS','DEALERSHIP','WHOLESALE','IMPORTS','EXPORTS','TRADING',
        'COMPANY','HOLDINGS','ENTERPRISES','INVESTMENTS','BROTHERS','SERVICE','CENTER',
        'CHEVROLET','CHEVY','TOYOTA','NISSAN','HYUNDAI','HONDA','SUBARU','CADILLAC',
        'CHRYSLER','LINCOLN','BUICK','MITSUBISHI','VOLKSWAGEN','MERCEDES','INFINITI',
        'PORSCHE','MASERATI','GENESIS','ACURA','LEXUS','JAGUAR','BENTLEY','FERRARI')
  )
  SELECT s.stem, count(DISTINCT s.label), sum(DISTINCT s.n),
         string_agg(DISTINCT s.label || ' (' || s.n || ')', ' + ')
  FROM stems s
  WHERE btrim(s.stem) <> ''
  GROUP BY s.stem
  HAVING count(DISTINCT s.label) > 1 AND sum(DISTINCT s.n) >= p_min_sales
  ORDER BY sum(DISTINCT s.n) DESC;
$$;
REVOKE ALL ON FUNCTION public.customer_merge_candidates(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_merge_candidates(int) TO authenticated, service_role;

DO $$
DECLARE r record; n bigint; b bigint;
BEGIN
  WITH resolved AS (
    SELECT s.id, r2.channel_key, r2.buyer_label, r2.buyer_detail, r2.is_arbitration
    FROM public.sold_book s
    CROSS JOIN LATERAL public.resolve_sale_channel(s.customer) r2
  )
  UPDATE public.sold_book bk
  SET channel_key = x.channel_key, buyer_label = x.buyer_label,
      buyer_detail = x.buyer_detail, is_arbitration = COALESCE(x.is_arbitration, false),
      updated_at = NOW()
  FROM resolved x
  WHERE bk.id = x.id
    AND (bk.channel_key IS DISTINCT FROM x.channel_key
         OR bk.buyer_label IS DISTINCT FROM x.buyer_label);

  SELECT count(*), count(DISTINCT buyer_key) INTO n, b FROM public.buyer_training_rows();
  RAISE NOTICE 'training rows: % sales, % customers', n, b;
  RAISE NOTICE '--- still worth a human look ---';
  FOR r IN SELECT * FROM public.customer_merge_candidates(20) LIMIT 8 LOOP
    RAISE NOTICE '  % sales: %', lpad(r.sales::text, 4), r.spellings;
  END LOOP;
  RAISE NOTICE '================ TRAINING AUDIT ================';
  FOR r IN SELECT * FROM public.buyer_training_audit() LOOP
    RAISE NOTICE '% | % | %', rpad(r.check_name, 44), rpad(r.status, 11), r.detail;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
