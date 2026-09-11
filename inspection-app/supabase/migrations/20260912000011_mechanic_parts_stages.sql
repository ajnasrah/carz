-- The mechanic board could not say "these parts are not ordered yet".
--
-- It had one parts lane, waiting_parts, which conflated the two states that
-- matter most: a car nobody has ordered for (somebody has to act) and a car
-- whose parts are bought and en route (nobody can do anything but wait). The
-- body shop has split those since day one — Need Parts vs Parts Ordered — and
-- it is the split that makes a "what do I have to buy today" list possible.
--
-- Adds the two missing lanes and the parts ETA the body shop just got, so both
-- shops answer the same question the same way.

-- 1) The two new lanes.
ALTER TABLE mechanic_jobs DROP CONSTRAINT IF EXISTS mechanic_jobs_status_check;
ALTER TABLE mechanic_jobs ADD CONSTRAINT mechanic_jobs_status_check
  CHECK (status = ANY (ARRAY[
    'intake', 'diagnosing', 'need_parts', 'waiting_parts', 'parts_in',
    'in_progress', 'on_hold', 'done'
  ]));

-- 2) When the parts land, so does the date. Same four columns and the same
--    contract as body_shop_jobs (20260912000010): read from the notes by the
--    client, because "next tuesday" needs a calendar and plpgsql is a bad place
--    to keep one.
ALTER TABLE mechanic_jobs
  ADD COLUMN IF NOT EXISTS parts_eta      DATE,
  ADD COLUMN IF NOT EXISTS parts_eta_last DATE,
  ADD COLUMN IF NOT EXISTS parts_eta_text TEXT,
  ADD COLUMN IF NOT EXISTS parts_eta_key  TEXT;

