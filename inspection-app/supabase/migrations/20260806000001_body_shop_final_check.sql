-- Body Shop: a final check stage, and attribution on the charge negotiation.
--
-- The pipeline the shop actually runs is:
--
--   intake -> waiting_parts -> in_progress -> final_check -> done
--
-- Parts come BEFORE the work, not after it: a car sits waiting on a bumper, the
-- part lands, then a tech picks it up. The old order had waiting_parts after
-- in_progress, which read as if work started and then stalled — the opposite of
-- how the car moves through the shop.
--
-- final_check is the last pass before a car leaves: buffing, sanding back a run,
-- colour match under the lights. It was being done inside 'done', which meant a
-- car showed as finished — and became payable — while it was still on the rack.
-- Only `done` stamps completed_at, so only a car that has passed final check can
-- reach the Saturday payout.

-- ---------------------------------------------------------------- status

ALTER TABLE body_shop_jobs DROP CONSTRAINT IF EXISTS body_shop_jobs_status_check;
ALTER TABLE body_shop_jobs ADD CONSTRAINT body_shop_jobs_status_check
  CHECK (status IN ('intake','waiting_parts','in_progress','final_check','done'));

-- Everything keyed off "open" — the one-open-job-per-car index, the board, the
-- housekeeping sweep — tests `status <> 'done'`, so final_check counts as open
-- with no further change.

-- Stamp when the car reached final check, so "how long has it been sitting on
-- the buffer" is answerable later. started_at is left alone: the clock on the
-- actual work starts at in_progress and doesn't restart.
ALTER TABLE body_shop_jobs
  ADD COLUMN IF NOT EXISTS final_check_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION stamp_body_shop_job_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
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

-- ---------------------------------------------------------------- attribution
--
-- A counter is one person telling another his number is wrong. It has to carry
-- a name whether or not a reason was typed — the name was already joined into
-- the view but only rendered alongside a note, so a counter with no note landed
-- on Jorge anonymously.
--
-- Appended at the end of the select list, which is what makes CREATE OR REPLACE
-- legal on an existing view.
CREATE OR REPLACE VIEW body_shop_board AS
SELECT
  j.id, j.stock_number, j.vin, j.vin6, j.status, j.price, j.notes,
  j.assigned_tech, j.entered_at, j.started_at, j.completed_at,
  j.source, j.created_at, j.updated_at,
  i.vehicle_year, i.vehicle_make, i.vehicle_model, i.vehicle_color, i.mileage,
  p.name AS tech_name,
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
  j.final_check_at
FROM body_shop_jobs j
LEFT JOIN inventory i
  ON (j.stock_number IS NOT NULL AND i.stock_number = j.stock_number)
  OR (j.stock_number IS NULL AND j.vin6 IS NOT NULL
      AND upper(right(i.vehicle_vin, 6)) = upper(j.vin6))
LEFT JOIN profiles p  ON p.id = j.assigned_tech
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
