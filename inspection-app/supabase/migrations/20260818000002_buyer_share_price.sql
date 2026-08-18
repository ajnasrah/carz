-- Show the buyer a price.
--
-- buyer_share_list read sa_active_cars.buy_now, which SmartAuction's export
-- never fills — it puts the ask in Opening Price. So every car on a shared list
-- rendered with no price at all, which is the one thing a wholesale buyer looks
-- at first. Prefer the marketplace's own price when the car has a listing (an
-- admin may have priced it by hand there), then the SmartAuction ask.
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
  ORDER BY COALESCE(ml.price, a.buy_now, a.opening_price) DESC NULLS LAST, u.ord;
$$;
GRANT EXECUTE ON FUNCTION buyer_share_list(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
