-- Comprehensive System Improvements Migration
-- This migration addresses critical system issues and adds missing functionality

-- ============================================
-- 1. FINANCIAL TRACKING ENHANCEMENTS
-- ============================================

-- Add comprehensive financial fields to inventory
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS 
  purchase_price DECIMAL(10,2),
  transportation_cost DECIMAL(10,2),
  repair_cost DECIMAL(10,2),
  detail_cost DECIMAL(10,2),
  inspection_cost DECIMAL(10,2),
  title_cost DECIMAL(10,2),
  floor_plan_cost DECIMAL(10,2),
  storage_cost DECIMAL(10,2),
  other_costs JSONB DEFAULT '{}',
  total_investment DECIMAL(10,2) GENERATED ALWAYS AS (
    COALESCE(purchase_price, 0) + 
    COALESCE(transportation_cost, 0) + 
    COALESCE(repair_cost, 0) + 
    COALESCE(detail_cost, 0) +
    COALESCE(inspection_cost, 0) +
    COALESCE(title_cost, 0) +
    COALESCE(floor_plan_cost, 0) +
    COALESCE(storage_cost, 0) +
    COALESCE(total_cost, 0)
  ) STORED,
  estimated_profit DECIMAL(10,2),
  floor_plan_start_date DATE,
  floor_plan_days INTEGER,
  title_status TEXT CHECK (title_status IN ('pending', 'in_transit', 'received', 'problem', 'ready')),
  title_received_date DATE,
  quickbooks_synced BOOLEAN DEFAULT FALSE,
  quickbooks_sync_date TIMESTAMP WITH TIME ZONE;

-- Add financial fields to sold table
ALTER TABLE sold ADD COLUMN IF NOT EXISTS
  gross_profit DECIMAL(10,2) GENERATED ALWAYS AS (
    COALESCE(sales_price, 0) - COALESCE(total_cost, 0)
  ) STORED,
  net_profit DECIMAL(10,2),
  roi_percentage DECIMAL(5,2),
  quickbooks_invoice_id TEXT,
  payment_status TEXT CHECK (payment_status IN ('pending', 'partial', 'paid', 'overdue'));

-- ============================================
-- 2. DATA SYNCHRONIZATION IMPROVEMENTS
-- ============================================

-- Create master location view that consolidates all location sources
CREATE OR REPLACE VIEW vehicle_master_location AS
SELECT 
  COALESCE(i.stock_number, vl.stock_number) as stock_number,
  COALESCE(i.vehicle_vin, vl.vin) as vin,
  -- Determine authoritative location
  CASE 
    WHEN vl.physical_location IS NOT NULL AND vl.location_updated_at > (NOW() - INTERVAL '7 days') 
      THEN vl.physical_location
    WHEN i.location_code = 'M' THEN 'memphis'
    WHEN i.location_code = 'J' THEN 'jackson'
    WHEN i.location_code = 'Z' AND vl.physical_location = 'in_transit' THEN 'in_transit'
    WHEN i.location_code = 'Z' THEN 'needs_dispatch'
    WHEN i.location_code = 'X' THEN 'in_transit'
    WHEN i.location_code = 'A' THEN 'auction'
    ELSE COALESCE(vl.physical_location, 'unknown')
  END as current_location,
  i.location_code as frazer_location_code,
  vl.physical_location as manual_location,
  vl.physical_source as location_source,
  GREATEST(i.updated_at, vl.updated_at) as last_updated,
  vl.location_updated_at,
  -- Calculate days at location
  CASE 
    WHEN vl.location_updated_at IS NOT NULL 
      THEN EXTRACT(DAY FROM NOW() - vl.location_updated_at)::INTEGER
    ELSE i.days_on_lot
  END as days_at_location
FROM inventory i
FULL OUTER JOIN vehicle_locations vl ON i.stock_number = vl.stock_number;

-- Function to sync location changes bidirectionally
CREATE OR REPLACE FUNCTION sync_vehicle_location()
RETURNS TRIGGER AS $$
BEGIN
  -- When vehicle_locations is updated, update inventory if needed
  IF TG_TABLE_NAME = 'vehicle_locations' THEN
    IF NEW.physical_location = 'in_transit' THEN
      UPDATE inventory 
      SET location_code = 'X' 
      WHERE stock_number = NEW.stock_number 
        AND location_code = 'Z';
    ELSIF NEW.physical_location IN ('memphis', 'front') THEN
      UPDATE inventory 
      SET location_code = 'M' 
      WHERE stock_number = NEW.stock_number;
    ELSIF NEW.physical_location = 'jackson' THEN
      UPDATE inventory 
      SET location_code = 'J' 
      WHERE stock_number = NEW.stock_number;
    END IF;
  END IF;
  
  -- When inventory location_code changes, update vehicle_locations
  IF TG_TABLE_NAME = 'inventory' AND OLD.location_code != NEW.location_code THEN
    INSERT INTO vehicle_locations (stock_number, vin, physical_location, physical_source, location_updated_at)
    VALUES (
      NEW.stock_number,
      NEW.vehicle_vin,
      CASE 
        WHEN NEW.location_code = 'M' THEN 'memphis'
        WHEN NEW.location_code = 'J' THEN 'jackson'
        WHEN NEW.location_code = 'X' THEN 'in_transit'
        WHEN NEW.location_code = 'A' THEN 'auction'
        ELSE 'unknown'
      END,
      'frazer_sync',
      NOW()
    )
    ON CONFLICT (stock_number) 
    DO UPDATE SET 
      physical_location = EXCLUDED.physical_location,
      physical_source = EXCLUDED.physical_source,
      location_updated_at = EXCLUDED.location_updated_at;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for bidirectional sync
