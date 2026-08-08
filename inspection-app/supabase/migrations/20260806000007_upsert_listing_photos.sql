-- Photos from a scraped condition report, onto the public marketplace.
--
-- 20260706000008 did this for damages typed in the SmartAuction extension; the
-- photos half was never built, so a car could show on the marketplace with a
-- full damage list and not one picture. The marketplace card and listing page
-- already render anything under checklist.photos (that is how the Telegram
-- ready-to-sell shots get there), so nothing on the frontend changes.
--
-- Same shape as the damages RPC on purpose: match on the LAST 6 of the VIN,
-- replace the 'sa_'-prefixed set on every sync so removing a photo upstream
-- removes it here, and never touch photos taken in the PWA inspection. If the
-- car has no inspection row yet one is created and marked complete, which is
-- what makes it eligible for marketplace_listings() at all.
--
-- Grants: server only. The extension talks to /api/listing-photos, which holds
-- the service key — the anon key ships inside the extension and must never be
-- able to rewrite a listing's photos.

CREATE OR REPLACE FUNCTION upsert_listing_photos(p_vin text, p_photos jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clean text := upper(regexp_replace(COALESCE(p_vin, ''), '[^A-Za-z0-9]', '', 'g'));
  v_last6 text;
  v_id uuid;
  v_checklist jsonb;
  v_photos jsonb;
  v_stock text;
  v_full text;
BEGIN
  IF length(v_clean) < 6 THEN RETURN 'bad_vin'; END IF;
  v_last6 := right(v_clean, 6);

  SELECT id, COALESCE(checklist, '{}'::jsonb) INTO v_id, v_checklist
  FROM inspections
  WHERE vin_last6 = v_last6 OR upper(right(vin, 6)) = v_last6
  ORDER BY completed_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;

  -- Nothing to save and no existing row → don't create an empty inspection.
  IF v_id IS NULL AND COALESCE(p_photos, '{}'::jsonb) = '{}'::jsonb THEN
    RETURN 'skipped';
  END IF;

  -- Keep PWA-shot slots (any key NOT starting 'sa_'), swap in the fresh set.
  v_photos := COALESCE((SELECT jsonb_object_agg(k, val)
                        FROM jsonb_each(COALESCE(v_checklist -> 'photos', '{}'::jsonb)) AS e(k, val)
                        WHERE k NOT LIKE 'sa\_%'), '{}'::jsonb)
              || COALESCE(p_photos, '{}'::jsonb);

  IF v_id IS NULL THEN
    SELECT stock_number, vehicle_vin INTO v_stock, v_full
    FROM inventory
    WHERE upper(right(vehicle_vin, 6)) = v_last6 OR last_6_vin = v_last6
    LIMIT 1;

    INSERT INTO inspections (type, status, vin, vin_last6, stock_number, checklist, completed_at)
    VALUES ('inbound', 'complete',
      COALESCE(v_full, CASE WHEN length(v_clean) >= 11 THEN v_clean ELSE v_last6 END),
      v_last6,
      COALESCE(v_stock, v_last6),
      jsonb_build_object('v', 2,
        'exterior', COALESCE(v_checklist -> 'exterior', '{}'::jsonb),
        'interior', COALESCE(v_checklist -> 'interior', '{}'::jsonb),
        'photos', v_photos),
      now());
    RETURN 'created';
  ELSE
    UPDATE inspections
      SET checklist = jsonb_set(COALESCE(checklist, '{}'::jsonb), '{photos}', v_photos),
          completed_at = COALESCE(completed_at, now()),
          updated_at = now()
    WHERE id = v_id;
    RETURN 'updated';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION upsert_listing_photos(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION upsert_listing_photos(text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
