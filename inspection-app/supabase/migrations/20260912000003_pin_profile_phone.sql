-- profiles.phone was a self-service admin switch.
--
-- Found while checking the account-deletion work, which had keyed its
-- phone-matched deletes on the same column. That part is fixed in
-- 20260912000002; this is the bigger half of the same root cause.
--
-- THE HOLE
-- is_admin() grants admin two ways: profiles.role = 'admin', OR
-- profiles.phone normalising to the owner's number 9018319661 (the "the owner
-- can never be locked out by a bad role row" escape hatch). Meanwhile:
--   · profiles_update lets any signed-in user UPDATE their own row,
--   · `authenticated` holds UPDATE on the phone column,
--   · guard_profile_privileges pinned role, approval_status,
--     sold_reports_access and account_type — but never phone,
--   · and there is no unique index on phone, so a second row may carry the
--     owner's number while his own row still exists.
--
-- So one statement — update profiles set phone='9018319661' where id=auth.uid()
-- — turned any account into an admin for every RLS policy and every SECURITY
-- DEFINER function that asks is_admin(): costs and profit, the sold book, the
-- staff roster, reservation decisions, the Admin panel. Reproduced against prod
-- inside a rolled-back transaction, as a marketplace BUYER — the account type
-- that approves itself at signup, so the whole path needs nothing but a phone
-- that can receive one SMS.
--
-- THE FIX, IN TWO LAYERS
-- 1. is_admin() reads the phone from auth.users, not from profiles. GoTrue owns
--    that column and only a verified OTP changes it, so the escape hatch now
--    depends on something the user cannot write. This is also the same source
--    claim_staff_invite trusts.
-- 2. guard_profile_privileges pins phone the way it already pins role: a
--    non-admin's UPDATE cannot move it, and a self-created row takes the
--    number from the auth record rather than whatever was posted.
--
-- Either layer alone closes it; both, because layer 1 is about privilege and
-- layer 2 is about the column being trustworthy for everything else that reads
-- it (isAdminProfile in the app, the deletion purge, admin lookups by phone).

-- ---------------------------------------------------------------- layer 1

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  ) OR EXISTS (
    -- The owner's escape hatch, moved off the writable copy of the number and
    -- onto the one GoTrue verified.
    SELECT 1 FROM auth.users u
    WHERE u.id = auth.uid()
      AND regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g')
          IN ('9018319661', '19018319661')
  );
$$;

-- ---------------------------------------------------------------- layer 2

CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, auth
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
    -- Nor may it start out wearing somebody else's phone number. AuthContext
    -- already provisions from the auth record, so the honest path is unchanged;
    -- this is what stops a hand-rolled INSERT from claiming the owner's number.
    -- Left alone when the auth record has no phone at all — there is nothing
    -- truer to replace it with.
    NEW.phone := COALESCE(
      (SELECT u.phone FROM auth.users u WHERE u.id = auth.uid()),
      NEW.phone
    );
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
  --  · cannot change the phone this account signs in as. Setup writes name,
  --    account_type, roles and the buyer's contact_/billing_ fields; none of
  --    them is this column, so nothing legitimate is being refused. Changing
  --    the number you sign in with is a re-verification, not a profile edit.
  NEW.phone := OLD.phone;
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
