-- A car we've photographed but haven't stocked yet should still look like a car.
--
-- The crew posts a VIN and photos to the Telegram ready-to-sell group the day we
-- buy it — often days before Frazer has stocked it. Those photos are kept in
-- wa_inbound_messages keyed by the last 6, which is the join key the whole
-- pipeline speaks, so nothing is lost while we wait. The moment the car is listed
-- on SmartAuction it goes public through marketplace_listings()' second branch,
-- `sa_only`: active on SA, no inventory row, built from the SA snapshot.
--
-- But that branch hard-coded `checklist = '{}'`. So the car reached the
-- marketplace with a year, a make, a model, a price — and not one photograph,
-- while its photos sat in storage under the same last 6 the listing was keyed by.
-- A buyer got a text-only card. It only started showing pictures days later when
-- Frazer stocked the car and the inventory branch took over.
--
-- Both branches now assemble photos the same way, so a listing looks the same
-- before and after the car is stocked. Nothing about WHICH cars are public
-- changes: an sa_only car was already published the day it hit SmartAuction.
--
-- What this does NOT do is publish a car that is only in Telegram — photographed,
-- not stocked, not listed on SA. There is nothing to build a listing from: no
-- year, no make, no model, no price. That car stays where it already is, in the
-- extension's ready-to-sell queue with in_inventory = false, waiting.

-- The Telegram ready-to-sell photos for one car, shaped like a checklist's photo
-- map ({"rts1": {"url": …}}). Four copies of this subquery existed inline across
-- the two marketplace functions; now there is one, and the sa_only branches can
-- have it too.
--
-- Deliberately RAW: the hidden/ordering overlay (listing_photo_edits) is applied
-- by the reader — applyPhotoEdits on the client, ready_to_sell_photos for the
-- extension — and applying it here as well would sort a car's photos twice by
-- two different rules.
CREATE OR REPLACE FUNCTION rts_photo_map(p_vin6 text)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT jsonb_object_agg('rts' || rn, jsonb_build_object('url', purl))
    FROM (
      SELECT row_number() OVER (ORDER BY w.received_at) AS rn,
             'https://yprihgygmreibcuybwoy.supabase.co/storage/v1/object/public/wa-photos/'
               || w.media_path AS purl
      FROM wa_inbound_messages w
      WHERE upper(w.vin6) = upper(p_vin6)
        AND w.station = 'ready'
        AND w.media_path IS NOT NULL
    ) z
  ), '{}'::jsonb);
$$;
GRANT EXECUTE ON FUNCTION rts_photo_map(text) TO anon, authenticated;

-- When the crew last posted about this car — the stand-in for completed_at on a
-- car with no inspection, so a freshly photographed one sorts with the rest of
-- the marketplace instead of falling to the bottom under NULLS LAST.
CREATE OR REPLACE FUNCTION rts_last_seen(p_vin6 text)
RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT max(w.received_at) FROM wa_inbound_messages w
  WHERE upper(w.vin6) = upper(p_vin6) AND w.station = 'ready';
$$;
GRANT EXECUTE ON FUNCTION rts_last_seen(text) TO anon, authenticated;

