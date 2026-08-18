-- A shared list must never show a car that has sold.
--
-- buyer_share_list resolved VINs against sa_active_cars on the theory that a
-- sold car leaves the active list. It doesn't: sa_active_cars is a snapshot of
-- the last SmartAuction upload, so a car sold since then is still sitting in it
-- — 3 of 39 four days after the last upload. A buyer opening yesterday's link
-- was being shown cars we no longer own. sa_sold_sales is the newer fact.
CREATE OR REPLACE FUNCTION buyer_share_list(p_slug text)
RETURNS TABLE (
  buyer_name text, note text, created_at timestamptz,
  vin text, year int, make text, model text, "trim" text,
  odometer int, color text, buy_now numeric, detail_url text,
  listing_id uuid
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
         ml.id
  FROM l
  JOIN unnest(l.vins) WITH ORDINALITY AS u(vin, ord) ON true
  JOIN sa_active_cars a ON a.vin = u.vin
  LEFT JOIN ml ON ml.full_vin = a.vin
  WHERE NOT EXISTS (SELECT 1 FROM sa_sold_sales s WHERE upper(s.vin) = upper(a.vin))
  ORDER BY COALESCE(ml.price, a.buy_now, a.opening_price) DESC NULLS LAST, u.ord;
$$;
GRANT EXECUTE ON FUNCTION buyer_share_list(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
