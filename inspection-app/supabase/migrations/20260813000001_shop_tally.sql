-- How many cars are sitting at the body shop and at the mechanics, and whether
-- that number is growing.
--
-- A count on its own can't answer "are we buying too many or pushing out too
-- few" — for that you need yesterday's count too, and nothing was writing one
-- down. So: a function that computes today's numbers and stamps them into a
-- daily table on the way past, and hands back today alongside the same figures
-- from a week ago.
--
-- The location lists live HERE, in one place, rather than in the page: the
-- dashboard, any report, and any future alert all have to agree on what counts
-- as "at the mechanic", and a second copy would drift the first time a shop is
-- added.

CREATE TABLE IF NOT EXISTS shop_tally_daily (
  day        date NOT NULL,
  shop       text NOT NULL,          -- 'body_shop' | 'mechanic'
  cars       integer NOT NULL,
  avg_days   numeric,                -- days on lot
  avg_here   numeric,                -- days sitting at that shop
  avg_added  numeric,                -- recon spend per car that has any
  taken_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, shop)
);

ALTER TABLE shop_tally_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_tally_read ON shop_tally_daily;
CREATE POLICY shop_tally_read ON shop_tally_daily FOR SELECT USING (true);
REVOKE ALL ON shop_tally_daily FROM PUBLIC;
GRANT SELECT ON shop_tally_daily TO anon, authenticated;

-- Jorge's shop IS the body shop — one physical place that arrives under two
-- slugs depending on who typed it, which is why the board and /inventory already
-- collapse them. Everything mechanical is one bucket too: what the owner wants
-- is "how many cars are tied up in service", not a shop-by-shop split. The
-- breakdown per location comes back separately for the card to show.
CREATE OR REPLACE FUNCTION shop_locations(p_shop text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_shop
    WHEN 'body_shop' THEN ARRAY['jorge', 'body_shop']
    WHEN 'mechanic' THEN ARRAY[
      'mechanic', 'mechanic_section', 'inside_mechanic_shop', 'pro_auto',
      'santa_maria', 'muffler_cs', 'summit_tire', 'tri_state', 'tri_state_glass',
      'city_auto', 'jim_keras_nissan', 'jim_keras_chevy_service', 'waiting_on_parts'
    ]
    ELSE ARRAY[]::text[]
  END;
$$;
GRANT EXECUTE ON FUNCTION shop_locations(text) TO anon, authenticated;

-- Today's numbers for one shop, straight off inventory + vehicle_locations.
-- added_costs is averaged over the cars that actually had recon (>0), the same
-- rule the Inventory page's Avg Add tile uses, so the figures agree app-wide.
CREATE OR REPLACE FUNCTION shop_tally_now(p_shop text)
RETURNS TABLE (cars integer, avg_days numeric, avg_here numeric, avg_added numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH here AS (
    SELECT inv.stock_number,
           NULLIF(regexp_replace(COALESCE(inv.days_on_lot::text, ''), '[^0-9]', '', 'g'), '')::numeric AS dol,
           NULLIF(regexp_replace(COALESCE(inv.added_costs::text, ''), '[^0-9.]', '', 'g'), '')::numeric AS added,
           EXTRACT(epoch FROM (now() - vl.location_updated_at)) / 86400 AS days_here
    FROM inventory inv
    JOIN vehicle_locations vl ON vl.stock_number = inv.stock_number
    WHERE vl.physical_location = ANY (shop_locations(p_shop))
  )
  SELECT count(*)::integer,
         round(avg(dol)),
         round(avg(days_here)),
         round(avg(added) FILTER (WHERE added > 0))
  FROM here;
$$;
GRANT EXECUTE ON FUNCTION shop_tally_now(text) TO anon, authenticated;

-- What the dashboard calls. Stamps today's row (idempotent — opening the app
-- twice doesn't double-count) and returns today beside the same week-ago row, so
-- the card can say which way the pile is moving. Written on read because there's
-- no scheduler in this stack; the day the counts matter is a day someone opened
-- the app.
CREATE OR REPLACE FUNCTION shop_tally()
RETURNS TABLE (
  shop text, cars integer, avg_days numeric, avg_here numeric, avg_added numeric,
  cars_prev integer, avg_here_prev numeric, prev_day date
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['body_shop', 'mechanic'] LOOP
    INSERT INTO shop_tally_daily AS d (day, shop, cars, avg_days, avg_here, avg_added)
    SELECT current_date, s, t.cars, t.avg_days, t.avg_here, t.avg_added
    FROM shop_tally_now(s) t
    ON CONFLICT (day, shop) DO UPDATE
      SET cars = EXCLUDED.cars, avg_days = EXCLUDED.avg_days,
          avg_here = EXCLUDED.avg_here, avg_added = EXCLUDED.avg_added,
          taken_at = now();
  END LOOP;

  RETURN QUERY
  SELECT d.shop, d.cars, d.avg_days, d.avg_here, d.avg_added,
         p.cars, p.avg_here, p.day
  FROM shop_tally_daily d
  -- The nearest snapshot at least a week old. "Exactly 7 days ago" would come
  -- back empty on any week nobody opened the app that day.
  LEFT JOIN LATERAL (
    SELECT x.cars, x.avg_here, x.day
    FROM shop_tally_daily x
    WHERE x.shop = d.shop AND x.day <= current_date - 7
    ORDER BY x.day DESC LIMIT 1
  ) p ON true
  WHERE d.day = current_date;
END;
$$;
GRANT EXECUTE ON FUNCTION shop_tally() TO authenticated;

-- The per-location split behind each number, so the card can show its working.
CREATE OR REPLACE FUNCTION shop_tally_breakdown(p_shop text)
RETURNS TABLE (physical_location text, cars integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vl.physical_location, count(*)::integer
  FROM inventory inv
  JOIN vehicle_locations vl ON vl.stock_number = inv.stock_number
  WHERE vl.physical_location = ANY (shop_locations(p_shop))
  GROUP BY vl.physical_location
  ORDER BY count(*) DESC;
$$;
GRANT EXECUTE ON FUNCTION shop_tally_breakdown(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
