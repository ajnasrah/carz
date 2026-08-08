-- claim_staff_invite was writing NULL over an empty roles array.
--
-- `array_agg` returns NULL — not '{}' — when it aggregates zero rows, so any
-- claimed profile with no extra_roles came out of the claim with roles = NULL
-- where it had been '{}'. Verified live: the App Review account went in as [] and
-- came out as null.
--
-- Nothing breaks today (every reader guards with `|| []`, and the body shop
-- policies' `roles && ARRAY[...]` treats NULL as no-match), but it makes the
-- column's contract "array or null, depending on which path last wrote it", and
-- the first `profile.roles.includes(...)` written without a guard is a crash.
-- COALESCE keeps it an array on every path.

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
         roles           = COALESCE(
                             (SELECT array_agg(DISTINCT r)
                                FROM unnest(COALESCE(roles, '{}'::TEXT[])
                                            || COALESCE(v_row.extra_roles, '{}'::TEXT[])) AS r),
                             '{}'::TEXT[]),
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

-- Repair the one row the NULL-writing version already touched.
UPDATE profiles SET roles = '{}'::TEXT[] WHERE roles IS NULL;

NOTIFY pgrst, 'reload schema';
