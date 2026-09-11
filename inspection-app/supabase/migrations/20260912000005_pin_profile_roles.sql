-- profiles.roles[] was the second self-service privilege switch.
--
-- Same shape as the phone hole fixed in 20260912000003, found by asking the
-- obvious follow-up question: what ELSE does guard_profile_privileges not pin?
-- It pinned role, approval_status, sold_reports_access, account_type and (as of
-- 000003) phone. It never pinned roles[] — and roles[] is not decoration:
--
--   is_accounting()      role='admin' OR roles && {accounting, owner_admin}
--   is_charge_approver() role='admin' OR roles && {owner_admin, accounting}
--   is_shop_manager()    role='admin' OR roles && {body_shop_manager}
--
-- and those three gate the money in the body shop: propose/counter/accept and
-- APPROVE a charge, approve a job, collect a payout, add and remove techs.
--
-- So an approved body shop tech — someone whose own pay comes out of exactly
-- those flows — could run
--
--   update profiles set roles = '{accounting,body_shop_manager}' where id = auth.uid();
--
-- and from then on approve his own charges and collect his own payout.
-- Reproduced against prod in a rolled-back transaction as an approved employee:
-- is_accounting, is_charge_approver and is_shop_manager all flipped true.
-- (is_admin stayed false — that one is pinned.)
--
-- THE RULE
-- You pick your own jobs on the Setup screen, and an admin sees them when they
-- approve you. After that they are the admin's to change, not yours. So roles[]
-- is writable by a non-admin only while the account is still unsettled —
-- setup not finished AND not yet approved — which is precisely the Setup save
-- and nothing else. Everything legitimate still works:
--
--   · Setup writes roles in the same UPDATE that sets setup_complete = true,
--     and it is OLD.setup_complete that is tested, so that write is allowed.
--   · The Admin panel's role editor is an admin, and admins return early.
--   · claim_staff_invite / claim_body_shop_tech_invite are SECURITY DEFINER, so
--     current_user is the owner and they return at the trusted-context branch.
--
-- Body is 20260912000004 verbatim plus the one freeze.

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
  --  · cannot hand themselves a job that pays. roles[] decides accounting,
  --    charge approval and shop manager, so it is only theirs to set while the
  --    account is still unsettled — i.e. the Setup save. After setup is
  --    finished or approval has been granted, it is the admin's.
  IF OLD.setup_complete IS TRUE OR OLD.approval_status = 'approved' THEN
    NEW.roles := OLD.roles;
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
