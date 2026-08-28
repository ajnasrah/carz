-- The work order router: one finished inbound inspection, two shop tickets.
--
-- Finishing an inbound inspection is the moment we know what a car needs, and
-- until now that knowledge died in a JSON column. This routes it:
--
--   exterior damage      -> a body shop ticket (photos come for free, see below)
--   startup / test drive -> a mechanic job with ONE LINE PER PROBLEM
--   interior damage      -> counted on the work order; no detail module to send
--                           it to yet, and inventing one would be fiction
--
-- Runs as a trigger, because the decision was "inbound opens tickets
-- automatically, no triage lane". It fires only on status becoming 'complete'
-- for an inbound inspection — the 276 rows sitting at status 'listed' are the
-- listing/disclosure flow and must never open a repair ticket.
--
-- WHERE THE FINDINGS LIVE: inspections.checklist, the v:2 JSON the working
-- six-step flow writes. NOT mechanical_issues / damage_estimates — those tables
-- do not exist in this database (20260520000001 is recorded as applied but
-- never ran), which is exactly why /inbound throws today. The JSON is the only
-- representation that has ever held real data, so it is the one we read.
--
-- Shape we parse:
--   startup    { <item>: { status: 'pass'|'fail', note } }
--   test_drive { <item>: { status: 'pass'|'fail', note } }
--   exterior   { <panel>: { damages: [ { type, size, note, photos[] } ] } }
--   interior   { <zone>:  { damages: [ ... ] } }

-- --------------------------------------------------------------- provenance
-- So a body shop ticket can say which inspection raised it, and show that
-- inspection's damage list. The mechanic's equivalent lives on each line
-- (source_inspection_id + source_key) because a mechanic job has lines and the
-- body shop's has one price.
ALTER TABLE body_shop_jobs
  ADD COLUMN IF NOT EXISTS source_inspection_id UUID REFERENCES inspections(id) ON DELETE SET NULL;

-- --------------------------------------------------------------- the receipt
-- One row per inspection that has been routed. This is not a third copy of the
-- findings — it is the record that routing HAPPENED, what it opened, and how
-- much it found. Without it there is no way to tell "this inspection found
-- nothing" from "this inspection was never routed", and a re-run could not tell
-- either.

CREATE TABLE IF NOT EXISTS work_orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id  UUID NOT NULL UNIQUE REFERENCES inspections(id) ON DELETE CASCADE,
  stock_number   TEXT,
  vin6           TEXT,

  body_shop_job_id UUID REFERENCES body_shop_jobs(id) ON DELETE SET NULL,
  mechanic_job_id  UUID REFERENCES mechanic_jobs(id)  ON DELETE SET NULL,

  exterior_findings   INT NOT NULL DEFAULT 0,
  interior_findings   INT NOT NULL DEFAULT 0,
  mechanical_findings INT NOT NULL DEFAULT 0,

  -- Null when the car wasn't in inventory at the time, so nothing could be
  -- opened against it. The work order still exists and still counts what was
  -- found; it just has no tickets yet.
  routed_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_orders_stock ON work_orders (stock_number);

ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_orders_all ON work_orders;
CREATE POLICY work_orders_all ON work_orders
  FOR ALL TO authenticated USING (is_employee()) WITH CHECK (is_employee());

-- --------------------------------------------------------------- the router

