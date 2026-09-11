-- purge_account_data must key on the VERIFIED phone, not the profile's copy.
--
-- The phone-keyed half of account deletion (roster row, body shop invite,
-- checklist texts, message log) looked the number up as
-- COALESCE(profiles.phone, auth.users.phone). profiles.phone is the wrong
-- source: profiles_update lets any signed-in user UPDATE their own row
-- ((auth.uid() = id)), and guard_profile_privileges pins role, approval_status,
-- sold_reports_access and account_type — but not phone. So the column is
-- attacker-controlled.
--
-- That turned "delete my account" into a way to delete someone else's data:
-- set your own profiles.phone to a colleague's number, delete your account, and
-- the purge takes THEIR roster row, THEIR body shop invite, THEIR daily
-- checklist and THEIR entire SMS history with it. No access is gained — this is
-- destruction only, and only by someone who already has an account — but the
-- data is gone and the audit trail says the leaver did it to themselves.
--
-- auth.users.phone is the number GoTrue verified by OTP. A user cannot change
-- it by writing to a table; it takes another verified code. It is also exactly
-- what claim_staff_invite and claim_body_shop_tech_invite match on ("the phone
-- in the caller's OWN auth record", 20260806000003), which is the property that
-- actually matters here: the invite this deletes is precisely the invite that
-- would otherwise let the deleted number walk back in.
--
-- Body is 20260912000001 verbatim apart from that one SELECT.

CREATE OR REPLACE FUNCTION public.purge_account_data(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_phone10    text;
  v_released   int := 0;
  v_scrubbed   int := 0;
  v_kept       int := 0;
  v_roster     int := 0;
  v_tech       int := 0;
  v_checklists int := 0;
  v_nudges     int := 0;
  v_messages   int := 0;
  v_stock      text;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'purge_account_data: no user';
  END IF;

  -- The OTP-verified number, and nothing else. NOT profiles.phone — see above.
  -- If it is somehow null there is no number to match on, and the phone-keyed
  -- deletes below are skipped rather than guessed at.
  SELECT norm_phone10(u.phone) INTO v_phone10
    FROM auth.users u WHERE u.id = p_user;

  -- ── Reservations ────────────────────────────────────────────────────────
  -- A car held for someone who no longer exists is a car nobody can sell. Let
  -- each one go the same way the admin's Release button does: status, then the
  -- marketplace_hidden row that took it off the listings (see
  -- decide_car_reservation, which this deliberately mirrors).
  FOR v_stock IN
    SELECT stock_number FROM public.car_reservations
     WHERE buyer_id = p_user AND status = 'reserved'
  LOOP
    DELETE FROM public.marketplace_hidden WHERE stock_number = v_stock;
    v_released := v_released + 1;
  END LOOP;

  -- Released now, plus any released long ago: dead records, so the buyer
  -- snapshot on them has no one left to serve.
  UPDATE public.car_reservations
     SET status        = 'released',
         released_at   = COALESCE(released_at, NOW()),
         buyer_name    = NULL, dealer_name   = NULL,
         buyer_phone   = NULL, buyer_email   = NULL,
         billing_name  = NULL, billing_phone = NULL, billing_email = NULL
   WHERE buyer_id = p_user
     AND status IN ('reserved', 'released');
  GET DIAGNOSTICS v_scrubbed = ROW_COUNT;

  -- Confirmed ones are transactions. They keep their snapshot on purpose.
  SELECT count(*) INTO v_kept
    FROM public.car_reservations
   WHERE buyer_id = p_user AND status = 'confirmed';

  IF v_phone10 IS NOT NULL THEN
    -- The staff roster. Deleting this is the difference between an account
    -- that is gone and one that walks straight back in on the next sign-in
    -- with its old name, role and approval (see claim_staff_invite).
    DELETE FROM public.allowed_users WHERE norm_phone10(phone) = v_phone10;
    GET DIAGNOSTICS v_roster = ROW_COUNT;

    DELETE FROM public.body_shop_tech_invites WHERE norm_phone10(phone) = v_phone10;
    GET DIAGNOSTICS v_tech = ROW_COUNT;

    -- Their daily checklist texts, the nudges, and every message we have on
    -- record to or from that number.
    DELETE FROM public.sms_checklists WHERE norm_phone10(phone) = v_phone10;
    GET DIAGNOSTICS v_checklists = ROW_COUNT;

    DELETE FROM public.sms_nudges WHERE norm_phone10(phone) = v_phone10;
    GET DIAGNOSTICS v_nudges = ROW_COUNT;

    DELETE FROM public.sms_messages WHERE norm_phone10(phone) = v_phone10;
    GET DIAGNOSTICS v_messages = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'reservations_released',  v_released,
    'reservations_scrubbed',  v_scrubbed,
    'reservations_kept',      v_kept,
    'roster_rows',            v_roster,
    'tech_invites',           v_tech,
    'checklists',             v_checklists,
    'nudges',                 v_nudges,
    'messages',               v_messages
  );
END $$;

-- CREATE OR REPLACE keeps the existing ACL, but restate it so the grant is
-- readable in one place and survives a future drop/recreate.
REVOKE ALL ON FUNCTION public.purge_account_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_account_data(uuid) TO service_role;