DROP TRIGGER IF EXISTS sync_location_from_vehicle_locations ON vehicle_locations;
CREATE TRIGGER sync_location_from_vehicle_locations
AFTER INSERT OR UPDATE ON vehicle_locations
FOR EACH ROW
EXECUTE FUNCTION sync_vehicle_location();

DROP TRIGGER IF EXISTS sync_location_from_inventory ON inventory;
CREATE TRIGGER sync_location_from_inventory
AFTER UPDATE ON inventory
FOR EACH ROW
WHEN (OLD.location_code IS DISTINCT FROM NEW.location_code)
EXECUTE FUNCTION sync_vehicle_location();

-- ============================================
-- 3. PERFORMANCE OPTIMIZATION - INDEXES
-- ============================================

-- Inventory indexes
CREATE INDEX IF NOT EXISTS idx_inventory_location_code ON inventory(location_code);
CREATE INDEX IF NOT EXISTS idx_inventory_days_on_lot ON inventory(days_on_lot);
CREATE INDEX IF NOT EXISTS idx_inventory_vendor ON inventory(vendor);
CREATE INDEX IF NOT EXISTS idx_inventory_buyer ON inventory(buyer);
CREATE INDEX IF NOT EXISTS idx_inventory_total_cost ON inventory(total_cost);
CREATE INDEX IF NOT EXISTS idx_inventory_vin ON inventory(vehicle_vin);
CREATE INDEX IF NOT EXISTS idx_inventory_last_6_vin ON inventory(last_6_vin);

