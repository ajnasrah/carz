-- ============================================
-- CARZ INC LOT TRACKING SCHEMA
-- Run this in Supabase SQL Editor AFTER supabase-schema.sql
-- ============================================
--
-- Adds lot location tracking on top of the existing `inventory` table
-- (which is synced from Frazer via the frazer-ingest edge function).
--
-- Tables:
--   lot_sections    — list of physical sections on the lot (Front Section, Mechanic Line, etc.)
--   lot_scans       — every "I just looked at this car in this section" event
--
-- View:
--   vehicle_lot_status — latest scan per stock_number, joined to inventory + days_since_seen
--
-- Stale thresholds (used by the UI):
--   green   < 7 days
--   yellow  7-13 days
--   red     >= 14 days
--   gray    never scanned
-- ============================================

-- 1. LOT SECTIONS TABLE
CREATE TABLE IF NOT EXISTS lot_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. LOT SCANS TABLE (event log — every observation is a row)
CREATE TABLE IF NOT EXISTS lot_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_number TEXT NOT NULL,
  vin TEXT,
  section TEXT NOT NULL,
  scanned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  scanned_at TIMESTAMPTZ DEFAULT NOW(),
  input_method TEXT CHECK (input_method IN ('manual', 'barcode', 'voice')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_lot_scans_stock ON lot_scans(stock_number);
CREATE INDEX IF NOT EXISTS idx_lot_scans_scanned_at ON lot_scans(scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_lot_scans_stock_scanned ON lot_scans(stock_number, scanned_at DESC);

-- 3. VEHICLE LOT STATUS VIEW (latest scan per stock, joined to inventory)
CREATE OR REPLACE VIEW vehicle_lot_status AS
SELECT
  i.stock_number,
  i.vehicle_vin,
  i.last_6_vin,
  i.vehicle_year,
  i.vehicle_make,
  i.vehicle_model,
  i.vehicle_color,
  i.mileage,
  i.days_on_lot,
  latest.section            AS current_section,
  latest.scanned_at         AS last_seen_at,
  latest.scanned_by         AS last_seen_by,
  latest.input_method       AS last_input_method,
  CASE
    WHEN latest.scanned_at IS NULL THEN NULL
    ELSE EXTRACT(DAY FROM (NOW() - latest.scanned_at))::INT
  END                       AS days_since_seen
FROM inventory i
LEFT JOIN LATERAL (
  SELECT section, scanned_at, scanned_by, input_method
  FROM lot_scans
  WHERE stock_number = i.stock_number
  ORDER BY scanned_at DESC
  LIMIT 1
) latest ON TRUE;

-- 4. ROW LEVEL SECURITY
ALTER TABLE lot_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read lot_sections" ON lot_sections;
CREATE POLICY "Authenticated users can read lot_sections"
  ON lot_sections FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can manage lot_sections" ON lot_sections;
CREATE POLICY "Authenticated users can manage lot_sections"
  ON lot_sections FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can read lot_scans" ON lot_scans;
CREATE POLICY "Authenticated users can read lot_scans"
  ON lot_scans FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can insert lot_scans" ON lot_scans;
CREATE POLICY "Authenticated users can insert lot_scans"
  ON lot_scans FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 5. SEED THE 10 SECTIONS IN WALK ORDER (upsert — safe to re-run)
INSERT INTO lot_sections (name, sort_order, active) VALUES
  ('Front Lot',             1, TRUE),
  ('Ready / Detail',        2, TRUE),
  ('Waiting On Parts',      3, TRUE),
  ('Mechanic',              4, TRUE),
  ('Pat / Jared',           5, TRUE),
  ('Inside Mechanic Shop',  6, TRUE),
  ('Gravel',                7, TRUE),
  ('Jorge',                 8, TRUE),
  ('Sold Lot',              9, TRUE),
  ('ARB Section',          10, TRUE)
ON CONFLICT (name) DO UPDATE
  SET sort_order = EXCLUDED.sort_order,
      active     = TRUE;

-- Deactivate any section that's no longer in the active list
-- (preserves historical lot_scans rows that reference them by name).
UPDATE lot_sections SET active = FALSE
WHERE name NOT IN (
  'Front Lot',
  'Ready / Detail',
  'Waiting On Parts',
  'Mechanic',
  'Pat / Jared',
  'Inside Mechanic Shop',
  'Gravel',
  'Jorge',
  'Sold Lot',
  'ARB Section'
);
