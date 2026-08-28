-- Two things that close the loop: a sign-off, and a way to know if any of this
-- worked.
--
-- SIGN-OFF. A mechanic job can currently be marked done with lines still open
-- and with nobody ever having said "that's everything I found". The point of
-- the whole rebuild is that a car gets fixed in ONE visit, and the failure mode
-- it replaces is a car going back on the lot with something still wrong. So
-- finishing a job in the app now records who looked and said it was complete.
--
-- Deliberately NOT enforced on close_mechanic_job(). That RPC fires when a car
-- physically leaves the shop — a fact, not a claim — and blocking it would mean
-- a car sitting on the wash line still showing as at the mechanic. The sign-off
-- is a statement a person makes; the Telegram close is an event that happened.
--
-- MISS RATE. mechanic_lines already distinguishes the two populations without
-- any new column: source_inspection_id is set when the work order router
-- created the line from an inspection finding, and null when someone added it
-- later with the car on the lift. That second number is the one that matters —
-- it is what the inspector did not catch.
--
-- Honest about the proxy: a null source also covers a line a manager typed in
-- for another reason, so this is "found after the inspection", not strictly
-- "the inspector missed it". Over many cars the trend is still the answer to
-- "is the new form working", which is the question worth asking.

ALTER TABLE mechanic_jobs
  ADD COLUMN IF NOT EXISTS signed_off_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_off_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN mechanic_jobs.signed_off_at IS
'When somebody stated that everything wrong with this car was on the job. Set
from the app when a tech finishes; never set by close_mechanic_job(), which
records a car leaving rather than a person''s judgement.';

-- --------------------------------------------------------------- per car

DROP VIEW IF EXISTS mechanic_job_miss_rate;

CREATE VIEW mechanic_job_miss_rate AS
SELECT
  j.id            AS job_id,
  j.stock_number,
  j.vin6,
  j.entered_at,
  j.completed_at,
  j.signed_off_at,
  count(l.id)                                                    AS lines_total,
  count(l.id) FILTER (WHERE l.source_inspection_id IS NOT NULL)   AS from_inspection,
  count(l.id) FILTER (WHERE l.source_inspection_id IS NULL)       AS found_at_shop,
  -- Null rather than zero for a car with no lines at all: "nothing was found"
  -- and "nobody looked" must not read the same on a chart.
  CASE WHEN count(l.id) > 0
       THEN round(100.0 * count(l.id) FILTER (WHERE l.source_inspection_id IS NULL)
                  / count(l.id))
  END                                                            AS found_at_shop_pct
FROM mechanic_jobs j
LEFT JOIN mechanic_lines l ON l.job_id = j.id
WHERE is_employee()
GROUP BY j.id, j.stock_number, j.vin6, j.entered_at, j.completed_at, j.signed_off_at;

REVOKE ALL ON mechanic_job_miss_rate FROM PUBLIC, anon;
GRANT SELECT ON mechanic_job_miss_rate TO authenticated;

-- ------------------------------------------------------------- by month
-- The trend is the deliverable. One car proves nothing; the question is whether
-- the share of work discovered only at the shop is falling now that the
-- inspection form can hold what the inspector found.
--
-- Only cars whose lines came from an inspection at all are counted — a job
-- opened straight from the Telegram group with everything typed by the mechanic
-- has a 100% "found at shop" rate by construction and would drown the signal.

DROP VIEW IF EXISTS mechanic_miss_rate_by_month;

CREATE VIEW mechanic_miss_rate_by_month AS
SELECT
  date_trunc('month', j.entered_at)::date                        AS month,
  count(DISTINCT j.id)                                           AS cars,
  count(l.id)                                                    AS lines_total,
  count(l.id) FILTER (WHERE l.source_inspection_id IS NOT NULL)   AS from_inspection,
  count(l.id) FILTER (WHERE l.source_inspection_id IS NULL)       AS found_at_shop,
  CASE WHEN count(l.id) > 0
       THEN round(100.0 * count(l.id) FILTER (WHERE l.source_inspection_id IS NULL)
                  / count(l.id))
  END                                                            AS found_at_shop_pct
FROM mechanic_jobs j
JOIN mechanic_lines l ON l.job_id = j.id
WHERE is_employee()
  AND EXISTS (
    SELECT 1 FROM mechanic_lines x
    WHERE x.job_id = j.id AND x.source_inspection_id IS NOT NULL
  )
GROUP BY 1
ORDER BY 1 DESC;

REVOKE ALL ON mechanic_miss_rate_by_month FROM PUBLIC, anon;
GRANT SELECT ON mechanic_miss_rate_by_month TO authenticated;

NOTIFY pgrst, 'reload schema';
