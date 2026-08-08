-- Body Shop: a stage for a car whose parts have landed but nobody has started.
--
--   intake -> waiting_parts -> parts_in -> in_progress -> final_check -> done
--
-- waiting_parts and in_progress used to sit next to each other, which hid the
-- one queue the shop actually schedules from: cars that are READY. A car whose
-- bumper arrived Tuesday is not "waiting on parts" any more, but it isn't being
-- worked either, and while it sat in waiting_parts it looked like the vendor's
-- problem instead of ours. parts_in is that queue — parts delivered, waiting to
-- start — and it is the list a manager hands out in the morning.

ALTER TABLE body_shop_jobs DROP CONSTRAINT IF EXISTS body_shop_jobs_status_check;
ALTER TABLE body_shop_jobs ADD CONSTRAINT body_shop_jobs_status_check
  CHECK (status IN ('intake','waiting_parts','parts_in','in_progress','final_check','done'));

-- Everything keyed off "open" tests `status <> 'done'`, so the new stage counts
-- as open with no further change — same as final_check before it.

-- When the parts landed, so "how long has this car been ready and untouched"
-- is answerable. That is the number that shames a queue into moving.
ALTER TABLE body_shop_jobs
  ADD COLUMN IF NOT EXISTS parts_in_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION stamp_body_shop_job_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'parts_in' AND NEW.parts_in_at IS NULL THEN
      NEW.parts_in_at := NOW();
    END IF;
    IF NEW.status = 'in_progress' AND NEW.started_at IS NULL THEN
      NEW.started_at := NOW();
    END IF;
    IF NEW.status = 'final_check' AND NEW.final_check_at IS NULL THEN
      NEW.final_check_at := NOW();
    END IF;
    IF NEW.status = 'done' THEN
      NEW.completed_at := COALESCE(NEW.completed_at, NOW());
    ELSE
      NEW.completed_at := NULL;   -- reopened
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Board view: parts_in_at appended at the end, which is what keeps CREATE OR
-- REPLACE legal on the existing view. Everything above it is unchanged from
-- 20260807000002.
CREATE OR REPLACE VIEW body_shop_board AS
SELECT
  j.id, j.stock_number, j.vin, j.vin6, j.status, j.price, j.notes,
  j.assigned_tech, j.entered_at, j.started_at, j.completed_at,
  j.source, j.created_at, j.updated_at,
  i.vehicle_year, i.vehicle_make, i.vehicle_model, i.vehicle_color, i.mileage,
  COALESCE(p.name, ti.name) AS tech_name,
  (j.stock_number IS NULL) AS awaiting_inventory,
  GREATEST(0, (EXTRACT(EPOCH FROM (COALESCE(j.completed_at, NOW()) - j.entered_at)) / 86400)::int)
    AS days_in_shop,
  COALESCE(pc.parts_total, 0)    AS parts_total,
  COALESCE(pc.parts_needed, 0)   AS parts_needed,
  COALESCE(pc.parts_ordered, 0)  AS parts_ordered,
  COALESCE(pc.parts_received, 0) AS parts_received,
  COALESCE(pc.parts_cost, 0)     AS parts_cost,
  j.charge_status, j.agreed_amount, j.counter_amount, j.counter_note,
  cb.name AS counter_by_name,
  j.payout_id IS NOT NULL AS paid, j.paid_amount, j.approved_at,
  j.counter_at,
  j.agreed_at,
  ab.name AS agreed_by_name,
  j.final_check_at,
  j.assigned_tech_invite,
  j.parts_in_at
FROM body_shop_jobs j
LEFT JOIN inventory i
  ON (j.stock_number IS NOT NULL AND i.stock_number = j.stock_number)
  OR (j.stock_number IS NULL AND j.vin6 IS NOT NULL
      AND upper(right(i.vehicle_vin, 6)) = upper(j.vin6))
LEFT JOIN profiles p  ON p.id = j.assigned_tech
LEFT JOIN body_shop_tech_invites ti ON ti.id = j.assigned_tech_invite
LEFT JOIN profiles cb ON cb.id = j.counter_by
LEFT JOIN profiles ab ON ab.id = j.agreed_by
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                                       AS parts_total,
    COUNT(*) FILTER (WHERE bp.status = 'needed')   AS parts_needed,
    COUNT(*) FILTER (WHERE bp.status = 'ordered')  AS parts_ordered,
    COUNT(*) FILTER (WHERE bp.status = 'received') AS parts_received,
    COALESCE(SUM(bp.cost), 0)                      AS parts_cost
  FROM body_shop_parts bp WHERE bp.job_id = j.id
) pc ON TRUE
WHERE is_employee();

REVOKE ALL ON body_shop_board FROM PUBLIC, anon;
GRANT SELECT ON body_shop_board TO authenticated;

NOTIFY pgrst, 'reload schema';
