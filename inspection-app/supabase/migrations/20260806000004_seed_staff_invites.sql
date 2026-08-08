-- Seed the two accounts that need to exist before anyone can log in and make them.
--
-- 1. App Review — Apple's reviewer. The app is phone-OTP gated, so a reviewer with
--    no US phone cannot get in, and "we couldn't sign in" is an automatic
--    Guideline 2.1 rejection. Supabase's Test OTP config maps +1 555 555 0100 to a
--    fixed code with no SMS ever sent (verified against the live auth endpoint).
--    Signing in is only half of it though: that account already exists and sits at
--    approval_status='pending', so today the reviewer would land on the pending
--    screen and get no further. This whitelists it so the claim approves it.
--
-- 2. Jorge Breve — body shop manager.
--
-- allowed_users.role is constrained to ('admin','inspector'), and body_shop_manager
-- is not a `role` at all — it lives in profiles.roles, the TEXT[] the body shop
-- policies test with `roles && ARRAY[...]`. So the whitelist grows an extra_roles
-- column and claim_staff_invite merges it, rather than bending the role check.

ALTER TABLE allowed_users ADD COLUMN IF NOT EXISTS extra_roles TEXT[];

-- Re-created (not ALTERed) to fold in extra_roles. Body identical to
-- 20260806000003 apart from the roles merge — see that migration for the
-- security reasoning, in particular why a whitelist row may never grant admin.
CREATE OR REPLACE FUNCTION claim_staff_invite()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_phone10 TEXT;
  v_row     allowed_users%ROWTYPE;
  v_role    TEXT;
BEGIN
  IF v_uid IS NULL THEN RETURN FALSE; END IF;

  SELECT norm_phone10(u.phone) INTO v_phone10 FROM auth.users u WHERE u.id = v_uid;
  IF v_phone10 IS NULL THEN
    SELECT norm_phone10(p.phone) INTO v_phone10 FROM profiles p WHERE p.id = v_uid;
  END IF;
  IF v_phone10 IS NULL THEN RETURN FALSE; END IF;

  SELECT * INTO v_row FROM allowed_users
   WHERE norm_phone10(phone) = v_phone10 AND claimed_at IS NULL
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  v_role := CASE WHEN COALESCE(v_row.role, '') IN ('', 'admin') THEN 'inspector' ELSE v_row.role END;

  UPDATE profiles
     SET name            = COALESCE(NULLIF(btrim(name), ''), v_row.name),
         role            = v_role,
         roles           = (SELECT array_agg(DISTINCT r)
                              FROM unnest(COALESCE(roles, '{}'::TEXT[])
                                          || COALESCE(v_row.extra_roles, '{}'::TEXT[])) AS r),
         account_type    = 'employee',
         setup_complete  = TRUE,
         approval_status = 'approved'
   WHERE id = v_uid;

  UPDATE allowed_users SET claimed_by = v_uid, claimed_at = NOW() WHERE id = v_row.id;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION claim_staff_invite() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION claim_staff_invite() TO authenticated;

-- ---------------------------------------------------------------- seed

-- phone is stored as the Login screen builds it (+1 + 10 digits) for display;
-- matching only ever goes through norm_phone10(), so the shape here is cosmetic.
INSERT INTO allowed_users (phone, name, role)
VALUES ('+15555550100', 'App Review', 'inspector')
ON CONFLICT (phone) DO NOTHING;

INSERT INTO allowed_users (phone, name, role, extra_roles)
VALUES ('+19013544264', 'Jorge Breve', 'inspector', ARRAY['body_shop_manager'])
ON CONFLICT (phone) DO UPDATE
  SET name = EXCLUDED.name, extra_roles = EXCLUDED.extra_roles;

NOTIFY pgrst, 'reload schema';
