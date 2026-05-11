-- ============================================
-- VEHICLE LOCATIONS OVERLAY
-- Survives Frazer inventory TRUNCATE+RELOAD by living in its own table.
-- One row per stock_number — upserts from list uploads.
-- ============================================

CREATE TABLE IF NOT EXISTS vehicle_locations (
  stock_number TEXT PRIMARY KEY,
  vin TEXT,

  -- Physical where-is-the-car-now (from UAX/DAA/ADESA run lists or Super Dispatch)
  physical_location TEXT CHECK (
    physical_location IN ('on_lot', 'uax', 'daa', 'adesa', 'in_transit', 'unknown')
  ),
  physical_source TEXT,           -- 'uax' | 'daa' | 'adesa' | 'super_dispatch' | 'manual'
  location_updated_at TIMESTAMPTZ,

  -- Marketplace listing statuses (from SA / Manheim / OVE exports)
  sa_status TEXT,                 -- 'active' | 'hold' | 'sold' | 'removed' | 'expired'
  sa_updated_at TIMESTAMPTZ,
  manheim_status TEXT,
  manheim_updated_at TIMESTAMPTZ,
  ove_status TEXT,
  ove_updated_at TIMESTAMPTZ,

  -- Which marketplace closed the deal (first one to flip to 'sold' wins)
  sold_on TEXT,                   -- 'smart_auction' | 'manheim' | 'ove'
  sold_at TIMESTAMPTZ,
  sold_price NUMERIC,
  buyer_name TEXT,

  -- Extra details — lane/lot/run_date/grade/etc. as jsonb so we don't keep
  -- adding columns every time a vendor adds a field.
  notes JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_locations_vin ON vehicle_locations(vin);
CREATE INDEX IF NOT EXISTS idx_vehicle_locations_physical ON vehicle_locations(physical_location);
CREATE INDEX IF NOT EXISTS idx_vehicle_locations_sa_status ON vehicle_locations(sa_status);

-- Convenience view: inventory LEFT JOIN vehicle_locations so every read has
-- the overlay baked in without callers needing to remember the join.
CREATE OR REPLACE VIEW inventory_with_locations AS
SELECT
  i.*,
  COALESCE(vl.physical_location, 'unknown') AS current_physical_location,
  vl.physical_source,
  vl.location_updated_at,
  vl.sa_status,
  vl.sa_updated_at,
  vl.manheim_status,
  vl.manheim_updated_at,
  vl.ove_status,
  vl.ove_updated_at,
  vl.sold_on,
  vl.sold_at,
  vl.sold_price,
  vl.buyer_name,
  vl.notes AS location_notes
FROM inventory i
LEFT JOIN vehicle_locations vl USING (stock_number);

-- RLS
ALTER TABLE vehicle_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon can read vehicle_locations" ON vehicle_locations;
CREATE POLICY "Anon can read vehicle_locations"
  ON vehicle_locations FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Authenticated can read vehicle_locations" ON vehicle_locations;
CREATE POLICY "Authenticated can read vehicle_locations"
  ON vehicle_locations FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated can upsert vehicle_locations" ON vehicle_locations;
CREATE POLICY "Authenticated can upsert vehicle_locations"
  ON vehicle_locations FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Extension uses anon key, so it also needs UPDATE/INSERT perms.
DROP POLICY IF EXISTS "Anon can upsert vehicle_locations" ON vehicle_locations;
CREATE POLICY "Anon can upsert vehicle_locations"
  ON vehicle_locations FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
