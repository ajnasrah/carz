-- Fix: the SmartAuction extension's Info tab (VIN lookup) never showed a car's
-- physical_location (e.g. "In Transit" set from Telegram), because its data source
-- — lookup_vin_by_last6 — selects only from the `inventory` table, which has no
-- physical_location column. That column lives in the `vehicle_locations` overlay.
-- So popup.js read `v.physical_location` as undefined and left the label as "—".
--
-- Fix: LEFT JOIN LATERAL the newest matching vehicle_locations row and return its
-- physical_location. Frazer reuses stock numbers across different cars, so
-- vehicle_locations can carry stale rows under the same stock_number — we prefer
-- the row whose VIN matches the current inventory VIN, then fall back to the
-- newest by location_updated_at. Adding a column to RETURNS TABLE requires DROP
-- + CREATE (return type can't be altered in place).

DROP FUNCTION IF EXISTS lookup_vin_by_last6(TEXT);

CREATE FUNCTION lookup_vin_by_last6(last6 TEXT)
RETURNS TABLE (
  vehicle_vin TEXT,
  stock_number TEXT,
  vehicle_year TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  mileage TEXT,
  buyer TEXT,
  vendor TEXT,
  location_code TEXT,
  days_on_lot TEXT,
  total_cost TEXT,
  added_costs TEXT,
  physical_location TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    i.vehicle_vin,
    i.stock_number,
    i.vehicle_year,
    i.vehicle_make,
    i.vehicle_model,
    i.vehicle_color,
    i.mileage,
    i.buyer,
    i.vendor,
    i.location_code,
    i.days_on_lot,
    i.total_cost,
    i.added_costs,
    loc.physical_location
  FROM inventory i
  LEFT JOIN LATERAL (
    SELECT vl.physical_location
    FROM vehicle_locations vl
    WHERE vl.stock_number = i.stock_number
    ORDER BY
      -- Prefer the location row for THIS car's VIN (guards Frazer stock reuse)
      (upper(vl.vin) = upper(i.vehicle_vin)) DESC NULLS LAST,
      -- then the most recently updated location
      vl.location_updated_at DESC NULLS LAST
    LIMIT 1
  ) loc ON true
  WHERE upper(i.last_6_vin) = upper(last6)
     OR upper(right(i.vehicle_vin, 6)) = upper(last6)
  ORDER BY
    -- Prefer a full 17-char VIN match over a pure last_6_vin match
    (upper(right(i.vehicle_vin, 6)) = upper(last6)) DESC,
    -- Newer stock numbers win ties
    i.stock_number DESC NULLS LAST
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION lookup_vin_by_last6(TEXT) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
