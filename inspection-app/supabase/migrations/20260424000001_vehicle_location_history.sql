-- ============================================
-- VEHICLE LOCATION HISTORY
-- Full audit trail of all location changes and events for vehicles
-- Captures every movement, status change, and marketplace activity
-- ============================================

-- Create the history table that tracks all changes
CREATE TABLE IF NOT EXISTS vehicle_location_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stock_number TEXT NOT NULL,
  vin TEXT,
  
  -- Event categorization
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'location_change',       -- Physical location changed
      'marketplace_listed',    -- Listed on SA/Manheim/OVE
      'marketplace_status',    -- Status change on marketplace
      'marketplace_sold',      -- Sold through marketplace
      'transport_initiated',   -- Started transport
      'transport_completed',   -- Completed transport
      'service_sent',         -- Sent to mechanic/body shop/etc
      'service_completed',    -- Returned from service
      'inventory_added',      -- First added to inventory
      'inventory_removed',    -- Removed from inventory
      'manual_update',        -- Manual location update
      'scan_detected',        -- Detected by lot scanner
      'note_added'           -- Notes or custom info added
    )
  ),
  
  -- Location tracking
  previous_location TEXT,
  new_location TEXT,
  location_source TEXT,    -- 'uax', 'daa', 'adesa', 'super_dispatch', 'manual', 'scanner', 'chat'
  
  -- Marketplace tracking
  marketplace TEXT,         -- 'smart_auction', 'manheim', 'ove'
  marketplace_status TEXT,  -- 'active', 'hold', 'sold', 'removed', 'expired'
  listing_price NUMERIC,
  sale_price NUMERIC,
  buyer_name TEXT,
  
  -- Service/Transport details
  service_provider TEXT,    -- Name of mechanic shop, body shop, etc
  service_type TEXT,        -- 'mechanic', 'body_shop', 'upholstery', 'glass', 'detailing'
  transport_carrier TEXT,   -- Transport company name
  transport_destination TEXT,
  estimated_arrival DATE,
  
  -- Metadata
  event_data JSONB DEFAULT '{}'::jsonb,  -- Additional flexible data
  created_by TEXT,          -- User who made the change
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Foreign key to current vehicle_locations
  FOREIGN KEY (stock_number) REFERENCES vehicle_locations(stock_number) ON DELETE CASCADE
);

-- Indexes for efficient querying
CREATE INDEX idx_vlh_stock_number ON vehicle_location_history(stock_number);
CREATE INDEX idx_vlh_vin ON vehicle_location_history(vin);
CREATE INDEX idx_vlh_event_type ON vehicle_location_history(event_type);
CREATE INDEX idx_vlh_created_at ON vehicle_location_history(created_at DESC);
CREATE INDEX idx_vlh_marketplace ON vehicle_location_history(marketplace) WHERE marketplace IS NOT NULL;
CREATE INDEX idx_vlh_new_location ON vehicle_location_history(new_location);

