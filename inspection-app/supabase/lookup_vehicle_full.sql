-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Creates a comprehensive vehicle lookup RPC that returns ALL inventory fields

CREATE OR REPLACE FUNCTION lookup_vehicle_full(search_vin text)
RETURNS TABLE (
  stock_number text,
  vehicle_vin text,
  last_6_vin text,
  vehicle_year text,
  vehicle_make text,
  vehicle_model text,
  vehicle_color text,
  mileage text,
  total_cost text,
  added_costs text,
  buyer text,
  vendor text,
  location_code text,
  days_on_lot text,
  purchase_date text,
  synced_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    stock_number, vehicle_vin, last_6_vin,
    vehicle_year, vehicle_make, vehicle_model, vehicle_color,
    mileage, total_cost, added_costs,
    buyer, vendor, location_code, days_on_lot,
    purchase_date, synced_at
  FROM inventory
  WHERE last_6_vin = upper(right(search_vin, 6))
     OR vehicle_vin = upper(search_vin)
  LIMIT 5;
$$;

-- Grant access to anon and authenticated roles
GRANT EXECUTE ON FUNCTION lookup_vehicle_full(text) TO anon, authenticated;
