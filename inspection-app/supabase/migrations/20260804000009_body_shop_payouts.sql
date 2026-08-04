-- Body shop payouts — the manager collects every Saturday.
--
-- What he's owed on a job is the price MINUS what the parts cost, because he
-- buys the parts. Both numbers are already on the job, so the payout is derived
-- rather than typed — no third place for the money to disagree.
--
-- Week runs Sunday..Saturday and is keyed by the Saturday he collects on.
--
-- Unpaid work ROLLS OVER: a car finished three weeks ago and never collected
-- still shows on this week's payout. Anything else quietly loses him money.
--
-- Accounting signs off per car before it can be collected. That's a separate
-- role from the body shop manager on purpose — the person doing the work
-- shouldn't be the one confirming he gets paid for it.

-- ---------------------------------------------------------- who is accounting

CREATE OR REPLACE FUNCTION is_accounting()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.approval_status = 'approved'
      AND (p.role = 'admin' OR p.roles && ARRAY['accounting','owner_admin'])
  );
$$;

REVOKE EXECUTE ON FUNCTION is_accounting() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION is_accounting() TO authenticated;

-- ---------------------------------------------------------------- payouts

CREATE TABLE IF NOT EXISTS body_shop_payouts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_ending DATE NOT NULL,              -- the Saturday collected on
  total       NUMERIC(10,2) NOT NULL DEFAULT 0,
  job_count   INTEGER NOT NULL DEFAULT 0,
  paid_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_body_shop_payouts_week ON body_shop_payouts (week_ending DESC);

ALTER TABLE body_shop_jobs
  ADD COLUMN IF NOT EXISTS payout_id    UUID REFERENCES body_shop_payouts(id) ON DELETE SET NULL,
  -- The amount is SNAPSHOT at collection. Re-pricing a job or correcting a part
  -- afterwards must never silently rewrite what he was actually handed.
  ADD COLUMN IF NOT EXISTS paid_amount  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by  UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_body_shop_jobs_payout ON body_shop_jobs (payout_id);

-- ---------------------------------------------------------------- the lines
-- Every finished job with what it's worth to him. Sunday..Saturday, keyed by
-- the Saturday. EXTRACT(DOW) is 0=Sunday..6=Saturday, so adding (6 - dow) lands
-- on that week's Saturday.

CREATE OR REPLACE VIEW body_shop_payout_lines AS
SELECT
  j.id,
  j.stock_number,
  j.vin6,
  j.completed_at,
  (j.completed_at::date + (6 - EXTRACT(DOW FROM j.completed_at)::int)) AS week_ending,
  i.vehicle_year, i.vehicle_make, i.vehicle_model,
  j.price,
  COALESCE(pc.parts_cost, 0) AS parts_cost,
  -- What he's owed. NULL price means nobody priced the job — surfaced as NULL so
  -- the UI can chase it rather than silently paying 0.
  CASE WHEN j.price IS NULL THEN NULL
       ELSE j.price - COALESCE(pc.parts_cost, 0) END AS payout,
  j.approved_at, j.approved_by, ap.name AS approved_by_name,
  j.payout_id, j.paid_amount,
  (j.payout_id IS NULL) AS unpaid
FROM body_shop_jobs j
LEFT JOIN inventory i ON i.stock_number = j.stock_number
LEFT JOIN profiles ap ON ap.id = j.approved_by
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(bp.cost), 0) AS parts_cost
  FROM body_shop_parts bp WHERE bp.job_id = j.id
) pc ON TRUE
WHERE j.status = 'done'
  AND is_employee();          -- the view bypasses table RLS; gate it here

REVOKE ALL ON body_shop_payout_lines FROM PUBLIC, anon;
GRANT SELECT ON body_shop_payout_lines TO authenticated;

-- ------------------------------------------------- fix: board was buyer-visible
-- body_shop_board is a plain (non-security_invoker) view, so the is_employee()
-- policies on body_shop_jobs do NOT apply to it — it reads as its owner. Granting
-- SELECT to `authenticated` therefore exposed the whole board, repair prices and
-- all, to marketplace buyers. The same guard the tables got has to be inside the
-- view itself.
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
  COALESCE(pc.parts_cost, 0)     AS parts_cost
FROM body_shop_jobs j
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
) pc ON TRUE
WHERE is_employee();

REVOKE ALL ON body_shop_board FROM PUBLIC, anon;
GRANT SELECT ON body_shop_board TO authenticated;

-- ---------------------------------------------------------------- the tally
-- What he's owed this Saturday: finished this week, plus anything still unpaid
-- from before.

