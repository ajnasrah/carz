-- Merge the customer spellings where merging is a fact, not a judgement.
--
-- customer_merge_candidates() lists identities that might be one dealer. Some of
-- those are certain and some are not, and the difference has a clean rule:
--
--   THORNTON        is a strict word-prefix of  THORNTON CHEVROLET     -> same
--   MT MORIAH       is a strict word-prefix of  MT MORIAH AUTO SALES   -> same
--   CHUCK HUTTON    is a strict word-prefix of  CHUCK HUTTON CHEVROLET -> same
--
--   JIM KERAS NISSAN      vs  JIM KERAS CHEVROLET        -> siblings, NOT the same
--   JOHN THORNTON CHEVROLET vs THORNTON CHEVROLET        -> neither is a prefix
--
-- A short form and a long form of the same name are the same business written
-- two ways. Two different tails off a shared stem are two rooftops, and merging
-- those would be a guess. Only the first rule is applied here; the rest stay
-- visible in customer_merge_candidates() for a person to decide.
--
-- Word-prefix, not character-prefix: "CAR CHOICE" must not swallow "CARSON".

CREATE OR REPLACE FUNCTION public.merge_prefix_customers(p_min_sales int DEFAULT 2)
-- OUT names deliberately differ from customer_aliases' columns: inside the
-- INSERT ... RETURNING below, matching names are ambiguous to the parser.
RETURNS TABLE (from_name text, to_name text, moved bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_staff() THEN RAISE EXCEPTION 'staff only'; END IF;

  RETURN QUERY
  WITH named AS (
    SELECT b.buyer_label AS label, count(*) AS n
    FROM sold_book b
    WHERE b.channel_key IN ('direct', 'carz_jackson')
      AND b.buyer_label IS NOT NULL AND btrim(b.buyer_label) <> ''
    GROUP BY 1
    HAVING count(*) >= p_min_sales
  ),
  pairs AS (
    SELECT s.label AS short_label, s.n AS short_n,
           l.label AS long_label,  l.n AS long_n
    FROM named s
    JOIN named l
      ON l.label <> s.label
     -- the space is what makes it a WORD prefix
     AND l.label LIKE s.label || ' %'
  ),
  -- One dealer can have several longer spellings; everything folds into the
  -- single busiest form so the identity does not chain.
  best AS (
    SELECT DISTINCT ON (short_label)
           short_label, long_label, short_n, long_n
    FROM pairs
    ORDER BY short_label, long_n DESC
  ),
  decided AS (
    SELECT short_label, long_label,
           CASE WHEN short_n >= long_n THEN short_label ELSE long_label END AS canon,
           short_n + long_n AS total
    FROM best
  ),
  ins AS (
    INSERT INTO customer_aliases (variant, canonical, note)
    SELECT v.label, dc.canon, 'word-prefix merge, ' || CURRENT_DATE
    FROM decided dc
    CROSS JOIN LATERAL (VALUES (dc.short_label), (dc.long_label)) AS v(label)
    WHERE v.label <> dc.canon
    ON CONFLICT (variant) DO UPDATE SET canonical = EXCLUDED.canonical
    RETURNING customer_aliases.variant, customer_aliases.canonical
  )
  SELECT i.variant, i.canonical,
         (SELECT count(*) FROM sold_book b WHERE b.buyer_label = i.variant)
  FROM ins i;
END $$;
REVOKE ALL ON FUNCTION public.merge_prefix_customers(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_prefix_customers(int) TO authenticated, service_role;

-- Catch stems the two-word grouping misses: "THORNTON" / "THORNTON CHEVROLET" /
-- "JOHN THORNTON CHEVROLET" share no two-word stem but are obviously worth a look.
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
    -- first two words
    SELECT label, n, btrim((regexp_split_to_array(label, ' '))[1] || ' ' ||
           COALESCE((regexp_split_to_array(label, ' '))[2], '')) AS stem
    FROM named
    UNION ALL
    -- any single distinctive word, so a shared surname anywhere in the name groups
    SELECT n2.label, n2.n, w.word
    FROM named n2
    CROSS JOIN LATERAL unnest(regexp_split_to_array(n2.label, ' ')) AS w(word)
    WHERE length(w.word) >= 6
      AND w.word NOT IN ('AUTOMOTIVE','MOTORS','DEALERSHIP','WHOLESALE','IMPORTS','EXPORTS','TRADING','COMPANY','HOLDINGS','ENTERPRISES','INVESTMENTS')
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
DECLARE r record; n bigint; b bigint; before_b bigint;
BEGIN
  SELECT count(DISTINCT buyer_key) INTO before_b FROM public.buyer_training_rows();

  RAISE NOTICE '--- merging word-prefix spellings ---';
  FOR r IN SELECT * FROM public.merge_prefix_customers(2) LOOP
    RAISE NOTICE '  % -> %  (% rows)', rpad(r.from_name, 28), rpad(r.to_name, 28), r.moved;
  END LOOP;

  -- Re-resolve the ledger so the new aliases take effect.
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
  RAISE NOTICE 'training rows: % sales, % customers (was % customers)', n, b, before_b;

  RAISE NOTICE '--- still worth a human look (siblings, not prefixes) ---';
  FOR r IN SELECT * FROM public.customer_merge_candidates(20) LIMIT 8 LOOP
    RAISE NOTICE '  % sales: %', lpad(r.sales::text, 4), r.spellings;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
