-- ============================================
-- INBOUND CAR INSPECTION SYSTEM ENHANCEMENTS
-- ============================================

-- 1. VEHICLE SOURCES TABLE
CREATE TABLE IF NOT EXISTS vehicle_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  type TEXT CHECK (type IN ('auction', 'trade_in', 'wholesale', 'consignment', 'other')),
  contact_info JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. INBOUND INSPECTIONS EXTENDED FIELDS
ALTER TABLE inspections 
ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES vehicle_sources(id),
ADD COLUMN IF NOT EXISTS purchase_price DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS transport_cost DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS arrival_date DATE,
ADD COLUMN IF NOT EXISTS lot_location TEXT,
ADD COLUMN IF NOT EXISTS condition_grade TEXT CHECK (condition_grade IN ('A', 'B', 'C', 'D', 'F')),
ADD COLUMN IF NOT EXISTS estimated_repair_cost DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS auction_grade TEXT,
ADD COLUMN IF NOT EXISTS frame_damage BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS flood_damage BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS title_status TEXT CHECK (title_status IN ('clean', 'salvage', 'rebuilt', 'lemon', 'pending')),
ADD COLUMN IF NOT EXISTS keys_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS inspection_priority TEXT CHECK (inspection_priority IN ('urgent', 'high', 'normal', 'low'));

-- 3. DAMAGE ESTIMATES TABLE
CREATE TABLE IF NOT EXISTS damage_estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID REFERENCES inspections(id) ON DELETE CASCADE,
  panel_or_zone TEXT NOT NULL,
  damage_type TEXT NOT NULL,
  severity TEXT CHECK (severity IN ('minor', 'moderate', 'severe')),
  repair_method TEXT CHECK (repair_method IN ('pdr', 'paint', 'replace', 'repair', 'detail')),
  estimated_cost DECIMAL(10,2),
  labor_hours DECIMAL(4,2),
  parts_cost DECIMAL(10,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. MECHANICAL ISSUES TABLE
CREATE TABLE IF NOT EXISTS mechanical_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID REFERENCES inspections(id) ON DELETE CASCADE,
  system TEXT CHECK (system IN ('engine', 'transmission', 'suspension', 'brakes', 'electrical', 'hvac', 'exhaust', 'cooling', 'fuel', 'other')),
  issue_description TEXT NOT NULL,
  severity TEXT CHECK (severity IN ('minor', 'moderate', 'severe', 'critical')),
  estimated_repair_cost DECIMAL(10,2),
  requires_immediate_attention BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. INSPECTION CHECKLIST ITEMS (for standardization)
CREATE TABLE IF NOT EXISTS inspection_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  subcategory TEXT,
  item_name TEXT NOT NULL,
  item_order INTEGER,
  required BOOLEAN DEFAULT true,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TIRE CONDITIONS TABLE
CREATE TABLE IF NOT EXISTS tire_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID REFERENCES inspections(id) ON DELETE CASCADE,
  position TEXT CHECK (position IN ('LF', 'RF', 'LR', 'RR', 'spare')),
  brand TEXT,
  size TEXT,
  tread_depth_32nds INTEGER,
  condition TEXT CHECK (condition IN ('excellent', 'good', 'fair', 'poor', 'replace')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. FLUID LEVELS TABLE
CREATE TABLE IF NOT EXISTS fluid_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID REFERENCES inspections(id) ON DELETE CASCADE,
  fluid_type TEXT CHECK (fluid_type IN ('engine_oil', 'transmission', 'brake', 'coolant', 'power_steering', 'windshield', 'differential')),
  level TEXT CHECK (level IN ('full', 'adequate', 'low', 'empty')),
  condition TEXT CHECK (condition IN ('clean', 'dirty', 'contaminated', 'needs_change')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. INSPECTION APPROVAL WORKFLOW
CREATE TABLE IF NOT EXISTS inspection_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID REFERENCES inspections(id) ON DELETE CASCADE,
  approver_id UUID REFERENCES auth.users(id),
  status TEXT CHECK (status IN ('pending', 'approved', 'rejected', 'needs_reinspection')),
  comments TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_damage_estimates_inspection ON damage_estimates(inspection_id);
CREATE INDEX IF NOT EXISTS idx_mechanical_issues_inspection ON mechanical_issues(inspection_id);
CREATE INDEX IF NOT EXISTS idx_tire_conditions_inspection ON tire_conditions(inspection_id);
CREATE INDEX IF NOT EXISTS idx_fluid_levels_inspection ON fluid_levels(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspections_source ON inspections(source_id);
CREATE INDEX IF NOT EXISTS idx_inspections_arrival ON inspections(arrival_date DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_priority ON inspections(inspection_priority);

-- 10. RLS POLICIES
ALTER TABLE vehicle_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE damage_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE mechanical_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE tire_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fluid_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_approvals ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all
CREATE POLICY "Users can read vehicle sources" ON vehicle_sources FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can read damage estimates" ON damage_estimates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can read mechanical issues" ON mechanical_issues FOR SELECT TO authenticated USING (true);

-- Allow users to create/update their own inspection data
CREATE POLICY "Users can manage damage estimates" ON damage_estimates FOR ALL TO authenticated 
  USING (inspection_id IN (SELECT id FROM inspections WHERE user_id = auth.uid()));
  
CREATE POLICY "Users can manage mechanical issues" ON mechanical_issues FOR ALL TO authenticated 
  USING (inspection_id IN (SELECT id FROM inspections WHERE user_id = auth.uid()));

-- 11. HELPER FUNCTION: Calculate total estimated repair cost
CREATE OR REPLACE FUNCTION calculate_total_repair_cost(inspection_uuid UUID)
RETURNS DECIMAL AS $$
DECLARE
  damage_total DECIMAL;
  mechanical_total DECIMAL;
BEGIN
  SELECT COALESCE(SUM(estimated_cost), 0) INTO damage_total
  FROM damage_estimates WHERE inspection_id = inspection_uuid;
  
  SELECT COALESCE(SUM(estimated_repair_cost), 0) INTO mechanical_total
  FROM mechanical_issues WHERE inspection_id = inspection_uuid;
  
  RETURN damage_total + mechanical_total;
END;
$$ LANGUAGE plpgsql;

-- 12. TRIGGER: Auto-update estimated repair cost
CREATE OR REPLACE FUNCTION update_inspection_repair_cost()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE inspections 
  SET estimated_repair_cost = calculate_total_repair_cost(COALESCE(NEW.inspection_id, OLD.inspection_id))
  WHERE id = COALESCE(NEW.inspection_id, OLD.inspection_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_repair_cost_on_damage
  AFTER INSERT OR UPDATE OR DELETE ON damage_estimates
  FOR EACH ROW EXECUTE FUNCTION update_inspection_repair_cost();

CREATE TRIGGER update_repair_cost_on_mechanical
  AFTER INSERT OR UPDATE OR DELETE ON mechanical_issues
  FOR EACH ROW EXECUTE FUNCTION update_inspection_repair_cost();