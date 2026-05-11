-- Two changes needed for the "skip = cross-device, photos purged post-sale" flow:
--
-- 1. `inspections.skipped_at` replaces the per-browser chrome.storage.local
--    skip list in the SmartAuction extension. Once set, the inspection is
--    hidden from every user's Ready-to-list view.
--
-- 2. `inspections.photos_purged_at` records when the photo cleanup edge
--    function removed the car's photos (after it left inventory). Keeps the
--    inspection row + checklist JSONB intact for historical trend analysis
--    but ensures we don't try to re-purge the same car nightly.

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS skipped_at        timestamptz,
  ADD COLUMN IF NOT EXISTS skipped_by        uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS photos_purged_at  timestamptz;

CREATE INDEX IF NOT EXISTS idx_inspections_skipped_at
  ON inspections (skipped_at)
  WHERE skipped_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inspections_photos_purged_at
  ON inspections (photos_purged_at)
  WHERE photos_purged_at IS NULL;

-- Convenience view: inspections whose stock_number is no longer in inventory
-- AND whose photos haven't been purged yet. The nightly purge edge function
-- reads from this, deletes storage objects, deletes inspection_photos rows,
-- and stamps photos_purged_at.
CREATE OR REPLACE VIEW inspections_awaiting_photo_purge AS
SELECT
  i.id,
  i.stock_number,
  i.vin,
  i.status,
  i.skipped_at,
  i.created_at,
  i.completed_at
FROM inspections i
LEFT JOIN inventory inv ON inv.stock_number = i.stock_number
WHERE i.stock_number IS NOT NULL         -- don't purge orphan-stock inspections;
                                          -- those need manual backfill first
  AND i.stock_number <> ''
  AND inv.stock_number IS NULL           -- car is no longer in inventory
  AND i.photos_purged_at IS NULL         -- not yet purged
  AND EXISTS (
    SELECT 1 FROM inspection_photos p
    WHERE p.inspection_id = i.id
  );

COMMENT ON COLUMN inspections.skipped_at IS
  'Set when a user skips this inspection from the Ready-to-list view. Cross-device. Does not delete the inspection or photos.';
COMMENT ON COLUMN inspections.photos_purged_at IS
  'Set by the purge-orphan-photos edge function after storage files and inspection_photos rows are deleted. The inspection row itself is retained.';

-- RPC that lets the SmartAuction extension (anon key) mark inspections as
-- skipped / unskipped without opening a broad UPDATE policy on the table.
-- Mirrors the pattern already used by `mark_inspection_listed`.
CREATE OR REPLACE FUNCTION set_inspection_skipped(
  p_inspection_id uuid,
  p_skipped       boolean
) RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := NOW();
BEGIN
  IF p_skipped THEN
    UPDATE inspections
      SET skipped_at = v_now
      WHERE id = p_inspection_id;
    RETURN v_now;
  ELSE
    UPDATE inspections
      SET skipped_at = NULL, skipped_by = NULL
      WHERE id = p_inspection_id;
    RETURN NULL;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION set_inspection_skipped(uuid, boolean) TO anon, authenticated;
