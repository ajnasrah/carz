-- Add photos to a car from the app, without the next scrape deleting them.
--
-- Every existing route into a listing's gallery belongs to a machine: Telegram
-- posts them, the extension scrapes them off a condition report, the PWA shoots
-- them during an inspection. There has never been a way for a person looking at
-- the listing to drop a handful of pictures onto it, which is what you want when
-- the crew's photos are thin and the car is going out today.
--
-- The delicate part is that they have to SURVIVE. upsert_listing_photos replaces
-- every 'sa_'-prefixed key on each sync, deliberately — that is what makes
-- removing a photo upstream remove it here — and /api/listing-photos wipes the
-- whole storage prefix when a re-scrape starts. A photo added by hand into that
-- namespace would live until the next scrape and then quietly vanish.
--
-- So hand-added photos get their own namespace, 'man_', which upsert_listing_photos
-- already preserves (it only rebuilds keys matching 'sa\_%'), and their own
-- storage prefix, listing/<vin6>/manual/, which the re-scrape wipe never touches.
--
-- Additive by definition: this merges, it never replaces. Removing one is what
-- the Edit Photos overlay is for, and that hides rather than deletes, because a
-- photo belongs to the car and other screens still show it.

CREATE OR REPLACE FUNCTION add_listing_photos(p_vin text, p_photos jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean text := upper(regexp_replace(COALESCE(p_vin, ''), '[^A-Za-z0-9]', '', 'g'));
  v_last6 text;
  v_id    uuid;
  v_stock text;
  v_full  text;
BEGIN
  IF length(v_clean) < 6 THEN RETURN 'bad_vin'; END IF;
  IF COALESCE(p_photos, '{}'::jsonb) = '{}'::jsonb THEN RETURN 'nothing'; END IF;
  v_last6 := right(v_clean, 6);

  SELECT id INTO v_id
  FROM inspections
  WHERE vin_last6 = v_last6 OR upper(right(vin, 6)) = v_last6
  ORDER BY completed_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;

  IF v_id IS NULL THEN
    -- Same fallback as upsert_listing_photos: a car with no inspection yet still
    -- gets one, marked complete, because that is what makes it eligible for
    -- marketplace_listings() at all. stock_number falls back to the last 6 —
    -- the marketplace joins inspections by VIN, not by stock number, so a car
    -- Frazer has not stocked yet still finds its pictures.
    SELECT stock_number, vehicle_vin INTO v_stock, v_full
    FROM inventory
    WHERE upper(right(vehicle_vin, 6)) = v_last6 OR last_6_vin = v_last6
    LIMIT 1;

    INSERT INTO inspections (type, status, vin, vin_last6, stock_number, checklist, completed_at)
    VALUES ('inbound', 'complete',
      COALESCE(v_full, CASE WHEN length(v_clean) >= 11 THEN v_clean ELSE v_last6 END),
      v_last6, COALESCE(v_stock, v_last6),
      jsonb_build_object('v', 2, 'photos', p_photos),
      now());
    RETURN 'created';
  END IF;

  UPDATE inspections
     SET checklist = jsonb_set(
           COALESCE(checklist, '{}'::jsonb), '{photos}',
           COALESCE(checklist -> 'photos', '{}'::jsonb) || p_photos),
         completed_at = COALESCE(completed_at, now()),
         updated_at = now()
   WHERE id = v_id;
  RETURN 'added';
END;
$$;

-- Server only. The endpoint that calls this checks the caller is an admin and
-- holds the service key; the anon key ships inside the public web bundle and must
-- never be able to put pictures on a listing.
REVOKE EXECUTE ON FUNCTION add_listing_photos(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION add_listing_photos(text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
