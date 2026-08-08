-- Fix: adding a body shop tech failed with
--   malformed array literal: "body_shop_tech"
--
-- 20260806000002 grew the roles array with
--
--   COALESCE(roles, '{}'::TEXT[]) || 'body_shop_tech'
--
-- `||` is overloaded — anyarray||anyarray AND anyarray||anyelement — and an
-- untyped string literal matches both. Postgres resolves to the array||array
-- form, then tries to read 'body_shop_tech' as an array literal and fails. It is
-- a parse-time resolution, so it blew up on the first real call rather than when
-- the function was created.
--
-- array_append() has exactly one meaning, so there is nothing to resolve. Both
-- functions are otherwise unchanged from 20260806000002.

CREATE OR REPLACE FUNCTION add_body_shop_tech(p_name TEXT, p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_phone10 TEXT := norm_phone10(p_phone);
  v_name    TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_profile UUID;
BEGIN
  IF NOT (is_shop_manager() OR is_charge_approver()) THEN
    RAISE EXCEPTION 'Only the body shop manager can add a tech';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Enter the tech''s name';
  END IF;
  IF v_phone10 IS NULL OR length(v_phone10) <> 10 THEN
    RAISE EXCEPTION 'Enter a 10-digit phone number';
  END IF;

  SELECT id INTO v_profile FROM profiles
   WHERE norm_phone10(phone) = v_phone10
   ORDER BY created_at LIMIT 1;

  IF v_profile IS NOT NULL THEN
    UPDATE profiles
       SET roles = (SELECT array_agg(DISTINCT r)
                      FROM unnest(array_append(COALESCE(roles, '{}'::TEXT[]), 'body_shop_tech')) AS r),
           name  = COALESCE(NULLIF(btrim(name), ''), v_name),
           account_type    = COALESCE(account_type, 'employee'),
           setup_complete  = TRUE,
           approval_status = 'approved'
     WHERE id = v_profile;

    INSERT INTO body_shop_tech_invites (phone10, phone, name, invited_by, claimed_by, claimed_at)
    VALUES (v_phone10, p_phone, v_name, auth.uid(), v_profile, NOW());
    RETURN 'linked';
  END IF;

  INSERT INTO body_shop_tech_invites (phone10, phone, name, invited_by)
  VALUES (v_phone10, p_phone, v_name, auth.uid())
  ON CONFLICT (phone10) WHERE claimed_at IS NULL
  DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, invited_by = EXCLUDED.invited_by;
  RETURN 'invited';
END;
$$;

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

NOTIFY pgrst, 'reload schema';