-- Vehicle locations indexes
CREATE INDEX IF NOT EXISTS idx_vehicle_locations_physical_location ON vehicle_locations(physical_location);
CREATE INDEX IF NOT EXISTS idx_vehicle_locations_location_updated ON vehicle_locations(location_updated_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_locations_vin ON vehicle_locations(vin);

-- Inspections indexes
CREATE INDEX IF NOT EXISTS idx_inspections_status ON inspections(status);
CREATE INDEX IF NOT EXISTS idx_inspections_type ON inspections(type);
CREATE INDEX IF NOT EXISTS idx_inspections_completed_at ON inspections(completed_at);
CREATE INDEX IF NOT EXISTS idx_inspections_stock_number ON inspections(stock_number);

-- Sold indexes
CREATE INDEX IF NOT EXISTS idx_sold_sale_date ON sold(sale_date);
CREATE INDEX IF NOT EXISTS idx_sold_profit_on_sale ON sold(profit_on_sale);
CREATE INDEX IF NOT EXISTS idx_sold_buyer ON sold(buyer);

-- ============================================
-- 4. DATA VALIDATION RULES
-- ============================================

-- Add constraints to prevent invalid data
ALTER TABLE inventory 
  ADD CONSTRAINT chk_valid_location_code 
  CHECK (location_code IN ('M', 'J', 'Z', 'X', 'A', 'S', 'C', 'P', 'U'));

ALTER TABLE vehicle_locations
  ADD CONSTRAINT chk_valid_physical_location
  CHECK (physical_location ~ '^[a-z0-9_]+$');

-- Function to validate VIN format
CREATE OR REPLACE FUNCTION validate_vin(vin TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  -- VIN should be 17 characters, no I, O, Q
  RETURN vin ~ '^[A-HJ-NPR-Z0-9]{17}$';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add VIN validation
ALTER TABLE inventory
  ADD CONSTRAINT chk_valid_vin
  CHECK (vehicle_vin IS NULL OR validate_vin(vehicle_vin));

-- ============================================
-- 5. REPORTING TABLES AND VIEWS
-- ============================================

-- Create materialized view for dashboard statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS dashboard_stats AS
SELECT 
  COUNT(DISTINCT i.stock_number) as total_inventory,
  AVG(i.days_on_lot)::INTEGER as avg_days_on_lot,
  AVG(i.added_costs)::DECIMAL(10,2) as avg_added_costs,
  AVG(i.total_cost)::DECIMAL(10,2) as avg_total_cost,
  COUNT(DISTINCT CASE WHEN vml.days_at_location >= 21 THEN i.stock_number END) as stuck_count,
  COUNT(DISTINCT CASE WHEN vml.days_at_location IS NULL THEN i.stock_number END) as missing_count,
  COUNT(DISTINCT CASE WHEN vml.current_location = 'needs_dispatch' THEN i.stock_number END) as needs_dispatch_count,
  COUNT(DISTINCT CASE WHEN ins.status = 'in_progress' THEN ins.id END) as active_inspections,
  -- Financial metrics
  SUM(i.total_investment) as total_investment,
  AVG(s.gross_profit) as avg_gross_profit,
  AVG(s.roi_percentage) as avg_roi,
  -- Location breakdown
  COUNT(DISTINCT CASE WHEN vml.current_location = 'memphis' THEN i.stock_number END) as memphis_count,
  COUNT(DISTINCT CASE WHEN vml.current_location = 'jackson' THEN i.stock_number END) as jackson_count,
  COUNT(DISTINCT CASE WHEN vml.current_location = 'in_transit' THEN i.stock_number END) as transit_count,
  COUNT(DISTINCT CASE WHEN vml.current_location LIKE '%auction%' THEN i.stock_number END) as auction_count,
  NOW() as last_refreshed
FROM inventory i
LEFT JOIN vehicle_master_location vml ON i.stock_number = vml.stock_number
LEFT JOIN inspections ins ON i.stock_number = ins.stock_number
LEFT JOIN sold s ON i.stock_number = s.stock_number;

-- Create index on materialized view
CREATE UNIQUE INDEX ON dashboard_stats(last_refreshed);

-- Function to refresh dashboard stats
CREATE OR REPLACE FUNCTION refresh_dashboard_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_stats;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. AUDIT AND HISTORY TRACKING
-- ============================================

-- Create comprehensive audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data JSONB,
  new_data JSONB,
  changed_fields TEXT[],
  user_id UUID REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_audit_log_table_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);

-- Generic audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
DECLARE
  changed_fields TEXT[];
  old_json JSONB;
  new_json JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_json = to_jsonb(OLD);
    INSERT INTO audit_log (table_name, record_id, action, old_data, user_id)
    VALUES (
      TG_TABLE_NAME, 
      OLD.stock_number::TEXT, 
      'DELETE', 
      old_json,
      auth.uid()
    );
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    old_json = to_jsonb(OLD);
    new_json = to_jsonb(NEW);
    
    -- Find changed fields
    SELECT array_agg(key) INTO changed_fields
    FROM jsonb_each(old_json) o
    FULL OUTER JOIN jsonb_each(new_json) n ON o.key = n.key
    WHERE o.value IS DISTINCT FROM n.value;
    
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_fields, user_id)
    VALUES (
      TG_TABLE_NAME,
      NEW.stock_number::TEXT,
      'UPDATE',
      old_json,
      new_json,
      changed_fields,
      auth.uid()
    );
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    new_json = to_jsonb(NEW);
    INSERT INTO audit_log (table_name, record_id, action, new_data, user_id)
    VALUES (
      TG_TABLE_NAME,
      NEW.stock_number::TEXT,
      'INSERT',
      new_json,
      auth.uid()
    );
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Add audit triggers to critical tables
CREATE TRIGGER audit_inventory AFTER INSERT OR UPDATE OR DELETE ON inventory
FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER audit_vehicle_locations AFTER INSERT OR UPDATE OR DELETE ON vehicle_locations
FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- ============================================
-- 7. ERROR HANDLING AND DATA CLEANUP
-- ============================================

-- Function to clean up orphaned records
CREATE OR REPLACE FUNCTION cleanup_orphaned_records()
RETURNS TABLE(
  table_name TEXT,
  records_deleted INTEGER
) AS $$
DECLARE
  vl_deleted INTEGER;
  ins_deleted INTEGER;
BEGIN
  -- Delete vehicle_locations for non-existent inventory
  DELETE FROM vehicle_locations vl
  WHERE NOT EXISTS (
    SELECT 1 FROM inventory i WHERE i.stock_number = vl.stock_number
  );
  GET DIAGNOSTICS vl_deleted = ROW_COUNT;
  
  -- Delete orphaned inspections
  DELETE FROM inspections ins
  WHERE ins.stock_number IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM inventory i WHERE i.stock_number = ins.stock_number
    );
  GET DIAGNOSTICS ins_deleted = ROW_COUNT;
  
  RETURN QUERY
  SELECT 'vehicle_locations', vl_deleted
  UNION ALL
  SELECT 'inspections', ins_deleted;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 8. QUICKBOOKS INTEGRATION PREPARATION
