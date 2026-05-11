-- Harden lookup_vin_by_last6 against last-6 collisions.
-- Two active cars can share the same last 6 VIN digits (1-in-16M per pair,
-- but inevitable across a dealer's history). The previous version returned
-- every match with no ORDER BY, and the caller blindly picked rows[0], which
-- could be the WRONG car — leading to the SA extension typing the wrong VIN
-- into the listing form.
--
-- Fix: order by stock_number DESC (the newest-added car typically has the
-- highest numeric stock number) and LIMIT 1 so the RPC is deterministic.

CREATE OR REPLACE FUNCTION lookup_vin_by_last6(last6 TEXT)
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
  added_costs TEXT
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
    i.added_costs
  FROM inventory i
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