-- Function to automatically log location changes
CREATE OR REPLACE FUNCTION log_vehicle_location_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip if this is the first insert (no previous state to compare)
  IF TG_OP = 'INSERT' THEN
    -- Log initial inventory entry
    INSERT INTO vehicle_location_history (
      stock_number, vin, event_type, 
      new_location, location_source,
      marketplace, marketplace_status,
      event_data, created_by
    ) VALUES (
      NEW.stock_number, 
      NEW.vin,
      'inventory_added',
      NEW.physical_location,
      NEW.physical_source,
      CASE 
        WHEN NEW.sa_status IS NOT NULL THEN 'smart_auction'
        WHEN NEW.manheim_status IS NOT NULL THEN 'manheim'
        WHEN NEW.ove_status IS NOT NULL THEN 'ove'
      END,
      COALESCE(NEW.sa_status, NEW.manheim_status, NEW.ove_status),
      jsonb_build_object(
        'initial_record', true,
        'notes', NEW.notes
      ),
      current_setting('app.current_user', true)
    );
    RETURN NEW;
  END IF;
  
  -- For updates, log various types of changes
  IF TG_OP = 'UPDATE' THEN
    -- Physical location change
    IF OLD.physical_location IS DISTINCT FROM NEW.physical_location THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type,
        previous_location, new_location, location_source,
        event_data, created_by
      ) VALUES (
        NEW.stock_number,
        NEW.vin,
        'location_change',
        OLD.physical_location,
        NEW.physical_location,
        NEW.physical_source,
        jsonb_build_object(
          'location_updated_at', NEW.location_updated_at,
          'notes', NEW.notes
        ),
        current_setting('app.current_user', true)
      );
    END IF;
    
    -- SmartAuction status change
    IF OLD.sa_status IS DISTINCT FROM NEW.sa_status THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type,
        marketplace, marketplace_status,
        listing_price, sale_price, buyer_name,
        event_data, created_by
      ) VALUES (
        NEW.stock_number,
        NEW.vin,
        CASE 
          WHEN NEW.sa_status = 'sold' THEN 'marketplace_sold'
          WHEN OLD.sa_status IS NULL THEN 'marketplace_listed'
          ELSE 'marketplace_status'
        END,
        'smart_auction',
        NEW.sa_status,
        (NEW.notes->>'listing_price')::numeric,
        CASE WHEN NEW.sa_status = 'sold' THEN NEW.sold_price END,
        CASE WHEN NEW.sa_status = 'sold' THEN NEW.buyer_name END,
        jsonb_build_object(
          'previous_status', OLD.sa_status,
          'updated_at', NEW.sa_updated_at
        ),
        current_setting('app.current_user', true)
      );
    END IF;
    
    -- Manheim status change
    IF OLD.manheim_status IS DISTINCT FROM NEW.manheim_status THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type,
        marketplace, marketplace_status,
        sale_price, buyer_name,
        event_data, created_by
      ) VALUES (
        NEW.stock_number,
        NEW.vin,
        CASE 
          WHEN NEW.manheim_status = 'sold' THEN 'marketplace_sold'
          WHEN OLD.manheim_status IS NULL THEN 'marketplace_listed'
          ELSE 'marketplace_status'
        END,
        'manheim',
        NEW.manheim_status,
        CASE WHEN NEW.manheim_status = 'sold' THEN NEW.sold_price END,
        CASE WHEN NEW.manheim_status = 'sold' THEN NEW.buyer_name END,
        jsonb_build_object(
          'previous_status', OLD.manheim_status,
          'updated_at', NEW.manheim_updated_at
        ),
        current_setting('app.current_user', true)
      );
    END IF;
    
    -- OVE status change
    IF OLD.ove_status IS DISTINCT FROM NEW.ove_status THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type,
        marketplace, marketplace_status,
        sale_price, buyer_name,
        event_data, created_by
      ) VALUES (
        NEW.stock_number,
        NEW.vin,
        CASE 
          WHEN NEW.ove_status = 'sold' THEN 'marketplace_sold'
          WHEN OLD.ove_status IS NULL THEN 'marketplace_listed'
          ELSE 'marketplace_status'
        END,
        'ove',
        NEW.ove_status,
        CASE WHEN NEW.ove_status = 'sold' THEN NEW.sold_price END,
        CASE WHEN NEW.ove_status = 'sold' THEN NEW.buyer_name END,
        jsonb_build_object(
          'previous_status', OLD.ove_status,
          'updated_at', NEW.ove_updated_at
        ),
        current_setting('app.current_user', true)
      );
    END IF;
    
    -- Check for service-related location changes
    IF NEW.physical_location IN ('mechanic_section', 'body_shop', 'summit_tire', 
                                  'pro_auto', 'upholstery', 'tri_state_glass', 
                                  'city_auto', 'jim_keras_chevy_service', '901_sound') 
       AND OLD.physical_location IS DISTINCT FROM NEW.physical_location THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type,
        previous_location, new_location,
        service_provider, service_type,
        event_data, created_by
      ) VALUES (
        NEW.stock_number,
        NEW.vin,
        'service_sent',
        OLD.physical_location,
        NEW.physical_location,
        NEW.physical_location,
        CASE 
          WHEN NEW.physical_location = 'mechanic_section' THEN 'mechanic'
          WHEN NEW.physical_location = 'body_shop' THEN 'body_shop'
          WHEN NEW.physical_location IN ('upholstery', '901_sound') THEN 'upholstery'
          WHEN NEW.physical_location = 'tri_state_glass' THEN 'glass'
          ELSE 'service'
        END,
        NEW.notes,
        current_setting('app.current_user', true)
      );
    END IF;
    
    -- Check for transport status
    IF NEW.physical_location = 'in_transit' AND OLD.physical_location != 'in_transit' THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type,
        previous_location, new_location,
        transport_destination,
        event_data, created_by
      ) VALUES (
        NEW.stock_number,
        NEW.vin,
        'transport_initiated',
        OLD.physical_location,
        NEW.physical_location,
        NEW.notes->>'destination',
        NEW.notes,
        current_setting('app.current_user', true)
      );
    ELSIF OLD.physical_location = 'in_transit' AND NEW.physical_location != 'in_transit' THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type,
        previous_location, new_location,
        event_data, created_by
      ) VALUES (
        NEW.stock_number,
        NEW.vin,
        'transport_completed',
        OLD.physical_location,
        NEW.physical_location,
        NEW.notes,
        current_setting('app.current_user', true)
      );
    END IF;
  END IF;
  
  -- For deletes, log removal
  IF TG_OP = 'DELETE' THEN
    INSERT INTO vehicle_location_history (
      stock_number, vin, event_type,
      previous_location,
      event_data, created_by
    ) VALUES (
      OLD.stock_number,
      OLD.vin,
      'inventory_removed',
      OLD.physical_location,
      jsonb_build_object(
        'final_status', jsonb_build_object(
          'sa_status', OLD.sa_status,
          'manheim_status', OLD.manheim_status,
          'ove_status', OLD.ove_status,
          'sold_on', OLD.sold_on,
          'sold_price', OLD.sold_price
        )
      ),
      current_setting('app.current_user', true)
    );
    RETURN OLD;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on vehicle_locations table
