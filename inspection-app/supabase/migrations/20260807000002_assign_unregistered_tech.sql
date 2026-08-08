-- Body Shop: assign a car to a man who has never opened the app.
--
-- 20260806000002 let Jorge ADD a tech before that tech signed in, but the car
-- still couldn't be put on him: body_shop_jobs.assigned_tech is a profiles FK,
-- and an invited man has no profile until he logs in. So the dropdown showed
-- only the guys who happened to have accounts, and the rest of the shop — the
-- ones who will never install anything — could not be given a car at all.
--
-- Now the roster is the dropdown. A job points at EITHER a profile
-- (assigned_tech) or a roster entry (assigned_tech_invite), never both, and the
-- board reads the name from whichever is set. When that man does sign in, the
-- claim moves every car already on his name onto his account, so nothing has to
-- be reassigned by hand.
--
-- The phone number is optional from here on. It is the only thing that can ever
-- link a roster name to an account, so it's still worth having — but a name with
-- no number is a perfectly good place to put a car, which is what the shop
-- actually needs. If the number is added later, the same roster row picks it up
-- and the cars follow.

-- ---------------------------------------------------------------- roster

-- Name-only entries have no number to match on.
ALTER TABLE body_shop_tech_invites ALTER COLUMN phone10 DROP NOT NULL;

-- The open-invite uniqueness above is on phone10, and NULLs don't collide there,
-- so name-only rows need their own guard or "add Miguel" twice makes two Miguels
-- in the dropdown.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bs_tech_invites_open_name
  ON body_shop_tech_invites (lower(name))
  WHERE phone10 IS NULL AND claimed_at IS NULL;

-- ---------------------------------------------------------------- assignment

ALTER TABLE body_shop_jobs
  ADD COLUMN IF NOT EXISTS assigned_tech_invite UUID
    REFERENCES body_shop_tech_invites(id) ON DELETE SET NULL;

-- One tech per car. Withdrawing a roster entry clears the assignment (FK above)
-- rather than leaving a car pointing at a name that no longer exists.
ALTER TABLE body_shop_jobs DROP CONSTRAINT IF EXISTS body_shop_jobs_one_tech;
ALTER TABLE body_shop_jobs ADD CONSTRAINT body_shop_jobs_one_tech
  CHECK (assigned_tech IS NULL OR assigned_tech_invite IS NULL);

CREATE INDEX IF NOT EXISTS idx_body_shop_jobs_tech_invite
  ON body_shop_jobs (assigned_tech_invite);

-- ---------------------------------------------------------------- add

