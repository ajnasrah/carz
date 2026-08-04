-- Keep the board in step with where cars actually are.
--
-- The 2026-08-04 backfill was a one-shot: it opened jobs for cars sitting at the
-- body shop at that moment. An audit straight afterwards found a car that had
-- arrived since and wasn't on the board — because a job is only opened when the
-- BOT sees a VIN in the body shop group, and a car can also get there via a lot
-- scan, a Super Dispatch row, or a manual location edit.
--
-- This closes that gap permanently: any car whose physical location is the body
-- shop gets a job, whatever moved it there.
--
-- The re-open guard is the delicate part. Naively "car is at body_shop and has
-- no OPEN job -> create one" would resurrect every job the manager marks Done,
-- because finishing the work doesn't move the car off the lot. So a job is only
-- created when no existing job already accounts for that arrival, i.e. none with
-- entered_at >= the location timestamp:
--
--   arrives 3d ago, no job          -> create (entered_at = 3d ago)
--   manager marks it Done           -> job entered_at 3d >= loc 3d, no re-create
--   leaves, comes back today        -> no job entered_at >= today, create a new one
--
-- 'jorge' IS the body shop (Inventory.canonicalLoc folds them), so both count.

CREATE OR REPLACE FUNCTION sync_body_shop_from_locations()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opened INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT vl.stock_number,
           COALESCE(NULLIF(vl.vin, ''), i.vehicle_vin) AS vin,
           upper(right(COALESCE(NULLIF(vl.vin, ''), i.vehicle_vin, ''), 6)) AS vin6,
           COALESCE(vl.location_updated_at, NOW()) AS arrived_at
      FROM vehicle_locations vl
      JOIN inventory i ON i.stock_number = vl.stock_number
     WHERE vl.physical_location IN ('body_shop', 'jorge')
       AND length(COALESCE(NULLIF(vl.vin, ''), i.vehicle_vin, '')) >= 6
       AND NOT EXISTS (
         SELECT 1 FROM body_shop_jobs j
          WHERE j.stock_number = vl.stock_number
            AND j.entered_at >= COALESCE(vl.location_updated_at, NOW())
       )
       -- and nothing currently open for it (belt and braces against the
       -- partial unique index raising instead of skipping)
       AND NOT EXISTS (
         SELECT 1 FROM body_shop_jobs j
          WHERE j.stock_number = vl.stock_number AND j.status <> 'done'
       )
  LOOP
    INSERT INTO body_shop_jobs (stock_number, vin, vin6, status, entered_at, source)
    VALUES (r.stock_number, r.vin, r.vin6, 'intake', r.arrived_at, 'location_sync')
    ON CONFLICT DO NOTHING;
    v_opened := v_opened + 1;
  END LOOP;

  -- A pending fresh-buy job may now be linkable to the car we just touched.
  RETURN v_opened;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_body_shop_from_locations() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION sync_body_shop_from_locations() FROM PUBLIC, anon;

-- Fold it into the board's on-load housekeeping. DROP first: this adds an
-- `opened` column to the return type, and CREATE OR REPLACE can't change that.
-- The client ignores the result shape, so widening it is safe.
DROP FUNCTION IF EXISTS body_shop_housekeeping();

CREATE OR REPLACE FUNCTION body_shop_housekeeping()
RETURNS TABLE (linked INTEGER, purged INTEGER, opened INTEGER)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_employee() THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;
  RETURN QUERY SELECT
    link_pending_body_shop_jobs(),
    purge_stale_pending_body_shop_jobs(7),
    sync_body_shop_from_locations();
END;
$$;

GRANT EXECUTE ON FUNCTION body_shop_housekeeping() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION body_shop_housekeeping() FROM PUBLIC, anon;

-- Catch up right now for anything that arrived since the one-shot backfill.
SELECT sync_body_shop_from_locations();

NOTIFY pgrst, 'reload schema';
