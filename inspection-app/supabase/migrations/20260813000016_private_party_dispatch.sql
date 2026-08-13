-- James was being sent cars he has no record of, and he was right to say so.
--
-- "Needs dispatch" conflates two different jobs. An auction car is waiting on a
-- lot with a gate pass and someone has to go and collect it — that's James. A
-- private-party buy has a person's name in the vendor field, because that IS the
-- seller: someone on the team bought a car off an individual. There's no auction
-- to collect from, so nothing on that list is actionable for him.
--
-- Detected by matching the auction NAMES rather than trying to spot a person's
-- name — a positive match on a known house is reliable, while "does this look
-- like a human" is not. Anything unmatched is treated as private, which fails
-- the safe way: it goes to the owner, who knows every deal, instead of to a
-- driver who'd be sent to an address that doesn't exist.
CREATE OR REPLACE FUNCTION nudge_is_auction(p_vendor text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  -- The pattern gets its own parentheses: `~` binds tighter than `||`, so
  -- without them this parses as (text ~ part1) || part2 — a boolean concatenated
  -- with text, which is text, and the function refuses to return it.
  SELECT upper(COALESCE(p_vendor, '')) ~ (
    '(ADESA|MANHEIM|\mDAA\M|\mAAA\M|\mUAX\M|COPART|\mACV\M|OPEN[^A-Z]*LANE|OPENLANE'
    || '|AUCTION|LOVELAND|ROCKIES|CARMAX|ENTERPRISE|HERTZ|AVIS|EDGE PIPELINE|BACKLOT)'
  );
$$;

ALTER TABLE sms_nudges DROP CONSTRAINT IF EXISTS sms_nudges_bucket_check;
ALTER TABLE sms_nudges ADD CONSTRAINT sms_nudges_bucket_check
  CHECK (bucket IN ('mechanic', 'body_shop', 'stuck21', 'dispatch', 'dispatch_private',
                    'dispatch_memphis', 'dispatch_alabama', 'dispatch_west'));

INSERT INTO sms_nudges (name, phone, bucket)
SELECT 'Abdullah', '+19018319661', 'dispatch_private'
WHERE NOT EXISTS (
  SELECT 1 FROM sms_nudges WHERE phone = '+19018319661' AND bucket = 'dispatch_private'
);

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
          WHEN p_bucket = 'dispatch_memphis' THEN s.needs_dispatch AND nudge_memphis_vendor(s.vendor)
          WHEN p_bucket = 'dispatch_alabama' THEN s.needs_dispatch AND nudge_alabama_vendor(s.vendor)
          WHEN p_bucket = 'dispatch_west'    THEN s.needs_dispatch AND nudge_west_vendor(s.vendor)
          -- James: the remainder, by construction.
          -- James: auction pickups the regional lists don't claim.
          WHEN p_bucket = 'dispatch' THEN s.needs_dispatch
            AND nudge_is_auction(s.vendor)
            AND NOT nudge_memphis_vendor(s.vendor)
            AND NOT nudge_alabama_vendor(s.vendor)
            AND NOT nudge_west_vendor(s.vendor)
          -- Bought off a person: no auction to collect from.
          WHEN p_bucket = 'dispatch_private' THEN s.needs_dispatch
            AND NOT nudge_is_auction(s.vendor)
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
