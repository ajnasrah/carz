-- Keep the auction house on every car we look at.
--
-- The Manheim export carries both "Auction House" ("Manheim Kansas City") and
-- "Pickup Location" ("MO - Manheim Kansas City"), and the importer only kept the
-- second. They are usually the same place, and then they are not: an offsite or
-- dealer-held unit lists the lot it is sitting on, not the sale it runs in — the
-- observations already hold rows reading "ADESA Offsite Wholesale, Tolleson, AZ",
-- which is a warehouse, not an auction. Grouping a study by location therefore
-- splits one sale across several rows and files offsite cars under nowhere.
--
-- `auction` is the sale. `location` stays what it always was — where the car
-- physically is — because for transport that is the number that matters.
ALTER TABLE public.run_list_observations
  ADD COLUMN IF NOT EXISTS auction TEXT,
  ADD COLUMN IF NOT EXISTS sale_name TEXT;

CREATE INDEX IF NOT EXISTS run_list_observations_auction
  ON public.run_list_observations (auction, sale_date DESC)
  WHERE auction IS NOT NULL;

COMMENT ON COLUMN public.run_list_observations.auction IS
  'The sale the car runs in (Manheim "Auction House"). Distinct from location, '
  'which is where the car physically sits and can be an offsite lot.';

-- Backfill from the pickup location, which for the Manheim feeds is the same
-- place wearing a state prefix. Anything that does not look like an auction name
-- is left alone rather than guessed at.
UPDATE public.run_list_observations
   SET auction = btrim(regexp_replace(location, '^[A-Z]{2}\s*-\s*', ''))
 WHERE auction IS NULL
   AND location IS NOT NULL
   AND location ~* '(manheim|adesa|daa|uax|america)';

-- How a lane or a consignor has actually done, for any sale. This is the query
-- behind the "by lane / by seller" view: what runs there, how much of it we
-- flagged, and what the comparable cars we already sold actually returned.
CREATE OR REPLACE FUNCTION run_list_lane_study(p_auction text DEFAULT NULL, p_days int DEFAULT 120)
RETURNS TABLE (
  auction text, lane text, seller text,
  cars bigint, targets bigint, watches bigint, passes bigint,
  avg_cr numeric, exp_profit numeric, exp_days numeric, comps bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(o.auction, o.location, '(unknown)'),
         COALESCE(NULLIF(btrim(o.lane), ''), '—'),
         COALESCE(NULLIF(btrim(o.seller), ''), '—'),
         count(*),
         count(*) FILTER (WHERE o.verdict = 'TARGET'),
         count(*) FILTER (WHERE o.verdict = 'WATCH'),
         count(*) FILTER (WHERE o.verdict = 'PASS'),
         round(avg(o.cr_grade), 1),
         -- Only cars with a real comp behind them: exact_profit is meaningless
         -- when exact_n is 0, and averaging those zeros drags a good lane down.
         round(avg(o.exact_profit) FILTER (WHERE COALESCE(o.exact_n, 0) > 0), 0),
         round(avg(o.exact_days) FILTER (WHERE COALESCE(o.exact_n, 0) > 0), 0),
         COALESCE(sum(o.exact_n), 0)
  FROM run_list_observations o
  WHERE o.seen_at >= now() - make_interval(days => p_days)
    AND (p_auction IS NULL
         OR COALESCE(o.auction, o.location, '') ILIKE '%' || p_auction || '%')
  GROUP BY 1, 2, 3
  ORDER BY 1, avg(o.exact_profit) FILTER (WHERE COALESCE(o.exact_n, 0) > 0) DESC NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION run_list_lane_study(text, int) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
