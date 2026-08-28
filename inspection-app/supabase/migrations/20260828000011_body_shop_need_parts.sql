-- "Waiting Parts" was two different problems wearing one label.
--
-- 26 cars sat in that lane and the board could not tell you which of them were
-- waiting on a vendor and which were waiting on US to pick up the phone. Those
-- are opposite situations: one is somebody else's clock, the other is ours and
-- is the only one the manager can do anything about this afternoon.
--
-- So the lane splits in two, and — the second half of this, and the part that
-- makes it stay true — the parts checklist drives it. Nobody moves a card by
-- hand between these three stages ever again:
--
--   need_parts     any part still marked Needed  → we owe somebody an order
--   waiting_parts  everything ordered, some out  → the vendor owes us
--   parts_in       every part received           → a tech can start
--
-- The pipeline is now:
--   intake -> need_parts -> waiting_parts -> parts_in -> in_progress
--          -> final_check -> done
--
-- need_parts sits where it does because listing what a car needs happens before
-- buying it. A car with NO parts listed stays in intake — that is not "needs
-- ordering", it is "nobody has looked yet", which is what the order list's
-- untriaged count has always called it.

-- ---------------------------------------------------------------- status

ALTER TABLE body_shop_jobs DROP CONSTRAINT IF EXISTS body_shop_jobs_status_check;
ALTER TABLE body_shop_jobs ADD CONSTRAINT body_shop_jobs_status_check
  CHECK (status IN ('intake','need_parts','waiting_parts','parts_in',
                    'in_progress','final_check','on_hold','done'));

-- ------------------------------------------------- the checklist moves the car
--
-- One function, called from the parts trigger and from the backfill below, so
-- "which stage do these parts mean" is written down exactly once.
--
-- It only ever moves a car WITHIN the parts stages. A car on the lift that
-- needs a late supplemental part must not be yanked back to need_parts — the
-- work in progress is real and the board must keep saying so; the order list
-- picks that part up regardless, because that list reads parts, not stages.
-- Held and done cars are untouched for the same reason.
CREATE OR REPLACE FUNCTION sync_body_shop_job_parts_stage(p_job UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status TEXT;
  v_total  INT;
  v_needed INT;
  v_order  INT;
  v_next   TEXT;
BEGIN
  SELECT status INTO v_status FROM body_shop_jobs WHERE id = p_job;
  IF v_status IS NULL
     OR v_status NOT IN ('intake','need_parts','waiting_parts','parts_in') THEN
    RETURN;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE status = 'needed'),
         count(*) FILTER (WHERE status = 'ordered')
    INTO v_total, v_needed, v_order
    FROM body_shop_parts WHERE job_id = p_job;

  -- Nothing listed says nothing about the stage: a manager who taps Need Parts
  -- before he has written the list down is right, and deleting a part is not a
  -- reason to teleport a car. The checklist only speaks when it has something
  -- to say.
  IF v_total = 0 THEN RETURN; END IF;

  v_next := CASE
    WHEN v_needed > 0 THEN 'need_parts'
    WHEN v_order  > 0 THEN 'waiting_parts'
    ELSE                   'parts_in'
  END;

  IF v_next IS DISTINCT FROM v_status THEN
    UPDATE body_shop_jobs SET status = v_next WHERE id = p_job;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION sync_body_shop_job_parts_stage(UUID) FROM PUBLIC;

-- AFTER, not BEFORE: the part row has to be committed to its own table before
-- we count it. DELETE reads OLD; everything else reads NEW.
CREATE OR REPLACE FUNCTION body_shop_parts_restage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM sync_body_shop_job_parts_stage(OLD.job_id);
    RETURN OLD;
  END IF;
  PERFORM sync_body_shop_job_parts_stage(NEW.job_id);
  -- A part moved to another car restages the car it left, too.
  IF TG_OP = 'UPDATE' AND OLD.job_id IS DISTINCT FROM NEW.job_id THEN
    PERFORM sync_body_shop_job_parts_stage(OLD.job_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION body_shop_parts_restage() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_body_shop_parts_restage ON body_shop_parts;
CREATE TRIGGER trg_body_shop_parts_restage
  AFTER INSERT OR DELETE ON body_shop_parts
  FOR EACH ROW EXECUTE FUNCTION body_shop_parts_restage();

-- Only a status or a reassignment can change the answer; an edited price or ETA
-- must not churn the board.
DROP TRIGGER IF EXISTS trg_body_shop_parts_restage_upd ON body_shop_parts;
CREATE TRIGGER trg_body_shop_parts_restage_upd
  AFTER UPDATE ON body_shop_parts
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.job_id IS DISTINCT FROM NEW.job_id)
  EXECUTE FUNCTION body_shop_parts_restage();

-- ------------------------------------------------- backfill
--
-- Every open car in a parts stage today gets classified by the rule above, which
-- is what splits the existing lane.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM body_shop_jobs
            WHERE status IN ('intake','waiting_parts','parts_in')
  LOOP
    PERFORM sync_body_shop_job_parts_stage(r.id);
  END LOOP;
END;
$$;

-- The one case the rule deliberately stays quiet about, decided once here: a car
-- parked in waiting_parts with no parts listed at all. It has nothing on order —
-- it can't have — so it belongs on the side of the split the manager can act on,
-- not the side where he is waiting for a vendor who was never called.
UPDATE body_shop_jobs j
   SET status = 'need_parts'
 WHERE j.status = 'waiting_parts'
   AND NOT EXISTS (SELECT 1 FROM body_shop_parts p WHERE p.job_id = j.id);
