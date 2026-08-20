-- "Your account is not active yet" — on a buyer who did everything right.
--
-- A buyer is meant to be approved on sight: they only ever reach the public
-- marketplace, and a reservation is confirmed by an admin afterwards anyway.
-- 20260818000011 built that, but wired it to a single transition:
--
--     IF OLD.account_type IS NULL AND NEW.account_type = 'buyer' THEN approve
--
-- which only fires the FIRST time an account picks Buyer on the setup screen.
-- Every buyer account that already had account_type = 'buyer' when that rule
-- shipped — i.e. every buyer who signed up before 18 August — was pending at that
-- moment and is pending still. account_type is frozen once set (further down the
-- same trigger), so the transition can never happen again for them. There is no
-- self-service way out: they finish setup, press Buy it now, and get told their
-- account is not active, with nothing on screen that would change that.
--
-- Deleting the profile row looks like it should fix it and does not, which is
-- the other half of how this was found. Admin → Remove deletes `profiles` only;
-- the Supabase Auth user survives, so signing in again re-provisions a row —
-- and lands in the same state.
--
-- So stop keying on the transition and key on the fact: an account that IS a
-- buyer and is waiting gets approved. Written against the EFFECTIVE account type
-- — COALESCE(OLD, NEW) — because account_type is frozen a few lines below, and
-- reading NEW alone would let an employee send account_type='buyer' in an update
-- and approve themselves on a value the trigger is about to throw away.
--
-- 'rejected' is untouched on purpose. That is an admin's decision about a person,
-- not a state anyone should be able to launder by resubmitting the setup form.

CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Trusted contexts (migrations, service_role, definer triggers) do anything.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  -- Authenticated admins do anything (promote, approve, reject, edit any row).
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A self-created profile can never start out privileged.
    IF NEW.role = 'admin' THEN
      NEW.role := 'inspector';
    END IF;
    -- Buyers are approved on sight; everyone else waits for an admin.
    IF NEW.account_type = 'buyer' THEN
      NEW.approval_status := 'approved';
    ELSE
      NEW.approval_status := 'pending';
    END IF;
    NEW.sold_reports_access := false;
    RETURN NEW;
  END IF;

  -- UPDATE by a non-admin on their own row:
  --  · cannot self-promote to admin (other role labels like lot_manager are fine)
  IF NEW.role = 'admin' AND OLD.role IS DISTINCT FROM 'admin' THEN
    NEW.role := OLD.role;
  END IF;
  --  · cannot change their own approval status, with ONE exception: a buyer
  --    who is still waiting. COALESCE, not NEW, so this reads the account type
  --    that will SURVIVE this update — an employee cannot approve themselves by
  --    sending 'buyer' in a field the freeze below is about to discard.
  IF COALESCE(OLD.account_type, NEW.account_type) = 'buyer'
     AND OLD.approval_status = 'pending' THEN
    NEW.approval_status := 'approved';
  ELSE
    NEW.approval_status := OLD.approval_status;
  END IF;
  --  · cannot grant themselves the sold book (that's what the request queue is for)
  NEW.sold_reports_access := OLD.sold_reports_access;
  --  · cannot flip buyer <-> employee once it has been chosen
  IF OLD.account_type IS NOT NULL THEN
    NEW.account_type := OLD.account_type;
  END IF;

  RETURN NEW;
END;
$$;

-- The buyers already stuck. Each of these is someone who finished signing up and
-- has been unable to reserve a car since; nothing they can do on their own would
-- have cleared it. Runs as the migration owner, so the trigger's trusted-context
-- branch lets it through untouched.
DO $$
DECLARE n integer;
BEGIN
  UPDATE profiles
     SET approval_status = 'approved'
   WHERE account_type = 'buyer'
     AND approval_status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'approved % buyer account(s) that were stuck pending', n;
END $$;

NOTIFY pgrst, 'reload schema';
