-- Body Shop management
--
-- A car lands in the body shop from the Telegram body_shop group: a worker posts
-- the last 6 of the VIN + photos, the webhook moves the car's physical_location
-- and (now) opens a job here automatically. The manager then prices it, lists the
-- parts he needs, and assigns a tech.
--
-- Keyed by stock_number like every other vehicle overlay table, and we ALSO store
-- vin/vin6 because `inventory` is TRUNCATEd and reloaded by the Frazer pipeline
-- and Frazer reuses stock numbers. vin6 is what ties a job to its Telegram photos
-- (car-history bucket, path `<vin6>/<sha256>.jpg`).

-- ---------------------------------------------------------------- jobs

CREATE TABLE IF NOT EXISTS body_shop_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_number   TEXT NOT NULL,
  vin            TEXT,
  vin6           TEXT,
  status         TEXT NOT NULL DEFAULT 'intake'
                 CHECK (status IN ('intake','in_progress','waiting_parts','done')),
  price          NUMERIC(10,2),           -- one price for the whole job
  assigned_tech  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes          TEXT,

  -- The age clock. Stamped with the TELEGRAM MESSAGE TIME, not now() — same rule
  -- as vehicle_locations.location_updated_at. Never bumped after creation, so
  -- "days in shop" stays honest even if the job is edited.
  entered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,

  source         TEXT NOT NULL DEFAULT 'manual',   -- 'telegram' | 'manual'
  created_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One OPEN job per car. A second Telegram post about the same car is a no-op
-- rather than a duplicate card; once the job is done, the car coming back in
-- legitimately opens a fresh job with a fresh age clock.
CREATE UNIQUE INDEX IF NOT EXISTS idx_body_shop_jobs_one_open
  ON body_shop_jobs (stock_number) WHERE status <> 'done';

CREATE INDEX IF NOT EXISTS idx_body_shop_jobs_status  ON body_shop_jobs (status);
CREATE INDEX IF NOT EXISTS idx_body_shop_jobs_tech    ON body_shop_jobs (assigned_tech);
CREATE INDEX IF NOT EXISTS idx_body_shop_jobs_entered ON body_shop_jobs (entered_at);
CREATE INDEX IF NOT EXISTS idx_body_shop_jobs_vin6    ON body_shop_jobs (vin6);

-- ---------------------------------------------------------------- parts

CREATE TABLE IF NOT EXISTS body_shop_parts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID NOT NULL REFERENCES body_shop_jobs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'needed'
              CHECK (status IN ('needed','ordered','received')),
  cost        NUMERIC(10,2),
  vendor      TEXT,
  eta         DATE,
  ordered_at  TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_body_shop_parts_job ON body_shop_parts (job_id);

-- ---------------------------------------------------------------- photos
-- Photos belong to the CAR, not to the body shop job. The body shop is just one
-- consumer — it asks for a car's photos the same way the car history screen
-- does. Nothing is ever copied between the two, so a photo exists once.
--
-- Telegram photos are already indexed by the intake pipeline (wa_inbound_messages
-- carries vin6 + station + received_at + media_path), and inspection photos are
-- already on inspections.checklist. This table is only for photos shot inside
-- the app that neither of those covers. vehicle_photos() below unions all three.

CREATE TABLE IF NOT EXISTS vehicle_photo_uploads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin6         TEXT NOT NULL,             -- what ties a photo to a car everywhere here
  stock_number TEXT,
  vin          TEXT,
  bucket       TEXT NOT NULL DEFAULT 'car-history',
  path         TEXT NOT NULL UNIQUE,      -- one row per stored object
  source       TEXT NOT NULL DEFAULT 'app',
  caption      TEXT,
  created_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_photo_uploads_vin6  ON vehicle_photo_uploads (vin6);
CREATE INDEX IF NOT EXISTS idx_vehicle_photo_uploads_stock ON vehicle_photo_uploads (stock_number);

-- ---------------------------------------------------------------- timestamps

CREATE OR REPLACE FUNCTION touch_body_shop_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_body_shop_jobs_touch ON body_shop_jobs;
CREATE TRIGGER trg_body_shop_jobs_touch BEFORE UPDATE ON body_shop_jobs
  FOR EACH ROW EXECUTE FUNCTION touch_body_shop_updated_at();

DROP TRIGGER IF EXISTS trg_body_shop_parts_touch ON body_shop_parts;
CREATE TRIGGER trg_body_shop_parts_touch BEFORE UPDATE ON body_shop_parts
  FOR EACH ROW EXECUTE FUNCTION touch_body_shop_updated_at();

-- Stamp the lifecycle timestamps from the status change so the UI never has to
-- remember to send them.
CREATE OR REPLACE FUNCTION stamp_body_shop_job_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'in_progress' AND NEW.started_at IS NULL THEN
      NEW.started_at := NOW();
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

