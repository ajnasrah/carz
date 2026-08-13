-- shop_tally() threw "column reference \"shop\" is ambiguous" on every call, so
-- the dashboard cards rendered zeros.
--
-- The RETURNS TABLE columns become plpgsql variables inside the body, and one of
-- them is named `shop` — which is also a column of shop_tally_daily. Everything
-- in the body was written qualified except the ON CONFLICT target, where a bare
-- `(day, shop)` is required by the syntax and plpgsql can't tell which `shop` is
-- meant. Naming the primary key instead removes the bare column references
-- entirely, so the OUT parameter has nothing to collide with.
--
-- Same trap as set_marketplace_price, where the fix was to return a scalar. Here
-- the shape of the result is worth keeping, so the upsert moves instead.

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
    ON CONFLICT ON CONSTRAINT shop_tally_daily_pkey DO UPDATE
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

NOTIFY pgrst, 'reload schema';
