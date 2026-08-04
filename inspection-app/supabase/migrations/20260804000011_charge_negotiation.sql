-- Charge negotiation: Jorge proposes, you or Omar approve or counter.
--
-- The price on a job stopped being one number the moment it became something
-- two people have to agree on. The flow:
--
--   draft      Jorge hasn't priced it yet
--   proposed   Jorge has named his charge, waiting on you or Omar
--   countered  you came back with a different number (and a reason), waiting on Jorge
--   agreed     both sides on the same number -> this is what gets paid
--
-- Jorge can re-propose after a counter, which puts it back to `proposed` — so
-- it can go round as many times as it needs to and every step is attributed.
--
-- The payout is the AGREED amount minus parts, never the asking price. A job
-- that isn't agreed cannot be paid out at all.
--
-- Separation of duties, deliberately: the person doing the work cannot approve
-- his own charge, and the person approving it isn't the one confirming the cash
-- went out.

-- --------------------------------------------------------------- who is who

-- You and Omar. Admin covers you; give Omar `owner_admin` (or `accounting`).
CREATE OR REPLACE FUNCTION is_charge_approver()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.approval_status = 'approved'
      AND (p.role = 'admin' OR p.roles && ARRAY['owner_admin','accounting'])
  );
$$;

REVOKE EXECUTE ON FUNCTION is_charge_approver() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION is_charge_approver() TO authenticated;

-- Jorge's side.
CREATE OR REPLACE FUNCTION is_shop_manager()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.approval_status = 'approved'
      AND (p.role = 'admin' OR p.roles && ARRAY['body_shop_manager'])
  );
$$;

REVOKE EXECUTE ON FUNCTION is_shop_manager() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION is_shop_manager() TO authenticated;

-- --------------------------------------------------------------- columns

ALTER TABLE body_shop_jobs
  ADD COLUMN IF NOT EXISTS charge_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (charge_status IN ('draft','proposed','countered','agreed')),
  ADD COLUMN IF NOT EXISTS proposed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS counter_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS counter_note   TEXT,
  ADD COLUMN IF NOT EXISTS counter_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS counter_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agreed_amount  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS agreed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agreed_by      UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_body_shop_jobs_charge ON body_shop_jobs (charge_status);

-- Existing priced jobs predate the negotiation and were never disputed: treat
-- them as already agreed at the price on record, so nothing that is already
-- finished suddenly needs re-approving.
UPDATE body_shop_jobs
   SET charge_status = 'agreed',
       agreed_amount = price,
       agreed_at     = COALESCE(completed_at, updated_at, NOW())
 WHERE price IS NOT NULL AND charge_status = 'draft';

-- ---------------------------------------------------------------- the moves

-- Jorge names his charge (or re-names it after a counter).
CREATE OR REPLACE FUNCTION propose_body_shop_charge(p_job_id UUID, p_amount NUMERIC)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (is_shop_manager() OR is_charge_approver()) THEN
    RAISE EXCEPTION 'Only the body shop manager can set the charge';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Enter a charge amount';
  END IF;
  IF EXISTS (SELECT 1 FROM body_shop_jobs WHERE id = p_job_id AND payout_id IS NOT NULL) THEN
    RAISE EXCEPTION 'That car has already been paid out';
  END IF;

  UPDATE body_shop_jobs
     SET price = p_amount,
         charge_status = 'proposed',
         proposed_at = NOW(),
         -- a fresh proposal clears the previous round
         counter_amount = NULL, counter_note = NULL, counter_by = NULL, counter_at = NULL,
         agreed_amount = NULL, agreed_at = NULL, agreed_by = NULL
   WHERE id = p_job_id;
  RETURN FOUND;
END;
$$;

