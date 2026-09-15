-- Text best buyer: how many cars each buyer has already been texted today.
--
-- Rusty Eck Ford is the best textable buyer for 56 of 100 cars, and he is — he
-- buys the most. A hard cap on #1 slots was measured and rejected: at 12 it
-- halved how often the one-tap buyer was the one who actually bought (14.2% ->
-- 6.4%). The real problem is texting one dealer thirty times in an afternoon, so
-- the limit is on what has been SENT: past 5 cars today (the outreach queue's
-- own limit), the button moves to the next buyer. Counts both ways a buyer gets
-- a car: a Text tap here (buyer_pitches) and the automatic queue
-- (outreach_offers), by phone, Memphis day.
--
-- Adding an OUT column to a RETURNS TABLE function needs DROP first.
DROP FUNCTION IF EXISTS public.marketplace_buyer_picks();
CREATE FUNCTION public.marketplace_buyer_picks()
RETURNS TABLE (
  vin text, rank integer, stock_number text, buyer_key text, buyer_name text,
  buyer_phone text, buyer_email text, buyer_city text, buyer_state text,
  predicted_price integer, confidence text, reason text, total_buys integer,
  days_since integer, computed_at timestamptz,
  last_pitched_at timestamptz, last_pitched_by text, pitch_count integer,
  texted_today integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH day_start AS (
    SELECT date_trunc('day', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago' AS t
  ), today AS (
    SELECT phone, count(DISTINCT vin)::int AS n FROM (
      SELECT buyer_phone AS phone, vin FROM buyer_pitches, day_start WHERE pitched_at >= day_start.t
      UNION ALL
      SELECT phone, vin FROM outreach_offers, day_start WHERE created_at >= day_start.t AND status <> 'failed'
    ) x GROUP BY phone
  )
  SELECT p.vin, p.rank, p.stock_number, p.buyer_key, p.buyer_name, p.buyer_phone,
         p.buyer_email, p.buyer_city, p.buyer_state, p.predicted_price, p.confidence,
         p.reason, p.total_buys, p.days_since, p.computed_at,
         lp.pitched_at, lp.who, COALESCE(lp.n, 0)::int,
         COALESCE(td.n, 0)
  FROM marketplace_buyer_picks p
  LEFT JOIN today td ON td.phone = p.buyer_phone
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
    AND NOT EXISTS (SELECT 1 FROM outreach_opt_outs x WHERE x.phone = p.buyer_phone)
  ORDER BY p.vin, p.rank;
$$;
REVOKE ALL ON FUNCTION public.marketplace_buyer_picks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketplace_buyer_picks() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
