-- Marketplace coverage + sold-hide (Feature B).
--   1) COVERAGE: also surface cars that are ACTIVE on SmartAuction (present in
--      sa_active_cars) but have NO matching inventory row. Previously the grid was
--      strictly FROM inventory, so active SA cars not yet in inventory silently
--      dropped off. These sa-only cars get a stable id md5('sa:'||vin) so their
--      "View Details" link resolves in the detail RPC (they have no stock_number).
--   2) SOLD-HIDE: drop any car whose vehicle_locations.sa_status = 'sold' from the
--      grid. (The InventoryResults upload sets sa_status='sold' for sold VINs.)
-- Signatures unchanged; only the query bodies change.

-- ============================ LIST ============================
DROP FUNCTION IF EXISTS marketplace_listings();
CREATE OR REPLACE FUNCTION marketplace_listings()
RETURNS TABLE (
  id uuid, stock_number text, vin text, vin_last6 text, full_vin text,
  year text, make text, model text, vehicle_color text, mileage text,
  checklist jsonb, completed_at timestamptz, buy_now text, sa_url text
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
        COALESCE(i.checklist -> 'photos', '{}'::jsonb) || COALESCE((
          SELECT jsonb_object_agg('rts' || rn, jsonb_build_object('url', purl))
          FROM (SELECT row_number() OVER (ORDER BY w.received_at) AS rn,
                       'https://yprihgygmreibcuybwoy.supabase.co/storage/v1/object/public/wa-photos/' || w.media_path AS purl
                FROM wa_inbound_messages w
                WHERE upper(w.vin6) = upper(inv.last_6_vin) AND w.station = 'ready' AND w.media_path IS NOT NULL) z
        ), '{}'::jsonb)
      ) AS checklist,
      COALESCE(i.completed_at, (SELECT max(w.received_at) FROM wa_inbound_messages w
        WHERE upper(w.vin6) = upper(inv.last_6_vin) AND w.station = 'ready')) AS completed_at,
      sac.buy_now::text AS buy_now, sac.detail_url AS sa_url
    FROM inventory inv
    LEFT JOIN inspections i ON (
      (i.vin_last6 = inv.last_6_vin OR i.vin = inv.last_6_vin OR i.vin = inv.vehicle_vin
       OR (i.stock_number IS NOT NULL AND i.stock_number = inv.stock_number)) AND i.completed_at IS NOT NULL)
    LEFT JOIN vehicle_locations vl ON vl.stock_number = inv.stock_number
    LEFT JOIN sa_active_cars sac ON upper(sac.vin) = upper(inv.vehicle_vin)
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
    SELECT
      md5('sa:' || upper(sac.vin))::uuid AS id, NULL::text AS stock_number,
      right(sac.vin, 6) AS vin, right(sac.vin, 6) AS vin_last6, sac.vin AS full_vin,
      sac.year::text AS year, sac.make AS make, sac.model AS model,
      sac.color AS vehicle_color, sac.odometer::text AS mileage,
      '{}'::jsonb AS checklist, NULL::timestamptz AS completed_at,
      sac.buy_now::text AS buy_now, sac.detail_url AS sa_url
    FROM sa_active_cars sac
    WHERE NOT EXISTS (SELECT 1 FROM inventory inv WHERE upper(inv.vehicle_vin) = upper(sac.vin))
  )
  SELECT * FROM inv_listings
  UNION ALL
  SELECT * FROM sa_only
  ORDER BY completed_at DESC NULLS LAST, stock_number NULLS LAST;
END;
$$;
GRANT EXECUTE ON FUNCTION marketplace_listings() TO anon, authenticated;

