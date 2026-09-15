-- Marketplace "Text best buyer": the buyers we can actually text about a car.
--
-- sa_recommendations answers "who is likeliest to buy this car" over every
-- buyer we know, and most of its #1 picks are Frazer dealers with a name and no
-- number (13 of 71 cars had a textable #1 on 2026-09-15). A button that opens
-- Messages is useless for those, so this is a separate, narrower list: the best
-- buyers per car AMONG buyers with a phone on file — in practice SmartAuction
-- buyers. It is recomputed hourly by /api/buyer-picks, so it covers cars that
-- arrived after anyone last opened Buyer Match.
--
-- Both tables hold buyer phone numbers, so neither has a policy: anon and
-- authenticated cannot touch them at all, and everything goes through the
-- staff-gated functions below.

CREATE TABLE IF NOT EXISTS public.marketplace_buyer_picks (
  vin             text        NOT NULL,
  rank            integer     NOT NULL,
  stock_number    text,
  buyer_key       text        NOT NULL,
  buyer_name      text        NOT NULL,
  buyer_phone     text        NOT NULL,
  buyer_email     text,
  buyer_city      text,
  buyer_state     text,
  predicted_price integer,
  confidence      text,
  reason          text,
  total_buys      integer,
  days_since      integer,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vin, rank)
);
ALTER TABLE public.marketplace_buyer_picks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_buyer_picks FROM anon, authenticated;

-- Every tap of Text. The message leaves from the salesman's own phone, so this
-- is the only record that a buyer was pitched a car — what lets the sheet say
-- "texted 2d ago" instead of three people texting Rusty Eck the same Silverado.
CREATE TABLE IF NOT EXISTS public.buyer_pitches (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vin          text        NOT NULL,
  stock_number text,
  buyer_key    text        NOT NULL,
  buyer_name   text,
  buyer_phone  text,
  pitched_by   uuid        DEFAULT auth.uid(),
  pitched_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS buyer_pitches_vin_buyer ON public.buyer_pitches (vin, buyer_key, pitched_at DESC);
ALTER TABLE public.buyer_pitches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.buyer_pitches FROM anon, authenticated;

-- Replace the whole list in one statement. Delete-then-insert as two REST calls
-- would leave a window where the marketplace reads no picks at all.
CREATE OR REPLACE FUNCTION public.replace_marketplace_buyer_picks(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE n integer;
BEGIN
  DELETE FROM marketplace_buyer_picks WHERE true;
  INSERT INTO marketplace_buyer_picks (
    vin, rank, stock_number, buyer_key, buyer_name, buyer_phone, buyer_email,
    buyer_city, buyer_state, predicted_price, confidence, reason, total_buys, days_since
  )
  SELECT upper(r->>'vin'), (r->>'rank')::int, r->>'stock_number', r->>'buyer_key',
         r->>'buyer_name', r->>'buyer_phone', r->>'buyer_email', r->>'buyer_city',
         r->>'buyer_state', (r->>'predicted_price')::int, r->>'confidence', r->>'reason',
         (r->>'total_buys')::int, (r->>'days_since')::int
  FROM jsonb_array_elements(p_rows) r;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
-- Server only. EXECUTE defaults to PUBLIC, which includes anon.
REVOKE ALL ON FUNCTION public.replace_marketplace_buyer_picks(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_marketplace_buyer_picks(jsonb) TO service_role;

-- The picks for every car, with who last texted each buyer about it. One call
-- when the marketplace opens: ~100 cars x 3 buyers, well under PostgREST's
-- 1,000-row cap — the client warns if that ever stops being true.
CREATE OR REPLACE FUNCTION public.marketplace_buyer_picks()
RETURNS TABLE (
  vin text, rank integer, stock_number text, buyer_key text, buyer_name text,
  buyer_phone text, buyer_email text, buyer_city text, buyer_state text,
  predicted_price integer, confidence text, reason text, total_buys integer,
  days_since integer, computed_at timestamptz,
  last_pitched_at timestamptz, last_pitched_by text, pitch_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.vin, p.rank, p.stock_number, p.buyer_key, p.buyer_name, p.buyer_phone,
         p.buyer_email, p.buyer_city, p.buyer_state, p.predicted_price, p.confidence,
         p.reason, p.total_buys, p.days_since, p.computed_at,
         lp.pitched_at, lp.who, COALESCE(lp.n, 0)::int
  FROM marketplace_buyer_picks p
  LEFT JOIN LATERAL (
    SELECT max(b.pitched_at) AS pitched_at, count(*) AS n,
           (SELECT coalesce(nullif(pr.name, ''), 'someone')
              FROM buyer_pitches b2 LEFT JOIN profiles pr ON pr.id = b2.pitched_by
             WHERE b2.vin = p.vin AND b2.buyer_key = p.buyer_key
             ORDER BY b2.pitched_at DESC LIMIT 1) AS who
    FROM buyer_pitches b
    WHERE b.vin = p.vin AND b.buyer_key = p.buyer_key
  ) lp ON true
  WHERE is_staff()
  ORDER BY p.vin, p.rank;
$$;
REVOKE ALL ON FUNCTION public.marketplace_buyer_picks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketplace_buyer_picks() TO authenticated, service_role;

-- Record a Text tap. Staff only: a buyer signed into the marketplace is
-- `authenticated` too, and must not be able to write here.
CREATE OR REPLACE FUNCTION public.log_buyer_pitch(
  p_vin text, p_buyer_key text, p_stock_number text DEFAULT NULL,
  p_buyer_name text DEFAULT NULL, p_buyer_phone text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'staff only' USING ERRCODE = '42501';
  END IF;
  INSERT INTO buyer_pitches (vin, stock_number, buyer_key, buyer_name, buyer_phone, pitched_by)
  VALUES (upper(p_vin), p_stock_number, p_buyer_key, p_buyer_name, p_buyer_phone, auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.log_buyer_pitch(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_buyer_pitch(text, text, text, text, text) TO authenticated, service_role;
