-- Buyer accounts that can reserve a car, and the reservations themselves.
--
-- A buyer reaches us from a texted share link, taps Reserve on a car, and has to
-- become an account before that can mean anything. Two things follow from that:
--
--   1. The account can approve itself. A buyer only ever sees the public
--      marketplace — the same pages anyone can already load without signing in —
--      so holding one behind manual approval protects nothing and leaves someone
--      who came from your text staring at a waiting screen. Employees still wait.
--
--   2. We need to know who they actually are before a car comes off the lot for
--      them: the dealership, someone to call, and someone in billing to invoice.
--      A reserved car is inventory taken off the market, so "some guy with a
--      phone number" is not enough.

-- ---------------------------------------------------------------------------
-- 1. Who the buyer is
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS dealer_name    TEXT,
  ADD COLUMN IF NOT EXISTS contact_name   TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone  TEXT,
  ADD COLUMN IF NOT EXISTS contact_email  TEXT,
  ADD COLUMN IF NOT EXISTS billing_name   TEXT,
  ADD COLUMN IF NOT EXISTS billing_phone  TEXT,
  ADD COLUMN IF NOT EXISTS billing_email  TEXT;

COMMENT ON COLUMN public.profiles.dealer_name IS
  'Buyer accounts: the dealership. Required before a car can be reserved.';
COMMENT ON COLUMN public.profiles.billing_email IS
  'Buyer accounts: where the invoice goes. Separate from contact_* on purpose — '
  'the person who buys the car is rarely the person who pays for it.';

-- ---------------------------------------------------------------------------
-- 2. Let a buyer account approve itself, and nothing else
--
-- Full body restated because CREATE OR REPLACE replaces the whole function.
-- Everything except the two approval_status branches is 20260817000001 verbatim,
-- which is itself 20260706000002 plus the sold_reports_access pin.
-- SECURITY INVOKER (no DEFINER) is still REQUIRED — under DEFINER, current_user
-- resolves to the owner and the guard would always bypass.
-- ---------------------------------------------------------------------------
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
  --  · cannot change their own approval status, with ONE exception: choosing
  --    "Buyer" on the setup screen. AuthContext provisions the row before the
  --    user has picked anything, so account_type arrives on a later UPDATE —
  --    without this, every buyer would be created pending and stay pending.
  --    Only the NULL -> 'buyer' transition qualifies, and account_type is
  --    already frozen once set (below), so this cannot be replayed.
  IF OLD.account_type IS NULL AND NEW.account_type = 'buyer' THEN
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

DROP TRIGGER IF EXISTS guard_profile_privileges ON public.profiles;
CREATE TRIGGER guard_profile_privileges
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_privileges();

-- ---------------------------------------------------------------------------
-- 3. Reservations
--
-- Rows are written ONLY by /api/reserve-car with the service key, which is why
-- there is no INSERT policy. Reserving pulls the car off the marketplace, so a
-- client that could insert here could also take any car off the market. The
-- endpoint verifies the session token, resolves the buyer itself, and checks the
-- profile is complete before anything is hidden.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.car_reservations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_number  TEXT NOT NULL,
  vin           TEXT,
  -- Snapshot of the buyer as they were when they reserved, so the record still
  -- reads correctly after a profile is edited or deleted.
  buyer_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  buyer_name    TEXT,
  dealer_name   TEXT,
  buyer_phone   TEXT,
  buyer_email   TEXT,
  billing_name  TEXT,
  billing_phone TEXT,
  billing_email TEXT,
  price         NUMERIC(10,2),
  status        TEXT NOT NULL DEFAULT 'reserved'
                CHECK (status IN ('reserved', 'confirmed', 'released')),
  -- Whether the text to the owner actually went out. The reservation is recorded
  -- first and texted second, so a Twilio outage loses the notification and never
  -- the car.
  notified      BOOLEAN NOT NULL DEFAULT false,
  notify_error  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at   TIMESTAMPTZ,
  decided_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- One live reservation per car. Partial so the history of released ones is kept.
CREATE UNIQUE INDEX IF NOT EXISTS car_reservations_one_live
  ON public.car_reservations (stock_number)
  WHERE status IN ('reserved', 'confirmed');

CREATE INDEX IF NOT EXISTS car_reservations_recent
  ON public.car_reservations (created_at DESC);

ALTER TABLE public.car_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS car_reservations_select ON public.car_reservations;
DROP POLICY IF EXISTS car_reservations_update ON public.car_reservations;

-- A buyer sees their own reservations so the car can read "reserved by you"
-- rather than just vanishing. Admins see all of them.
CREATE POLICY car_reservations_select
  ON public.car_reservations FOR SELECT
  USING (auth.uid() = buyer_id OR public.is_admin());

-- Only an admin confirms or releases. No INSERT policy — see the note above.
CREATE POLICY car_reservations_update
  ON public.car_reservations FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, UPDATE ON public.car_reservations TO authenticated;
REVOKE ALL ON public.car_reservations FROM anon;

NOTIFY pgrst, 'reload schema';
