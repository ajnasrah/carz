-- Make "Skip" in the SA extension destructive: hide the card AND purge every
-- photo tied to the inspection. Same purge surface as mark_inspection_listed
-- (returns file_path rows so the caller can delete storage objects, and
-- deletes inspection_photos rows + nulls checklist.photos).
--
-- Unlike mark_inspection_listed, this one leaves status='complete' — Skip is
-- a "I'm done with this car, don't need its photos anymore" signal, not
-- "I listed it on SA".

CREATE OR REPLACE FUNCTION skip_and_purge_inspection(insp_id UUID)
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
    skipped_at = NOW(),
    checklist = COALESCE(checklist, '{}'::jsonb)
      || jsonb_build_object('photos', '{}'::jsonb, 'photos_purged_at', to_jsonb(NOW()))
  WHERE id = insp_id;

  DELETE FROM inspection_photos WHERE inspection_id = insp_id;
END;
$$;

GRANT EXECUTE ON FUNCTION skip_and_purge_inspection(UUID) TO anon, authenticated;
