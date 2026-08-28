-- Mechanic shop management
--
-- The body shop's twin, with one structural difference that changes everything
-- downstream: a mechanic job is a LIST OF PROBLEMS, not a single price.
--
-- Jorge quotes one number for a car and gets paid that number, so body_shop_jobs
-- carries `price` and a payout pipeline. The mechanics are hourly, so there is
-- no per-job money here at all — what we need instead is to know WHICH repairs a
-- car is waiting on, because "at the mechanic" tells you nothing about whether
-- the car is one alignment or three weeks from the front line.
--
-- Hence mechanic_lines. One row per problem, each with its own status, its own
-- parts, and a pointer back to the inspection finding that raised it. Per-car
-- cost is the sum of its parts; labor is overhead and is deliberately not
-- tracked per car.
--
-- Keyed by stock_number like every other vehicle overlay table, and we ALSO
-- store vin/vin6 for the same reason the body shop does: `inventory` is
-- TRUNCATEd and reloaded by the Frazer pipeline and Frazer reuses stock numbers,
-- while vin6 is what ties a job to its Telegram photos.

-- ---------------------------------------------------------------- jobs

CREATE TABLE IF NOT EXISTS mechanic_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_number   TEXT NOT NULL,
  vin            TEXT,
  vin6           TEXT,
  status         TEXT NOT NULL DEFAULT 'intake'
                 CHECK (status IN ('intake','diagnosing','waiting_parts','in_progress','on_hold','done')),
  assigned_tech  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes          TEXT,

  -- The age clock. Stamped with the TELEGRAM MESSAGE TIME, not now() — same rule
  -- as vehicle_locations.location_updated_at and body_shop_jobs.entered_at.
  -- Never bumped after creation, so "days in shop" stays honest.
  entered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at     TIMESTAMPTZ,
  held_at        TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,

  source         TEXT NOT NULL DEFAULT 'manual',   -- 'telegram' | 'manual' | 'inspection' | 'backfill'
  created_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One OPEN job per car, exactly as the body shop does it. A second Telegram post
-- about the same car is a no-op rather than a duplicate card. on_hold counts as
-- open here too — a car parked because the customer hasn't decided must not grow
-- a second card when someone posts it again.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mechanic_jobs_one_open
  ON mechanic_jobs (stock_number) WHERE status <> 'done';

CREATE INDEX IF NOT EXISTS idx_mechanic_jobs_status  ON mechanic_jobs (status);
CREATE INDEX IF NOT EXISTS idx_mechanic_jobs_tech    ON mechanic_jobs (assigned_tech);
CREATE INDEX IF NOT EXISTS idx_mechanic_jobs_entered ON mechanic_jobs (entered_at);
CREATE INDEX IF NOT EXISTS idx_mechanic_jobs_vin6    ON mechanic_jobs (vin6);

-- ---------------------------------------------------------------- lines
--
-- The unit of work. `system` and `severity` use the vocabulary the inbound
-- inspection was designed around, so that when a finding becomes a line the
-- router copies values rather than translating them — a translation table is one
-- more place for a finding to get silently dropped.
--
-- `declined` is a real outcome and not a failure: plenty of findings on a
-- wholesale car are correctly left alone. It is separated from `done` so that
-- "what did we actually fix" and "what did we knowingly ship" stay different
-- questions.

CREATE TABLE IF NOT EXISTS mechanic_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES mechanic_jobs(id) ON DELETE CASCADE,

  system        TEXT CHECK (system IN ('engine','transmission','suspension','brakes',
                                       'electrical','hvac','exhaust','cooling','fuel','other')),
  description   TEXT NOT NULL,
  severity      TEXT CHECK (severity IN ('minor','moderate','severe','critical')),

  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','in_progress','waiting_parts','done','declined')),

  est_cost      NUMERIC(10,2),
  assigned_tech UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes         TEXT,

  -- Where this line came from. NULL for a line a mechanic added himself once the
  -- car was on the lift, which is most of the interesting ones.
  --
  -- Points at the INSPECTION, not at a normalized findings table. The obvious
  -- target would be mechanical_issues, but that table does not exist in this
  -- database — 20260520000001_inbound_inspection_enhancements.sql was written
  -- and never pushed, which is also why /inbound and /inbound/:id/mechanical
  -- throw. The finding really lives in inspections.checklist (the v:2 JSON), so
  -- provenance is the inspection plus a stable key for the finding inside it.
  -- That keeps this module standing on its own rather than on a fix that hasn't
  -- happened yet.
  source_inspection_id UUID REFERENCES inspections(id) ON DELETE SET NULL,
  source_key           TEXT,

  opened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mechanic_lines_job    ON mechanic_lines (job_id);
