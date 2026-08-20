-- Keep what we recommended, so it can be graded.
--
-- sa_recommendations has never held a row. Two reasons: every write in
-- BuyerMatch.jsx is wrapped in .catch(() => {}), so failures were invisible; and
-- the table's active_vin carries a foreign key to sa_active_cars, which the page
-- deletes and re-inserts wholesale on every upload. Now that the car list comes
-- from the marketplace rather than the SmartAuction snapshot, that FK would
-- reject most rows outright.
--
-- More importantly the table is a cache — one row per current pick, overwritten
-- on every run. A cache cannot answer "were last month's recommendations any
-- good", which is the question that keeps the whole feature honest. So the cache
-- stays, the FK goes, and an append-only history sits beside it.

-- ---------------------------------------------------------------------------
-- 1. The live cache: current picks, replaced each run.
-- ---------------------------------------------------------------------------
ALTER TABLE public.sa_recommendations DROP CONSTRAINT IF EXISTS sa_recommendations_active_vin_fkey;
ALTER TABLE public.sa_recommendations ADD COLUMN IF NOT EXISTS buyer_key   text;
ALTER TABLE public.sa_recommendations ADD COLUMN IF NOT EXISTS channel_key text;
ALTER TABLE public.sa_recommendations ADD COLUMN IF NOT EXISTS stock_number text;
-- A car has one buyer at each rank. Without this an upsert has no conflict
-- target and every re-run appends a duplicate set.
CREATE UNIQUE INDEX IF NOT EXISTS sa_recommendations_vin_rank
  ON public.sa_recommendations (active_vin, rank);

-- ---------------------------------------------------------------------------
-- 2. The record. One row per (car, buyer, day) — re-running the page all
--    afternoon does not multiply the evidence.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recommendation_history (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  computed_on     date NOT NULL DEFAULT CURRENT_DATE,
  vin             text NOT NULL,
  stock_number    text,
  rank            int  NOT NULL,
  buyer_key       text NOT NULL,
  buyer_name      text,
  channel_key     text,
  predicted_price numeric,
  score           numeric,
  confidence      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS recommendation_history_daily
  ON public.recommendation_history (computed_on, vin, buyer_key);
CREATE INDEX IF NOT EXISTS recommendation_history_vin ON public.recommendation_history (vin);

ALTER TABLE public.recommendation_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rec_history_read ON public.recommendation_history;
CREATE POLICY rec_history_read ON public.recommendation_history
  FOR SELECT TO authenticated USING (public.is_staff());
GRANT SELECT ON public.recommendation_history TO authenticated;
REVOKE ALL ON public.recommendation_history FROM anon;

-- Writes go through a function so a client cannot backdate computed_on and
-- flatter the scorecard.
CREATE OR REPLACE FUNCTION public.save_recommendations(p_rows jsonb)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF NOT is_staff() THEN RAISE EXCEPTION 'staff only'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RETURN 0; END IF;

  WITH incoming AS (
    SELECT DISTINCT ON (upper(r->>'vin'), r->>'buyer_key')
           upper(r->>'vin')            AS vin,
           NULLIF(r->>'stock_number', '') AS stock_number,
           (r->>'rank')::int           AS rank,
           r->>'buyer_key'             AS buyer_key,
           r->>'buyer_name'            AS buyer_name,
           NULLIF(r->>'channel_key', '') AS channel_key,
           NULLIF(r->>'predicted_price', '')::numeric AS predicted_price,
           NULLIF(r->>'score', '')::numeric           AS score,
           NULLIF(r->>'confidence', '') AS confidence
    FROM jsonb_array_elements(p_rows) r
    WHERE COALESCE(r->>'vin', '') <> '' AND COALESCE(r->>'buyer_key', '') <> ''
    ORDER BY upper(r->>'vin'), r->>'buyer_key', (r->>'rank')::int
  )
  INSERT INTO recommendation_history
    (vin, stock_number, rank, buyer_key, buyer_name, channel_key,
     predicted_price, score, confidence)
  SELECT vin, stock_number, rank, buyer_key, buyer_name, channel_key,
         predicted_price, score, confidence
  FROM incoming
  ON CONFLICT (computed_on, vin, buyer_key) DO UPDATE SET
    rank = EXCLUDED.rank, score = EXCLUDED.score,
    predicted_price = EXCLUDED.predicted_price, confidence = EXCLUDED.confidence;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.save_recommendations(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_recommendations(jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The scorecard. For every car recommended and since sold, did the buyer who
--    actually bought it appear in the picks we made beforehand?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recommendation_scorecard(p_days int DEFAULT 90)
RETURNS TABLE (cars_sold bigint, cars_recommended bigint,
               hit_at_1 bigint, hit_at_3 bigint, hit_any bigint,
               hit_rate_1 numeric, hit_rate_3 numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH sold AS (
    SELECT t.vin, t.buyer_key, t.sale_date
    FROM buyer_training_rows() t
    WHERE t.sale_date >= CURRENT_DATE - GREATEST(p_days, 1)
  ),
  -- Only picks made BEFORE the sale count. A recommendation written the day
  -- after the car sold proves nothing.
  matched AS (
    SELECT s.vin, s.buyer_key,
           min(h.rank) FILTER (WHERE h.buyer_key = s.buyer_key) AS truth_rank,
           count(*) > 0 AS was_recommended
    FROM sold s
    JOIN recommendation_history h
      ON h.vin = s.vin AND h.computed_on <= s.sale_date
    GROUP BY s.vin, s.buyer_key
  )
  SELECT (SELECT count(*) FROM sold),
         count(*) FILTER (WHERE was_recommended),
         count(*) FILTER (WHERE truth_rank = 1),
         count(*) FILTER (WHERE truth_rank <= 3),
         count(*) FILTER (WHERE truth_rank IS NOT NULL),
         round(100.0 * count(*) FILTER (WHERE truth_rank = 1)
               / NULLIF(count(*) FILTER (WHERE was_recommended), 0), 1),
         round(100.0 * count(*) FILTER (WHERE truth_rank <= 3)
               / NULLIF(count(*) FILTER (WHERE was_recommended), 0), 1)
  FROM matched;
$$;
REVOKE ALL ON FUNCTION public.recommendation_scorecard(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recommendation_scorecard(int) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
