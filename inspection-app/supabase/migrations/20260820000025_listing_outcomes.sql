-- Keep the cars that did NOT sell.
--
-- The SmartAuction full report contains four kinds of row — active, sold,
-- removed and held — and the uploader has always classified all four, counted
-- all four in its log line, and then saved two. So every "no" we have ever
-- received went in the bin: the cars we listed and could not move, the reasons
-- they came off, and how long they sat before that happened.
--
-- Those are the negative examples. A model trained only on wins cannot tell the
-- difference between "this lane takes this car" and "this is the only lane we
-- ever tried". They are also the only source of days-to-sell we have on the
-- selling side, which is what tells you a car needs its net widened.

CREATE TABLE IF NOT EXISTS public.sa_listing_outcomes (
  vin            text NOT NULL,
  -- The report is a snapshot, so the same VIN legitimately appears across many
  -- uploads at different stages of its life.
  observed_on    date NOT NULL DEFAULT CURRENT_DATE,
  status         text NOT NULL CHECK (status IN ('active', 'sold', 'removed', 'hold')),
  year           int,
  make           text,
  model          text,
  odometer       int,
  segment        text,
  opening_price  numeric,
  buy_now        numeric,
  days_remaining int,
  removal_date   date,
  removal_reason text,
  hold_date      date,
  hold_reason    text,
  location       text,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vin, observed_on, status)
);
CREATE INDEX IF NOT EXISTS sa_listing_outcomes_status ON public.sa_listing_outcomes (status, observed_on DESC);
CREATE INDEX IF NOT EXISTS sa_listing_outcomes_vin    ON public.sa_listing_outcomes (vin);

ALTER TABLE public.sa_listing_outcomes ENABLE ROW LEVEL SECURITY;
-- The extension writes with the anon key and has no sign-in, exactly as it does
-- for sa_active_cars and sa_sold_sales. Nothing here is customer data: it is our
-- own listings and why they came down.
DROP POLICY IF EXISTS sa_listing_outcomes_rw ON public.sa_listing_outcomes;
CREATE POLICY sa_listing_outcomes_rw ON public.sa_listing_outcomes
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.sa_listing_outcomes TO anon, authenticated;

-- How hard is this kind of car to move? Feeds "widen the net" rather than the
-- ranking itself — a car that has come off the block twice needs more buyers
-- shown, not a different top three.
CREATE OR REPLACE FUNCTION public.listing_difficulty(p_days int DEFAULT 365)
RETURNS TABLE (segment text, make text, listings bigint, sold bigint,
               removed bigint, sell_through numeric, avg_days_listed numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH latest AS (
    SELECT DISTINCT ON (vin) vin, status, segment, make, days_remaining
    FROM sa_listing_outcomes
    WHERE observed_on >= CURRENT_DATE - GREATEST(p_days, 1)
    ORDER BY vin, observed_on DESC
  )
  SELECT COALESCE(l.segment, 'car'), l.make, count(*),
         count(*) FILTER (WHERE l.status = 'sold'),
         count(*) FILTER (WHERE l.status = 'removed'),
         round(100.0 * count(*) FILTER (WHERE l.status = 'sold') / NULLIF(count(*), 0), 1),
         round(avg(l.days_remaining), 1)
  FROM latest l
  WHERE is_staff()
  GROUP BY 1, 2
  ORDER BY count(*) DESC;
$$;
REVOKE ALL ON FUNCTION public.listing_difficulty(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listing_difficulty(int) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
