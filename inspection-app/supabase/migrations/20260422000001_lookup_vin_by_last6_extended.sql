-- Extend lookup_vin_by_last6 to return everything the Info tab needs:
-- mileage, buyer, vendor, location_code, days_on_lot, costs.
-- Keeps the same name + signature (last6 TEXT) so existing callers still work;
-- just more columns in the result.

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
     OR upper(right(i.vehicle_vin, 6)) = upper(last6);
$$;

GRANT EXECUTE ON FUNCTION lookup_vin_by_last6(TEXT) TO anon, authenticated;
