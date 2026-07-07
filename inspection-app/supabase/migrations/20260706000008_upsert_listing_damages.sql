-- Feature A: save damages entered in the SmartAuction auto-fill extension into
-- the car's inspection.checklist so they render on the public marketplace.
--
-- The extension sends damages already shaped for the marketplace, bucketed under
-- keys prefixed 'sa_' (e.g. sa_ext_0, sa_int_1). Each sync REPLACES the previous
-- 'sa_' buckets (so editing/removing in the extension stays in sync) while leaving
-- any damages entered in the PWA inspection untouched.
--
-- Matching is by last-6 VIN. If no inspection exists yet, one is created (linked
-- to inventory for stock_number when possible) and marked complete so the car
-- surfaces on the marketplace. Runs as definer so the extension's anon key can write.

CREATE OR REPLACE FUNCTION upsert_listing_damages(p_vin text, p_exterior jsonb, p_interior jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_clean text := upper(regexp_replace(COALESCE(p_vin, ''), '[^A-Za-z0-9]', '', 'g'));
  v_last6 text;
  v_id uuid;
  v_checklist jsonb;
  v_ext jsonb;
  v_int jsonb;
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
  IF v_id IS NULL
     AND COALESCE(p_exterior, '{}'::jsonb) = '{}'::jsonb
     AND COALESCE(p_interior, '{}'::jsonb) = '{}'::jsonb THEN
    RETURN 'skipped';
  END IF;

  -- Keep PWA-entered damages (any key NOT starting 'sa_'), swap in the fresh 'sa_' set.
  v_ext := COALESCE((SELECT jsonb_object_agg(k, val)
                     FROM jsonb_each(COALESCE(v_checklist -> 'exterior', '{}'::jsonb)) AS e(k, val)
                     WHERE k NOT LIKE 'sa\_%'), '{}'::jsonb) || COALESCE(p_exterior, '{}'::jsonb);
  v_int := COALESCE((SELECT jsonb_object_agg(k, val)
                     FROM jsonb_each(COALESCE(v_checklist -> 'interior', '{}'::jsonb)) AS e(k, val)
                     WHERE k NOT LIKE 'sa\_%'), '{}'::jsonb) || COALESCE(p_interior, '{}'::jsonb);

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
      jsonb_build_object('v', 2, 'exterior', v_ext, 'interior', v_int,
                         'photos', COALESCE(v_checklist -> 'photos', '{}'::jsonb)),
      now());
    RETURN 'created';
  ELSE
    UPDATE inspections
      SET checklist = jsonb_set(jsonb_set(COALESCE(checklist, '{}'::jsonb), '{exterior}', v_ext), '{interior}', v_int),
          completed_at = COALESCE(completed_at, now()),
          updated_at = now()
    WHERE id = v_id;
    RETURN 'updated';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION upsert_listing_damages(text, jsonb, jsonb) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
