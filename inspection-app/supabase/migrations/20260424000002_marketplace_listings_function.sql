-- Create marketplace_listings function to show inventory with completed inspections
CREATE OR REPLACE FUNCTION marketplace_listings()
RETURNS TABLE (
  id uuid,
  stock_number text,
  vin text,
  vin_last6 text,
  full_vin text,
  year text,
  make text,
  model text,
  vehicle_color text,
  mileage text,
  checklist jsonb,
  completed_at timestamptz
) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(i.id, gen_random_uuid()) as id,
    inv.stock_number,
    COALESCE(i.vin, inv.last_6_vin) as vin,
    inv.last_6_vin as vin_last6,
    inv.vehicle_vin as full_vin,
    inv.vehicle_year as year,
    inv.vehicle_make as make,
    inv.vehicle_model as model,
    inv.vehicle_color,
    inv.mileage::text as mileage,
    i.checklist,
    i.completed_at
  FROM inventory inv
  INNER JOIN inspections i ON (
    -- Match by last 6 of VIN (most common)
    i.vin_last6 = inv.last_6_vin
    OR i.vin = inv.last_6_vin
    OR
    -- Match by full VIN if available
    i.vin = inv.vehicle_vin
    OR
    -- Match by stock number if available
    (i.stock_number IS NOT NULL AND i.stock_number = inv.stock_number)
  )
  WHERE 
    -- Only show cars that have been inspected
    i.completed_at IS NOT NULL
    AND inv.stock_number IS NOT NULL
  ORDER BY 
    COALESCE(i.completed_at, NOW()) DESC,
    inv.stock_number;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION marketplace_listings() TO anon, authenticated;