DROP TRIGGER IF EXISTS trg_body_shop_jobs_status ON body_shop_jobs;
CREATE TRIGGER trg_body_shop_jobs_status BEFORE UPDATE ON body_shop_jobs
  FOR EACH ROW EXECUTE FUNCTION stamp_body_shop_job_status();

-- Ordered/received timestamps for parts, same idea.
CREATE OR REPLACE FUNCTION stamp_body_shop_part_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'ordered'  AND NEW.ordered_at  IS NULL THEN NEW.ordered_at  := NOW(); END IF;
    IF NEW.status = 'received' THEN
      NEW.ordered_at  := COALESCE(NEW.ordered_at, NOW());
      NEW.received_at := COALESCE(NEW.received_at, NOW());
    ELSE
      NEW.received_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_body_shop_parts_status ON body_shop_parts;
CREATE TRIGGER trg_body_shop_parts_status BEFORE UPDATE ON body_shop_parts
  FOR EACH ROW EXECUTE FUNCTION stamp_body_shop_part_status();

-- ---------------------------------------------------------------- board view
-- One row per job with everything a card needs: the car, its age, the tech's
-- name, and the parts rollup. Not security_invoker, so it can read `inventory`
-- (which is only reachable through SECURITY DEFINER RPCs otherwise) — same
-- pattern as list_all_inventory().

CREATE OR REPLACE VIEW body_shop_board AS
SELECT
  j.id, j.stock_number, j.vin, j.vin6, j.status, j.price, j.notes,
  j.assigned_tech, j.entered_at, j.started_at, j.completed_at,
  j.source, j.created_at, j.updated_at,
  i.vehicle_year, i.vehicle_make, i.vehicle_model, i.vehicle_color, i.mileage,
  p.name AS tech_name,
  GREATEST(0, (EXTRACT(EPOCH FROM (NOW() - j.entered_at)) / 86400)::int) AS days_in_shop,
  COALESCE(pc.parts_total, 0)    AS parts_total,
  COALESCE(pc.parts_needed, 0)   AS parts_needed,
  COALESCE(pc.parts_ordered, 0)  AS parts_ordered,
  COALESCE(pc.parts_received, 0) AS parts_received,
  COALESCE(pc.parts_cost, 0)     AS parts_cost
FROM body_shop_jobs j
LEFT JOIN inventory i ON i.stock_number = j.stock_number
LEFT JOIN profiles  p ON p.id = j.assigned_tech
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                                                  AS parts_total,
    COUNT(*) FILTER (WHERE bp.status = 'needed')              AS parts_needed,
    COUNT(*) FILTER (WHERE bp.status = 'ordered')             AS parts_ordered,
    COUNT(*) FILTER (WHERE bp.status = 'received')            AS parts_received,
    COALESCE(SUM(bp.cost), 0)                                 AS parts_cost
  FROM body_shop_parts bp WHERE bp.job_id = j.id
) pc ON TRUE;

GRANT SELECT ON body_shop_board TO anon, authenticated;

-- ---------------------------------------------------------------- intake RPC
-- Called by the Telegram webhook when a VIN shows up in the body_shop group.
-- SECURITY DEFINER so it can read `inventory`. Idempotent: an already-open job
-- is returned untouched, so re-posting the same car never resets its age clock
-- or spawns a duplicate card.

CREATE OR REPLACE FUNCTION ensure_body_shop_job(p_vin6 TEXT, p_event TIMESTAMPTZ DEFAULT NOW())
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock TEXT;
  v_vin   TEXT;
  v_id    UUID;
BEGIN
  SELECT stock_number, vehicle_vin INTO v_stock, v_vin
  FROM lookup_vin_by_last6(p_vin6) LIMIT 1;

  IF v_stock IS NULL THEN
    RETURN NULL;   -- car isn't in inventory; nothing to open a job against
  END IF;

  SELECT id INTO v_id FROM body_shop_jobs
  WHERE stock_number = v_stock AND status <> 'done' LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- Backfill vin6 if the job was created by hand without one, so the photo
    -- lookup starts working.
    UPDATE body_shop_jobs SET vin6 = COALESCE(vin6, p_vin6), vin = COALESCE(vin, v_vin)
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO body_shop_jobs (stock_number, vin, vin6, status, entered_at, source)
  VALUES (v_stock, v_vin, p_vin6, 'intake', COALESCE(p_event, NOW()), 'telegram')
  ON CONFLICT DO NOTHING           -- lost a race with a concurrent webhook
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM body_shop_jobs
    WHERE stock_number = v_stock AND status <> 'done' LIMIT 1;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_body_shop_job(TEXT, TIMESTAMPTZ) TO anon, authenticated, service_role;