-- You or Omar accept the charge as asked.
CREATE OR REPLACE FUNCTION approve_body_shop_charge(p_job_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_amount NUMERIC;
BEGIN
  IF NOT is_charge_approver() THEN
    RAISE EXCEPTION 'Only an owner can approve a charge';
  END IF;

  SELECT price INTO v_amount FROM body_shop_jobs
   WHERE id = p_job_id AND charge_status = 'proposed' AND payout_id IS NULL;
  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'Nothing proposed to approve on that car';
  END IF;

  UPDATE body_shop_jobs
     SET charge_status = 'agreed', agreed_amount = v_amount,
         agreed_at = NOW(), agreed_by = auth.uid()
   WHERE id = p_job_id;
  RETURN TRUE;
END;
$$;

-- You or Omar come back with a different number and a reason.
CREATE OR REPLACE FUNCTION counter_body_shop_charge(
  p_job_id UUID, p_amount NUMERIC, p_note TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_charge_approver() THEN
    RAISE EXCEPTION 'Only an owner can counter a charge';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Enter your counter amount';
  END IF;
  IF EXISTS (SELECT 1 FROM body_shop_jobs WHERE id = p_job_id AND payout_id IS NOT NULL) THEN
    RAISE EXCEPTION 'That car has already been paid out';
  END IF;

  UPDATE body_shop_jobs
     SET charge_status = 'countered',
         counter_amount = p_amount, counter_note = p_note,
         counter_by = auth.uid(), counter_at = NOW(),
         agreed_amount = NULL, agreed_at = NULL, agreed_by = NULL
   WHERE id = p_job_id AND charge_status IN ('proposed','countered','agreed');
  RETURN FOUND;
END;
$$;

-- Jorge takes the counter.
CREATE OR REPLACE FUNCTION accept_body_shop_counter(p_job_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_amount NUMERIC;
BEGIN
  IF NOT is_shop_manager() THEN
    RAISE EXCEPTION 'Only the body shop manager can accept a counter';
  END IF;

  SELECT counter_amount INTO v_amount FROM body_shop_jobs
   WHERE id = p_job_id AND charge_status = 'countered' AND payout_id IS NULL;
  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'There is no counter to accept on that car';
  END IF;

  UPDATE body_shop_jobs
     SET price = v_amount,
         charge_status = 'agreed', agreed_amount = v_amount,
         agreed_at = NOW(), agreed_by = auth.uid()
   WHERE id = p_job_id;
  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION propose_body_shop_charge(UUID, NUMERIC) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION approve_body_shop_charge(UUID)           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION counter_body_shop_charge(UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION accept_body_shop_counter(UUID)           FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION propose_body_shop_charge(UUID, NUMERIC) TO authenticated;
GRANT  EXECUTE ON FUNCTION approve_body_shop_charge(UUID)           TO authenticated;
GRANT  EXECUTE ON FUNCTION counter_body_shop_charge(UUID, NUMERIC, TEXT) TO authenticated;
GRANT  EXECUTE ON FUNCTION accept_body_shop_counter(UUID)           TO authenticated;

-- ------------------------------------------------- payout uses the AGREED number

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
  -- AGREED minus parts. Not the asking price — an un-agreed job is not payable,
  -- so its payout is NULL and the UI chases it instead of paying it.
  CASE WHEN j.charge_status <> 'agreed' OR j.agreed_amount IS NULL THEN NULL
       ELSE j.agreed_amount - COALESCE(pc.parts_cost, 0) END AS payout,
  j.approved_at, j.approved_by, ap.name AS approved_by_name,
  j.payout_id, j.paid_amount,
  (j.payout_id IS NULL) AS unpaid,
  j.charge_status, j.agreed_amount, j.counter_amount, j.counter_note
FROM body_shop_jobs j
LEFT JOIN inventory i ON i.stock_number = j.stock_number
LEFT JOIN profiles ap ON ap.id = j.approved_by
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(bp.cost), 0) AS parts_cost
  FROM body_shop_parts bp WHERE bp.job_id = j.id
) pc ON TRUE
WHERE j.status = 'done'
  AND is_employee();

REVOKE ALL ON body_shop_payout_lines FROM PUBLIC, anon;
GRANT SELECT ON body_shop_payout_lines TO authenticated;

-- Surface the charge state on the board so "needs your approval" is visible
-- without opening every car. Appended, so CREATE OR REPLACE is legal.
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
  COALESCE(pc.parts_cost, 0)     AS parts_cost,
  j.charge_status, j.agreed_amount, j.counter_amount, j.counter_note,
  cb.name AS counter_by_name,
  j.payout_id IS NOT NULL AS paid, j.paid_amount, j.approved_at
FROM body_shop_jobs j
LEFT JOIN inventory i
  ON (j.stock_number IS NOT NULL AND i.stock_number = j.stock_number)
  OR (j.stock_number IS NULL AND j.vin6 IS NOT NULL
      AND upper(right(i.vehicle_vin, 6)) = upper(j.vin6))
LEFT JOIN profiles p  ON p.id = j.assigned_tech
LEFT JOIN profiles cb ON cb.id = j.counter_by
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

NOTIFY pgrst, 'reload schema';
