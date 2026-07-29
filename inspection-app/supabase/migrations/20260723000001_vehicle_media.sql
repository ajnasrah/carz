-- vehicle_media(p_vin, p_last6, p_stock): the two visual bits the global VIN
-- search popup wants — the first "main" photo and the live marketplace listing
-- link — for ANY car (active or sold), matched however the caller found it.
--
-- SECURITY DEFINER on purpose: it reads sa_active_cars / inspections /
-- wa_inbound_messages, mirroring the marketplace_listing_detail logic, so the
-- anon client gets a reliable answer without depending on each table's RLS.
--
--   first_photo — priority: a completed inspection's corner shots, then any
--                 checklist photo, then the earliest ready-to-sell intake photo.
--   sa_url      — sa_active_cars.detail_url (present only while listed on SA).

CREATE OR REPLACE FUNCTION vehicle_media(p_vin text, p_last6 text, p_stock text)
RETURNS TABLE (first_photo text, sa_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_checklist jsonb;
  v_photo text;
  v_sa text;
BEGIN
  -- Live marketplace (SmartAuction) listing link, matched by full VIN.
  IF p_vin IS NOT NULL AND length(p_vin) = 17 THEN
    SELECT sac.detail_url INTO v_sa
    FROM sa_active_cars sac
    WHERE upper(sac.vin) = upper(p_vin)
    LIMIT 1;
  END IF;

  -- Most recent completed inspection for this car (by last6 / full VIN / stock).
  SELECT i.checklist INTO v_checklist
  FROM inspections i
  WHERE i.completed_at IS NOT NULL
    AND (
      (p_last6 IS NOT NULL AND (i.vin_last6 = p_last6 OR i.vin = p_last6))
      OR (p_vin IS NOT NULL AND i.vin = p_vin)
      OR (p_stock IS NOT NULL AND i.stock_number = p_stock)
    )
  ORDER BY i.completed_at DESC
  LIMIT 1;

  -- Preferred: the four corner shots, in the same order the marketplace uses.
  v_photo := COALESCE(
    v_checklist -> 'photos' -> 'driver_front_corner' ->> 'url',
    v_checklist -> 'photos' -> 'pass_front_corner'   ->> 'url',
    v_checklist -> 'photos' -> 'driver_rear_corner'  ->> 'url',
    v_checklist -> 'photos' -> 'pass_rear_corner'    ->> 'url'
  );

  -- Fallback: any photo carried on the checklist.
  IF v_photo IS NULL AND (v_checklist -> 'photos') IS NOT NULL THEN
    SELECT e.val ->> 'url' INTO v_photo
    FROM jsonb_each(v_checklist -> 'photos') AS e(key, val)
    WHERE e.val ->> 'url' IS NOT NULL
    LIMIT 1;
  END IF;

  -- Fallback: earliest ready-to-sell intake photo (Telegram/WhatsApp), by last6.
  IF v_photo IS NULL AND p_last6 IS NOT NULL THEN
    SELECT 'https://yprihgygmreibcuybwoy.supabase.co/storage/v1/object/public/wa-photos/' || w.media_path
      INTO v_photo
    FROM wa_inbound_messages w
    WHERE upper(w.vin6) = upper(p_last6)
      AND w.station = 'ready'
      AND w.media_path IS NOT NULL
    ORDER BY w.received_at
    LIMIT 1;
  END IF;

  RETURN QUERY SELECT v_photo, v_sa;
END;
$$;
GRANT EXECUTE ON FUNCTION vehicle_media(text, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