-- ------------------------------------------------------- car-level photo API
-- Every photo we hold for one car, newest first, whatever put it there:
--   telegram   — what the crews posted (body shop, mechanic, transport, intake)
--   app        — shot inside the app (vehicle_photos)
--   inspection — the inspection flow's checklist photos
--
-- Returns the bucket and path rather than a URL, because car-history is PRIVATE
-- and must stay that way (it must never feed the marketplace). The caller mints
-- signed URLs for is_public = false and builds a plain public URL otherwise.
--
-- SECURITY DEFINER so one call answers for any car without depending on the RLS
-- of wa_inbound_messages / inspections — same reasoning as vehicle_media().

CREATE OR REPLACE FUNCTION vehicle_photos(p_vin6 TEXT, p_stock TEXT DEFAULT NULL)
RETURNS TABLE (
  bucket    TEXT,
  path      TEXT,
  source    TEXT,     -- 'telegram' | 'app' | 'inspection'
  station   TEXT,     -- telegram only: body_shop | mechanic | transport | ready | seller
  is_public BOOLEAN,
  taken_at  TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- What the crews sent over Telegram.
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

  -- Shot inside the app.
  SELECT vp.bucket, vp.path, vp.source, NULL, vp.bucket <> 'car-history', vp.created_at
  FROM vehicle_photo_uploads vp
  WHERE upper(vp.vin6) = upper(p_vin6)

  UNION ALL

  -- The inspection flow's checklist photos. Stored as a public URL, so the path
  -- is recovered by trimming the public prefix off it.
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
    AND (
      upper(i.vin_last6) = upper(p_vin6)
      OR upper(right(COALESCE(i.vin, ''), 6)) = upper(p_vin6)
      OR (p_stock IS NOT NULL AND i.stock_number = p_stock)
    )

  ORDER BY 6 DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION vehicle_photos(TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------- RLS
-- Matches the rest of this app: any signed-in employee can read and write.
-- Who sees WHICH cars (a tech sees only his own) is enforced in the UI, same as
-- everywhere else here — see the security-debt note in the approval-gate work.

ALTER TABLE body_shop_jobs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE body_shop_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_photo_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS body_shop_jobs_all ON body_shop_jobs;
CREATE POLICY body_shop_jobs_all ON body_shop_jobs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS body_shop_parts_all ON body_shop_parts;
CREATE POLICY body_shop_parts_all ON body_shop_parts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS vehicle_photo_uploads_all ON vehicle_photo_uploads;
CREATE POLICY vehicle_photo_uploads_all ON vehicle_photo_uploads
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- The Telegram webhook writes with the service key (bypasses RLS), but the
-- ensure_body_shop_job RPC is SECURITY DEFINER anyway.

-- ---------------------------------------------------------------- storage
-- car-history stays PRIVATE (it must never feed the marketplace). Signed URLs
-- are minted per read. Signed-URL creation and uploads both need these.

DROP POLICY IF EXISTS car_history_read ON storage.objects;
CREATE POLICY car_history_read ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'car-history');

DROP POLICY IF EXISTS car_history_write ON storage.objects;
CREATE POLICY car_history_write ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'car-history');

DROP POLICY IF EXISTS car_history_update ON storage.objects;
CREATE POLICY car_history_update ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'car-history');

DROP POLICY IF EXISTS car_history_delete ON storage.objects;
CREATE POLICY car_history_delete ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'car-history');

-- ---------------------------------------------------------------- backfill
-- Seed the board with the cars that are ALREADY at the body shop, so it isn't
-- empty on day one and nobody has to re-post cars that are sitting there now.
--
-- Source is vehicle_locations, not the Telegram archive: it's the settled answer
-- for where a car is (newest-event-time wins, fed by Telegram + lot scans +
-- manual edits alike), and it survives the Frazer truncate-reload that
-- `inventory` goes through.
--
-- 'jorge' IS the body shop — one physical place, two codes. The Inventory page
-- already collapses them (canonicalLoc), so we must too or we'd miss ~14 cars.
--
-- entered_at comes from location_updated_at — the real time the car arrived, not
-- now() — so the age clock is honest the moment the board opens. Cars no longer
-- in inventory are skipped: they're sold or long gone.

INSERT INTO body_shop_jobs (stock_number, vin, vin6, status, entered_at, source)
SELECT
  vl.stock_number,
  COALESCE(NULLIF(vl.vin, ''), i.vehicle_vin),
  upper(right(COALESCE(NULLIF(vl.vin, ''), i.vehicle_vin, ''), 6)),
  'intake',
  COALESCE(vl.location_updated_at, NOW()),
  'backfill'
FROM vehicle_locations vl
JOIN inventory i ON i.stock_number = vl.stock_number
WHERE vl.physical_location IN ('body_shop', 'jorge')
  AND length(COALESCE(NULLIF(vl.vin, ''), i.vehicle_vin, '')) >= 6
ON CONFLICT DO NOTHING;   -- the partial unique index keeps this re-runnable

NOTIFY pgrst, 'reload schema';
