-- Take the Mechanic LINE back off the mechanic board.
--
-- The backfill in 20260828000001 seeded from physical_location IN ('mechanic',
-- 'mechanic_section'), on the assumption they were one place under two codes the
-- way 'jorge' and 'body_shop' are. Inventory's LOCATION_LABELS prints both as
-- "Mechanic", which is what made them look equivalent.
--
-- They aren't. 'mechanic' is the ~22 cars at the mechanic. 'mechanic_section' is
-- the ~173 sitting in the Mechanic Line on the lot — queued, not being worked.
-- Seeding all 195 buries the cars that are actually on a lift under eight times
-- their number of cars that aren't, which is the same failure on_hold was added
-- to fix on the body shop board.
--
-- Only UNTOUCHED backfill rows are removed: source = 'backfill', still in
-- intake, no lines, no parts, no notes, and never assigned. If anyone has opened
-- one of these cards and started working it in the meantime, that is a real job
-- and it stays. A queued car gets a job when someone actually starts it.

DO $$
DECLARE
  v_before INT;
  v_after  INT;
  v_gone   INT;
BEGIN
  SELECT COUNT(*) INTO v_before FROM mechanic_jobs;

  DELETE FROM mechanic_jobs j
  WHERE j.source = 'backfill'
    AND j.status = 'intake'
    AND j.assigned_tech IS NULL
    AND j.notes IS NULL
    AND NOT EXISTS (SELECT 1 FROM mechanic_lines l WHERE l.job_id = j.id)
    AND NOT EXISTS (SELECT 1 FROM mechanic_parts p WHERE p.job_id = j.id)
    AND EXISTS (
      SELECT 1 FROM vehicle_locations vl
      WHERE vl.stock_number = j.stock_number
        AND vl.physical_location = 'mechanic_section'
    );

  GET DIAGNOSTICS v_gone = ROW_COUNT;
  SELECT COUNT(*) INTO v_after FROM mechanic_jobs;

  RAISE NOTICE 'mechanic_jobs: % before, % removed (lot line), % remaining',
    v_before, v_gone, v_after;
END $$;

NOTIFY pgrst, 'reload schema';
