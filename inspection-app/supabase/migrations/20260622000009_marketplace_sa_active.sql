-- Marketplace now also includes cars that are ACTIVE on SmartAuction (present in
-- sa_active_cars from the active-list upload), in addition to ready-to-sell and
-- completed-inspection cars. SA-active cars show with their Buy-Now price + link.
-- Gate change only (sa_active_cars is already joined as sac).

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
          FROM (SELECT row_number() OVER (ORDER BY rt) AS rn, purl
                FROM (SELECT w.media_path,
                             'https://yprihgygmreibcuybwoy.supabase.co/storage/v1/object/public/wa-photos/' || w.media_path AS purl,
                             min(w.received_at) AS rt
                      FROM wa_inbound_messages w
                      WHERE upper(w.vin6) = upper(inv.last_6_vin) AND w.station = 'ready' AND w.media_path IS NOT NULL
                      GROUP BY w.media_path) d) z
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
      AND (
        i.completed_at IS NOT NULL
        OR sac.vin IS NOT NULL                                   -- active on SmartAuction
        OR EXISTS (SELECT 1 FROM wa_inbound_messages w
          WHERE upper(w.vin6) = upper(inv.last_6_vin) AND w.station = 'ready' AND w.media_path IS NOT NULL)
      )
    ORDER BY inv.stock_number, i.completed_at DESC NULLS LAST
  ) t
  ORDER BY t.completed_at DESC NULLS LAST, t.stock_number;
END;
$$;
GRANT EXECUTE ON FUNCTION marketplace_listings() TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
