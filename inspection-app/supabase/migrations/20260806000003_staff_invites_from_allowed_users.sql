-- Staff onboarding: an admin adds a name + phone, and that person's first
-- sign-in puts them straight on the dashboard.
--
-- The Admin panel has had an "Add User" form since the beginning. It writes to
-- allowed_users — and NOTHING has ever read that table. The whitelist was
-- decorative: the person still had to sign up, pick their way through Setup,
-- guess "employee" over "buyer", then sit in the pending queue until an admin
-- noticed. For a crew being onboarded off a TestFlight or home-screen link,
-- that pending screen is a dead end — nothing tells them when they're approved,
-- and nothing brings them back to the app.
--
-- This makes the existing form do what it always looked like it did. Same
-- proven shape as body_shop_tech_invites (20260806000002): match on the LAST 10
-- DIGITS of the phone in the caller's OWN auth record, claim once, record it.
--
-- ─── Security: allowed_users was world-writable ─────────────────────────────
-- The original policies (supabase-schema.sql) let ANY authenticated caller
-- INSERT or DELETE whitelist rows, despite the comment above them reading
-- "only admins can manage (via service role)". That was harmless while nothing
-- read the table. This migration makes the table load-bearing, so it locks the
-- writes down to admins FIRST.
--
-- It also means every row written before this migration is untrusted — any
-- signed-in user could have added one, including one with role='admin'. So the
-- claim below NEVER grants admin, whatever the row says. Admin stays a
-- deliberate act in the Admin panel against an account that already exists.

-- ---------------------------------------------------------------- lock down

ALTER TABLE allowed_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read allowed_users"   ON allowed_users;
DROP POLICY IF EXISTS "Authenticated users can insert allowed_users" ON allowed_users;
DROP POLICY IF EXISTS "Authenticated users can delete allowed_users" ON allowed_users;
DROP POLICY IF EXISTS allowed_users_select ON allowed_users;
DROP POLICY IF EXISTS allowed_users_write  ON allowed_users;

-- The roster is staff contact detail, not public. `TO authenticated` on its own
-- would include marketplace buyers, who have no business reading the staff list.
CREATE POLICY allowed_users_select ON allowed_users
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY allowed_users_write ON allowed_users
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON allowed_users FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON allowed_users TO authenticated;

-- ---------------------------------------------------------------- claim state

-- Without this, a claim is re-runnable forever, and that quietly un-does
-- rejection: an admin sets approval_status='rejected', but the profile is then
-- not "settled", so the app asks to claim again on the next sign-in and the
-- still-present whitelist row re-approves them. Claimed-once makes rejection stick.
ALTER TABLE allowed_users ADD COLUMN IF NOT EXISTS claimed_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE allowed_users ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- Matching is on the last 10 digits and nothing else: auth.users stores
-- '19018319661', profiles has seen '+19018319661', and an admin will type
-- '(901) 831-9661'. norm_phone10() comes from 20260806000002.
CREATE INDEX IF NOT EXISTS idx_allowed_users_phone10_open
  ON allowed_users (norm_phone10(phone)) WHERE claimed_at IS NULL;

-- ---------------------------------------------------------------- claim

-- Called by the app on sign-in for any account that isn't finished. The client
-- passes NOTHING — the number is read from the caller's own auth record, so
-- there is no number to forge and holding a whitelist entry for someone else's
-- phone buys nothing.
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

  -- Never admin from a whitelist row — see the header. Anything else the admin
  -- picked is honoured; an unrecognised or absent label falls back to inspector.
  v_role := CASE WHEN COALESCE(v_row.role, '') IN ('', 'admin') THEN 'inspector' ELSE v_row.role END;

  -- An admin typing a name and a number IS the approval. account_type is forced
  -- to 'employee': the whitelist is the staff roster, and a buyer would be sent
  -- to the marketplace-only view by ProtectedRoute.
  UPDATE profiles
     SET name            = COALESCE(NULLIF(btrim(name), ''), v_row.name),
         role            = v_role,
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

NOTIFY pgrst, 'reload schema';
