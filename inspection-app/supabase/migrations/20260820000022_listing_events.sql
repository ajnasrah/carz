-- Start recording demand.
--
-- Everything Buyer Match knows is a completed sale. Nothing anywhere records
-- what anyone looked for: the marketplace search box is client-side state, the
-- filters are client-side state, and opening a listing leaves no trace. So the
-- only buyers the system can reason about are the ones who already bought, and
-- 28% of our SmartAuction sales go to someone who never had.
--
-- One table fixes that. It is deliberately thin — an event type, who (as far as
-- we can tell), which car or which query, and when. No PII beyond what the app
-- already holds, and an anonymous per-browser key so a visitor's searches join
-- into a session without identifying anyone.

CREATE TABLE IF NOT EXISTS public.listing_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type   text NOT NULL CHECK (event_type IN (
                 'search',        -- typed in the marketplace search box (debounced)
                 'filter',        -- applied a make/model/year/mileage filter
                 'listing_view',  -- opened a car's listing page
                 'share_open',    -- opened a /m/<slug> list we sent them
                 'share_view',    -- opened one car from inside a shared list
                 'reserve'        -- reserved a car
               )),
  -- Anonymous, browser-local. Lets a visitor's searches join into one session
  -- without knowing who they are.
  session_key  text,
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Resolved buyer identity when we do know: a share link carries it, and a
  -- signed-in buyer account resolves to one. Same phone->email->name convention
  -- as sa_buyers and buyer_training_rows().
  buyer_key    text,
  stock_number text,
  vin          text,
  query        text,
  filters      jsonb,
  result_count int,
  source       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_events_recent  ON public.listing_events (created_at DESC);
CREATE INDEX IF NOT EXISTS listing_events_buyer   ON public.listing_events (buyer_key, created_at DESC) WHERE buyer_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS listing_events_session ON public.listing_events (session_key, created_at DESC);
CREATE INDEX IF NOT EXISTS listing_events_vin     ON public.listing_events (vin) WHERE vin IS NOT NULL;

ALTER TABLE public.listing_events ENABLE ROW LEVEL SECURITY;
-- No INSERT policy: writes go through log_listing_event() so the shape stays
-- controlled and a client cannot backdate or forge a buyer_key on someone else's
-- behalf beyond what it already knows. Reads are staff-only — this is a record of
-- what our customers are shopping for.
DROP POLICY IF EXISTS listing_events_read ON public.listing_events;
CREATE POLICY listing_events_read ON public.listing_events
  FOR SELECT TO authenticated USING (public.is_staff());
GRANT SELECT ON public.listing_events TO authenticated;
REVOKE ALL ON public.listing_events FROM anon;

-- ---------------------------------------------------------------------------
-- The writer. Open to anon because the marketplace is public and an un-logged-in
-- dealer browsing our cars is exactly the signal we are missing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_listing_event(
  p_event_type   text,
  p_session_key  text DEFAULT NULL,
  p_stock_number text DEFAULT NULL,
  p_vin          text DEFAULT NULL,
  p_query        text DEFAULT NULL,
  p_filters      jsonb DEFAULT NULL,
  p_result_count int DEFAULT NULL,
  p_source       text DEFAULT NULL,
  p_buyer_key    text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_event_type IS NULL THEN RETURN; END IF;
  INSERT INTO listing_events (
    event_type, session_key, actor_id, buyer_key, stock_number, vin,
    query, filters, result_count, source)
  VALUES (
    p_event_type,
    left(NULLIF(btrim(COALESCE(p_session_key, '')), ''), 64),
    auth.uid(),
    left(NULLIF(btrim(COALESCE(p_buyer_key, '')), ''), 200),
    left(NULLIF(btrim(COALESCE(p_stock_number, '')), ''), 40),
    upper(left(NULLIF(btrim(COALESCE(p_vin, '')), ''), 17)),
    -- A search box can receive anything; keep it short and keep it text.
    left(NULLIF(btrim(COALESCE(p_query, '')), ''), 120),
    p_filters,
    p_result_count,
    left(NULLIF(btrim(COALESCE(p_source, '')), ''), 40));
EXCEPTION WHEN check_violation THEN
  -- An unknown event_type must never break the page that emitted it.
  RETURN;
END $$;
REVOKE ALL ON FUNCTION public.log_listing_event(text, text, text, text, text, jsonb, int, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_listing_event(text, text, text, text, text, jsonb, int, text, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Opening a list we sent is the one demand signal we already collect and never
-- read. Keep the counters, and emit an event carrying the buyer it was sent to.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buyer_share_list_opened(p_slug text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key text; v_vins text[];
BEGIN
  UPDATE buyer_share_lists
     SET open_count      = open_count + 1,
         first_opened_at = COALESCE(first_opened_at, now()),
         last_opened_at  = now()
   WHERE slug = p_slug
   RETURNING buyer_key, vins INTO v_key, v_vins;

  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO listing_events (event_type, buyer_key, source, result_count, query)
  VALUES ('share_open', v_key, 'share_list', COALESCE(array_length(v_vins, 1), 0), p_slug);
END $$;
GRANT EXECUTE ON FUNCTION public.buyer_share_list_opened(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- What each known buyer has been shopping for lately, resolved to the vehicle
-- attributes the engine scores on. This is what turns a browse into a lead.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buyer_demand_signals(p_days int DEFAULT 60)
RETURNS TABLE (buyer_key text, make text, model text, segment text,
               views bigint, last_seen timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.buyer_key,
         upper(btrim(i.vehicle_make))  AS make,
         upper(btrim(i.vehicle_model)) AS model,
         sa_segment(i.vehicle_make, i.vehicle_model) AS segment,
         count(*) AS views,
         max(e.created_at) AS last_seen
  FROM listing_events e
  JOIN inventory i
    ON i.stock_number = e.stock_number
   OR upper(i.vehicle_vin) = e.vin
  WHERE is_staff()
    AND e.buyer_key IS NOT NULL
    AND e.event_type IN ('listing_view', 'share_view', 'reserve')
    AND e.created_at >= now() - make_interval(days => GREATEST(p_days, 1))
  GROUP BY 1, 2, 3, 4;
$$;
REVOKE ALL ON FUNCTION public.buyer_demand_signals(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_demand_signals(int) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What the market as a whole is asking for, named or not. This is the answer to
-- "what should we be bidding on", and it needs no buyer identity at all.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.demand_searches(p_days int DEFAULT 30)
RETURNS TABLE (query text, searches bigint, sessions bigint, last_seen timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lower(btrim(e.query)), count(*), count(DISTINCT e.session_key), max(e.created_at)
  FROM listing_events e
  WHERE is_staff()
    AND e.event_type = 'search'
    AND e.query IS NOT NULL AND length(btrim(e.query)) >= 2
    AND e.created_at >= now() - make_interval(days => GREATEST(p_days, 1))
  GROUP BY 1
  ORDER BY count(*) DESC;
$$;
REVOKE ALL ON FUNCTION public.demand_searches(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.demand_searches(int) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
