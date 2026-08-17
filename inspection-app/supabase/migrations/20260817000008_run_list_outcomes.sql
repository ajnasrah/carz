-- Did the cars we recommended actually work? — the feedback loop.
--
-- run_list_observations records what a car looked like on the block (CR grade,
-- announcements, the auction's own valuation) and what the buy list said about
-- it that day. `sold` and `inventory` record what happened next. Both are keyed
-- by VIN, so the join is the study: for every car we ever scored, did we buy it,
-- what did the shop do to it, and did the recommendation hold up.
--
-- This is the table that lets the search criteria adapt instead of staying
-- hand-tuned. Today the buy list's thresholds ($800 profit, 30 days, 2 comps)
-- are constants somebody picked once and nothing has ever checked them. With
-- this, every threshold becomes a measurable question:
--   · of the cars we called TARGET and bought, what did they really average?
--   · does a 2.4 CR grade cost more in the shop than a 3.8, holding the
--     nameplate constant? by how much?
--   · which announcements actually predict recon, and which are noise?
--   · do the cars we PASSED on and bought anyway do worse — or was the engine
--     wrong to pass?
--
-- SECURITY DEFINER because `sold` is RLS-protected against the public keys; the
-- admin check inside is the gate. This returns cost and profit per car, which is
-- the same data the Sold Reports page restricts (migration 20260817000001), so
-- it is held to the same standard rather than the looser one list_all_sold uses.
CREATE OR REPLACE FUNCTION public.run_list_outcomes()
RETURNS TABLE (
  vin             TEXT,
  first_seen      TIMESTAMPTZ,
  times_run       BIGINT,        -- how many sales it ran through before selling
  sale_date       TEXT,
  source_label    TEXT,
  year            INTEGER,
  make            TEXT,
  model           TEXT,
  trim_level      TEXT,   -- "trim" alone is reserved in a RETURNS TABLE signature
  odometer        INTEGER,
  cr_grade        NUMERIC,
  announcements   TEXT,
  auction_value   NUMERIC,
  verdict         TEXT,          -- what we said at the time
  confidence      TEXT,
  exact_n         INTEGER,
  predicted_profit NUMERIC,      -- what we said it would make
  bought          BOOLEAN,
  purchase_date   TEXT,
  original_cost   NUMERIC,
  added_costs     NUMERIC,       -- what the shop actually spent
  total_cost      NUMERIC,
  sales_price     NUMERIC,
  actual_profit   NUMERIC,       -- what it actually made
  days_on_lot     NUMERIC,
  sold_date       TEXT,
  still_held      BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH obs AS (
    -- One row per VIN: the FIRST time we saw it (that's the decision point),
    -- plus a count of how many times it ran in total.
    SELECT DISTINCT ON (o.vin)
      o.vin, o.seen_at, o.sale_date, o.source_label, o.year, o.make, o.model,
      o.trim, o.odometer, o.cr_grade, o.announcements, o.auction_value,
      o.verdict, o.confidence, o.exact_n, o.exact_profit,
      COUNT(*) OVER (PARTITION BY o.vin) AS runs
    FROM public.run_list_observations o
    ORDER BY o.vin, o.seen_at ASC
  )
  SELECT
    obs.vin,
    obs.seen_at,
    obs.runs,
    obs.sale_date,
    obs.source_label,
    obs.year, obs.make, obs.model, obs.trim AS trim_level, obs.odometer,
    obs.cr_grade, obs.announcements, obs.auction_value,
    obs.verdict, obs.confidence, obs.exact_n, obs.exact_profit,
    (s.vehicle_vin IS NOT NULL OR i.vehicle_vin IS NOT NULL) AS bought,
    COALESCE(s.purchase_date, i.purchase_date),
    NULLIF(regexp_replace(COALESCE(s.original_cost, i.total_cost), '[^0-9.-]', '', 'g'), '')::NUMERIC,
    NULLIF(regexp_replace(COALESCE(s.added_costs,   i.added_costs), '[^0-9.-]', '', 'g'), '')::NUMERIC,
    NULLIF(regexp_replace(COALESCE(s.total_cost,    i.total_cost),  '[^0-9.-]', '', 'g'), '')::NUMERIC,
    NULLIF(regexp_replace(s.sales_price,     '[^0-9.-]', '', 'g'), '')::NUMERIC,
    NULLIF(regexp_replace(s.profit_on_sale,  '[^0-9.-]', '', 'g'), '')::NUMERIC,
    NULLIF(regexp_replace(COALESCE(s.days_on_lot, i.days_on_lot), '[^0-9.-]', '', 'g'), '')::NUMERIC,
    s.sale_date,
    (i.vehicle_vin IS NOT NULL AND s.vehicle_vin IS NULL) AS still_held
  FROM obs
  -- A car can appear in `sold` more than once (we buy some back and resell
  -- them). Take the first sale: that's the outcome of THIS purchase decision.
  LEFT JOIN LATERAL (
    SELECT * FROM public.sold sd
    WHERE UPPER(sd.vehicle_vin) = obs.vin
    ORDER BY sd.sale_date ASC LIMIT 1
  ) s ON TRUE
  LEFT JOIN LATERAL (
    SELECT * FROM public.inventory iv
    WHERE UPPER(iv.vehicle_vin) = obs.vin LIMIT 1
  ) i ON TRUE
  WHERE public.is_admin();
$$;

-- Not granted to anon: this carries cost and profit per car. `authenticated`
-- includes buyer accounts, so the is_admin() check in the body is the real gate,
-- not this grant — see migration 20260804000009 and the Sold Reports work.
REVOKE ALL ON FUNCTION public.run_list_outcomes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_list_outcomes() TO authenticated;

NOTIFY pgrst, 'reload schema';