-- 3) The checklist drives the lane, exactly as it does for the body shop.
--
-- Only while the car is in a parts lane or still being triaged: once a tech has
-- it on the lift, ordering one more bolt must not drag the card backwards.
-- 'diagnosing' is included where the body shop has only 'intake' — it is the
-- mechanic's triage stage, and finding what is wrong is precisely when the
-- first part gets listed.
CREATE OR REPLACE FUNCTION sync_mechanic_job_parts_stage(p_job uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status TEXT;
  v_total  INT;
  v_needed INT;
  v_order  INT;
  v_next   TEXT;
BEGIN
  SELECT status INTO v_status FROM mechanic_jobs WHERE id = p_job;
  IF v_status IS NULL
     OR v_status NOT IN ('intake','diagnosing','need_parts','waiting_parts','parts_in') THEN
    RETURN;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE status = 'needed'),
         count(*) FILTER (WHERE status = 'ordered')
    INTO v_total, v_needed, v_order
    FROM mechanic_parts WHERE job_id = p_job;

  -- An empty list says nothing about the stage. A manager who taps Need Parts
  -- before he has written the list down is right, and deleting the last part is
  -- not a reason to teleport a car.
  IF v_total = 0 THEN RETURN; END IF;

  v_next := CASE
    WHEN v_needed > 0 THEN 'need_parts'
    WHEN v_order  > 0 THEN 'waiting_parts'
    ELSE                   'parts_in'
  END;

  IF v_next IS DISTINCT FROM v_status THEN
    UPDATE mechanic_jobs SET status = v_next WHERE id = p_job;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION trg_sync_mechanic_parts_stage()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM sync_mechanic_job_parts_stage(COALESCE(NEW.job_id, OLD.job_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_mechanic_parts_stage ON mechanic_parts;
CREATE TRIGGER trg_mechanic_parts_stage
  AFTER INSERT OR UPDATE OF status OR DELETE ON mechanic_parts
  FOR EACH ROW EXECUTE FUNCTION trg_sync_mechanic_parts_stage();

-- 4) Surface the new columns on the board. Appended at the end so CREATE OR
--    REPLACE stays legal; everything above is unchanged.
CREATE OR REPLACE VIEW mechanic_board AS
SELECT j.id,
    j.stock_number,
    j.vin,
    j.vin6,
    j.status,
    j.notes,
    j.assigned_tech,
    j.entered_at,
    j.started_at,
    j.completed_at,
    j.held_at,
    j.parts_delivered_at,
    j.signed_off_at,
    j.signed_off_by,
    j.source,
    j.created_at,
    j.updated_at,
    i.vehicle_year,
    i.vehicle_make,
    i.vehicle_model,
    i.vehicle_color,
    i.mileage,
    p.name AS tech_name,
    i.stock_number IS NULL AS awaiting_inventory,
    GREATEST(0, (EXTRACT(epoch FROM COALESCE(j.completed_at, now()) - j.entered_at) / 86400::numeric)::integer) AS days_in_shop,
    GREATEST(0, COALESCE(now()::date - frazer_date(i.purchase_date), frazer_num(i.days_on_lot)::integer)) AS days_owned,
    COALESCE(lc.lines_total, 0::bigint) AS lines_total,
    COALESCE(lc.lines_open, 0::bigint) AS lines_open,
    COALESCE(lc.lines_done, 0::bigint) AS lines_done,
    COALESCE(lc.lines_declined, 0::bigint) AS lines_declined,
    COALESCE(lc.blocked_on_parts, 0::bigint) AS blocked_on_parts,
    lc.worst_severity,
    COALESCE(pc.parts_total, 0::bigint) AS parts_total,
    COALESCE(pc.parts_needed, 0::bigint) AS parts_needed,
    COALESCE(pc.parts_ordered, 0::bigint) AS parts_ordered,
    COALESCE(pc.parts_received, 0::bigint) AS parts_received,
    COALESCE(pc.parts_cost, 0::numeric) AS parts_cost,
    j.parts_eta,
    j.parts_eta_last,
    j.parts_eta_text,
    j.parts_eta_key
   FROM mechanic_jobs j
     LEFT JOIN inventory i ON j.stock_number IS NOT NULL AND i.stock_number = j.stock_number OR j.stock_number IS NULL AND j.vin6 IS NOT NULL AND upper("right"(i.vehicle_vin, 6)) = upper(j.vin6)
     LEFT JOIN profiles p ON p.id = j.assigned_tech
     LEFT JOIN LATERAL ( SELECT count(*) AS lines_total,
            count(*) FILTER (WHERE ml.status <> ALL (ARRAY['done'::text, 'declined'::text])) AS lines_open,
            count(*) FILTER (WHERE ml.status = 'done'::text) AS lines_done,
            count(*) FILTER (WHERE ml.status = 'declined'::text) AS lines_declined,
            count(*) FILTER (WHERE ml.status = 'waiting_parts'::text) AS blocked_on_parts,
            (array_agg(ml.severity ORDER BY (
                CASE ml.severity
                    WHEN 'critical'::text THEN 0
                    WHEN 'severe'::text THEN 1
                    WHEN 'moderate'::text THEN 2
                    WHEN 'minor'::text THEN 3
                    ELSE 4
                END)) FILTER (WHERE ml.status <> ALL (ARRAY['done'::text, 'declined'::text])))[1] AS worst_severity
           FROM mechanic_lines ml
          WHERE ml.job_id = j.id) lc ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS parts_total,
            count(*) FILTER (WHERE mp.status = 'needed'::text) AS parts_needed,
            count(*) FILTER (WHERE mp.status = 'ordered'::text) AS parts_ordered,
            count(*) FILTER (WHERE mp.status = 'received'::text) AS parts_received,
            COALESCE(sum(mp.cost), 0::numeric) AS parts_cost
           FROM mechanic_parts mp
          WHERE mp.job_id = j.id) pc ON true
  WHERE is_employee();

REVOKE ALL ON mechanic_board FROM PUBLIC, anon;
GRANT SELECT ON mechanic_board TO authenticated;

NOTIFY pgrst, 'reload schema';
