-- Delete my account, for real.
--
-- App Review rejected 1.0 (15) under guideline 5.1.1(v): an app that lets you
-- create an account has to let you delete it from inside the app, and
-- deactivating it doesn't count. This is the database half of that — the two
-- things standing between "the user pressed Delete" and the auth row actually
-- going away:
--
--   1. SIX FOREIGN KEYS THAT SAY NO. Everything else that points at a person
--      is ON DELETE SET NULL, so the record survives and loses its author.
--      These six were left at NO ACTION, which means a DELETE on auth.users
--      raises instead — one skipped inspection, one scanned VIN nobody could
--      match, or one car pulled from an auction, and the account is
--      undeletable. unmatched_vehicles.scanned_by was NOT NULL as well, so
--      that one needs the column loosened before the constraint can set it.
--
--      Nothing here deletes a business record. A car that was scanned was
--      still scanned; only the name attached to it goes.
--
--   2. THE PERSONAL DATA THAT ISN'T REACHED BY A CASCADE. profiles,
--      buyer_billing_locations and sold_report_access_requests all cascade off
--      auth.users and need no help. The rest is keyed by PHONE NUMBER, not by
--      user id — the staff roster, the body shop invite, the daily checklist
--      texts and their message log — and would sit there after the account was
--      gone. Worse, the roster row is what re-approves a returning phone, so
--      leaving it means a "deleted" account walks back in with its old role.
--
-- What deliberately stays: a CONFIRMED reservation. That is a car taken off
-- the lot for someone, i.e. a transaction the dealership has to be able to
-- account for, and it keeps its buyer snapshot. Reservations that never got
-- that far are released (the car goes back on the market) and scrubbed. The
-- delete screen says so in those words before anyone presses the button.

-- ---------------------------------------------------------------------------
-- 1. The six that block
-- ---------------------------------------------------------------------------

ALTER TABLE IF EXISTS public.inspections
  DROP CONSTRAINT IF EXISTS inspections_skipped_by_fkey;
ALTER TABLE IF EXISTS public.inspections
  ADD CONSTRAINT inspections_skipped_by_fkey
  FOREIGN KEY (skipped_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.pull_tracking
  DROP CONSTRAINT IF EXISTS pull_tracking_pulled_manheim_by_fkey;
ALTER TABLE IF EXISTS public.pull_tracking
  ADD CONSTRAINT pull_tracking_pulled_manheim_by_fkey
  FOREIGN KEY (pulled_manheim_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.pull_tracking
  DROP CONSTRAINT IF EXISTS pull_tracking_pulled_ove_by_fkey;
ALTER TABLE IF EXISTS public.pull_tracking
  ADD CONSTRAINT pull_tracking_pulled_ove_by_fkey
  FOREIGN KEY (pulled_ove_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.pull_tracking
  DROP CONSTRAINT IF EXISTS pull_tracking_pulled_sa_by_fkey;
ALTER TABLE IF EXISTS public.pull_tracking
  ADD CONSTRAINT pull_tracking_pulled_sa_by_fkey
  FOREIGN KEY (pulled_sa_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.unmatched_vehicles
  DROP CONSTRAINT IF EXISTS unmatched_vehicles_resolved_by_fkey;
ALTER TABLE IF EXISTS public.unmatched_vehicles
  ADD CONSTRAINT unmatched_vehicles_resolved_by_fkey
  FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- The scan itself is the record worth keeping; who held the phone is not worth
-- making the account permanent for.
ALTER TABLE IF EXISTS public.unmatched_vehicles
  ALTER COLUMN scanned_by DROP NOT NULL;
ALTER TABLE IF EXISTS public.unmatched_vehicles
  DROP CONSTRAINT IF EXISTS unmatched_vehicles_scanned_by_fkey;
ALTER TABLE IF EXISTS public.unmatched_vehicles
  ADD CONSTRAINT unmatched_vehicles_scanned_by_fkey
  FOREIGN KEY (scanned_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2. Everything the cascade can't reach
--
-- Called by /api/delete-account with the service key, immediately before it
-- asks GoTrue to delete the auth user. It is not callable by anon or
-- authenticated: the endpoint proves who the caller is from their own session
-- token and passes that id, so there is no user id here for a client to forge.
--
-- Runs as one statement from the caller's point of view — if any part of it
-- raises, none of it applied and the auth user is still there to try again.
-- ---------------------------------------------------------------------------

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

  -- The phone comes from their own records, never from the caller. profiles
  -- holds '+19018319661', auth.users holds '19018319661', and an admin typed
  -- '(901) 831-9661' into the roster — norm_phone10 is what makes those one
  -- number. A profile row may already be missing, so auth.users is the backstop.
  SELECT norm_phone10(COALESCE(p.phone, u.phone))
    INTO v_phone10
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
   WHERE u.id = p_user;

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

-- EXECUTE is granted to PUBLIC by default, and `authenticated` includes every
-- marketplace buyer. A definer function that takes a user id as an argument is
-- exactly the thing that must not be reachable from a browser holding the anon
-- key, so both are revoked and only the service key may call it.
REVOKE ALL ON FUNCTION public.purge_account_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_account_data(uuid) TO service_role;

COMMENT ON FUNCTION public.purge_account_data(uuid) IS
  'Account deletion, step one: clears the personal data that no cascade reaches '
  '(phone-keyed roster/invite/SMS rows) and releases any car still being held. '
  'Step two is deleting the auth user itself, which cascades profiles, billing '
  'locations and access requests. Service key only — see api/delete-account.js.';
