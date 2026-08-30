-- Open the tickets as the findings land, not when somebody presses finish.
--
-- The router fired on the transition into 'complete'. That is the wrong moment
-- for this shop: of 281 inbound inspections, 5 ever reached 'complete'. So an
-- inspector could stand at a car, say "transmission is slipping", watch it be
-- recorded — and the mechanic would never hear about it, because the walk was
-- never formally finished. The finding was saved and the work order was not.
--
-- A car with a slipping transmission belongs on the mechanic's board the second
-- somebody says so. Waiting for a button press puts the whole system's value
-- behind the one step people reliably skip.
--
-- Safe to fire repeatedly because routing was built idempotent from the start:
-- lines are keyed on (source_inspection_id, source_key), ensure_*_job returns
-- the existing open job untouched, and a re-route refreshes wording only —
-- never a status or a severity the mechanic has already changed. That property
-- was tested before this change; it is what makes this change possible.

DROP TRIGGER IF EXISTS trg_inspection_complete_route ON inspections;

CREATE OR REPLACE FUNCTION on_inspection_changed_route()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM route_inspection_work_order(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Routing must never block someone recording what they are looking at.
    -- Losing the ticket is recoverable — the finding is still on the
    -- inspection and the next edit re-routes it. Losing the finding is not.
    RAISE WARNING 'work order routing failed for inspection %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

-- Fires on a real change to the findings, or on the walk being finished.
-- 'listed' and 'archived' are excluded: those are the listing/disclosure flow
-- and must never open a repair ticket.
CREATE TRIGGER trg_inspection_route
  AFTER UPDATE ON inspections
  FOR EACH ROW
  WHEN (
    NEW.type = 'inbound'
    AND NEW.status IN ('in_progress', 'complete')
    AND (NEW.checklist IS DISTINCT FROM OLD.checklist
         OR NEW.status IS DISTINCT FROM OLD.status)
  )
  EXECUTE FUNCTION on_inspection_changed_route();

-- Catch up everything already recorded but never routed, so the cars sitting in
-- half-finished inspections right now reach the shops.
DO $$
DECLARE r RECORD; n INT := 0;
BEGIN
  FOR r IN
    SELECT id FROM inspections
    WHERE type = 'inbound' AND status IN ('in_progress', 'complete')
      AND (checklist -> 'test_drive') IS NOT NULL
  LOOP
    BEGIN
      PERFORM route_inspection_work_order(r.id);
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'backfill routing failed for %: %', r.id, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'routed % existing inspection(s)', n;
END $$;

NOTIFY pgrst, 'reload schema';
