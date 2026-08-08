-- Sweep the app photos that were uploaded but never indexed.
--
-- uploadVehiclePhoto puts the file in storage FIRST and writes the index row
-- second. That second write named `vehicle_photos` — the read function — instead
-- of `vehicle_photo_uploads`, the table, so it failed with PGRST205 every time
-- and left the photo sitting in the car-history bucket with nothing pointing at
-- it. Invisible in the app, undeletable from the app, still taking up space.
--
-- These are real photos of real cars that someone stood there and took, and the
-- path carries the car: `<vin6>/app-<uid>.<ext>`. So they are ADOPTED, not
-- deleted — indexed against the vin6 they were shot for, which makes them appear
-- on that car and, because they're source='app', deletable from the lightbox by
-- anyone who decides they're junk. Deleting them here would be the irreversible
-- version of the same cleanup.
--
-- Only touches:
--   * the car-history bucket
--   * names shaped exactly like an app upload (`<6 chars>/app-…`), which is what
--     keeps the Telegram bot's own photos out of this
--   * objects with no index row already
--
-- Re-running is a no-op: anything adopted the first time now has a row.

DO $$
DECLARE
  v_found   INT;
  v_adopted INT;
BEGIN
  CREATE TEMP TABLE orphan_app_photos ON COMMIT DROP AS
  SELECT
    o.name                              AS path,
    upper(split_part(o.name, '/', 1))   AS vin6,
    o.created_at,
    o.owner
  FROM storage.objects o
  WHERE o.bucket_id = 'car-history'
    AND o.name ~ '^[A-Za-z0-9]{6}/app-'
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_photo_uploads vp
       WHERE vp.bucket = 'car-history' AND vp.path = o.name)
    -- Belt and braces: never claim something the bot's own index knows about.
    AND NOT EXISTS (
      SELECT 1 FROM wa_inbound_messages w WHERE w.media_path = o.name);

  SELECT COUNT(*) INTO v_found FROM orphan_app_photos;
  RAISE NOTICE 'orphaned app photos found: %', v_found;

  INSERT INTO vehicle_photo_uploads (vin6, stock_number, vin, bucket, path, source, created_by, created_at)
  SELECT
    p.vin6,
    -- The stock number the car had at the time isn't recoverable from the path,
    -- and it's optional — vehicle_photos() matches on vin6 anyway.
    NULL,
    NULL,
    'car-history',
    p.path,
    'app',
    -- storage.objects.owner is the auth user who uploaded. Kept only when that
    -- user still has a profile, since created_by is an FK to it.
    (SELECT pr.id FROM profiles pr WHERE pr.id = p.owner),
    p.created_at
  FROM orphan_app_photos p
  ON CONFLICT (path) DO NOTHING;

  GET DIAGNOSTICS v_adopted = ROW_COUNT;
  RAISE NOTICE 'orphaned app photos adopted: %', v_adopted;
END $$;
