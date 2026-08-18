-- Let a buyer reserve straight off a shared list.
--
-- buyer_share_list returned everything the page needed to SHOW a car and nothing
-- it needed to ACT on one: /api/reserve-car keys on a stock number, and this
-- function only ever spoke in VINs. So the buyer we sent the link to got the
-- worse path — a text to the office — while a buyer who happened to browse the
-- marketplace got a real Reserve button.
--
-- stock_number is NULL when the car isn't in Frazer inventory any more, and the
-- page hides the button in that case rather than offering something that would
-- 404 on the way through.
-- Adding OUT params changes the row type, which CREATE OR REPLACE refuses.
DROP FUNCTION IF EXISTS buyer_share_list(text);
CREATE OR REPLACE FUNCTION buyer_share_list(p_slug text)
RETURNS TABLE (
  buyer_name text, note text, created_at timestamptz,
  vin text, year int, make text, model text, "trim" text,
  odometer int, color text, buy_now numeric, detail_url text,
  listing_id uuid, stock_number text, reserved boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH l AS (
    SELECT * FROM buyer_share_lists WHERE slug = p_slug
  ),
  ml AS (
    SELECT m.id, upper(m.full_vin) AS full_vin,
           nullif(regexp_replace(COALESCE(m.buy_now, ''), '[^0-9.]', '', 'g'), '')::numeric AS price
    FROM marketplace_listings() m
  )
  SELECT l.buyer_name, l.note, l.created_at,
         a.vin, a.year, a.make, a.model, a.trim,
         a.odometer, a.color,
         COALESCE(ml.price, a.buy_now, a.opening_price),
         a.detail_url,
         ml.id,
         inv.stock_number,
         EXISTS (
           SELECT 1 FROM car_reservations r
           WHERE r.stock_number = inv.stock_number
             AND r.status IN ('reserved', 'confirmed')
         )
  FROM l
  JOIN unnest(l.vins) WITH ORDINALITY AS u(vin, ord) ON true
  JOIN sa_active_cars a ON a.vin = u.vin
  LEFT JOIN ml ON ml.full_vin = a.vin
  LEFT JOIN inventory inv ON upper(inv.vehicle_vin) = upper(a.vin)
  WHERE NOT EXISTS (SELECT 1 FROM sa_sold_sales s WHERE upper(s.vin) = upper(a.vin))
  ORDER BY COALESCE(ml.price, a.buy_now, a.opening_price) DESC NULLS LAST, u.ord;
$$;
GRANT EXECUTE ON FUNCTION buyer_share_list(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
