-- Follow-up to 20260807000002: take the ON CONFLICT inference out of the
-- name-only add.
--
-- That path used
--
--   ON CONFLICT (lower(name)) WHERE phone10 IS NULL AND claimed_at IS NULL
--
-- which asks Postgres to match a partial index on an expression. It is legal,
-- but it resolves at RUN time inside a plpgsql body — so "add a tech" is the
-- first thing that would ever find out if the inference didn't line up with
-- idx_bs_tech_invites_open_name, and adding a tech is not a good place to
-- discover that. The update-then-insert below means the same thing with nothing
-- to infer; the unique index still backs it.
--
-- Everything else is identical to 20260807000002.

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

    IF v_closed = 0 THEN
      INSERT INTO body_shop_tech_invites (phone10, phone, name, invited_by, claimed_by, claimed_at)
      VALUES (v_phone10, p_phone, v_name, auth.uid(), v_profile, NOW());
    END IF;
    RETURN 'linked';
  END IF;

  -- ---- name only: on the roster, assignable, no account to wait on. Adding the
  -- same name twice is a no-op rather than a second man in the dropdown.
  IF v_phone10 IS NULL THEN
    UPDATE body_shop_tech_invites
       SET invited_by = auth.uid()
     WHERE claimed_at IS NULL AND phone10 IS NULL AND lower(name) = lower(v_name);
    IF NOT FOUND THEN
      INSERT INTO body_shop_tech_invites (phone10, phone, name, invited_by)
      VALUES (NULL, NULL, v_name, auth.uid());
    END IF;
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

REVOKE EXECUTE ON FUNCTION add_body_shop_tech(TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION add_body_shop_tech(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
