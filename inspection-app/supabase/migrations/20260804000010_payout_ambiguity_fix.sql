-- Fix ambiguous column references in the payout functions.
--
-- RETURNS TABLE (payout_id ..., job_count ..., total ...) puts those names in
-- scope as OUT variables, so an unqualified `WHERE payout_id IS NULL` inside the
-- body is ambiguous between the variable and body_shop_payout_lines.payout_id.
-- Postgres raised "column reference payout_id is ambiguous" at runtime.
--
-- Caught because a test asserting that collecting BEFORE accounting confirms
-- should fail... did fail, but on this error rather than on the guard. A guard
-- that is never actually exercised is not a guard, so both are re-tested below.
--
-- Fix: alias the view and qualify every reference. Same treatment for the
-- summary, which had the same latent collision on `week_ending`.

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
    SELECT l.week_ending AS we, l.payout AS amt, l.approved_at AS appr, l.price AS pr,
           (SELECT saturday FROM wk) AS sat
    FROM body_shop_payout_lines l
    WHERE l.payout_id IS NULL
  )
  SELECT
    (SELECT wk.saturday FROM wk),
    COUNT(*) FILTER (WHERE d.we = d.sat)::int,
    COALESCE(SUM(d.amt) FILTER (WHERE d.we = d.sat), 0),
    COUNT(*) FILTER (WHERE d.we < d.sat)::int,
    COALESCE(SUM(d.amt) FILTER (WHERE d.we < d.sat), 0),
    COUNT(*)::int,
    COALESCE(SUM(d.amt), 0),
    COUNT(*) FILTER (WHERE d.appr IS NOT NULL)::int,
    COALESCE(SUM(d.amt) FILTER (WHERE d.appr IS NOT NULL), 0),
    COUNT(*) FILTER (WHERE d.pr IS NULL)::int
  FROM due d;
$$;

REVOKE EXECUTE ON FUNCTION body_shop_payout_summary() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION body_shop_payout_summary() TO authenticated;

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

  SELECT COUNT(*), COALESCE(SUM(l.payout), 0) INTO v_cnt, v_tot
  FROM body_shop_payout_lines l
  WHERE l.payout_id IS NULL AND l.approved_at IS NOT NULL AND l.payout IS NOT NULL;

  IF v_cnt = 0 THEN
    RAISE EXCEPTION 'Nothing confirmed to pay out yet';
  END IF;

  INSERT INTO body_shop_payouts (week_ending, total, job_count, paid_by, notes)
  VALUES (v_sat, v_tot, v_cnt, auth.uid(), p_notes)
  RETURNING id INTO v_id;

  -- Snapshot each line's amount as it stands right now, so re-pricing a job or
  -- correcting a part later can never rewrite what he was actually handed.
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

NOTIFY pgrst, 'reload schema';