DROP TRIGGER IF EXISTS vehicle_location_history_trigger ON vehicle_locations;
CREATE TRIGGER vehicle_location_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON vehicle_locations
  FOR EACH ROW
  EXECUTE FUNCTION log_vehicle_location_change();

-- Helper view to get latest location for each vehicle with history count
CREATE OR REPLACE VIEW vehicle_location_summary AS
SELECT 
  vl.*,
  COUNT(vlh.id) AS total_events,
  MAX(vlh.created_at) AS last_event_at,
  (
    SELECT json_agg(
      json_build_object(
        'event_type', h.event_type,
        'location', COALESCE(h.new_location, h.previous_location),
        'marketplace', h.marketplace,
        'status', h.marketplace_status,
        'created_at', h.created_at
      ) ORDER BY h.created_at DESC
    )
    FROM (
      SELECT * FROM vehicle_location_history 
      WHERE stock_number = vl.stock_number 
      ORDER BY created_at DESC 
      LIMIT 10
    ) h
  ) AS recent_history
FROM vehicle_locations vl
LEFT JOIN vehicle_location_history vlh ON vl.stock_number = vlh.stock_number
GROUP BY vl.stock_number, vl.vin, vl.physical_location, vl.physical_source,
         vl.location_updated_at, vl.sa_status, vl.sa_updated_at,
         vl.manheim_status, vl.manheim_updated_at, vl.ove_status,
         vl.ove_updated_at, vl.sold_on, vl.sold_at, vl.sold_price,
         vl.buyer_name, vl.notes, vl.created_at, vl.updated_at;

-- RLS Policies
ALTER TABLE vehicle_location_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon can read vehicle_location_history" ON vehicle_location_history;
CREATE POLICY "Anon can read vehicle_location_history"
  ON vehicle_location_history FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Authenticated can read vehicle_location_history" ON vehicle_location_history;
CREATE POLICY "Authenticated can read vehicle_location_history"
  ON vehicle_location_history FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated can insert vehicle_location_history" ON vehicle_location_history;
CREATE POLICY "Authenticated can insert vehicle_location_history"
  ON vehicle_location_history FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Function to manually add history entries (for backdating or corrections)
CREATE OR REPLACE FUNCTION add_vehicle_history_event(
  p_stock_number TEXT,
  p_event_type TEXT,
  p_location TEXT DEFAULT NULL,
  p_marketplace TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_notes JSONB DEFAULT '{}'::jsonb
) RETURNS void AS $$
BEGIN
  INSERT INTO vehicle_location_history (
    stock_number,
    vin,
    event_type,
    new_location,
    marketplace,
    marketplace_status,
    event_data,
    created_by
  )
  SELECT
    p_stock_number,
    vl.vin,
    p_event_type,
    p_location,
    p_marketplace,
    p_status,
    p_notes,
    current_setting('app.current_user', true)
  FROM vehicle_locations vl
  WHERE vl.stock_number = p_stock_number;
END;
$$ LANGUAGE plpgsql;

-- Add update trigger for vehicle_locations updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_vehicle_locations_updated_at ON vehicle_locations;
CREATE TRIGGER update_vehicle_locations_updated_at
  BEFORE UPDATE ON vehicle_locations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

NOTIFY pgrst, 'reload schema';