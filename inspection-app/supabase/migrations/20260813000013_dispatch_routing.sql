-- The pickup lists, routed by who actually drives there.
--
--   Omar  — Memphis: ADESA Memphis, UAX, OpenLane
--   Tony  — Alabama/Mississippi: Birmingham, Moody, Huntsville, Manheim Mississippi
--   Owner — the west: Colorado, Oklahoma, Kansas
--   James — everything else, defined as exactly that: whatever the other three
--           don't claim. A new auction in a new state lands on James without a
--           migration, which is the point — nobody's cars fall through a gap.
--
-- Matched on the vendor we bought from, because a Z-code car has no tracked
-- location yet; the auction is the only thing that says where it sits.


-- The pattern needs its own parentheses: `~` binds tighter than `||`, so a
-- concatenated pattern parses as (text ~ 'part1') || 'part2' — boolean
-- concatenated with text, which is text, and the function refuses to return it.
CREATE OR REPLACE FUNCTION nudge_west_vendor(p_vendor text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(COALESCE(p_vendor, '')) ~ (
    '(COLORADO|DENVER|ROCKIES|LOVELAND'
    || '|OKLAHOMA|TULSA'
    || '|KANSAS|WICHITA)'
  );
$$;

DELETE FROM sms_nudges WHERE bucket = 'dispatch_far';

ALTER TABLE sms_nudges DROP CONSTRAINT IF EXISTS sms_nudges_bucket_check;
ALTER TABLE sms_nudges ADD CONSTRAINT sms_nudges_bucket_check
  CHECK (bucket IN ('mechanic', 'body_shop', 'stuck21', 'dispatch',
                    'dispatch_memphis', 'dispatch_alabama', 'dispatch_west'));
INSERT INTO sms_nudges (name, phone, bucket)
SELECT 'Abdullah', '+19018319661', 'dispatch_west'
WHERE NOT EXISTS (
  SELECT 1 FROM sms_nudges WHERE phone = '+19018319661' AND bucket = 'dispatch_west'
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
          WHEN p_bucket = 'dispatch' THEN s.needs_dispatch
            AND NOT nudge_memphis_vendor(s.vendor)
            AND NOT nudge_alabama_vendor(s.vendor)
            AND NOT nudge_west_vendor(s.vendor)
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