-- ============================================

-- Table for QuickBooks sync queue
CREATE TABLE IF NOT EXISTS quickbooks_sync_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('inventory', 'sold', 'expense')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_qb_sync_status ON quickbooks_sync_queue(status);
CREATE INDEX idx_qb_sync_created ON quickbooks_sync_queue(created_at);

-- ============================================
-- 9. ENHANCED REPORTING VIEWS
-- ============================================

-- Comprehensive inventory analysis view
CREATE OR REPLACE VIEW inventory_analysis AS
SELECT 
  i.*,
  vml.current_location,
  vml.days_at_location,
  -- Age categories
  CASE 
    WHEN i.days_on_lot <= 10 THEN 'fresh'
    WHEN i.days_on_lot <= 30 THEN 'aging'
    WHEN i.days_on_lot <= 60 THEN 'stale'
    ELSE 'old'
  END as age_category,
  -- Location status
  CASE 
    WHEN vml.days_at_location >= 21 THEN 'stuck'
    WHEN vml.days_at_location >= 14 THEN 'warning'
    WHEN vml.days_at_location >= 7 THEN 'normal'
    ELSE 'fresh'
  END as location_status,
  -- Financial metrics
  i.total_investment,
  i.estimated_profit,
  CASE 
    WHEN i.total_investment > 0 THEN 
      (i.estimated_profit / i.total_investment * 100)::DECIMAL(5,2)
    ELSE NULL
  END as estimated_roi,
  -- Inspection status
  ins.status as inspection_status,
  ins.completed_at as inspection_completed,
  -- Marketplace status
  vl.sa_status,
  vl.manheim_status,
  vl.ove_status,
  CASE 
    WHEN vl.sa_status IS NOT NULL OR vl.manheim_status IS NOT NULL OR vl.ove_status IS NOT NULL 
    THEN TRUE 
    ELSE FALSE 
  END as listed_online
FROM inventory i
LEFT JOIN vehicle_master_location vml ON i.stock_number = vml.stock_number
LEFT JOIN vehicle_locations vl ON i.stock_number = vl.stock_number
LEFT JOIN LATERAL (
  SELECT status, completed_at 
  FROM inspections 
  WHERE stock_number = i.stock_number 
  ORDER BY created_at DESC 
  LIMIT 1
) ins ON TRUE;

-- Sales performance view
CREATE OR REPLACE VIEW sales_performance AS
SELECT 
  DATE_TRUNC('month', s.sale_date) as sale_month,
  COUNT(*) as units_sold,
  SUM(s.sales_price) as total_revenue,
  SUM(s.total_cost) as total_cost,
  SUM(s.gross_profit) as total_gross_profit,
  AVG(s.gross_profit) as avg_gross_profit,
  AVG(s.days_on_lot) as avg_days_to_sale,
  AVG(s.roi_percentage) as avg_roi,
  -- Breakdown by buyer
  COUNT(DISTINCT s.buyer) as unique_buyers,
  MODE() WITHIN GROUP (ORDER BY s.buyer) as top_buyer
FROM sold s
WHERE s.sale_date IS NOT NULL
GROUP BY DATE_TRUNC('month', s.sale_date)
ORDER BY sale_month DESC;

-- ============================================
-- 10. GRANTS AND PERMISSIONS
-- ============================================

-- Ensure proper RLS policies
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE quickbooks_sync_queue ENABLE ROW LEVEL SECURITY;

-- Admin can see everything
CREATE POLICY "Admin full access to audit_log" ON audit_log
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- Users can see their own actions
CREATE POLICY "Users see own audit entries" ON audit_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Only admin can manage QuickBooks sync
CREATE POLICY "Admin manages QuickBooks sync" ON quickbooks_sync_queue
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- ============================================
-- 11. SCHEDULED MAINTENANCE
-- ============================================

-- Function to perform daily maintenance
CREATE OR REPLACE FUNCTION daily_maintenance()
RETURNS void AS $$
BEGIN
  -- Refresh materialized views
  REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_stats;
  
  -- Clean up old audit logs (keep 1 year)
  DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '1 year';
  
  -- Process QuickBooks sync queue
  UPDATE quickbooks_sync_queue 
  SET status = 'failed', 
      error_message = 'Exceeded maximum retries'
  WHERE status = 'pending' 
    AND retry_count > 5 
    AND created_at < NOW() - INTERVAL '1 day';
  
  -- Clean up orphaned records
  PERFORM cleanup_orphaned_records();
END;
$$ LANGUAGE plpgsql;

-- Comment on the migration
COMMENT ON SCHEMA public IS 'Comprehensive improvements migration v1.0 - Adds financial tracking, data sync, performance optimization, and reporting capabilities';