-- The router now reads FINDINGS, so one problem is one line.
--
-- Until now a failed check produced exactly one mechanic line, because a check
-- held exactly one note. That was the whole bug: three drivetrain problems
-- reached the tech as one line saying "drivetrain — hard shift", and the other
-- two were gone. The inspection form now records a list per check, so the
-- router has to fan that list out.
--
-- Each finding carries its own system, severity and the label of the check it
-- came from, all captured by the person who drove the car. The router no longer
-- guesses any of it — the CASE mapping that used to infer a system from the
-- check id survives only as the fallback for legacy rows written before this.
--
-- source_key becomes '<section>:<check>:<finding id>' so re-running an amended
-- inspection still updates each line in place rather than duplicating it.

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
  v_rec       RECORD;
  v_desc      TEXT;
BEGIN
  SELECT id, type, status, vin, vin_last6, stock_number, checklist, completed_at
    INTO v_insp
  FROM inspections WHERE id = p_inspection_id;

  IF NOT FOUND OR v_insp.type <> 'inbound' THEN
    RETURN NULL;
  END IF;

  v_vin6  := upper(nullif(btrim(coalesce(v_insp.vin_last6, right(coalesce(v_insp.vin,''), 6))), ''));
  v_event := coalesce(v_insp.completed_at, NOW());

  -- Keys starting 'sa_' are the LISTING flow's disclosure rows, written when a
  -- car is listed — long after arrival, usually after the work was already paid
  -- for. Routing them would reopen finished repairs.
  SELECT count(*) INTO v_ext
  FROM jsonb_each(coalesce(v_insp.checklist -> 'exterior', '{}'::jsonb)) e(key, val)
  WHERE e.key NOT LIKE 'sa\_%'
    AND jsonb_array_length(coalesce(e.val -> 'damages', '[]'::jsonb)) > 0;

  SELECT count(*) INTO v_int
  FROM jsonb_each(coalesce(v_insp.checklist -> 'interior', '{}'::jsonb)) e(key, val)
  WHERE e.key NOT LIKE 'sa\_%'
    AND jsonb_array_length(coalesce(e.val -> 'damages', '[]'::jsonb)) > 0;

  -- Everything mechanically wrong with the car, one row each, from all three
  -- sources: the new findings lists, the legacy one-note-per-check rows, and
  -- the free-form "anything else" bucket.
  CREATE TEMP TABLE IF NOT EXISTS _wo_findings (
    source_key TEXT, descr TEXT, sys TEXT, sev TEXT
  ) ON COMMIT DROP;
  DELETE FROM _wo_findings;

  INSERT INTO _wo_findings (source_key, descr, sys, sev)
  WITH secs AS (
    SELECT 'startup'::text AS sec, key AS check_id, value AS entry
      FROM jsonb_each(coalesce(v_insp.checklist -> 'startup', '{}'::jsonb))
    UNION ALL
    SELECT 'drive', key, value
      FROM jsonb_each(coalesce(v_insp.checklist -> 'test_drive', '{}'::jsonb))
  ),
  raw AS (
    -- Current shape: a list of findings under a check.
    SELECT
      s.sec || ':' || s.check_id || ':' || coalesce(f.value ->> 'id', md5(f.value::text)) AS source_key,
      nullif(btrim(coalesce(f.value ->> 'check_label', '') ||
             CASE WHEN coalesce(f.value ->> 'check_label','') <> '' THEN ' — ' ELSE '' END ||
             coalesce(f.value ->> 'description', '')), '')                                AS descr,
      coalesce(f.value ->> 'system', 'other')                                             AS sys,
      coalesce(f.value ->> 'severity', 'moderate')                                        AS sev
    FROM secs s
    CROSS JOIN LATERAL jsonb_array_elements(s.entry -> 'findings') f(value)
    WHERE jsonb_typeof(s.entry -> 'findings') = 'array'

    UNION ALL

    -- Legacy shape: a failed check with a single note and no findings list.
    -- Kept so inspections finished before this migration still route.
    SELECT
      s.sec || ':' || s.check_id,
      coalesce(nullif(btrim(s.entry ->> 'note'), ''), initcap(replace(s.check_id, '_', ' '))),
      CASE s.check_id
        WHEN 'dash_lights' THEN 'electrical' WHEN 'accessories' THEN 'electrical'
        WHEN 'engine' THEN 'engine'          WHEN 'drivetrain' THEN 'transmission'
        WHEN 'brakes_steering' THEN 'brakes' WHEN 'ride_tires' THEN 'suspension'
        ELSE 'other' END,
      CASE s.check_id
        WHEN 'brakes_steering' THEN 'severe' WHEN 'engine' THEN 'severe'
        WHEN 'drivetrain' THEN 'severe'      ELSE 'moderate' END
    FROM secs s
    WHERE s.entry ->> 'status' = 'fail'
      AND jsonb_typeof(s.entry -> 'findings') IS DISTINCT FROM 'array'

    UNION ALL

    -- The "anything else" bucket: whatever the checks never thought to ask.
    SELECT
      'other:' || coalesce(f.value ->> 'id', md5(f.value::text)),
      nullif(btrim(coalesce(f.value ->> 'description', '')), ''),
      coalesce(f.value ->> 'system', 'other'),
      coalesce(f.value ->> 'severity', 'moderate')
    FROM jsonb_array_elements(
           coalesce(v_insp.checklist -> 'other' -> 'findings', '[]'::jsonb)) f(value)
  )
  SELECT
    source_key,
    descr,
    -- Coerce to the vocabularies mechanic_lines actually accepts. A finding
    -- written by a future client with an unknown system must land on the board
    -- as 'other', never fail the whole routing on a CHECK violation.
    CASE WHEN sys IN ('engine','transmission','suspension','brakes','electrical',
                      'hvac','exhaust','cooling','fuel','other') THEN sys ELSE 'other' END,
    CASE WHEN sev IN ('minor','moderate','severe','critical') THEN sev ELSE 'moderate' END
  FROM raw
  WHERE coalesce(btrim(descr), '') <> '';

  SELECT count(*) INTO v_mech FROM _wo_findings;

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

  IF v_mech_job IS NOT NULL THEN
    FOR v_rec IN SELECT * FROM _wo_findings LOOP
      v_desc := left(v_rec.descr, 500);

      INSERT INTO mechanic_lines
        (job_id, system, description, severity, status, source_inspection_id, source_key)
      VALUES
        (v_mech_job, v_rec.sys, v_desc, v_rec.sev, 'open', p_inspection_id, v_rec.source_key)
      ON CONFLICT (source_inspection_id, source_key)
        WHERE source_inspection_id IS NOT NULL AND source_key IS NOT NULL
      DO UPDATE SET
        description = EXCLUDED.description,
        system      = EXCLUDED.system,
        updated_at  = NOW();
        -- Status and severity stay as the mechanic left them: re-running an
        -- amended inspection must never reopen a repair he has closed, nor undo
        -- a severity he corrected with the car in front of him.
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
