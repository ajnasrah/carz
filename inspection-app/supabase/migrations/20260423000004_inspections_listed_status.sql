-- The mark_inspection_listed RPC couldn't actually flip status because the
-- inspections.status CHECK constraint only allowed ('in_progress', 'complete').
-- Setting status='listed' raised a CHECK violation which rolled back the whole
-- RPC transaction — so cards stayed in the extension queue after Complete.
--
-- Widen the constraint, add the missing listed_at column, and re-declare the
-- RPC so it's safe to re-run.

ALTER TABLE inspections
  DROP CONSTRAINT IF EXISTS inspections_status_check;

ALTER TABLE inspections
  ADD CONSTRAINT inspections_status_check
  CHECK (status IN ('in_progress', 'complete', 'listed', 'archived'));

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS listed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_inspections_listed_at
  ON inspections (listed_at)
  WHERE listed_at IS NOT NULL;

CREATE OR REPLACE FUNCTION mark_inspection_listed(insp_id UUID)
RETURNS TABLE (file_path TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
    SELECT p.file_path
    FROM inspection_photos p
    WHERE p.inspection_id = insp_id
      AND p.file_path IS NOT NULL;

  UPDATE inspections
  SET
    status = 'listed',
    listed_at = NOW(),
    checklist = COALESCE(checklist, '{}'::jsonb)
      || jsonb_build_object('photos', '{}'::jsonb, 'photos_purged_at', to_jsonb(NOW()))
  WHERE id = insp_id;

  DELETE FROM inspection_photos WHERE inspection_id = insp_id;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_inspection_listed(UUID) TO anon, authenticated;
