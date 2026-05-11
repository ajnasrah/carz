-- ============================================
-- CARZ INC LOT SECTIONS UPDATE
-- Run this in Supabase SQL Editor whenever the section list changes.
-- Idempotent — safe to run multiple times.
-- ============================================
--
-- Replaces the active section list with the new walk-order list below.
-- Sections that disappear from the list are DEACTIVATED (not deleted)
-- so historical lot_scans rows that reference them by name still resolve.
-- ============================================

BEGIN;

-- Upsert each section in walk order — re-activates any that were previously deactivated
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
  ('ARB Section',          10, TRUE),
  ('Wash Line',            11, TRUE)
ON CONFLICT (name) DO UPDATE
  SET sort_order = EXCLUDED.sort_order,
      active     = TRUE;

-- Deactivate anything not in the new list
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
  'ARB Section',
  'Wash Line'
);

-- Verify
SELECT name, sort_order, active FROM lot_sections ORDER BY active DESC, sort_order;

COMMIT;