CREATE OR REPLACE FUNCTION body_shop_payout_summary()
RETURNS TABLE (
  week_ending        DATE,
  jobs_this_week     INTEGER,
  amount_this_week   NUMERIC,
  jobs_rollover      INTEGER,
  amount_rollover    NUMERIC,
  jobs_due           INTEGER,
  amount_due         NUMERIC,
  jobs_approved      INTEGER,
  amount_approved    NUMERIC,
  jobs_unpriced      INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH wk AS (
    SELECT (CURRENT_DATE + (6 - EXTRACT(DOW FROM CURRENT_DATE)::int)) AS saturday
  ),
  due AS (
    SELECT l.*, (SELECT saturday FROM wk) AS saturday
    FROM body_shop_payout_lines l
    WHERE l.payout_id IS NULL
  )
  SELECT
    (SELECT saturday FROM wk),
    COUNT(*) FILTER (WHERE week_ending = saturday)::int,
    COALESCE(SUM(payout) FILTER (WHERE week_ending = saturday), 0),
    COUNT(*) FILTER (WHERE week_ending < saturday)::int,
    COALESCE(SUM(payout) FILTER (WHERE week_ending < saturday), 0),
    COUNT(*)::int,
    COALESCE(SUM(payout), 0),
    COUNT(*) FILTER (WHERE approved_at IS NOT NULL)::int,
    COALESCE(SUM(payout) FILTER (WHERE approved_at IS NOT NULL), 0),
    COUNT(*) FILTER (WHERE price IS NULL)::int
  FROM due;
$$;

REVOKE EXECUTE ON FUNCTION body_shop_payout_summary() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION body_shop_payout_summary() TO authenticated;

-- ------------------------------------------------------- accounting sign-off

CREATE OR REPLACE FUNCTION approve_body_shop_job(p_job_id UUID, p_approved BOOLEAN DEFAULT TRUE)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_accounting() THEN
    RAISE EXCEPTION 'Only accounting can confirm a car for payment';
  END IF;
  -- Once collected it's history; confirming or un-confirming it would rewrite
  -- what was already handed over.
  IF EXISTS (SELECT 1 FROM body_shop_jobs WHERE id = p_job_id AND payout_id IS NOT NULL) THEN
    RAISE EXCEPTION 'That car has already been paid out';
  END IF;

  UPDATE body_shop_jobs
     SET approved_at = CASE WHEN p_approved THEN NOW() ELSE NULL END,
         approved_by = CASE WHEN p_approved THEN auth.uid() ELSE NULL END
   WHERE id = p_job_id AND status = 'done';

  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION approve_body_shop_job(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION approve_body_shop_job(UUID, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------- collect

CREATE OR REPLACE FUNCTION collect_body_shop_payout(p_notes TEXT DEFAULT NULL)
RETURNS TABLE (payout_id UUID, job_count INTEGER, total NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id   UUID;
  v_sat  DATE := CURRENT_DATE + (6 - EXTRACT(DOW FROM CURRENT_DATE)::int);
  v_cnt  INTEGER;
  v_tot  NUMERIC;
BEGIN
  IF NOT is_accounting() THEN
    RAISE EXCEPTION 'Only accounting can record a payout';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(payout), 0) INTO v_cnt, v_tot
  FROM body_shop_payout_lines
  WHERE payout_id IS NULL AND approved_at IS NOT NULL AND payout IS NOT NULL;

  IF v_cnt = 0 THEN
    RAISE EXCEPTION 'Nothing confirmed to pay out yet';
  END IF;

  INSERT INTO body_shop_payouts (week_ending, total, job_count, paid_by, notes)
  VALUES (v_sat, v_tot, v_cnt, auth.uid(), p_notes)
  RETURNING id INTO v_id;

  -- Snapshot each line's amount as it stands right now.
  UPDATE body_shop_jobs j
     SET payout_id = v_id,
         paid_amount = l.payout
    FROM body_shop_payout_lines l
   WHERE l.id = j.id
     AND l.payout_id IS NULL
     AND l.approved_at IS NOT NULL
     AND l.payout IS NOT NULL;

  RETURN QUERY SELECT v_id, v_cnt, v_tot;
END;
$$;

REVOKE EXECUTE ON FUNCTION collect_body_shop_payout(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION collect_body_shop_payout(TEXT) TO authenticated;

-- ---------------------------------------------------------------- RLS

ALTER TABLE body_shop_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS body_shop_payouts_read ON body_shop_payouts;
CREATE POLICY body_shop_payouts_read ON body_shop_payouts
  FOR SELECT TO authenticated USING (is_employee());

-- Payout rows are only ever written through collect_body_shop_payout(), which
-- checks is_accounting(). No direct insert/update/delete policy on purpose.

NOTIFY pgrst, 'reload schema';