-- ============================ DETAIL ============================
DROP FUNCTION IF EXISTS marketplace_listing_detail(uuid);
CREATE OR REPLACE FUNCTION marketplace_listing_detail(listing_id uuid)
RETURNS TABLE (
  id uuid, vin text, vin_last6 text, full_vin text, year text, make text, model text,
  mileage integer, checklist jsonb, completed_at timestamptz, vehicle_color text,
  stock_number text, total_cost text, days_on_lot text, sa_status text, buy_now text, sa_url text
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  -- inventory-anchored car
  (SELECT DISTINCT ON (inv.stock_number)
    md5(inv.stock_number)::uuid, COALESCE(i.vin, inv.last_6_vin), inv.last_6_vin, inv.vehicle_vin,
    COALESCE(i.year::text, inv.vehicle_year), COALESCE(i.make, inv.vehicle_make), COALESCE(i.model, inv.vehicle_model),
    COALESCE(i.mileage, NULLIF(regexp_replace(inv.mileage::text, '[^0-9]', '', 'g'), '')::int),
    jsonb_set(
      COALESCE(i.checklist, '{}'::jsonb), '{photos}',
      COALESCE(i.checklist -> 'photos', '{}'::jsonb) || COALESCE((
        SELECT jsonb_object_agg('rts' || rn, jsonb_build_object('url', purl))
        FROM (SELECT row_number() OVER (ORDER BY w.received_at) AS rn,
                     'https://yprihgygmreibcuybwoy.supabase.co/storage/v1/object/public/wa-photos/' || w.media_path AS purl
              FROM wa_inbound_messages w
              WHERE upper(w.vin6) = upper(inv.last_6_vin) AND w.station = 'ready' AND w.media_path IS NOT NULL) z
      ), '{}'::jsonb)
    ),
    COALESCE(i.completed_at, (SELECT max(w.received_at) FROM wa_inbound_messages w
      WHERE upper(w.vin6) = upper(inv.last_6_vin) AND w.station = 'ready')),
    inv.vehicle_color, inv.stock_number, inv.total_cost, inv.days_on_lot, vl.sa_status,
    sac.buy_now::text, sac.detail_url
  FROM inventory inv
  LEFT JOIN inspections i ON (
    (i.vin_last6 = inv.last_6_vin OR i.vin = inv.last_6_vin OR i.vin = inv.vehicle_vin
     OR (i.stock_number IS NOT NULL AND i.stock_number = inv.stock_number)) AND i.completed_at IS NOT NULL)
  LEFT JOIN vehicle_locations vl ON vl.stock_number = inv.stock_number
  LEFT JOIN sa_active_cars sac ON upper(sac.vin) = upper(inv.vehicle_vin)
  WHERE md5(inv.stock_number)::uuid = listing_id
  ORDER BY inv.stock_number, i.completed_at DESC NULLS LAST)

  UNION ALL

  -- sa-only car (active on SmartAuction, not in inventory)
  (SELECT
    md5('sa:' || upper(sac.vin))::uuid, right(sac.vin, 6), right(sac.vin, 6), sac.vin,
    sac.year::text, sac.make, sac.model, sac.odometer::int,
    '{}'::jsonb, NULL::timestamptz, sac.color,
    NULL::text, NULL::text, NULL::text, NULL::text, sac.buy_now::text, sac.detail_url
  FROM sa_active_cars sac
  WHERE md5('sa:' || upper(sac.vin))::uuid = listing_id
    AND NOT EXISTS (SELECT 1 FROM inventory inv WHERE upper(inv.vehicle_vin) = upper(sac.vin)));
$$;
GRANT EXECUTE ON FUNCTION marketplace_listing_detail(uuid) TO anon, authenticated;

-- ============================ SOLD MARKERS ============================
-- The InventoryResults upload calls these with the VIN lists it classified.
-- Sold VINs get vehicle_locations.sa_status='sold' (→ dropped from the grid);
-- VINs that are active again get flipped back from 'sold' to 'active' only
-- (never clobbers a non-sold status set by other pipelines). Both match by VIN
-- to an inventory row, so cars with no inventory row are simply skipped here
-- (they drop off the grid anyway by being absent from sa_active_cars).

CREATE OR REPLACE FUNCTION marketplace_mark_sold(p_vins text[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n integer;
BEGIN
  INSERT INTO vehicle_locations (stock_number, vin, sa_status, sa_updated_at, sold_on, sold_at)
  SELECT DISTINCT ON (inv.stock_number)
         inv.stock_number, inv.vehicle_vin, 'sold', now(), 'smart_auction', now()
  FROM inventory inv
  WHERE inv.stock_number IS NOT NULL
    AND upper(inv.vehicle_vin) IN (SELECT upper(v) FROM unnest(p_vins) v WHERE v IS NOT NULL AND v <> '')
  ORDER BY inv.stock_number
  ON CONFLICT (stock_number) DO UPDATE
    SET sa_status = 'sold', sa_updated_at = now(),
        sold_on = 'smart_auction',
        sold_at = COALESCE(vehicle_locations.sold_at, now());
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
GRANT EXECUTE ON FUNCTION marketplace_mark_sold(text[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION marketplace_unmark_sold(p_vins text[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n integer;
BEGIN
  UPDATE vehicle_locations vl
    SET sa_status = 'active', sa_updated_at = now(), sold_on = NULL, sold_at = NULL
  FROM inventory inv
  WHERE vl.stock_number = inv.stock_number
    AND vl.sa_status = 'sold'
    AND upper(inv.vehicle_vin) IN (SELECT upper(v) FROM unnest(p_vins) v WHERE v IS NOT NULL AND v <> '');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
GRANT EXECUTE ON FUNCTION marketplace_unmark_sold(text[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
