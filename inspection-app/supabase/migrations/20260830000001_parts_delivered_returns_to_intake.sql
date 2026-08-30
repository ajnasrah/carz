-- Parts landing puts the car back in the queue, tagged.
--
-- "Waiting parts" is not a state a car should sit in once the parts are on the
-- shelf — it is the reason nobody is touching it, and the moment that reason
-- goes away the car is ordinary work again. Leaving it parked in Waiting Parts
-- means the one stage that is supposed to mean "blocked" fills up with cars
-- that aren't, and then nobody trusts it.
--
-- So when the last part for a job is marked delivered:
--   * the JOB leaves Waiting Parts and goes back to Intake,
--   * every LINE sitting in Waiting Parts goes back to Open,
--   * and the job carries a Parts Delivered tag so it is obvious, at a glance
--     on the board, which of the cars in Intake can be started right now.
--
-- The tag is a timestamp rather than a status, precisely so it does NOT become
-- a fourth stage. It rides along with whatever stage the car is in and stops
-- mattering once somebody picks the car up.
--
-- Deliberately scoped to the mechanic. The body shop solves the same problem
-- with its own 'parts_in' stage and its own screens; changing that is a
-- separate decision and someone else is working in those files.

ALTER TABLE mechanic_jobs
  ADD COLUMN IF NOT EXISTS parts_delivered_at TIMESTAMPTZ;

COMMENT ON COLUMN mechanic_jobs.parts_delivered_at IS
'When the last part for this job arrived. A tag, not a stage: it rides along
with the car''s status so the board can show which Intake cars are ready to be
started, and is cleared when work begins.';

CREATE OR REPLACE FUNCTION mechanic_parts_delivered()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_job       UUID;
  v_outstanding INT;
  v_total     INT;
BEGIN
  v_job := coalesce(NEW.job_id, OLD.job_id);

  SELECT count(*) FILTER (WHERE status <> 'received'), count(*)
    INTO v_outstanding, v_total
  FROM mechanic_parts WHERE job_id = v_job;

  -- Nothing to say about a job with no parts, and nothing to do while any part
  -- is still outstanding.
  IF v_total = 0 OR v_outstanding > 0 THEN
    RETURN NULL;
  END IF;

  -- A held or finished job is left alone: on hold is a person's decision, and a
  -- delivery must not drag a closed car back onto the board.
  UPDATE mechanic_jobs
  SET status = CASE WHEN status = 'waiting_parts' THEN 'intake' ELSE status END,
      parts_delivered_at = coalesce(parts_delivered_at, NOW())
  WHERE id = v_job
    AND status NOT IN ('done', 'on_hold');

  -- The repairs that were blocked are ordinary open work again.
  UPDATE mechanic_lines
  SET status = 'open'
  WHERE job_id = v_job AND status = 'waiting_parts';

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_mechanic_parts_delivered ON mechanic_parts;
CREATE TRIGGER trg_mechanic_parts_delivered
  AFTER INSERT OR UPDATE OF status ON mechanic_parts
  FOR EACH ROW EXECUTE FUNCTION mechanic_parts_delivered();

-- Picking the car up clears the tag — it has done its job the moment somebody
-- acts on it, and a permanent badge is just noise.
CREATE OR REPLACE FUNCTION stamp_mechanic_job_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'in_progress' AND NEW.started_at IS NULL THEN
      NEW.started_at := NOW();
    END IF;
    -- Work has started (or the car is finished): the "parts are here" nudge is
    -- spent.
    IF NEW.status IN ('in_progress', 'done') THEN
      NEW.parts_delivered_at := NULL;
    END IF;
    IF NEW.status = 'on_hold' THEN
      NEW.held_at := COALESCE(NEW.held_at, NOW());
    ELSE
      NEW.held_at := NULL;
    END IF;
    IF NEW.status = 'done' THEN
      NEW.completed_at := COALESCE(NEW.completed_at, NOW());
    ELSE
      NEW.completed_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- The board needs to show the tag. DROP first: this inserts a column rather
