-- Dispatch nudges: James chases the cars waiting to be picked up, except the
-- ones in the cities the owner handles himself.
--
-- A Z-code car has no physical location by definition — that's what "we don't
-- know where this is yet" means — so the city has to come from the vendor we
-- bought it from ("DAA HUNTSVILLE", "ADESA Colorado Springs"). That's what the
-- listed exclusions all resolve to: seven cities, not a list of auction names.
-- Matching the city rather than "adesa memphis"/"daa memphis" pair-by-pair means
-- a new auction in an existing city routes correctly without another migration.

CREATE OR REPLACE FUNCTION nudge_owner_city(p_vendor text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(COALESCE(p_vendor, '')) ~
    '(MEMPHIS|BIRMINGHAM|BHAM|HUNTSVILLE|DENVER|COLORADO SPRINGS|KANSAS CITY|TULSA|UAX)';
$$;

ALTER TABLE sms_nudges DROP CONSTRAINT IF EXISTS sms_nudges_bucket_check;
ALTER TABLE sms_nudges ADD CONSTRAINT sms_nudges_bucket_check
  CHECK (bucket IN ('mechanic', 'body_shop', 'stuck21', 'dispatch', 'dispatch_far'));

-- Everything still waiting on transport, oldest first. `dispatch` is James's
-- half; `dispatch_far` is the owner's — the cities above.
CREATE OR REPLACE FUNCTION nudge_cars(p_bucket text, p_limit integer DEFAULT 5)
RETURNS TABLE (
  stock_number text, vin text, vehicle text,
  days_owned integer, days_here integer, location text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT
      inv.stock_number,
      inv.vehicle_vin,
      btrim(concat_ws(' ', inv.vehicle_year, inv.vehicle_make, inv.vehicle_model)) AS vehicle,
      NULLIF(regexp_replace(COALESCE(inv.days_on_lot::text, ''), '[^0-9]', '', 'g'), '')::int AS dol,
      inv.location_code,
      inv.vendor,
      vl.physical_location,
      vl.location_updated_at,
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
      -- Still needs dispatch: Frazer says Transport and nothing has told us where
      -- it physically is. Once it's tracked anywhere it's been handled.
      (b.location_code = 'Z'
        AND (b.physical_location IS NULL OR b.physical_location = 'unknown')) AS needs_dispatch
    FROM base b
  )
  SELECT s.stock_number, s.vehicle_vin, s.vehicle, s.dol,
         CASE WHEN p_bucket LIKE 'dispatch%' THEN NULL ELSE COALESCE(s.days_here, s.days_untracked) END,
         -- For a car awaiting pickup the useful "where" is the auction we bought
         -- it from, since it has no tracked location yet.
         CASE WHEN p_bucket LIKE 'dispatch%' THEN s.vendor ELSE s.physical_location END
  FROM scored s
  WHERE CASE
          WHEN p_bucket = 'stuck21' THEN s.days_untracked >= 21
          WHEN p_bucket = 'dispatch' THEN s.needs_dispatch AND NOT nudge_owner_city(s.vendor)
          WHEN p_bucket = 'dispatch_far' THEN s.needs_dispatch AND nudge_owner_city(s.vendor)
          ELSE s.physical_location = ANY (shop_locations(p_bucket))
        END
  ORDER BY
    CASE
      WHEN p_bucket = 'stuck21' THEN s.days_untracked
      WHEN p_bucket LIKE 'dispatch%' THEN s.dol      -- longest owned and still not collected
      ELSE s.days_here
    END DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
$$;
REVOKE ALL ON FUNCTION nudge_cars(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nudge_cars(text, integer) TO authenticated;

INSERT INTO sms_nudges (name, phone, bucket)
SELECT v.name, v.phone, v.bucket
FROM (VALUES
  ('James',    '+15866250871', 'dispatch'),
  ('Abdullah', '+19018319661', 'dispatch_far'),
  ('Omar',     '+19018268622', 'dispatch_far')
) AS v(name, phone, bucket)
WHERE NOT EXISTS (
  SELECT 1 FROM sms_nudges s WHERE s.phone = v.phone AND s.bucket = v.bucket
);

NOTIFY pgrst, 'reload schema';