CREATE INDEX IF NOT EXISTS idx_mechanic_lines_status ON mechanic_lines (status);

-- Idempotency for the work order router. One inspection finding produces exactly
-- ONE line, ever — so re-running or amending an inbound inspection updates the
-- line it already made instead of littering the job with duplicates. This is the
-- index the router's ON CONFLICT clause targets.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mechanic_lines_one_per_finding
  ON mechanic_lines (source_inspection_id, source_key)
  WHERE source_inspection_id IS NOT NULL AND source_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mechanic_lines_inspection
  ON mechanic_lines (source_inspection_id) WHERE source_inspection_id IS NOT NULL;

-- ---------------------------------------------------------------- parts
--
-- Mirrors body_shop_parts so PartsToOrder can read both with one shape, plus a
-- nullable line_id: a water pump belongs to the water pump line, but a box of
-- shop rags belongs to the job. Nullable rather than required because forcing
-- every part onto a line would push people to invent lines for consumables.

CREATE TABLE IF NOT EXISTS mechanic_parts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID NOT NULL REFERENCES mechanic_jobs(id) ON DELETE CASCADE,
  line_id     UUID REFERENCES mechanic_lines(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'needed'
              CHECK (status IN ('needed','ordered','received')),
  cost        NUMERIC(10,2),
  vendor      TEXT,
  part_number TEXT,
  source_url  TEXT,          -- what the buyer actually clicked, for the next guy
  eta         DATE,
  ordered_at  TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  ordered_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mechanic_parts_job  ON mechanic_parts (job_id);
CREATE INDEX IF NOT EXISTS idx_mechanic_parts_line ON mechanic_parts (line_id);

-- ---------------------------------------------------------------- timestamps

CREATE OR REPLACE FUNCTION touch_mechanic_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mechanic_jobs_touch ON mechanic_jobs;
CREATE TRIGGER trg_mechanic_jobs_touch BEFORE UPDATE ON mechanic_jobs
  FOR EACH ROW EXECUTE FUNCTION touch_mechanic_updated_at();

DROP TRIGGER IF EXISTS trg_mechanic_lines_touch ON mechanic_lines;
CREATE TRIGGER trg_mechanic_lines_touch BEFORE UPDATE ON mechanic_lines
  FOR EACH ROW EXECUTE FUNCTION touch_mechanic_updated_at();

DROP TRIGGER IF EXISTS trg_mechanic_parts_touch ON mechanic_parts;
CREATE TRIGGER trg_mechanic_parts_touch BEFORE UPDATE ON mechanic_parts
  FOR EACH ROW EXECUTE FUNCTION touch_mechanic_updated_at();

-- Lifecycle stamps driven off the status change, so the UI never has to remember
-- to send them. Same shape as stamp_body_shop_job_status().
CREATE OR REPLACE FUNCTION stamp_mechanic_job_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'in_progress' AND NEW.started_at IS NULL THEN
      NEW.started_at := NOW();
    END IF;
    -- Stamped on the way in, cleared on the way out: a car put back on hold next
    -- month gets a fresh hold date rather than the first one.
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

DROP TRIGGER IF EXISTS trg_mechanic_jobs_status ON mechanic_jobs;
CREATE TRIGGER trg_mechanic_jobs_status BEFORE UPDATE ON mechanic_jobs
  FOR EACH ROW EXECUTE FUNCTION stamp_mechanic_job_status();

CREATE OR REPLACE FUNCTION stamp_mechanic_line_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'in_progress' AND NEW.started_at IS NULL THEN
      NEW.started_at := NOW();
    END IF;
    -- A declined line is finished too — we decided, and the decision has a date.
    IF NEW.status IN ('done','declined') THEN
      NEW.completed_at := COALESCE(NEW.completed_at, NOW());
    ELSE
      NEW.completed_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mechanic_lines_status ON mechanic_lines;
CREATE TRIGGER trg_mechanic_lines_status BEFORE UPDATE ON mechanic_lines
  FOR EACH ROW EXECUTE FUNCTION stamp_mechanic_line_status();

CREATE OR REPLACE FUNCTION stamp_mechanic_part_status()
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

DROP TRIGGER IF EXISTS trg_mechanic_parts_status ON mechanic_parts;
CREATE TRIGGER trg_mechanic_parts_status BEFORE UPDATE ON mechanic_parts
  FOR EACH ROW EXECUTE FUNCTION stamp_mechanic_part_status();

-- --------------------------------------------------- the job follows its lines
--
-- The rule that makes lines worth having: a mechanic job is done when its work
-- is done, and its work is the lines. A tech closing the last line shouldn't
-- also have to remember to close the job — that second step is exactly what
-- doesn't happen on a busy afternoon, and a board full of finished cars still
-- showing as open is a board nobody trusts.
--
-- Only fires on the LAST line closing, and only for a job that is actually
-- running. A held job is left alone for the same reason the body shop leaves
-- one alone: on_hold is a decision a person made, and no automation gets to
-- quietly undo it.
CREATE OR REPLACE FUNCTION close_mechanic_job_when_lines_done()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_open INT;
BEGIN
  IF NEW.status NOT IN ('done','declined') THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO v_open
  FROM mechanic_lines
  WHERE job_id = NEW.job_id AND status NOT IN ('done','declined');

  IF v_open = 0 THEN
    UPDATE mechanic_jobs
    SET status = 'done'
    WHERE id = NEW.job_id AND status NOT IN ('done','on_hold');
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_mechanic_lines_close_job ON mechanic_lines;
CREATE TRIGGER trg_mechanic_lines_close_job AFTER UPDATE OF status ON mechanic_lines
  FOR EACH ROW EXECUTE FUNCTION close_mechanic_job_when_lines_done();

-- ---------------------------------------------------------------- board view
--
-- One row per job with everything a card needs. days_owned is the headline for
-- the same reason it is on the body shop board: money is lost by the day we own
-- a car, not by the day it sits at the mechanic, so a car dropped off this
-- morning that we bought in June belongs at the TOP of the list.
--
-- The line rollup is what this board has and the body shop's doesn't. lines_open
-- is the number that answers "how far is this car from the front line", and
-- blocked_on_parts is the one that says whose fault the wait is.
--
-- WHERE is_employee() because this view is not security_invoker — it reads
-- `inventory` directly, so without the gate a signed-in BUYER could select it.
-- Same reasoning and same shape as body_shop_board.

DROP VIEW IF EXISTS mechanic_board;

CREATE VIEW mechanic_board AS
SELECT
  j.id, j.stock_number, j.vin, j.vin6, j.status, j.notes,
  j.assigned_tech, j.entered_at, j.started_at, j.completed_at, j.held_at,
  j.source, j.created_at, j.updated_at,
  i.vehicle_year, i.vehicle_make, i.vehicle_model, i.vehicle_color, i.mileage,
  p.name AS tech_name,
  (i.stock_number IS NULL) AS awaiting_inventory,

  GREATEST(0, (EXTRACT(EPOCH FROM (COALESCE(j.completed_at, NOW()) - j.entered_at)) / 86400)::int)
    AS days_in_shop,

  -- purchase_date first, days_on_lot second — purchase_date is a fact that
  -- doesn't age, days_on_lot is a snapshot that reads short the moment the
  -- Frazer export is a day old. NULL when the car isn't in inventory at all
  -- (a fresh buy Frazer hasn't seen); the board falls back to days_in_shop.
  GREATEST(0, COALESCE(
    (NOW()::date - frazer_date(i.purchase_date)),
    frazer_num(i.days_on_lot)::int
  )) AS days_owned,

  COALESCE(lc.lines_total, 0)     AS lines_total,
  COALESCE(lc.lines_open, 0)      AS lines_open,
  COALESCE(lc.lines_done, 0)      AS lines_done,
  COALESCE(lc.lines_declined, 0)  AS lines_declined,
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
    COUNT(*)                                                   AS lines_total,
    COUNT(*) FILTER (WHERE ml.status NOT IN ('done','declined')) AS lines_open,
    COUNT(*) FILTER (WHERE ml.status = 'done')                 AS lines_done,
    COUNT(*) FILTER (WHERE ml.status = 'declined')             AS lines_declined,
    COUNT(*) FILTER (WHERE ml.status = 'waiting_parts')        AS blocked_on_parts,
    -- The car's headline problem, for the card. Ordered by how bad it is, not
    -- by when it was raised.
    (ARRAY_AGG(ml.severity ORDER BY
       CASE ml.severity WHEN 'critical' THEN 0 WHEN 'severe' THEN 1
                        WHEN 'moderate' THEN 2 WHEN 'minor' THEN 3 ELSE 4 END)
     FILTER (WHERE ml.status NOT IN ('done','declined')))[1]   AS worst_severity
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

-- ---------------------------------------------------------------- intake RPC
--
-- Called by the Telegram webhook when a VIN shows up in the mechanic group, and
-- by the work order router when an inbound inspection finds mechanical problems.
-- SECURITY DEFINER so it can read `inventory`. Idempotent: an already-open job
-- is returned untouched, so re-posting the same car never resets its age clock
-- or spawns a duplicate card.

CREATE OR REPLACE FUNCTION ensure_mechanic_job(
  p_vin6   TEXT,
  p_event  TIMESTAMPTZ DEFAULT NOW(),
  p_source TEXT DEFAULT 'telegram'
)
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

  SELECT id INTO v_id FROM mechanic_jobs
  WHERE stock_number = v_stock AND status <> 'done' LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- Backfill vin6 if the job was created by hand without one, so the photo
    -- lookup starts working.
    UPDATE mechanic_jobs SET vin6 = COALESCE(vin6, p_vin6), vin = COALESCE(vin, v_vin)
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO mechanic_jobs (stock_number, vin, vin6, status, entered_at, source)
  VALUES (v_stock, v_vin, p_vin6, 'intake', COALESCE(p_event, NOW()), COALESCE(p_source, 'telegram'))
  ON CONFLICT DO NOTHING           -- lost a race with a concurrent webhook
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM mechanic_jobs
    WHERE stock_number = v_stock AND status <> 'done' LIMIT 1;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION ensure_mechanic_job(TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION ensure_mechanic_job(TEXT, TIMESTAMPTZ, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------- close RPC
--
-- Fired by the Telegram mechanic-out group: the car has left the shop, so
-- whatever was still open on it is finished by definition. Closing the job
-- without closing its lines would leave a done car permanently "waiting on
-- brakes", which is worse than no lines at all — so the lines close with it.
--
-- A HELD job is skipped, exactly as close_body_shop_job() skips one. on_hold is
-- a person's decision that this car isn't being worked; a junk car pushed around
-- the back of the lot must not come back stamped as repaired.

CREATE OR REPLACE FUNCTION close_mechanic_job(
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
  v_done    TIMESTAMPTZ;
BEGIN
  v_stock := nullif(btrim(coalesce(p_stock, '')), '');
  IF v_stock IS NULL AND p_vin6 IS NOT NULL THEN
    SELECT stock_number INTO v_stock FROM lookup_vin_by_last6(p_vin6) LIMIT 1;
  END IF;

  SELECT id, entered_at INTO v_id, v_entered
  FROM mechanic_jobs
  WHERE status NOT IN ('done', 'on_hold')
    AND (
      (v_stock IS NOT NULL AND stock_number = v_stock)
      OR (p_vin6 IS NOT NULL AND upper(COALESCE(vin6, '')) = upper(p_vin6))
    )
  ORDER BY entered_at ASC
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN NULL;   -- never went to the mechanic, already closed, or on hold
  END IF;

  -- The event time, not now(), so "days in shop" measures the real stay even
  -- when a webhook is retried hours later — but never EARLIER than it arrived.
  v_done := GREATEST(COALESCE(p_event, NOW()), v_entered);

  -- Lines first: the job's own status trigger doesn't cascade, and the line
  -- trigger only ever closes a job, never reopens one, so ordering is safe.
  UPDATE mechanic_lines
  SET status = 'done', completed_at = COALESCE(completed_at, v_done)
  WHERE job_id = v_id AND status NOT IN ('done','declined');

  UPDATE mechanic_jobs
  SET status = 'done', completed_at = v_done
  WHERE id = v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION close_mechanic_job(TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION close_mechanic_job(TEXT, TIMESTAMPTZ, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------- RLS
-- Matches the rest of this app: any signed-in employee can read and write.
-- Who sees WHICH cars is enforced in the UI, same as everywhere else here.

ALTER TABLE mechanic_jobs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mechanic_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE mechanic_parts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mechanic_jobs_all ON mechanic_jobs;
CREATE POLICY mechanic_jobs_all ON mechanic_jobs
  FOR ALL TO authenticated USING (is_employee()) WITH CHECK (is_employee());

DROP POLICY IF EXISTS mechanic_lines_all ON mechanic_lines;
CREATE POLICY mechanic_lines_all ON mechanic_lines
  FOR ALL TO authenticated USING (is_employee()) WITH CHECK (is_employee());

DROP POLICY IF EXISTS mechanic_parts_all ON mechanic_parts;
CREATE POLICY mechanic_parts_all ON mechanic_parts
  FOR ALL TO authenticated USING (is_employee()) WITH CHECK (is_employee());

-- ---------------------------------------------------------------- backfill
-- Seed the board with the cars ALREADY at the mechanic, so it isn't empty on day
-- one and nobody has to re-post cars sitting there now.
--
-- ONLY 'mechanic'. Inventory's LOCATION_LABELS prints both 'mechanic' and
-- 'mechanic_section' as "Mechanic", which makes them look like the jorge/
-- body_shop pair — they are not. 'mechanic' is the 22 cars at the mechanic;
-- 'mechanic_section' is the 173 parked in the Mechanic Line on the lot, waiting
-- and not being worked. Opening a job for all 195 would bury the 22 that matter
-- and reproduce exactly the problem on_hold was invented to fix on the body shop
-- board. A queued car gets a job when someone actually starts it.
--
-- Source is vehicle_locations, not the Telegram archive: it's the settled answer
-- for where a car is, and it survives the Frazer truncate-reload. entered_at
-- comes from location_updated_at — the real arrival time, not now() — so the age
-- clock is honest the moment the board opens. Cars no longer in inventory are
-- skipped: they're sold or long gone.
--
-- No lines are created here. A backfilled car's problems live in someone's head
-- or in a text message, and inventing lines we can't source would put fiction on
-- the board. They get lines when someone opens the card.

INSERT INTO mechanic_jobs (stock_number, vin, vin6, status, entered_at, source)
SELECT
  vl.stock_number,
  COALESCE(NULLIF(vl.vin, ''), i.vehicle_vin),
  upper(right(COALESCE(NULLIF(vl.vin, ''), i.vehicle_vin, ''), 6)),
  'intake',
  COALESCE(vl.location_updated_at, NOW()),
  'backfill'
FROM vehicle_locations vl
JOIN inventory i ON i.stock_number = vl.stock_number
WHERE vl.physical_location = 'mechanic'
  AND length(COALESCE(NULLIF(vl.vin, ''), i.vehicle_vin, '')) >= 6
ON CONFLICT DO NOTHING;   -- the partial unique index keeps this re-runnable

COMMENT ON TABLE mechanic_lines IS
'One repair per row. Most arrive from an inbound inspection, identified by
(source_inspection_id, source_key) — unique, so re-running an inspection updates
its lines rather than duplicating them; the rest are added by whoever put the car
on the lift. A job is done when its lines are.';

COMMENT ON COLUMN mechanic_parts.line_id IS
'Which repair this part is for. NULL for consumables and anything bought for the
car as a whole rather than for one specific job on it.';

NOTIFY pgrst, 'reload schema';