CREATE OR REPLACE FUNCTION route_inspection_work_order(p_inspection_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_insp      RECORD;
  v_vin6      TEXT;
  v_event     TIMESTAMPTZ;
  v_bs_job    UUID;
  v_mech_job  UUID;
  v_ext       INT := 0;
  v_int       INT := 0;
  v_mech      INT := 0;
  v_wo        UUID;
  v_key       TEXT;
  v_val       JSONB;
  v_note      TEXT;
  v_desc      TEXT;
  v_system    TEXT;
  v_severity  TEXT;
  v_source    TEXT;
BEGIN
  SELECT id, type, status, vin, vin_last6, stock_number, checklist, completed_at
    INTO v_insp
  FROM inspections WHERE id = p_inspection_id;

  IF NOT FOUND OR v_insp.type <> 'inbound' THEN
    RETURN NULL;
  END IF;

  v_vin6  := upper(nullif(btrim(coalesce(v_insp.vin_last6, right(coalesce(v_insp.vin,''), 6))), ''));
  -- The completion time, not now(), so a job opened by a webhook retry hours
  -- later still ages from when the car was actually finished with.
  v_event := coalesce(v_insp.completed_at, NOW());

  -- ------------------------------------------------------------- count it up
  --
  -- Panels whose key starts with 'sa_' are skipped throughout. Those are the
  -- LISTING flow's free-text disclosure rows (sa_ext_0, sa_int_0, …) written
  -- when a car is listed, months after arrival and usually after the work was
  -- already done. Routing them would re-open repairs we have already paid for.
  SELECT count(*) INTO v_ext
  FROM jsonb_each(coalesce(v_insp.checklist -> 'exterior', '{}'::jsonb)) e(key, val)
  WHERE e.key NOT LIKE 'sa\_%'
    AND jsonb_array_length(coalesce(e.val -> 'damages', '[]'::jsonb)) > 0;

  SELECT count(*) INTO v_int
  FROM jsonb_each(coalesce(v_insp.checklist -> 'interior', '{}'::jsonb)) e(key, val)
  WHERE e.key NOT LIKE 'sa\_%'
    AND jsonb_array_length(coalesce(e.val -> 'damages', '[]'::jsonb)) > 0;

  SELECT count(*) INTO v_mech
  FROM (
    SELECT key, val FROM jsonb_each(coalesce(v_insp.checklist -> 'startup', '{}'::jsonb))
    UNION ALL
    SELECT key, val FROM jsonb_each(coalesce(v_insp.checklist -> 'test_drive', '{}'::jsonb))
  ) s(key, val)
  WHERE s.val ->> 'status' = 'fail';

  -- ------------------------------------------------------------ open tickets
  --
  -- Both ensure_* RPCs return NULL for a car that isn't in inventory, and both
  -- are idempotent, so re-running this on an amended inspection finds the
  -- existing job rather than opening a second one or resetting its age clock.

  IF v_vin6 IS NOT NULL AND v_ext > 0 THEN
    v_bs_job := ensure_body_shop_job(v_vin6, v_event);
    IF v_bs_job IS NOT NULL THEN
      -- Only stamp provenance if the ticket doesn't already name an inspection.
      -- A car that came back for a second job keeps pointing at the inspection
      -- that opened it.
      UPDATE body_shop_jobs
      SET source_inspection_id = coalesce(source_inspection_id, p_inspection_id)
      WHERE id = v_bs_job;
    END IF;
  END IF;

  IF v_vin6 IS NOT NULL AND v_mech > 0 THEN
    v_mech_job := ensure_mechanic_job(v_vin6, v_event, 'inspection');
  END IF;

  -- ------------------------------------------------------------------- lines
  --
  -- One line per failed check. The system and severity below are a STARTING
  -- POINT the mechanic is expected to correct once the car is on the lift — an
  -- inspector reporting "brakes pull left" cannot know whether that's a caliper
  -- or an alignment. Getting a line onto the board with a rough guess beats
  -- getting nothing onto the board with a precise one.
  IF v_mech_job IS NOT NULL THEN
    FOR v_source, v_key, v_val IN
      SELECT 'startup', key, value FROM jsonb_each(coalesce(v_insp.checklist -> 'startup', '{}'::jsonb))
      UNION ALL
      SELECT 'drive',   key, value FROM jsonb_each(coalesce(v_insp.checklist -> 'test_drive', '{}'::jsonb))
    LOOP
      CONTINUE WHEN coalesce(v_val ->> 'status', '') <> 'fail';

      v_note := nullif(btrim(coalesce(v_val ->> 'note', '')), '');

      -- Labels, because the JSON stores only the item id and a mechanic reading
      -- the board should not have to know that 'ride_tires' means the car
      -- shakes on the highway.
      v_desc := CASE v_key
        WHEN 'dash_lights'     THEN 'Warning light on'
        WHEN 'accessories'     THEN 'Accessory not working'
        WHEN 'engine'          THEN 'Engine noise or rough idle'
        WHEN 'drivetrain'      THEN 'Drivetrain — shifting or power'
        WHEN 'brakes_steering' THEN 'Brakes or steering'
        WHEN 'ride_tires'      THEN 'Ride, vibration or tires'
        ELSE initcap(replace(v_key, '_', ' '))
      END;
      IF v_note IS NOT NULL THEN
        v_desc := v_desc || ' — ' || v_note;
      END IF;

      v_system := CASE v_key
        WHEN 'dash_lights'     THEN 'electrical'
        WHEN 'accessories'     THEN 'electrical'
        WHEN 'engine'          THEN 'engine'
        WHEN 'drivetrain'      THEN 'transmission'
        WHEN 'brakes_steering' THEN 'brakes'
        WHEN 'ride_tires'      THEN 'suspension'
        ELSE 'other'
      END;

      -- Anything that stops the car or could strand it starts high; the rest
      -- starts in the middle. Nobody is served by a board where every line is
      -- the same colour.
      v_severity := CASE v_key
        WHEN 'brakes_steering' THEN 'severe'
        WHEN 'engine'          THEN 'severe'
        WHEN 'drivetrain'      THEN 'severe'
        ELSE 'moderate'
      END;

      INSERT INTO mechanic_lines
        (job_id, system, description, severity, status, source_inspection_id, source_key)
      VALUES
        (v_mech_job, v_system, v_desc, v_severity, 'open', p_inspection_id, v_source || ':' || v_key)
      ON CONFLICT (source_inspection_id, source_key)
        WHERE source_inspection_id IS NOT NULL AND source_key IS NOT NULL
      DO UPDATE SET
        description = EXCLUDED.description,
        system      = EXCLUDED.system,
        updated_at  = NOW();
        -- Status and severity are deliberately NOT overwritten. Re-running an
        -- amended inspection must never reopen a repair the mechanic already
        -- closed, nor undo a severity he corrected with the car in front of him.
    END LOOP;
  END IF;

  -- ------------------------------------------------------------- the receipt
  INSERT INTO work_orders (
    inspection_id, stock_number, vin6,
    body_shop_job_id, mechanic_job_id,
    exterior_findings, interior_findings, mechanical_findings, routed_at
  ) VALUES (
    p_inspection_id, v_insp.stock_number, v_vin6,
    v_bs_job, v_mech_job,
    v_ext, v_int, v_mech,
    CASE WHEN v_bs_job IS NOT NULL OR v_mech_job IS NOT NULL THEN v_event END
  )
  ON CONFLICT (inspection_id) DO UPDATE SET
    stock_number        = EXCLUDED.stock_number,
    vin6                = EXCLUDED.vin6,
    body_shop_job_id    = coalesce(work_orders.body_shop_job_id, EXCLUDED.body_shop_job_id),
    mechanic_job_id     = coalesce(work_orders.mechanic_job_id,  EXCLUDED.mechanic_job_id),
    exterior_findings   = EXCLUDED.exterior_findings,
    interior_findings   = EXCLUDED.interior_findings,
    mechanical_findings = EXCLUDED.mechanical_findings,
    routed_at           = coalesce(work_orders.routed_at, EXCLUDED.routed_at),
    updated_at          = NOW()
  RETURNING id INTO v_wo;

  RETURN v_wo;
END;
$$;

REVOKE EXECUTE ON FUNCTION route_inspection_work_order(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION route_inspection_work_order(UUID) TO authenticated, service_role;

-- --------------------------------------------------------------- the trigger
--
-- Fires once, on the transition INTO 'complete'. Guarded three ways: inbound
-- only, complete only, and only when the status actually changed — an edit to a
-- finished inspection's notes must not re-run routing.
--
-- Wrapped so a routing failure can never block someone finishing an inspection
-- on the lot. Losing the ticket is recoverable (re-run the RPC by hand); losing
-- the inspection because a shop table was locked is not.

CREATE OR REPLACE FUNCTION on_inspection_complete_route()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM route_inspection_work_order(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'work order routing failed for inspection %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_inspection_complete_route ON inspections;
CREATE TRIGGER trg_inspection_complete_route
  AFTER UPDATE OF status ON inspections
  FOR EACH ROW
  WHEN (NEW.status = 'complete' AND NEW.type = 'inbound'
        AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION on_inspection_complete_route();

COMMENT ON TABLE work_orders IS
'One row per inbound inspection that has been routed to the shops. Records that
routing happened and what it opened — not a third copy of the findings, which
stay in inspections.checklist and in mechanic_lines.';

NOTIFY pgrst, 'reload schema';
