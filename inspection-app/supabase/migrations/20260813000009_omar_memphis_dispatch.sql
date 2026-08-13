-- Omar chases the Memphis-area pickups specifically: ADESA Memphis, UAX Memphis
-- and OpenLane. That's narrower than the owner's list, so it gets its own bucket
-- rather than being bolted onto dispatch_far.
--
-- These overlap with dispatch_far on purpose — Memphis is one of the owner's
-- cities, so a car at ADESA Memphis shows on both his list and Omar's. That's
-- the intent: Omar works them, the owner still sees them.
ALTER TABLE sms_nudges DROP CONSTRAINT IF EXISTS sms_nudges_bucket_check;
ALTER TABLE sms_nudges ADD CONSTRAINT sms_nudges_bucket_check
  CHECK (bucket IN ('mechanic', 'body_shop', 'stuck21',
                    'dispatch', 'dispatch_far', 'dispatch_memphis'));

CREATE OR REPLACE FUNCTION nudge_memphis_vendor(p_vendor text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  -- OpenLane is written a dozen ways in Frazer exports; match it loosely, and
  -- UAX is Memphis-only so it needs no city qualifier.
  SELECT upper(COALESCE(p_vendor, '')) ~ '(ADESA[^A-Z]*MEMPHIS|UAX|OPEN[^A-Z]*LANE|OPENLANE)';
$$;

-- Swap Omar off the owner's wide list onto his own.
DELETE FROM sms_nudges WHERE name = 'Omar' AND bucket = 'dispatch_far';
INSERT INTO sms_nudges (name, phone, bucket)
SELECT 'Omar', '+19018268622', 'dispatch_memphis'
WHERE NOT EXISTS (
  SELECT 1 FROM sms_nudges WHERE phone = '+19018268622' AND bucket = 'dispatch_memphis'
);

-- Route the new bucket in the same CASE the others use.
CREATE OR REPLACE FUNCTION nudge_cars(p_bucket text, p_limit integer DEFAULT 5)
RETURNS TABLE (
  stock_number text, vin text, vehicle text,
  days_owned integer, days_here integer, location text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT
      inv.stock_number, inv.vehicle_vin,
      btrim(concat_ws(' ', inv.vehicle_year, inv.vehicle_make, inv.vehicle_model)) AS vehicle,
      NULLIF(regexp_replace(COALESCE(inv.days_on_lot::text, ''), '[^0-9]', '', 'g'), '')::int AS dol,
      inv.location_code, inv.vendor,
      vl.physical_location, vl.location_updated_at,
      GREATEST(ls.last_seen_at, vl.location_updated_at) AS tracked_at
    FROM inventory inv
    LEFT JOIN vehicle_locations vl ON vl.stock_number = inv.stock_number
    LEFT JOIN vehicle_lot_status ls ON ls.stock_number = inv.stock_number
  ),
  scored AS (
    SELECT b.*,
      CASE
        WHEN b.tracked_at IS NOT NULL
          THEN LEAST(floor(EXTRACT(epoch FROM (now() - b.tracked_at)) / 86400)::int,
                     COALESCE(b.dol, 2147483647))
        WHEN b.location_code = 'Z' THEN b.dol
      END AS days_untracked,
      floor(EXTRACT(epoch FROM (now() - b.location_updated_at)) / 86400)::int AS days_here,
      (b.location_code = 'Z'
        AND (b.physical_location IS NULL OR b.physical_location = 'unknown')) AS needs_dispatch
    FROM base b
  )
  SELECT s.stock_number, s.vehicle_vin, s.vehicle, s.dol,
         CASE WHEN p_bucket LIKE 'dispatch%' THEN NULL ELSE COALESCE(s.days_here, s.days_untracked) END,
         CASE WHEN p_bucket LIKE 'dispatch%' THEN s.vendor ELSE s.physical_location END
  FROM scored s
  WHERE CASE
          WHEN p_bucket = 'stuck21' THEN s.days_untracked >= 21
          WHEN p_bucket = 'dispatch' THEN s.needs_dispatch AND NOT nudge_owner_city(s.vendor)
          WHEN p_bucket = 'dispatch_far' THEN s.needs_dispatch AND nudge_owner_city(s.vendor)
          WHEN p_bucket = 'dispatch_memphis' THEN s.needs_dispatch AND nudge_memphis_vendor(s.vendor)
          ELSE s.physical_location = ANY (shop_locations(p_bucket))
        END
  ORDER BY
    CASE
      WHEN p_bucket = 'stuck21' THEN s.days_untracked
      WHEN p_bucket LIKE 'dispatch%' THEN s.dol
      ELSE s.days_here
    END DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
$$;
REVOKE ALL ON FUNCTION nudge_cars(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nudge_cars(text, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