-- than appending, and CREATE OR REPLACE can only append.
DROP VIEW IF EXISTS mechanic_board;

CREATE VIEW mechanic_board AS
SELECT
  j.id, j.stock_number, j.vin, j.vin6, j.status, j.notes,
  j.assigned_tech, j.entered_at, j.started_at, j.completed_at, j.held_at,
  j.parts_delivered_at, j.signed_off_at, j.signed_off_by,
  j.source, j.created_at, j.updated_at,
  i.vehicle_year, i.vehicle_make, i.vehicle_model, i.vehicle_color, i.mileage,
  p.name AS tech_name,
  (i.stock_number IS NULL) AS awaiting_inventory,

  GREATEST(0, (EXTRACT(EPOCH FROM (COALESCE(j.completed_at, NOW()) - j.entered_at)) / 86400)::int)
    AS days_in_shop,

  GREATEST(0, COALESCE(
    (NOW()::date - frazer_date(i.purchase_date)),
    frazer_num(i.days_on_lot)::int
  )) AS days_owned,

  COALESCE(lc.lines_total, 0)      AS lines_total,
  COALESCE(lc.lines_open, 0)       AS lines_open,
  COALESCE(lc.lines_done, 0)       AS lines_done,
  COALESCE(lc.lines_declined, 0)   AS lines_declined,
  COALESCE(lc.blocked_on_parts, 0) AS blocked_on_parts,
  lc.worst_severity,

  COALESCE(pc.parts_total, 0)    AS parts_total,
  COALESCE(pc.parts_needed, 0)   AS parts_needed,
  COALESCE(pc.parts_ordered, 0)  AS parts_ordered,
  COALESCE(pc.parts_received, 0) AS parts_received,
  COALESCE(pc.parts_cost, 0)     AS parts_cost
FROM mechanic_jobs j
LEFT JOIN inventory i
  ON (j.stock_number IS NOT NULL AND i.stock_number = j.stock_number)
  OR (j.stock_number IS NULL AND j.vin6 IS NOT NULL
      AND upper(right(i.vehicle_vin, 6)) = upper(j.vin6))
LEFT JOIN profiles p ON p.id = j.assigned_tech
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                                                     AS lines_total,
    COUNT(*) FILTER (WHERE ml.status NOT IN ('done','declined'))  AS lines_open,
    COUNT(*) FILTER (WHERE ml.status = 'done')                    AS lines_done,
    COUNT(*) FILTER (WHERE ml.status = 'declined')                AS lines_declined,
    COUNT(*) FILTER (WHERE ml.status = 'waiting_parts')           AS blocked_on_parts,
    (ARRAY_AGG(ml.severity ORDER BY
       CASE ml.severity WHEN 'critical' THEN 0 WHEN 'severe' THEN 1
                        WHEN 'moderate' THEN 2 WHEN 'minor' THEN 3 ELSE 4 END)
     FILTER (WHERE ml.status NOT IN ('done','declined')))[1]      AS worst_severity
  FROM mechanic_lines ml WHERE ml.job_id = j.id
) lc ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                                       AS parts_total,
    COUNT(*) FILTER (WHERE mp.status = 'needed')   AS parts_needed,
    COUNT(*) FILTER (WHERE mp.status = 'ordered')  AS parts_ordered,
    COUNT(*) FILTER (WHERE mp.status = 'received') AS parts_received,
    COALESCE(SUM(mp.cost), 0)                      AS parts_cost
  FROM mechanic_parts mp WHERE mp.job_id = j.id
) pc ON TRUE
WHERE is_employee();

REVOKE ALL ON mechanic_board FROM PUBLIC, anon;
GRANT SELECT ON mechanic_board TO authenticated;

NOTIFY pgrst, 'reload schema';
