-- Fixes a break introduced by 20260912000003.
--
-- That migration pinned profiles.phone on INSERT by reading the number out of
-- auth.users from inside guard_profile_privileges. The guard is deliberately
-- SECURITY INVOKER — under DEFINER, current_user resolves to the owner and its
-- very first branch ("trusted contexts do anything") would wave everything
-- through, which is noted in 20260818000011 and is still true. As INVOKER it
-- runs as `authenticated`, and `authenticated` has no SELECT on auth.users. So
-- every self-service profile INSERT raised:
--
--   42501: permission denied for table users
--
-- i.e. nobody could finish signing up. Caught by running the signup path as
-- `authenticated` in a rolled-back transaction rather than by reading the
-- function, because the guard reads fine and only fails under the role it
-- actually runs as.
--
-- verified_phone() does that one read behind a DEFINER wall. It takes no
-- argument and is keyed to auth.uid(), so it can only ever return the caller's
-- own number — there is nothing here to abuse by exposing it, and it keeps the
-- guard itself INVOKER.

CREATE OR REPLACE FUNCTION public.verified_phone()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT u.phone FROM auth.users u WHERE u.id = auth.uid();
$$;

COMMENT ON FUNCTION public.verified_phone() IS
  'The caller''s OTP-verified phone from auth.users. Definer so that INVOKER '
  'triggers (guard_profile_privileges) can reach it; keyed to auth.uid() so it '
  'can only ever return your own number.';

REVOKE ALL ON FUNCTION public.verified_phone() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verified_phone() TO authenticated, anon, service_role;

-- Same body as 20260912000003 with the one read swapped.
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
    NEW.phone := COALESCE(public.verified_phone(), NEW.phone);
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
