-- A car marked "in transit" was falling off the transport chase entirely.
--
-- needs_dispatch meant "Frazer says Transport and we don't know where it is".
-- The moment anyone marked a car in_transit it satisfied "we know where it is"
-- and vanished from every pickup list — so a car that has been in transit for
-- three weeks, which is exactly the one worth asking about, was invisible while
-- a car bought yesterday was on the list.
--
-- In transit is still not delivered. It stays on the list until it lands
-- somewhere real, and the clock that matters becomes time IN TRANSIT rather than
-- time owned: a 60-day-old car that started moving yesterday is fine, a 20-day
-- transit on a fresh purchase is not.
CREATE OR REPLACE FUNCTION nudge_cars(p_bucket text, p_limit integer DEFAULT 5,
                                      p_min_days integer DEFAULT 0)
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
      -- Waiting on transport: never collected, OR collected and still moving.
      ((b.location_code = 'Z'
          AND (b.physical_location IS NULL OR b.physical_location = 'unknown'))
        OR b.physical_location = 'in_transit') AS needs_dispatch,
      (b.physical_location = 'in_transit') AS moving
    FROM base b
  )
  SELECT s.stock_number, s.vehicle_vin, s.vehicle, s.dol,
         CASE WHEN p_bucket LIKE 'dispatch%'
              THEN CASE WHEN s.moving THEN s.days_here END
              ELSE COALESCE(s.days_here, s.days_untracked) END,
         CASE WHEN p_bucket LIKE 'dispatch%'
              THEN CASE WHEN s.moving THEN 'in transit from ' || COALESCE(s.vendor, '?')
                        ELSE s.vendor END
              ELSE s.physical_location END
  FROM scored s
  WHERE CASE
          WHEN p_bucket = 'stuck21' THEN s.days_untracked >= 21
          WHEN p_bucket = 'dispatch_memphis' THEN s.needs_dispatch AND nudge_memphis_vendor(s.vendor)
          WHEN p_bucket = 'dispatch_alabama' THEN s.needs_dispatch AND nudge_alabama_vendor(s.vendor)
          WHEN p_bucket = 'dispatch_west'    THEN s.needs_dispatch AND nudge_west_vendor(s.vendor)
          WHEN p_bucket = 'dispatch' THEN s.needs_dispatch
            AND nudge_is_auction(s.vendor)
            AND NOT nudge_memphis_vendor(s.vendor)
            AND NOT nudge_alabama_vendor(s.vendor)
            AND NOT nudge_west_vendor(s.vendor)
          WHEN p_bucket = 'dispatch_private' THEN s.needs_dispatch
            AND NOT nudge_is_auction(s.vendor)
          ELSE s.physical_location = ANY (shop_locations(p_bucket))
        END
    -- Once it's moving, judge it on how long it's been moving.
    AND COALESCE(
          CASE WHEN p_bucket LIKE 'dispatch%'
               THEN CASE WHEN s.moving THEN s.days_here ELSE s.dol END
               ELSE COALESCE(s.days_here, s.days_untracked) END, 0
        ) >= COALESCE(p_min_days, 0)
  ORDER BY
    CASE
      WHEN p_bucket = 'stuck21' THEN s.days_untracked
      WHEN p_bucket LIKE 'dispatch%' THEN CASE WHEN s.moving THEN s.days_here ELSE s.dol END
      ELSE s.days_here
    END DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
$$;
REVOKE ALL ON FUNCTION nudge_cars(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nudge_cars(text, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
