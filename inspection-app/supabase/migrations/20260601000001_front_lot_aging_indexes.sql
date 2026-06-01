-- Add indexes to vehicle_locations for front lot aging queries
-- These indexes optimize queries that find front lot vehicles over 10 days old not on SmartAuction

-- Index for filtering by location_updated_at and sa_status
CREATE INDEX IF NOT EXISTS idx_vehicle_locations_aging 
ON vehicle_locations(location_updated_at, sa_status) 
WHERE sold_on IS NULL;

-- Index for filtering by physical_location
CREATE INDEX IF NOT EXISTS idx_vehicle_locations_physical 
ON vehicle_locations(physical_location) 
WHERE sold_on IS NULL;

-- Composite index for the complete front lot aging query
CREATE INDEX IF NOT EXISTS idx_vehicle_locations_front_lot_aging 
ON vehicle_locations(location_updated_at, physical_location, sa_status) 
WHERE sold_on IS NULL AND (sa_status IS NULL OR sa_status != 'active');

-- Add comment explaining the indexes
COMMENT ON INDEX idx_vehicle_locations_aging IS 'Optimizes queries for vehicles aging on lot without SmartAuction listing';
COMMENT ON INDEX idx_vehicle_locations_physical IS 'Optimizes filtering by physical location for unsold vehicles';
COMMENT ON INDEX idx_vehicle_locations_front_lot_aging IS 'Composite index for front lot aging report queries';