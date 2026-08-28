-- Fix: the mechanical-findings count referenced a column that doesn't exist.
--
-- jsonb_each() returns (key, value). The exterior and interior counts alias it
-- as e(key, val) and so read e.val correctly, but the mechanical count unions
-- two un-aliased selects and asked for `val` inside them — `SELECT key, val
-- FROM jsonb_each(...)` — which is a 42703 at runtime, not at creation, because
-- plpgsql only plans a statement the first time it executes.
--
-- The trigger swallows routing errors by design (finishing an inspection on the
-- lot must never fail because a shop table was busy), so this failed silently:
-- every inbound inspection would have completed normally and opened nothing.
-- Caught by a rollback test against prod before any real inspection hit it.
--
-- Only the one subquery changes; the rest is the original function verbatim.

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
  v_event := coalesce(v_insp.completed_at, NOW());

  -- Panels whose key starts with 'sa_' are skipped throughout: those are the
  -- LISTING flow's free-text disclosure rows, written when a car is listed —
  -- months after arrival, usually after the work was already done. Routing them
  -- would re-open repairs we have already paid for.
  SELECT count(*) INTO v_ext
  FROM jsonb_each(coalesce(v_insp.checklist -> 'exterior', '{}'::jsonb)) e(key, val)
  WHERE e.key NOT LIKE 'sa\_%'
    AND jsonb_array_length(coalesce(e.val -> 'damages', '[]'::jsonb)) > 0;

  SELECT count(*) INTO v_int
  FROM jsonb_each(coalesce(v_insp.checklist -> 'interior', '{}'::jsonb)) e(key, val)
  WHERE e.key NOT LIKE 'sa\_%'
    AND jsonb_array_length(coalesce(e.val -> 'damages', '[]'::jsonb)) > 0;

  -- THE FIX: `value`, the column jsonb_each actually returns.
  SELECT count(*) INTO v_mech
  FROM (
    SELECT key, value FROM jsonb_each(coalesce(v_insp.checklist -> 'startup', '{}'::jsonb))
    UNION ALL
    SELECT key, value FROM jsonb_each(coalesce(v_insp.checklist -> 'test_drive', '{}'::jsonb))
  ) s(key, val)
  WHERE s.val ->> 'status' = 'fail';

  IF v_vin6 IS NOT NULL AND v_ext > 0 THEN
    v_bs_job := ensure_body_shop_job(v_vin6, v_event);
    IF v_bs_job IS NOT NULL THEN
      UPDATE body_shop_jobs
      SET source_inspection_id = coalesce(source_inspection_id, p_inspection_id)
      WHERE id = v_bs_job;
    END IF;
  END IF;

  IF v_vin6 IS NOT NULL AND v_mech > 0 THEN
    v_mech_job := ensure_mechanic_job(v_vin6, v_event, 'inspection');
  END IF;

  -- One line per failed check. The system and severity are a STARTING POINT the
  -- mechanic corrects with the car on the lift — an inspector reporting "brakes
  -- pull left" cannot know whether that's a caliper or an alignment. A line on
  -- the board with a rough guess beats nothing on the board with a precise one.
  IF v_mech_job IS NOT NULL THEN
    FOR v_source, v_key, v_val IN
      SELECT 'startup', key, value FROM jsonb_each(coalesce(v_insp.checklist -> 'startup', '{}'::jsonb))
      UNION ALL
      SELECT 'drive',   key, value FROM jsonb_each(coalesce(v_insp.checklist -> 'test_drive', '{}'::jsonb))
    LOOP
      CONTINUE WHEN coalesce(v_val ->> 'status', '') <> 'fail';

      v_note := nullif(btrim(coalesce(v_val ->> 'note', '')), '');

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
        -- Status and severity are deliberately NOT overwritten: re-running an
        -- amended inspection must never reopen a repair the mechanic closed,
        -- nor undo a severity he corrected with the car in front of him.
    END LOOP;
  END IF;

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

NOTIFY pgrst, 'reload schema';