-- 'linked'  the number already has an account — the role is granted now
-- 'invited' a number nobody has signed in with yet — the next sign-in claims it
-- 'added'   a name with no number — assignable now, claimable if a number lands
CREATE OR REPLACE FUNCTION add_body_shop_tech(p_name TEXT, p_phone TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_phone10 TEXT := norm_phone10(p_phone);
  v_name    TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_profile UUID;
  v_closed  INT := 0;
BEGIN
  IF NOT (is_shop_manager() OR is_charge_approver()) THEN
    RAISE EXCEPTION 'Only the body shop manager can add a tech';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Enter the tech''s name';
  END IF;
  -- Blank is a deliberate name-only add; half a number is a typo, and letting it
  -- through would create a roster row that can never be claimed.
  IF btrim(COALESCE(p_phone, '')) <> '' AND COALESCE(length(v_phone10), 0) <> 10 THEN
    RAISE EXCEPTION 'Enter a 10-digit phone number, or leave it blank';
  END IF;

  IF v_phone10 IS NOT NULL THEN
    SELECT id INTO v_profile FROM profiles
     WHERE norm_phone10(phone) = v_phone10
     ORDER BY created_at LIMIT 1;
  END IF;

  -- ---- he already has an account: grant the role outright
  IF v_profile IS NOT NULL THEN
    UPDATE profiles
       SET roles = (SELECT array_agg(DISTINCT r)
                      FROM unnest(array_append(COALESCE(roles, '{}'::TEXT[]), 'body_shop_tech')) AS r),
           name  = COALESCE(NULLIF(btrim(name), ''), v_name),
           account_type    = COALESCE(account_type, 'employee'),
           setup_complete  = TRUE,
           approval_status = 'approved'
     WHERE id = v_profile;

    -- Cars already sitting on his roster name move onto the account. Done BEFORE
    -- the invites are closed, while they still match.
    UPDATE body_shop_jobs
       SET assigned_tech = v_profile, assigned_tech_invite = NULL
     WHERE assigned_tech_invite IN (
       SELECT id FROM body_shop_tech_invites
        WHERE claimed_at IS NULL
          AND (phone10 = v_phone10 OR (phone10 IS NULL AND lower(name) = lower(v_name))));

    UPDATE body_shop_tech_invites
       SET claimed_by = v_profile, claimed_at = NOW()
     WHERE claimed_at IS NULL
       AND (phone10 = v_phone10 OR (phone10 IS NULL AND lower(name) = lower(v_name)));
    GET DIAGNOSTICS v_closed = ROW_COUNT;

    -- Only write a record row if there wasn't already one to close, so the
    -- roster keeps one line per hire instead of two.
    IF v_closed = 0 THEN
      INSERT INTO body_shop_tech_invites (phone10, phone, name, invited_by, claimed_by, claimed_at)
      VALUES (v_phone10, p_phone, v_name, auth.uid(), v_profile, NOW());
    END IF;
    RETURN 'linked';
  END IF;

  -- ---- name only: on the roster, assignable, no account to wait on
  IF v_phone10 IS NULL THEN
    INSERT INTO body_shop_tech_invites (phone10, phone, name, invited_by)
    VALUES (NULL, NULL, v_name, auth.uid())
    ON CONFLICT (lower(name)) WHERE phone10 IS NULL AND claimed_at IS NULL
    DO UPDATE SET invited_by = EXCLUDED.invited_by;
    RETURN 'added';
  END IF;

  -- ---- a number, nobody by it yet. If he's already on the roster by name, fold
  -- the number into that row so the cars on it stay on it.
  UPDATE body_shop_tech_invites t
     SET phone10 = v_phone10, phone = p_phone, invited_by = auth.uid()
   WHERE t.claimed_at IS NULL AND t.phone10 IS NULL AND lower(t.name) = lower(v_name)
     AND NOT EXISTS (SELECT 1 FROM body_shop_tech_invites x
                      WHERE x.claimed_at IS NULL AND x.phone10 = v_phone10);
  IF FOUND THEN RETURN 'invited'; END IF;

  INSERT INTO body_shop_tech_invites (phone10, phone, name, invited_by)
  VALUES (v_phone10, p_phone, v_name, auth.uid())
  ON CONFLICT (phone10) WHERE claimed_at IS NULL
  DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, invited_by = EXCLUDED.invited_by;
  RETURN 'invited';
END;
$$;

-- The signature is still (TEXT, TEXT) — the DEFAULT only means PostgREST may
-- call it with p_name alone — so this stays a replace, not a second overload.

-- ---------------------------------------------------------------- claim

-- Unchanged from 20260806000006 except for the job hand-off: the cars assigned to
-- the roster entry become cars assigned to the account, in the same transaction
-- that grants the role.
CREATE OR REPLACE FUNCTION claim_body_shop_tech_invite()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_phone10 TEXT;
  v_invite  body_shop_tech_invites%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN FALSE; END IF;

  SELECT norm_phone10(u.phone) INTO v_phone10 FROM auth.users u WHERE u.id = v_uid;
  IF v_phone10 IS NULL THEN
    SELECT norm_phone10(p.phone) INTO v_phone10 FROM profiles p WHERE p.id = v_uid;
  END IF;
  IF v_phone10 IS NULL THEN RETURN FALSE; END IF;

  SELECT * INTO v_invite FROM body_shop_tech_invites
   WHERE phone10 = v_phone10 AND claimed_at IS NULL
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  UPDATE profiles
     SET roles = (SELECT array_agg(DISTINCT r)
                    FROM unnest(array_append(COALESCE(roles, '{}'::TEXT[]), 'body_shop_tech')) AS r),
         name  = COALESCE(NULLIF(btrim(name), ''), v_invite.name),
         phone = COALESCE(phone, v_invite.phone),
         account_type    = COALESCE(account_type, 'employee'),
         setup_complete  = TRUE,
         approval_status = 'approved'
   WHERE id = v_uid;

  UPDATE body_shop_jobs
     SET assigned_tech = v_uid, assigned_tech_invite = NULL
   WHERE assigned_tech_invite = v_invite.id;

  UPDATE body_shop_tech_invites
     SET claimed_by = v_uid, claimed_at = NOW()
   WHERE id = v_invite.id;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION add_body_shop_tech(TEXT, TEXT)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION claim_body_shop_tech_invite()   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION add_body_shop_tech(TEXT, TEXT)  TO authenticated;
GRANT  EXECUTE ON FUNCTION claim_body_shop_tech_invite()   TO authenticated;

-- ---------------------------------------------------------------- housekeeping

-- The stale-pending purge reads assigned_tech as "somebody has touched this car,
-- leave it alone". A roster assignment is exactly that, so it has to count too —
-- otherwise a car Jorge put on a man with no account gets deleted from under him
-- after 7 days. Identical to 20260804000005 apart from that one line.
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
      AND j.assigned_tech_invite IS NULL
      AND j.entered_at < NOW() - (p_days || ' days')::interval
      AND NOT EXISTS (SELECT 1 FROM body_shop_parts bp WHERE bp.job_id = j.id)
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

REVOKE EXECUTE ON FUNCTION purge_stale_pending_body_shop_jobs(INTEGER) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION purge_stale_pending_body_shop_jobs(INTEGER) TO authenticated, service_role;

-- ---------------------------------------------------------------- board

-- tech_name now comes from whichever side the car is assigned to. The roster
-- join is what lets a tech-scoped board and the job screen show a name for a man
-- with no account. assigned_tech_invite is appended last, which is what keeps
-- CREATE OR REPLACE legal on the existing view.
CREATE OR REPLACE VIEW body_shop_board AS
SELECT
  j.id, j.stock_number, j.vin, j.vin6, j.status, j.price, j.notes,
  j.assigned_tech, j.entered_at, j.started_at, j.completed_at,
  j.source, j.created_at, j.updated_at,
  i.vehicle_year, i.vehicle_make, i.vehicle_model, i.vehicle_color, i.mileage,
  COALESCE(p.name, ti.name) AS tech_name,
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
  j.payout_id IS NOT NULL AS paid, j.paid_amount, j.approved_at,
  j.counter_at,
  j.agreed_at,
  ab.name AS agreed_by_name,
  j.final_check_at,
  j.assigned_tech_invite
FROM body_shop_jobs j
LEFT JOIN inventory i
  ON (j.stock_number IS NOT NULL AND i.stock_number = j.stock_number)
  OR (j.stock_number IS NULL AND j.vin6 IS NOT NULL
      AND upper(right(i.vehicle_vin, 6)) = upper(j.vin6))
LEFT JOIN profiles p  ON p.id = j.assigned_tech
LEFT JOIN body_shop_tech_invites ti ON ti.id = j.assigned_tech_invite
LEFT JOIN profiles cb ON cb.id = j.counter_by
LEFT JOIN profiles ab ON ab.id = j.agreed_by
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
