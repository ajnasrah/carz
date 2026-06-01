-- Track vehicles found during lot walk that aren't in inventory
-- These could be new arrivals, customer cars, or data entry issues

-- Create table for unmatched vehicles
CREATE TABLE IF NOT EXISTS unmatched_vehicles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    scanned_value TEXT NOT NULL, -- What was scanned (VIN, partial VIN, stock number, etc.)
    scan_type TEXT, -- 'vin', 'partial_vin', 'stock_number', 'unknown'
    section TEXT NOT NULL, -- Where it was found
    scan_method TEXT, -- 'barcode', 'voice', 'manual'
    notes TEXT,
    resolution_status TEXT DEFAULT 'pending', -- 'pending', 'resolved', 'ignored'
    resolution_notes TEXT,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES auth.users(id),
    scanned_by UUID REFERENCES auth.users(id) NOT NULL,
    scanned_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes
CREATE INDEX idx_unmatched_vehicles_status ON unmatched_vehicles(resolution_status);
CREATE INDEX idx_unmatched_vehicles_scanned_at ON unmatched_vehicles(scanned_at DESC);
CREATE INDEX idx_unmatched_vehicles_scanned_value ON unmatched_vehicles(scanned_value);
CREATE INDEX idx_unmatched_vehicles_section ON unmatched_vehicles(section);

-- Enable RLS
ALTER TABLE unmatched_vehicles ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view all unmatched vehicles" ON unmatched_vehicles
    FOR SELECT USING (true);

CREATE POLICY "Users can insert unmatched vehicles" ON unmatched_vehicles
    FOR INSERT WITH CHECK (auth.uid() = scanned_by);

CREATE POLICY "Users can update unmatched vehicles" ON unmatched_vehicles
    FOR UPDATE USING (true);

-- Create a view for easier querying
CREATE OR REPLACE VIEW unmatched_vehicles_summary AS
SELECT 
    uv.*,
    u1.raw_user_meta_data->>'name' as scanned_by_name,
    u2.raw_user_meta_data->>'name' as resolved_by_name,
    CASE 
        WHEN uv.scan_type = 'vin' THEN RIGHT(uv.scanned_value, 6)
        WHEN uv.scan_type = 'partial_vin' THEN uv.scanned_value
        ELSE NULL
    END as vin_last6,
    EXTRACT(EPOCH FROM (NOW() - uv.scanned_at)) / 86400 as days_unmatched
FROM unmatched_vehicles uv
LEFT JOIN auth.users u1 ON u1.id = uv.scanned_by
LEFT JOIN auth.users u2 ON u2.id = uv.resolved_by;

-- Function to check if a scanned value matches inventory after being added
CREATE OR REPLACE FUNCTION check_unmatched_against_inventory()
RETURNS TABLE (
    unmatched_id UUID,
    scanned_value TEXT,
    matched_stock TEXT,
    matched_vin TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        uv.id,
        uv.scanned_value,
        i.stock_number,
        i.vehicle_vin
    FROM unmatched_vehicles uv
    JOIN inventory i ON (
        -- Match by full VIN
        (uv.scan_type = 'vin' AND i.vehicle_vin = uv.scanned_value) OR
        -- Match by last 6 of VIN
        (uv.scan_type IN ('vin', 'partial_vin') AND 
         RIGHT(i.vehicle_vin, 6) = RIGHT(uv.scanned_value, 6)) OR
        -- Match by stock number
        (uv.scan_type = 'stock_number' AND i.stock_number = uv.scanned_value)
    )
    WHERE uv.resolution_status = 'pending';
END;
$$ LANGUAGE plpgsql;

-- Add trigger to update updated_at
CREATE TRIGGER update_unmatched_vehicles_updated_at
    BEFORE UPDATE ON unmatched_vehicles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE unmatched_vehicles IS 'Tracks vehicles scanned during lot walk that dont match inventory';
COMMENT ON COLUMN unmatched_vehicles.scan_type IS 'Type of scan: vin, partial_vin, stock_number, or unknown';
COMMENT ON COLUMN unmatched_vehicles.resolution_status IS 'Status: pending (needs attention), resolved (matched to inventory), ignored (confirmed not our vehicle)';