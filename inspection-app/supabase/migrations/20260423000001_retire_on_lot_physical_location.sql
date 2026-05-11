-- Retire the generic `on_lot` physical_location value.
-- The Inventory editor now exposes Front / Mechanic Section / Body Shop
-- for Memphis positions, plus Jackson as its own lot. `on_lot` was a vague
-- "somewhere on the Memphis lot" placeholder that no longer makes sense.
--
-- Legacy rows set to `on_lot` are migrated to `front` (the ready / display
-- lot) as the safest default. Re-tag manually afterward if any of those
-- cars actually live in mechanic or body shop.

UPDATE vehicle_locations
SET
  physical_location = 'front',
  physical_source   = 'migration_20260423',
  notes             = COALESCE(notes, '{}'::jsonb) || jsonb_build_object(
    'migrated_from', 'on_lot',
    'migrated_at',   NOW()
  )
WHERE physical_location = 'on_lot';
