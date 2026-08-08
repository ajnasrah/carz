-- Body Shop: add a tech by phone number, before he has ever opened the app.
--
-- The old path made Jorge wait on the tech: the guy had to sign up, guess his
-- way through the Setup screen, tick "Body Shop Tech", and then sit in the
-- pending queue until an admin approved him — three people and a day's delay
-- before he could be assigned a car.
--
-- Now Jorge types a name and a phone number on the job screen. Whenever that
-- number signs in, the profile it creates is claimed by the invite: named,
-- given the body_shop_tech role, marked as an employee and approved. He lands
-- straight on the board with his cars on it.
--
-- The invite matches on the LAST 10 DIGITS and nothing else. Phone numbers reach
-- us in every shape — auth.users stores '19018319661', profiles has seen
-- '+19018319661', and Jorge will type '(901) 831-9661' — so every comparison in
-- here goes through norm_phone10().
--
-- Security: an invite grants exactly one role, body_shop_tech. It is claimed by
-- the phone in the caller's OWN auth record, never by a number passed in from
-- the client, so holding an invite for someone else's number buys nothing.

CREATE OR REPLACE FUNCTION norm_phone10(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(right(regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g'), 10), '');
$$;

CREATE TABLE IF NOT EXISTS body_shop_tech_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone10     TEXT NOT NULL,                    -- the only thing ever matched on
  phone       TEXT,                             -- as Jorge typed it, for display
  name        TEXT NOT NULL,
  invited_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  claimed_at  TIMESTAMPTZ
);

-- One OPEN invite per number. A claimed one stays as the record of how that tech
-- got in, and doesn't block re-inviting someone who was removed and came back.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bs_tech_invites_open
  ON body_shop_tech_invites (phone10) WHERE claimed_at IS NULL;

ALTER TABLE body_shop_tech_invites ENABLE ROW LEVEL SECURITY;

-- Reading the roster is the shop's business; writes go through the RPCs below.
-- `TO authenticated` alone would include buyers, so the policy names the role.
DROP POLICY IF EXISTS bs_tech_invites_select ON body_shop_tech_invites;
CREATE POLICY bs_tech_invites_select ON body_shop_tech_invites
  FOR SELECT TO authenticated
  USING (is_shop_manager() OR is_charge_approver());

REVOKE ALL ON body_shop_tech_invites FROM PUBLIC, anon;
GRANT SELECT ON body_shop_tech_invites TO authenticated;

-- ---------------------------------------------------------------- add

-- Jorge (or an owner) adds a tech. Two outcomes, and the caller is told which:
--   'linked'  the number already has an account — the role is granted now
--   'invited' nobody by that number yet — the next sign-in claims it
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

  -- Already has an account? Grant the role outright — there is nothing to wait
  -- for, and leaving an unclaimed invite behind would never fire.
  SELECT id INTO v_profile FROM profiles
   WHERE norm_phone10(phone) = v_phone10
   ORDER BY created_at LIMIT 1;

  IF v_profile IS NOT NULL THEN
    UPDATE profiles
       SET roles = (SELECT array_agg(DISTINCT r)
                      FROM unnest(COALESCE(roles, '{}'::TEXT[]) || 'body_shop_tech') AS r),
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

-- Withdraw an invite that hasn't been claimed. Someone who has already signed in
-- is a real employee — removing him is the Admin panel's job, not this one.
CREATE OR REPLACE FUNCTION remove_body_shop_tech_invite(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (is_shop_manager() OR is_charge_approver()) THEN
    RAISE EXCEPTION 'Only the body shop manager can remove an invite';
  END IF;
  DELETE FROM body_shop_tech_invites WHERE id = p_id AND claimed_at IS NULL;
  RETURN FOUND;
END;
$$;

-- ---------------------------------------------------------------- claim

-- Called by the app on sign-in for anyone not yet set up. Matches the phone on
-- the caller's OWN auth record — the client passes nothing, so there is no
-- number to forge. auth.users.phone has no '+', profiles' may; both normalise.
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
  -- Fall back to the profile row for an account created by some other means.
  IF v_phone10 IS NULL THEN
    SELECT norm_phone10(p.phone) INTO v_phone10 FROM profiles p WHERE p.id = v_uid;
  END IF;
  IF v_phone10 IS NULL THEN RETURN FALSE; END IF;

  SELECT * INTO v_invite FROM body_shop_tech_invites
   WHERE phone10 = v_phone10 AND claimed_at IS NULL
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- Approved on the strength of the invite: Jorge naming a man and his number IS
  -- the approval. He gets body_shop_tech and nothing else — BodyShop.jsx scopes a
  -- tech to his own assigned cars.
  UPDATE profiles
     SET roles = (SELECT array_agg(DISTINCT r)
                    FROM unnest(COALESCE(roles, '{}'::TEXT[]) || 'body_shop_tech') AS r),
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

REVOKE EXECUTE ON FUNCTION add_body_shop_tech(TEXT, TEXT)      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION remove_body_shop_tech_invite(UUID)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION claim_body_shop_tech_invite()       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION add_body_shop_tech(TEXT, TEXT)      TO authenticated;
GRANT  EXECUTE ON FUNCTION remove_body_shop_tech_invite(UUID)  TO authenticated;
GRANT  EXECUTE ON FUNCTION claim_body_shop_tech_invite()       TO authenticated;

NOTIFY pgrst, 'reload schema';
