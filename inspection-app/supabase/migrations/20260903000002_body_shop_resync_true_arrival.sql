-- Marking a car Done put it straight back in Intake.
--
-- 06-429-26 (Lexus GX) was completed at 16:40:57 and a fresh `intake` job was
-- opened for it at 17:14:59. 07-217-26 (Kia Carnival) was completed at 17:19:48
-- and re-opened TWELVE SECONDS later. Neither car had moved.
--
-- sync_body_shop_from_locations() opens a job for any car sitting at the body
-- shop that no job accounts for, and measured "accounts for" against
-- vehicle_locations.location_updated_at:
--
--   AND NOT EXISTS (... j.entered_at >= vl.location_updated_at)
--
-- That column is not the arrival. It is "last time anything wrote a location",
-- and a lot walk rewrites it every pass, whether or not the car moved — both
-- cars were re-stamped 2026-08-28 by a scan that put them back in the same
-- section they were already in. There is no history row for that date, because
-- nothing changed. But the jobs' entered_at (07-08 and 08-07) were now older
-- than the car's "arrival", so the sync read a phantom 08-28 arrival with no job
-- covering it.
--
-- The only thing holding it back was the second guard, `status <> 'done'`. So
-- the resurrection fired the moment the work was signed off, on the very next
-- board load — housekeeping runs inline in fetchBoard(). The manager marks it
-- Done, the board refreshes, the car is back in Intake, backdated to a day it
-- never arrived. Eleven more finished cars were primed to do the same.
--
-- So: ask history when the car actually ARRIVED — the last event that moved it
-- INTO the shop from somewhere else — and fall back to location_updated_at only
-- when history has nothing (it is thin before 2026-07-08).
--
-- 'jorge' IS the body shop, so a body_shop <-> jorge row is not an arrival; it
-- is the same stay under two names, which is exactly the row that misled the
-- old guard on the Lexus.
--
-- And a second guard alongside the first: a job COMPLETED after the arrival
-- accounts for that stay too. entered_at alone cannot see it, because a job
-- opened before a re-stamp keeps its original entered_at forever, and that is
-- the whole shape of this bug.
--
-- What this deliberately still opens: 08-127-26 went to the mechanic on 08-17
-- and came back 08-28. previous_location = 'mechanic_section', so that IS an
-- arrival, its old job was completed 11 days before it, and the car gets the
-- new job it should have. A real return still lands on the board.

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
           -- the last time this car came INTO the shop from outside it, and only
           -- the timestamp of the move itself, never now()
           COALESCE(
             (SELECT max(h.event_at)
                FROM vehicle_location_history h
               WHERE h.stock_number = vl.stock_number
                 AND h.new_location IN ('body_shop', 'jorge')
                 AND (h.previous_location IS NULL
                      OR h.previous_location NOT IN ('body_shop', 'jorge'))),
             vl.location_updated_at,
             NOW()
           ) AS arrived_at
      FROM vehicle_locations vl
      JOIN inventory i ON i.stock_number = vl.stock_number
     WHERE vl.physical_location IN ('body_shop', 'jorge')
       AND length(COALESCE(NULLIF(vl.vin, ''), i.vehicle_vin, '')) >= 6
       AND NOT EXISTS (
         SELECT 1 FROM body_shop_jobs j
          WHERE j.stock_number = vl.stock_number AND j.status <> 'done'
       )
  LOOP
    -- opened for this stay, or finished during it: either way it is accounted for
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM body_shop_jobs j
       WHERE j.stock_number = r.stock_number
         AND (j.entered_at >= r.arrived_at OR j.completed_at >= r.arrived_at)
    );

    INSERT INTO body_shop_jobs (stock_number, vin, vin6, status, entered_at, source)
    VALUES (r.stock_number, r.vin, r.vin6, 'intake', r.arrived_at, 'location_sync')
    ON CONFLICT DO NOTHING;
    v_opened := v_opened + 1;
  END LOOP;

  RETURN v_opened;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_body_shop_from_locations() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION sync_body_shop_from_locations() FROM PUBLIC, anon;

-- ------------------------------------------------------------------- cleanup
--
-- The two cars the shop finished today and the board handed straight back. Both
-- are `location_sync` rows created AFTER the done job they duplicate, for a car
-- that never left — the exact signature of the bug, and nothing else matches it.
-- Deleted rather than marked done: they are not work, and a done row would put
-- a second line on the payout for a car that was only ever fixed once.
DELETE FROM body_shop_jobs j
 WHERE j.source = 'location_sync'
   AND j.status <> 'done'
   AND EXISTS (
     SELECT 1 FROM body_shop_jobs d
      WHERE d.stock_number = j.stock_number
        AND d.status = 'done'
        AND d.completed_at >= j.entered_at
        AND d.completed_at <= j.created_at
   );

NOTIFY pgrst, 'reload schema';
