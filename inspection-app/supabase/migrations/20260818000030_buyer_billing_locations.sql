-- Where the car actually gets billed.
--
-- 20260818000011 gave a buyer account ONE billing contact, which is right for a
-- single-rooftop dealer and wrong for everyone else. A group with four stores
-- buys a car for a specific store, and the invoice has to name that store — the
-- billing desk is often the same person for all of them, so the contact is not
-- what distinguishes them. So locations are their own rows, and each can carry
-- its own billing contact when it has one.
--
-- Optional on purpose. A buyer with no locations bills to the account-level
-- contact exactly as before; a buyer with one uses it without being asked; only
-- a buyer with several has to choose, and only at the moment he reserves.

CREATE TABLE IF NOT EXISTS public.buyer_billing_locations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- What the buyer calls it: "Brunswick", "Main store", "Savannah lot".
  label         TEXT NOT NULL,
  address       TEXT,
  city          TEXT,
  state         TEXT,
  zip           TEXT,
  -- Optional override. NULL means "use the account's billing contact", which is
  -- the common case — one billing desk covering every rooftop.
  billing_name  TEXT,
  billing_phone TEXT,
  billing_email TEXT,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS buyer_billing_locations_owner
  ON public.buyer_billing_locations (profile_id, created_at);

-- At most one default per buyer.
CREATE UNIQUE INDEX IF NOT EXISTS buyer_billing_locations_one_default
  ON public.buyer_billing_locations (profile_id)
  WHERE is_default;

ALTER TABLE public.buyer_billing_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bbl_own_select ON public.buyer_billing_locations;
DROP POLICY IF EXISTS bbl_own_write  ON public.buyer_billing_locations;
DROP POLICY IF EXISTS bbl_own_update ON public.buyer_billing_locations;
DROP POLICY IF EXISTS bbl_own_delete ON public.buyer_billing_locations;

-- A buyer manages his own rooftops; an admin can read them all, because they end
-- up on an invoice. profile_id is pinned to auth.uid() on write, so a buyer
-- cannot file a location under somebody else's account.
CREATE POLICY bbl_own_select ON public.buyer_billing_locations
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.is_admin());
CREATE POLICY bbl_own_write ON public.buyer_billing_locations
  FOR INSERT TO authenticated
  WITH CHECK (profile_id = auth.uid());
CREATE POLICY bbl_own_update ON public.buyer_billing_locations
  FOR UPDATE TO authenticated
  USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());
CREATE POLICY bbl_own_delete ON public.buyer_billing_locations
  FOR DELETE TO authenticated
  USING (profile_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.buyer_billing_locations TO authenticated;
REVOKE ALL ON public.buyer_billing_locations FROM anon;

-- ---------------------------------------------------------------------------
-- The reservation records WHERE it was billed, snapshotted like everything else
-- on that row: the location can be renamed or deleted afterwards and the
-- reservation still reads correctly.
-- ---------------------------------------------------------------------------
ALTER TABLE public.car_reservations
  ADD COLUMN IF NOT EXISTS billing_location_id    UUID REFERENCES public.buyer_billing_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS billing_location_label TEXT,
  ADD COLUMN IF NOT EXISTS billing_address        TEXT;

COMMENT ON COLUMN public.car_reservations.billing_location_label IS
  'Snapshot of the rooftop this car was billed to, as it was named at the time.';

NOTIFY pgrst, 'reload schema';
