-- Body shop: fresh-buy fallback, buyer lockout, and three correctness fixes.
--
-- 1. FRESH BUYS. ensure_body_shop_job() gave up when lookup_vin_by_last6 found
--    nothing, so a car bought at auction and sent straight to the body shop —
--    before Frazer has it — never appeared on the board at all. Its photos were
--    fine (they key on vin6, not inventory), but the job was silently dropped.
--    Jobs can now open with vin6 alone and adopt their stock number later.
--
-- 2. BUYERS ARE AUTHENTICATED USERS. The policies from 20260804000001 said
--    `TO authenticated`, which includes marketplace buyers — external customers
--    with real logins. That let a buyer read the body shop board (repair prices)
--    and, worse, sign car-history URLs: the damage photos of the very cars they
--    are being sold. Gated to staff via is_employee().
--
-- 3. days_in_shop counted to NOW() even for finished jobs, so a car completed in
--    March reads "150 days in shop" forever on the Done tab.
--
-- 4. vehicle_photos() built inspection URLs by stripping a prefix that might not
--    be there, silently emitting a broken path when it wasn't.

-- ---------------------------------------------------------------- who is staff

-- SECURITY DEFINER so policies can consult profiles without recursing through
-- its own RLS. Mirrors the existing is_admin() from 20260706000003.
CREATE OR REPLACE FUNCTION is_employee()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND (
        p.role = 'admin'
        OR (COALESCE(p.account_type, 'employee') = 'employee'
            AND p.approval_status = 'approved')
      )
  );
$$;

GRANT EXECUTE ON FUNCTION is_employee() TO authenticated;

-- ------------------------------------------------------- jobs without a stock #

ALTER TABLE body_shop_jobs ALTER COLUMN stock_number DROP NOT NULL;

-- A car with no stock number yet is identified by its vin6 instead. Same "one
-- open job per car" rule, different key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_body_shop_jobs_one_open_pending
  ON body_shop_jobs (vin6)
  WHERE stock_number IS NULL AND status <> 'done';

-- Adopt stock numbers for pending jobs whose car has since landed in inventory.
-- Safe to run repeatedly; called on every board load.
CREATE OR REPLACE FUNCTION link_pending_body_shop_jobs()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linked INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT j.id, j.vin6, i.stock_number, i.vehicle_vin
    FROM body_shop_jobs j
    JOIN inventory i ON upper(right(i.vehicle_vin, 6)) = upper(j.vin6)
    WHERE j.stock_number IS NULL
      AND j.status <> 'done'
      AND j.vin6 IS NOT NULL
      -- Don't collide with a job that already exists for that stock number;
      -- leave the pending one alone rather than fail the whole sweep.
      AND NOT EXISTS (
        SELECT 1 FROM body_shop_jobs k
        WHERE k.stock_number = i.stock_number AND k.status <> 'done'
      )
  LOOP
    UPDATE body_shop_jobs
    SET stock_number = r.stock_number,
        vin = COALESCE(vin, r.vehicle_vin)
    WHERE id = r.id;
    v_linked := v_linked + 1;
  END LOOP;
  RETURN v_linked;
END;
$$;

GRANT EXECUTE ON FUNCTION link_pending_body_shop_jobs() TO authenticated, service_role;

