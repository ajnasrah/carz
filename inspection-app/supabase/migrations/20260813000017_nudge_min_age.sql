-- Don't chase a car nobody has had a chance to move yet.
--
-- "Oldest 5" means the oldest AVAILABLE, so a bucket holding four cars sends all
-- four however new they are — James's list went out with a car bought that
-- morning on it (0 days owned), and a 7-day-old Impala. Neither is late; they're
-- just the only things in the bucket. A list like that trains people to ignore it.
--
-- min_days is per recipient because the right floor differs by job: a pickup
-- three days after the sale is genuinely late, while a car at the mechanic isn't
-- worth a text until it's sat a couple of weeks.
ALTER TABLE sms_nudges ADD COLUMN IF NOT EXISTS min_days integer NOT NULL DEFAULT 0;

UPDATE sms_nudges SET min_days = 3  WHERE bucket LIKE 'dispatch%';
UPDATE sms_nudges SET min_days = 14 WHERE bucket IN ('mechanic', 'body_shop');
-- stuck21 has its own 21-day floor baked into the definition.

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
          WHEN p_bucket = 'dispatch' THEN s.needs_dispatch
            AND nudge_is_auction(s.vendor)
            AND NOT nudge_memphis_vendor(s.vendor)
            AND NOT nudge_alabama_vendor(s.vendor)
            AND NOT nudge_west_vendor(s.vendor)
          WHEN p_bucket = 'dispatch_private' THEN s.needs_dispatch
            AND NOT nudge_is_auction(s.vendor)
          ELSE s.physical_location = ANY (shop_locations(p_bucket))
        END
    -- The age floor. Pickups are judged on how long we've owned the car, shop
    -- cars on how long they've sat where they are.
    AND COALESCE(
          CASE WHEN p_bucket LIKE 'dispatch%' THEN s.dol
               ELSE COALESCE(s.days_here, s.days_untracked) END, 0
        ) >= COALESCE(p_min_days, 0)
  ORDER BY
    CASE
      WHEN p_bucket = 'stuck21' THEN s.days_untracked
      WHEN p_bucket LIKE 'dispatch%' THEN s.dol
      ELSE s.days_here
    END DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
$$;
REVOKE ALL ON FUNCTION nudge_cars(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nudge_cars(text, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