-- ============================ LIST ============================
CREATE OR REPLACE FUNCTION marketplace_listings()
RETURNS TABLE (
  id uuid, stock_number text, vin text, vin_last6 text, full_vin text,
  year text, make text, model text, vehicle_color text, mileage text,
  checklist jsonb, completed_at timestamptz, buy_now text, sa_url text,
  price_source text
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH inv_listings AS (
    SELECT DISTINCT ON (inv.stock_number)
      md5(inv.stock_number)::uuid AS id, inv.stock_number,
      COALESCE(i.vin, inv.last_6_vin) AS vin, inv.last_6_vin AS vin_last6,
      inv.vehicle_vin AS full_vin, inv.vehicle_year AS year, inv.vehicle_make AS make,
      inv.vehicle_model AS model, inv.vehicle_color, inv.mileage::text AS mileage,
      jsonb_set(
        COALESCE(i.checklist, '{}'::jsonb), '{photos}',
        COALESCE(i.checklist -> 'photos', '{}'::jsonb) || rts_photo_map(inv.last_6_vin)
      ) AS checklist,
      COALESCE(i.completed_at, rts_last_seen(inv.last_6_vin)) AS completed_at,
      COALESCE(mp.price, GREATEST(sac.buy_now, sac.opening_price))::text AS buy_now,
      sac.detail_url AS sa_url,
      CASE
        WHEN mp.price IS NOT NULL THEN 'manual'
        WHEN GREATEST(sac.buy_now, sac.opening_price) IS NOT NULL THEN 'smartauction'
      END AS price_source
    FROM inventory inv
    LEFT JOIN inspections i ON (
      (i.vin_last6 = inv.last_6_vin OR i.vin = inv.last_6_vin OR i.vin = inv.vehicle_vin
       OR (i.stock_number IS NOT NULL AND i.stock_number = inv.stock_number)) AND i.completed_at IS NOT NULL)
    LEFT JOIN vehicle_locations vl ON vl.stock_number = inv.stock_number
    LEFT JOIN sa_active_cars sac ON upper(sac.vin) = upper(inv.vehicle_vin)
    LEFT JOIN marketplace_prices mp ON mp.vin = upper(inv.vehicle_vin)
    WHERE inv.stock_number IS NOT NULL
      AND (vl.sa_status IS DISTINCT FROM 'sold')                 -- (2) hide sold
      AND (
        i.completed_at IS NOT NULL
        OR sac.vin IS NOT NULL                                   -- active on SmartAuction
        OR EXISTS (SELECT 1 FROM wa_inbound_messages w
          WHERE upper(w.vin6) = upper(inv.last_6_vin) AND w.station = 'ready' AND w.media_path IS NOT NULL)
      )
    ORDER BY inv.stock_number, i.completed_at DESC NULLS LAST
  ),
  sa_only AS (                                                    -- (1) active on SA, not in inventory
    -- Same photo assembly as above, keyed off the SA VIN's last 6 instead of the
    -- inventory row's: the crew's Telegram shots, plus anything an inspection
    -- holds — the 'sa_' set the extension scrapes off the condition report lands
    -- in an inspection row keyed by last 6 whether or not the car is stocked.
    SELECT DISTINCT ON (sac.vin)
      md5('sa:' || upper(sac.vin))::uuid AS id, NULL::text AS stock_number,
      right(sac.vin, 6) AS vin, right(sac.vin, 6) AS vin_last6, sac.vin AS full_vin,
      sac.year::text AS year, sac.make AS make, sac.model AS model,
      sac.color AS vehicle_color, sac.odometer::text AS mileage,
      jsonb_set(
        COALESCE(i.checklist, '{}'::jsonb), '{photos}',
        COALESCE(i.checklist -> 'photos', '{}'::jsonb) || rts_photo_map(right(sac.vin, 6))
      ) AS checklist,
      COALESCE(i.completed_at, rts_last_seen(right(sac.vin, 6))) AS completed_at,
      COALESCE(mp.price, GREATEST(sac.buy_now, sac.opening_price))::text AS buy_now,
      sac.detail_url AS sa_url,
      CASE
        WHEN mp.price IS NOT NULL THEN 'manual'
        WHEN GREATEST(sac.buy_now, sac.opening_price) IS NOT NULL THEN 'smartauction'
      END AS price_source
    FROM sa_active_cars sac
    LEFT JOIN inspections i ON (
      (i.vin_last6 = right(sac.vin, 6) OR upper(i.vin) = upper(sac.vin) OR i.vin = right(sac.vin, 6))
      AND i.completed_at IS NOT NULL)
    LEFT JOIN marketplace_prices mp ON mp.vin = upper(sac.vin)
    WHERE NOT EXISTS (SELECT 1 FROM inventory inv WHERE upper(inv.vehicle_vin) = upper(sac.vin))
    ORDER BY sac.vin, i.completed_at DESC NULLS LAST
  )
  SELECT * FROM inv_listings
  UNION ALL
  SELECT * FROM sa_only
  ORDER BY completed_at DESC NULLS LAST, stock_number NULLS LAST;
END;
$$;
GRANT EXECUTE ON FUNCTION marketplace_listings() TO anon, authenticated;

-- ============================ DETAIL ============================
-- The card and the page have to agree: a card showing photographs that opens on
-- an empty gallery is worse than showing none.
CREATE OR REPLACE FUNCTION marketplace_listing_detail(listing_id uuid)
RETURNS TABLE (
  id uuid, vin text, vin_last6 text, full_vin text, year text, make text, model text,
  mileage integer, checklist jsonb, completed_at timestamptz, vehicle_color text,
  stock_number text, total_cost text, days_on_lot text, sa_status text, buy_now text, sa_url text,
  price_source text
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  -- inventory-anchored car
  (SELECT DISTINCT ON (inv.stock_number)
    md5(inv.stock_number)::uuid, COALESCE(i.vin, inv.last_6_vin), inv.last_6_vin, inv.vehicle_vin,
    COALESCE(i.year::text, inv.vehicle_year), COALESCE(i.make, inv.vehicle_make), COALESCE(i.model, inv.vehicle_model),
    COALESCE(i.mileage, NULLIF(regexp_replace(inv.mileage::text, '[^0-9]', '', 'g'), '')::int),
    jsonb_set(
      COALESCE(i.checklist, '{}'::jsonb), '{photos}',
      COALESCE(i.checklist -> 'photos', '{}'::jsonb) || rts_photo_map(inv.last_6_vin)
    ),
    COALESCE(i.completed_at, rts_last_seen(inv.last_6_vin)),
    inv.vehicle_color, inv.stock_number, inv.total_cost, inv.days_on_lot, vl.sa_status,
    COALESCE(mp.price, GREATEST(sac.buy_now, sac.opening_price))::text, sac.detail_url,
    CASE
      WHEN mp.price IS NOT NULL THEN 'manual'
      WHEN GREATEST(sac.buy_now, sac.opening_price) IS NOT NULL THEN 'smartauction'
    END
  FROM inventory inv
  LEFT JOIN inspections i ON (
    (i.vin_last6 = inv.last_6_vin OR i.vin = inv.last_6_vin OR i.vin = inv.vehicle_vin
     OR (i.stock_number IS NOT NULL AND i.stock_number = inv.stock_number)) AND i.completed_at IS NOT NULL)
  LEFT JOIN vehicle_locations vl ON vl.stock_number = inv.stock_number
  LEFT JOIN sa_active_cars sac ON upper(sac.vin) = upper(inv.vehicle_vin)
  LEFT JOIN marketplace_prices mp ON mp.vin = upper(inv.vehicle_vin)
  WHERE md5(inv.stock_number)::uuid = listing_id
  ORDER BY inv.stock_number, i.completed_at DESC NULLS LAST)

  UNION ALL

  -- sa-only car (active on SmartAuction, not in inventory)
  (SELECT DISTINCT ON (sac.vin)
    md5('sa:' || upper(sac.vin))::uuid, right(sac.vin, 6), right(sac.vin, 6), sac.vin,
    sac.year::text, sac.make, sac.model,
    COALESCE(i.mileage, sac.odometer::int),
    jsonb_set(
      COALESCE(i.checklist, '{}'::jsonb), '{photos}',
      COALESCE(i.checklist -> 'photos', '{}'::jsonb) || rts_photo_map(right(sac.vin, 6))
    ),
    COALESCE(i.completed_at, rts_last_seen(right(sac.vin, 6))), sac.color,
    NULL::text, NULL::text, NULL::text, NULL::text,
    COALESCE(mp.price, GREATEST(sac.buy_now, sac.opening_price))::text, sac.detail_url,
    CASE
      WHEN mp.price IS NOT NULL THEN 'manual'
      WHEN GREATEST(sac.buy_now, sac.opening_price) IS NOT NULL THEN 'smartauction'
    END
  FROM sa_active_cars sac
  LEFT JOIN inspections i ON (
    (i.vin_last6 = right(sac.vin, 6) OR upper(i.vin) = upper(sac.vin) OR i.vin = right(sac.vin, 6))
    AND i.completed_at IS NOT NULL)
  LEFT JOIN marketplace_prices mp ON mp.vin = upper(sac.vin)
  WHERE md5('sa:' || upper(sac.vin))::uuid = listing_id
    AND NOT EXISTS (SELECT 1 FROM inventory inv WHERE upper(inv.vehicle_vin) = upper(sac.vin))
  ORDER BY sac.vin, i.completed_at DESC NULLS LAST);
$$;
GRANT EXECUTE ON FUNCTION marketplace_listing_detail(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