-- Drop fresh-buy jobs that never turned into a real car.
--
-- A VIN typo in the group opens a job for a car that will never exist, and those
-- would pile up on the board forever. After 7 days without appearing in
-- inventory, an UNTOUCHED one is almost certainly a typo, so it goes.
--
-- "Untouched" is strict on purpose: no price, no notes, no tech, no parts, still
-- in intake, and opened by the bot rather than typed in by a person. The moment
-- the manager puts a price or a part on it, it's real work and this will never
-- delete it — it just keeps showing, which is the signal to go look at it.
-- Nothing of value is lost either way: photos live in car-history keyed by vin6,
-- so they survive the job and reattach if the car ever does show up.
CREATE OR REPLACE FUNCTION purge_stale_pending_body_shop_jobs(p_days INTEGER DEFAULT 7)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  WITH gone AS (
    DELETE FROM body_shop_jobs j
    WHERE j.stock_number IS NULL
      AND j.status = 'intake'
      AND j.source = 'telegram'
      AND j.price IS NULL
      AND j.notes IS NULL
      AND j.assigned_tech IS NULL
      AND j.entered_at < NOW() - (p_days || ' days')::interval
      AND NOT EXISTS (SELECT 1 FROM body_shop_parts bp WHERE bp.job_id = j.id)
      -- Belt and braces: never delete one whose car actually exists. The linker
      -- runs first and should have claimed it, but if that failed this is a real
      -- car and deleting it would hide a car sitting in the shop.
      AND NOT EXISTS (
        SELECT 1 FROM inventory i
        WHERE upper(right(i.vehicle_vin, 6)) = upper(j.vin6)
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM gone;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION purge_stale_pending_body_shop_jobs(INTEGER) TO authenticated, service_role;

-- One call for the board to make on load: adopt what's landed, drop what never
-- will. Same "do it inline, no cron" approach the Telegram photo handshake uses.
CREATE OR REPLACE FUNCTION body_shop_housekeeping()
RETURNS TABLE (linked INTEGER, purged INTEGER)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_employee() THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;
  RETURN QUERY SELECT link_pending_body_shop_jobs(), purge_stale_pending_body_shop_jobs(7);
END;
$$;

GRANT EXECUTE ON FUNCTION body_shop_housekeeping() TO authenticated, service_role;

-- ------------------------------------------------------- intake RPC, rewritten

CREATE OR REPLACE FUNCTION ensure_body_shop_job(p_vin6 TEXT, p_event TIMESTAMPTZ DEFAULT NOW())
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock TEXT;
  v_vin   TEXT;
  v_id    UUID;
BEGIN
  IF p_vin6 IS NULL OR length(p_vin6) < 6 THEN
    RETURN NULL;
  END IF;

  SELECT stock_number, vehicle_vin INTO v_stock, v_vin
  FROM lookup_vin_by_last6(p_vin6) LIMIT 1;

  IF v_stock IS NOT NULL THEN
    -- Known car: an open job for this stock number wins.
    SELECT id INTO v_id FROM body_shop_jobs
    WHERE stock_number = v_stock AND status <> 'done' LIMIT 1;

    IF v_id IS NOT NULL THEN
      UPDATE body_shop_jobs
      SET vin6 = COALESCE(vin6, p_vin6), vin = COALESCE(vin, v_vin)
      WHERE id = v_id;
      RETURN v_id;
    END IF;

    -- It may have been opened as a fresh buy before Frazer had it — adopt that
    -- job (keeping its age, price and parts) instead of starting a second one.
    SELECT id INTO v_id FROM body_shop_jobs
    WHERE stock_number IS NULL AND upper(vin6) = upper(p_vin6) AND status <> 'done'
    LIMIT 1;

    IF v_id IS NOT NULL THEN
      UPDATE body_shop_jobs
      SET stock_number = v_stock, vin = COALESCE(vin, v_vin)
      WHERE id = v_id;
      RETURN v_id;
    END IF;

    INSERT INTO body_shop_jobs (stock_number, vin, vin6, status, entered_at, source)
    VALUES (v_stock, v_vin, p_vin6, 'intake', COALESCE(p_event, NOW()), 'telegram')
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM body_shop_jobs
      WHERE stock_number = v_stock AND status <> 'done' LIMIT 1;
    END IF;
    RETURN v_id;
  END IF;

  -- FRESH BUY: not in inventory yet. Open the job on the vin6 alone; a later
  -- Frazer load links it. This is the case that used to vanish.
  SELECT id INTO v_id FROM body_shop_jobs
  WHERE stock_number IS NULL AND upper(vin6) = upper(p_vin6) AND status <> 'done'
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO body_shop_jobs (stock_number, vin, vin6, status, entered_at, source)
  VALUES (NULL, NULL, p_vin6, 'intake', COALESCE(p_event, NOW()), 'telegram')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM body_shop_jobs
    WHERE stock_number IS NULL AND upper(vin6) = upper(p_vin6) AND status <> 'done'
    LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_body_shop_job(TEXT, TIMESTAMPTZ) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION ensure_body_shop_job(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;

-- ---------------------------------------------------------------- board view

-- DROP first: CREATE OR REPLACE VIEW can only append columns, and this inserts
-- awaiting_inventory ahead of days_in_shop.
DROP VIEW IF EXISTS body_shop_board;

CREATE VIEW body_shop_board AS
SELECT
  j.id, j.stock_number, j.vin, j.vin6, j.status, j.price, j.notes,
  j.assigned_tech, j.entered_at, j.started_at, j.completed_at,
  j.source, j.created_at, j.updated_at,
  i.vehicle_year, i.vehicle_make, i.vehicle_model, i.vehicle_color, i.mileage,
  p.name AS tech_name,
  (j.stock_number IS NULL) AS awaiting_inventory,
  -- A finished job's age is how long it TOOK, not how long ago it started.
  GREATEST(0, (EXTRACT(EPOCH FROM (COALESCE(j.completed_at, NOW()) - j.entered_at)) / 86400)::int)
    AS days_in_shop,
  COALESCE(pc.parts_total, 0)    AS parts_total,
  COALESCE(pc.parts_needed, 0)   AS parts_needed,
  COALESCE(pc.parts_ordered, 0)  AS parts_ordered,
  COALESCE(pc.parts_received, 0) AS parts_received,
  COALESCE(pc.parts_cost, 0)     AS parts_cost
FROM body_shop_jobs j
-- Match on stock number, or on vin6 for a fresh buy that has landed in inventory
-- but not been linked yet — so the card shows the real car immediately.
LEFT JOIN inventory i
  ON (j.stock_number IS NOT NULL AND i.stock_number = j.stock_number)
  OR (j.stock_number IS NULL AND j.vin6 IS NOT NULL
      AND upper(right(i.vehicle_vin, 6)) = upper(j.vin6))
LEFT JOIN profiles p ON p.id = j.assigned_tech
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                                       AS parts_total,
    COUNT(*) FILTER (WHERE bp.status = 'needed')   AS parts_needed,
    COUNT(*) FILTER (WHERE bp.status = 'ordered')  AS parts_ordered,
    COUNT(*) FILTER (WHERE bp.status = 'received') AS parts_received,
    COALESCE(SUM(bp.cost), 0)                      AS parts_cost
  FROM body_shop_parts bp WHERE bp.job_id = j.id
) pc ON TRUE;

REVOKE ALL ON body_shop_board FROM PUBLIC, anon;
GRANT SELECT ON body_shop_board TO authenticated;

-- ------------------------------------------------------- photo API, hardened

CREATE OR REPLACE FUNCTION vehicle_photos(p_vin6 TEXT, p_stock TEXT DEFAULT NULL)
RETURNS TABLE (
  bucket    TEXT,
  path      TEXT,
  source    TEXT,
  station   TEXT,
  is_public BOOLEAN,
  taken_at  TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- Staff only. This is SECURITY DEFINER over the whole photo archive, and a
  -- marketplace buyer must never be able to enumerate (or sign) the car-history
  -- shots of the cars they're shopping.
  SELECT * FROM (
    SELECT
      CASE WHEN w.station IN ('ready','seller') THEN 'wa-photos' ELSE 'car-history' END,
      w.media_path,
      'telegram',
      w.station,
      w.station IN ('ready','seller'),
      w.received_at
    FROM wa_inbound_messages w
    WHERE upper(w.vin6) = upper(p_vin6)
      AND w.media_path IS NOT NULL

    UNION ALL

    SELECT vp.bucket, vp.path, vp.source, NULL, vp.bucket <> 'car-history', vp.created_at
    FROM vehicle_photo_uploads vp
    WHERE upper(vp.vin6) = upper(p_vin6)

    UNION ALL

    SELECT
      'inspection-photos',
      regexp_replace(e.val ->> 'url', '^.*/object/public/inspection-photos/', ''),
      'inspection',
      NULL,
      TRUE,
      i.completed_at
    FROM inspections i
    CROSS JOIN LATERAL jsonb_each(COALESCE(i.checklist -> 'photos', '{}'::jsonb)) AS e(key, val)
    WHERE (e.val ->> 'url') IS NOT NULL
      -- Only rows we can actually turn back into a storage path. Without this a
      -- URL from anywhere else passed through whole and produced a broken image.
      AND (e.val ->> 'url') LIKE '%/object/public/inspection-photos/%'
      AND (
        upper(i.vin_last6) = upper(p_vin6)
        OR upper(right(COALESCE(i.vin, ''), 6)) = upper(p_vin6)
        OR (p_stock IS NOT NULL AND i.stock_number = p_stock)
      )
  ) all_photos
  WHERE is_employee()
  ORDER BY 6 DESC NULLS LAST;
$$;

REVOKE EXECUTE ON FUNCTION vehicle_photos(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION vehicle_photos(TEXT, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------- policies

DROP POLICY IF EXISTS body_shop_jobs_all ON body_shop_jobs;
CREATE POLICY body_shop_jobs_all ON body_shop_jobs
  FOR ALL TO authenticated USING (is_employee()) WITH CHECK (is_employee());

DROP POLICY IF EXISTS body_shop_parts_all ON body_shop_parts;
CREATE POLICY body_shop_parts_all ON body_shop_parts
  FOR ALL TO authenticated USING (is_employee()) WITH CHECK (is_employee());

DROP POLICY IF EXISTS vehicle_photo_uploads_all ON vehicle_photo_uploads;
CREATE POLICY vehicle_photo_uploads_all ON vehicle_photo_uploads
  FOR ALL TO authenticated USING (is_employee()) WITH CHECK (is_employee());

-- car-history holds body shop / mechanic / transport damage photos. Signing a
-- URL requires SELECT here, so this is the control that actually keeps them away
-- from buyers.
DROP POLICY IF EXISTS car_history_read ON storage.objects;
CREATE POLICY car_history_read ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'car-history' AND is_employee());

DROP POLICY IF EXISTS car_history_write ON storage.objects;
CREATE POLICY car_history_write ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'car-history' AND is_employee());

DROP POLICY IF EXISTS car_history_update ON storage.objects;
CREATE POLICY car_history_update ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'car-history' AND is_employee());

DROP POLICY IF EXISTS car_history_delete ON storage.objects;
CREATE POLICY car_history_delete ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'car-history' AND is_employee());

NOTIFY pgrst, 'reload schema';
