-- Tony takes the Alabama/Mississippi run: Birmingham, Moody, Huntsville and
-- Manheim Mississippi. Matched on the vendor we bought from, same as the other
-- pickup lists — a Z-code car has no tracked location yet, so the auction is the
-- only thing that says where it physically sits.
--
-- These overlap the owner's wide list (Birmingham and Huntsville are his cities)
-- on purpose: Tony works them, the owner still sees them.
ALTER TABLE sms_nudges DROP CONSTRAINT IF EXISTS sms_nudges_bucket_check;
ALTER TABLE sms_nudges ADD CONSTRAINT sms_nudges_bucket_check
  CHECK (bucket IN ('mechanic', 'body_shop', 'stuck21',
                    'dispatch', 'dispatch_far', 'dispatch_memphis', 'dispatch_alabama'));

CREATE OR REPLACE FUNCTION nudge_alabama_vendor(p_vendor text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(COALESCE(p_vendor, '')) ~
    '(BIRMINGHAM|BHAM|MOODY|HUNTSVILLE|MISSISSIPPI|MISSISIPPI|MISS\.)';
$$;

INSERT INTO sms_nudges (name, phone, bucket)
SELECT 'Tony', '+19018268646', 'dispatch_alabama'
WHERE NOT EXISTS (
  SELECT 1 FROM sms_nudges WHERE phone = '+19018268646' AND bucket = 'dispatch_alabama'
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
          WHEN p_bucket = 'dispatch' THEN s.needs_dispatch AND NOT nudge_owner_city(s.vendor)
          WHEN p_bucket = 'dispatch_far' THEN s.needs_dispatch AND nudge_owner_city(s.vendor)
          WHEN p_bucket = 'dispatch_memphis' THEN s.needs_dispatch AND nudge_memphis_vendor(s.vendor)
          WHEN p_bucket = 'dispatch_alabama' THEN s.needs_dispatch AND nudge_alabama_vendor(s.vendor)
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
