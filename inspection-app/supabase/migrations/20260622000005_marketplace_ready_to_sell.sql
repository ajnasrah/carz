-- ============================================
-- MARKETPLACE = in inventory AND (completed inspection OR posted to ready-to-sell)
-- Ready-to-sell photos (Telegram) are injected into checklist.photos so the
-- existing Marketplace card + listing page render them with no frontend change.
-- ============================================

-- wa-photos must be public for the marketplace <img> URLs to load.
-- (car-history stays private — backend reference only.)
UPDATE storage.buckets SET public = true WHERE id = 'wa-photos';

DROP FUNCTION IF EXISTS marketplace_listings();
CREATE OR REPLACE FUNCTION marketplace_listings()
RETURNS TABLE (
  id uuid, stock_number text, vin text, vin_last6 text, full_vin text,
  year text, make text, model text, vehicle_color text, mileage text,
  checklist jsonb, completed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM (
    SELECT DISTINCT ON (inv.stock_number)
      COALESCE(i.id, gen_random_uuid())              AS id,
      inv.stock_number,
      COALESCE(i.vin, inv.last_6_vin)                AS vin,
      inv.last_6_vin                                 AS vin_last6,
      inv.vehicle_vin                                AS full_vin,
      inv.vehicle_year                               AS year,
      inv.vehicle_make                               AS make,
      inv.vehicle_model                              AS model,
      inv.vehicle_color,
      inv.mileage::text                              AS mileage,
      -- inspection checklist (if any) with ready-to-sell photos merged into .photos
      jsonb_set(
        COALESCE(i.checklist, '{}'::jsonb),
        '{photos}',
        COALESCE(i.checklist -> 'photos', '{}'::jsonb) || COALESCE((
          SELECT jsonb_object_agg('rts' || rn, jsonb_build_object('url', purl))
          FROM (
            SELECT row_number() OVER (ORDER BY w.received_at) AS rn,
                   'https://yprihgygmreibcuybwoy.supabase.co/storage/v1/object/public/wa-photos/' || w.media_path AS purl
            FROM wa_inbound_messages w
            WHERE upper(w.vin6) = upper(inv.last_6_vin)
              AND w.station = 'ready' AND w.media_path IS NOT NULL
          ) z
        ), '{}'::jsonb)
      )                                              AS checklist,
      COALESCE(i.completed_at, (
        SELECT max(w.received_at) FROM wa_inbound_messages w
        WHERE upper(w.vin6) = upper(inv.last_6_vin) AND w.station = 'ready'
      ))                                             AS completed_at
    FROM inventory inv
    LEFT JOIN inspections i ON (
      i.vin_last6 = inv.last_6_vin
      OR i.vin = inv.last_6_vin
      OR i.vin = inv.vehicle_vin
      OR (i.stock_number IS NOT NULL AND i.stock_number = inv.stock_number)
    )
    WHERE inv.stock_number IS NOT NULL
      AND (
        i.completed_at IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM wa_inbound_messages w
          WHERE upper(w.vin6) = upper(inv.last_6_vin)
            AND w.station = 'ready' AND w.media_path IS NOT NULL
        )
      )
    ORDER BY inv.stock_number, i.completed_at DESC NULLS LAST
  ) t
  ORDER BY t.completed_at DESC NULLS LAST, t.stock_number;
END;
$$;

GRANT EXECUTE ON FUNCTION marketplace_listings() TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
