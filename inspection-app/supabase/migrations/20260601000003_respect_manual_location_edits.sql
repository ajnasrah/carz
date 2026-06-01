-- ============================================
-- FIX: Respect Manual Location Edits
-- Problem: Sync from inventory overwrites manual location edits
-- Solution: Check physical_source before overwriting
-- ============================================

-- Drop the existing sync function that overwrites manual edits
DROP TRIGGER IF EXISTS sync_location_from_inventory ON inventory;
DROP FUNCTION IF EXISTS sync_vehicle_location() CASCADE;

-- Create improved sync function that respects manual edits
CREATE OR REPLACE FUNCTION sync_vehicle_location()
RETURNS TRIGGER AS $$
BEGIN
  -- Only sync FROM vehicle_locations TO inventory when manually setting to in_transit
  -- Never sync the other way (from inventory to vehicle_locations) for manual edits
  
  IF TG_TABLE_NAME = 'vehicle_locations' THEN
    -- Only update inventory location_code if this is a manual edit to in_transit
    IF NEW.physical_source = 'manual' AND NEW.physical_location = 'in_transit' THEN
      -- User manually marked as in transit, update Frazer code to X
      UPDATE inventory 
      SET location_code = 'X' 
      WHERE stock_number = NEW.stock_number 
        AND location_code IN ('Z', 'A');
    END IF;
  END IF;
  
  -- When inventory location_code changes, only update vehicle_locations if:
  -- 1. The vehicle_locations record doesn't exist yet, OR
  -- 2. The existing record is NOT from a manual source
  IF TG_TABLE_NAME = 'inventory' AND OLD.location_code IS DISTINCT FROM NEW.location_code THEN
    -- Check if there's an existing manual edit we should preserve
    DECLARE
      existing_record RECORD;
    BEGIN
      SELECT physical_source, physical_location 
      INTO existing_record
      FROM vehicle_locations 
      WHERE stock_number = NEW.stock_number;
      
      -- Only update if no record exists or it's not a manual edit
      IF NOT FOUND OR existing_record.physical_source != 'manual' THEN
        INSERT INTO vehicle_locations (
          stock_number, 
          vin, 
          physical_location, 
          physical_source, 
          location_updated_at
        )
        VALUES (
          NEW.stock_number,
          NEW.vehicle_vin,
          CASE 
            WHEN NEW.location_code = 'M' THEN 'memphis'
            WHEN NEW.location_code = 'J' THEN 'jackson'
            WHEN NEW.location_code = 'X' THEN 'in_transit'
            WHEN NEW.location_code = 'A' THEN 'auction'
            WHEN NEW.location_code = 'Z' THEN NULL -- Don't set location for Z
            ELSE NULL
          END,
          'frazer_sync',
          NOW()
        )
        ON CONFLICT (stock_number) 
        DO UPDATE SET
          physical_location = EXCLUDED.physical_location,
          physical_source = EXCLUDED.physical_source,
          location_updated_at = EXCLUDED.location_updated_at
        WHERE vehicle_locations.physical_source != 'manual'; -- Never overwrite manual edits
      END IF;
    END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-create triggers with the improved function
DROP TRIGGER IF EXISTS sync_location_from_vehicle_locations ON vehicle_locations;
CREATE TRIGGER sync_location_from_vehicle_locations
AFTER UPDATE ON vehicle_locations
FOR EACH ROW
WHEN (NEW.physical_source = 'manual')
EXECUTE FUNCTION sync_vehicle_location();

-- Note: We're NOT re-creating the inventory->vehicle_locations trigger
-- because we handle that logic inside the function now with proper checks

-- Add comment explaining the logic
COMMENT ON FUNCTION sync_vehicle_location() IS 
'Syncs location data between inventory and vehicle_locations tables.
IMPORTANT: Manual edits (physical_source = manual) are never overwritten by automated syncs.
When a user manually updates a location, it takes precedence over Frazer location codes.';

-- Create a function to clean up stuck vehicles that have been manually moved
CREATE OR REPLACE FUNCTION fix_stuck_vehicles_with_manual_edits()
RETURNS void AS $$
BEGIN
  -- Find vehicles with location_code Z but manual physical_location set
  UPDATE vehicle_locations vl
  SET 
    notes = COALESCE(notes, '{}'::jsonb) || jsonb_build_object(
      'manual_override_preserved', true,
      'frazer_code_ignored', 'Z',
      'fixed_at', NOW()
    ),
    updated_at = NOW()
  FROM inventory inv
  WHERE 
    vl.stock_number = inv.stock_number
    AND inv.location_code = 'Z'
    AND vl.physical_source = 'manual'
    AND vl.physical_location IS NOT NULL
    AND vl.physical_location NOT IN ('', 'in_transit');
    
  RAISE NOTICE 'Fixed % vehicles with manual location overrides', FOUND;
END;
$$ LANGUAGE plpgsql;

-- Run the fix immediately
SELECT fix_stuck_vehicles_with_manual_edits();

-- Add index for better performance on physical_source queries
CREATE INDEX IF NOT EXISTS idx_vehicle_locations_physical_source 
ON vehicle_locations(physical_source) 
WHERE physical_source = 'manual';