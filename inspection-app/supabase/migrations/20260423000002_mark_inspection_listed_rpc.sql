-- RPC for the SA extension's auto-complete flow.
-- The extension authenticates with the anon key, but the existing RLS policies
-- on `inspections` and `inspection_photos` require auth.role()='authenticated'
-- for UPDATE / DELETE. This RPC runs SECURITY DEFINER so the extension can
-- flip an inspection to status='listed' and purge its photo references without
-- the user having to hold an authenticated session in the side-panel popup.
--
-- Does NOT delete storage objects — the bucket DELETE still goes through the
-- extension's fetch so storage RLS stays in control of that surface.

CREATE OR REPLACE FUNCTION mark_inspection_listed(insp_id UUID)
RETURNS TABLE (file_path TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Capture every file_path so the caller can delete the storage objects
  RETURN QUERY
    SELECT p.file_path
    FROM inspection_photos p
    WHERE p.inspection_id = insp_id
      AND p.file_path IS NOT NULL;

  -- 2. Flip status + stamp listed_at
  UPDATE inspections
  SET
    status = 'listed',
    listed_at = NOW(),
    checklist = COALESCE(checklist, '{}'::jsonb)
      || jsonb_build_object('photos', '{}'::jsonb, 'photos_purged_at', to_jsonb(NOW()))
  WHERE id = insp_id;

  -- 3. Delete the photo rows (storage objects are handled client-side)
  DELETE FROM inspection_photos WHERE inspection_id = insp_id;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_inspection_listed(UUID) TO anon, authenticated;
