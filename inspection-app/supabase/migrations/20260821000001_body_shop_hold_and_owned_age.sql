-- Body Shop: age the board by how long we've OWNED the car, and give the junk
-- somewhere to sit.
--
-- Two changes, one theme — the board should rank cars by what they cost us.
--
-- 1. days_owned. The board sorted by days_in_shop, which is the age of the JOB:
--    a car that arrived at Jorge's this morning reads 0 even if we've had it on
--    the books since June. Money is lost by the day we own a car, not by the day
--    it sits at the body shop, so the number that decides what gets worked first
--    is the days-in-inventory figure — and a car dropped off yesterday that we
--    bought two months ago belongs at the TOP of the list, not the bottom.
--    days_in_shop stays; it's still the honest measure of the shop's own
--    turnaround, and the payout and finished-list screens read it.
--
-- 2. on_hold. Cars come in that nobody is going to fix — a rotted rocker, a hit
--    that isn't worth the panels, a car waiting on a decision that isn't coming
--    this month. They sat in intake forever, dragging the "oldest" number and
--    the intake count with them, so the one figure that should shame the shop
--    into moving was mostly junk. on_hold parks them: off the pipeline, out of
--    the counts, still one tap away and still holding their photos and parts.
--
--    Deliberately NOT 'done': done means the work is finished and Jorge gets
--    paid for it (body_shop_payout_lines is every job with status = 'done').
--    Parking a junk car must never put money on the payout.

-- ---------------------------------------------------------------- status

ALTER TABLE body_shop_jobs DROP CONSTRAINT IF EXISTS body_shop_jobs_status_check;
ALTER TABLE body_shop_jobs ADD CONSTRAINT body_shop_jobs_status_check
  CHECK (status IN ('intake','waiting_parts','parts_in','in_progress','final_check','on_hold','done'));

-- When it was parked, so "held since June" is answerable — and so taking it off
-- hold and putting it back is visible rather than silent.
ALTER TABLE body_shop_jobs
  ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ;

-- on_hold is OPEN for every purpose that tests `status <> 'done'`:
--   * the one-open-job-per-car unique index still holds, so a held car can't
--     grow a second card from a Telegram post or a location sync;
--   * sync_body_shop_from_locations() won't re-open one;
--   * purge_stale_pending_body_shop_jobs() only ever touches status = 'intake',
--     so a held fresh buy is never deleted out from under the manager.
-- Only the board's own filtering treats it as its own lane.

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
    -- Stamped on the way in, cleared on the way out: a car put back on hold
    -- next month gets a fresh hold date rather than the first one.
    IF NEW.status = 'on_hold' THEN
      NEW.held_at := COALESCE(NEW.held_at, NOW());
    ELSE
      NEW.held_at := NULL;
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

-- ------------------------------------------------- a held car is never auto-closed
--
-- close_body_shop_job() is fired by the location trigger (a car moves off
-- Jorge's) and by the Telegram body_shop_out group. Both mean "the work here is
-- over" — which is exactly what a held car has NOT done. A junk car pushed
-- around the back of the lot, or scanned somewhere else, would otherwise be
-- stamped done and land on Jorge's payout as finished work.
--
-- So a held job is skipped, and stays held until the manager takes it off hold
-- himself. The board and the dashboard tally can disagree about that one car;
-- that is the point of parking it.
CREATE OR REPLACE FUNCTION close_body_shop_job(
  p_vin6  TEXT,
  p_event TIMESTAMPTZ DEFAULT NOW(),
  p_stock TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock   TEXT;
  v_id      UUID;
  v_entered TIMESTAMPTZ;
BEGIN
  v_stock := nullif(btrim(coalesce(p_stock, '')), '');
  IF v_stock IS NULL AND p_vin6 IS NOT NULL THEN
    SELECT stock_number INTO v_stock FROM lookup_vin_by_last6(p_vin6) LIMIT 1;
  END IF;

  SELECT id, entered_at INTO v_id, v_entered
  FROM body_shop_jobs
  WHERE status NOT IN ('done', 'on_hold')
    AND (
      (v_stock IS NOT NULL AND stock_number = v_stock)
      OR (p_vin6 IS NOT NULL AND upper(COALESCE(vin6, '')) = upper(p_vin6))
    )
  ORDER BY entered_at ASC
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN NULL;   -- never went to the body shop, already closed, or on hold
  END IF;

  -- The event time, not now(), so "days in shop" measures the real stay even when
  -- a webhook is retried hours later — but never EARLIER than the car arrived.
  UPDATE body_shop_jobs
  SET status       = 'done',
      completed_at = GREATEST(COALESCE(p_event, NOW()), v_entered)
  WHERE id = v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION close_body_shop_job(TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION close_body_shop_job(TEXT, TIMESTAMPTZ, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------- board view
--
-- days_owned is the new headline: how long the CAR has been ours.
--
-- purchase_date first, days_on_lot second. Both come from Frazer as text, but
-- purchase_date is a fact that doesn't age — subtracting it from today is right
-- however stale the last CSV export is — while days_on_lot is a snapshot taken
-- the moment the export ran and reads a day or two short by the time we use it.
-- NULL when the car isn't in inventory at all (a fresh buy Frazer hasn't seen);
-- the board falls back to days_in_shop and says so rather than printing a zero.
--
-- DROP first rather than CREATE OR REPLACE: this inserts a column in the middle
-- of the row rather than appending, and REPLACE can only append. Nothing in the
-- schema depends on this view — the app is its only reader.
DROP VIEW IF EXISTS body_shop_board;

CREATE VIEW body_shop_board AS
SELECT
  j.id, j.stock_number, j.vin, j.vin6, j.status, j.price, j.notes,
  j.assigned_tech, j.entered_at, j.started_at, j.completed_at,
  j.source, j.created_at, j.updated_at,
  i.vehicle_year, i.vehicle_make, i.vehicle_model, i.vehicle_color, i.mileage,
  COALESCE(p.name, ti.name) AS tech_name,
  (j.stock_number IS NULL) AS awaiting_inventory,
  GREATEST(0, (EXTRACT(EPOCH FROM (COALESCE(j.completed_at, NOW()) - j.entered_at)) / 86400)::int)
    AS days_in_shop,
  GREATEST(0, COALESCE(
    (NOW()::date - frazer_date(i.purchase_date)),
    frazer_num(i.days_on_lot)::int
  )) AS days_owned,
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
  j.parts_in_at,
  j.held_at
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

COMMENT ON COLUMN body_shop_jobs.held_at IS
'When the job was parked on hold. Cleared when it leaves on_hold, so a car held
twice reports the current hold, not the first one.';

NOTIFY pgrst, 'reload schema';
