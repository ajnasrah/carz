-- Add SmartAuction Buy-Now price + listing link to the marketplace, joined from
-- sa_active_cars (populated by the SmartAuction active-list upload) by full VIN.
-- Both functions gain buy_now + sa_url columns.

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
  SELECT * FROM (
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
    LEFT JOIN sa_active_cars sac ON upper(sac.vin) = upper(inv.vehicle_vin)
    WHERE inv.stock_number IS NOT NULL
      AND (i.completed_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM wa_inbound_messages w
          WHERE upper(w.vin6) = upper(inv.last_6_vin) AND w.station = 'ready' AND w.media_path IS NOT NULL))
    ORDER BY inv.stock_number, i.completed_at DESC NULLS LAST
  ) t
  ORDER BY t.completed_at DESC NULLS LAST, t.stock_number;
END;
$$;
GRANT EXECUTE ON FUNCTION marketplace_listings() TO anon, authenticated;

DROP FUNCTION IF EXISTS marketplace_listing_detail(uuid);
CREATE OR REPLACE FUNCTION marketplace_listing_detail(listing_id uuid)
RETURNS TABLE (
  id uuid, vin text, vin_last6 text, full_vin text, year text, make text, model text,
  mileage integer, checklist jsonb, completed_at timestamptz, vehicle_color text,
  stock_number text, total_cost text, days_on_lot text, sa_status text, buy_now text, sa_url text
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT DISTINCT ON (inv.stock_number)
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
  ORDER BY inv.stock_number, i.completed_at DESC NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION marketplace_listing_detail(uuid) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
