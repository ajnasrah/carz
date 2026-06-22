-- ============================================
-- LOCATION RECENCY GUARD — "newest event-time wins" for physical location
--
-- One row per stock_number in vehicle_locations means every source (app manual
-- edit, lot scan, SmartAuction extension, UAX/DAA/ADESA + Super Dispatch list
-- uploads, WhatsApp) overwrites the same row. Previously it was last-WRITE-wins
-- by execution order: a stale list uploaded later could clobber newer data, and
-- a month-old Super Dispatch row stamped now() looked freshly in_transit.
--
-- This trigger makes it last-EVENT-TIME-wins for the physical_location trio:
-- an update carrying an OLDER location_updated_at than what's already stored
-- cannot move the car — the existing (newer) location is preserved.
--
-- SCOPE: only physical_location / physical_source / location_updated_at are
-- guarded. The marketplace columns (sa_status, manheim_status, ove_status,
-- sold_*, notes, …) each have their OWN timestamps and pass through untouched,
-- so a list upload can still update sa_status even when its location loses.
--
-- Manual edits are NOT privileged: they stamp location_updated_at = now(), so
-- they win at edit time and are only overridden by a genuinely newer event.
-- This intentionally supersedes the old "manual always wins" intent in
-- 20260601000003_respect_manual_location_edits.sql.
-- ============================================

CREATE OR REPLACE FUNCTION enforce_location_recency()
RETURNS TRIGGER AS $$
BEGIN
  -- Only act when the location trio actually changes. A marketplace-only update
  -- (e.g. sa_status) leaves the trio identical and must pass through untouched —
  -- in particular it must NOT acquire a location_updated_at it never had.
  IF NEW.physical_location   IS DISTINCT FROM OLD.physical_location
     OR NEW.physical_source     IS DISTINCT FROM OLD.physical_source
     OR NEW.location_updated_at IS DISTINCT FROM OLD.location_updated_at THEN

    -- A location change that arrives without a fresh timestamp is treated as
    -- happening now (scoped to genuine location changes only).
    IF NEW.location_updated_at IS NULL THEN
      NEW.location_updated_at := NOW();
    END IF;

    -- Incoming event is OLDER than what we already have → it loses.
    -- Revert the trio to the existing (newer) values; let every other column
    -- in this UPDATE proceed normally.
    IF OLD.location_updated_at IS NOT NULL
       AND NEW.location_updated_at < OLD.location_updated_at THEN
      NEW.physical_location   := OLD.physical_location;
      NEW.physical_source     := OLD.physical_source;
      NEW.location_updated_at := OLD.location_updated_at;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_location_recency ON vehicle_locations;
CREATE TRIGGER trg_location_recency
  BEFORE UPDATE ON vehicle_locations
  FOR EACH ROW
  EXECUTE FUNCTION enforce_location_recency();

COMMENT ON FUNCTION enforce_location_recency() IS
'Newest-event-time-wins guard for vehicle_locations.physical_location. An UPDATE
whose location_updated_at predates the stored value cannot change the location
trio; other columns are unaffected. Each source must stamp the TRUE event time
(dispatch/pickup date, list run date, WhatsApp message time), not now().';

NOTIFY pgrst, 'reload schema';
