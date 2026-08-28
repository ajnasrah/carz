-- Write one branch of a checklist without sending the whole thing.
--
-- The bug this exists to kill: every inspection page loads the whole inspection
-- at mount, then saves `{...prev.checklist, test_drive: {...}}` — the ENTIRE
-- checklist, rebuilt from the copy it read when the page opened. The three
-- tracks are designed to be worked in parallel by different people, so if
-- somebody finishes Quick Check while another has Test Drive open, the next tap
-- on Test Drive writes back a checklist whose `startup` branch is minutes stale
-- and silently erases the startup findings.
--
-- Nobody would ever suspect the app. The inspector remembers recording it, the
-- tech never sees it, and it looks exactly like a person forgetting — which is
-- the complaint this whole piece of work started from.
--
-- So: send the path and the value, and let Postgres merge. Two tracks writing
-- different branches can no longer touch each other's data.
--
-- jsonb_set's create_missing only creates the FINAL key, so a path into a
-- branch that doesn't exist yet is a silent no-op. Every ancestor is created
-- first, which is what makes this safe to call on a fresh inspection whose
-- checklist is still `{}`.

CREATE OR REPLACE FUNCTION patch_inspection_checklist(
  p_inspection_id UUID,
  p_path          TEXT[],
  p_value         JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_checklist JSONB;
  v_i         INT;
BEGIN
  IF NOT is_employee() THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  IF p_path IS NULL OR array_length(p_path, 1) IS NULL THEN
    RAISE EXCEPTION 'a path is required';
  END IF;

  SELECT coalesce(checklist, '{}'::jsonb) INTO v_checklist
  FROM inspections WHERE id = p_inspection_id
  FOR UPDATE;   -- serialise concurrent writers on this row

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Create any missing ancestor objects, outermost first.
  FOR v_i IN 1 .. array_length(p_path, 1) - 1 LOOP
    IF jsonb_typeof(v_checklist #> p_path[1:v_i]) IS DISTINCT FROM 'object' THEN
      v_checklist := jsonb_set(v_checklist, p_path[1:v_i], '{}'::jsonb, true);
    END IF;
  END LOOP;

  v_checklist := jsonb_set(v_checklist, p_path, p_value, true);

  UPDATE inspections
  SET checklist = v_checklist, updated_at = NOW()
  WHERE id = p_inspection_id;

  RETURN v_checklist;
END;
$$;

REVOKE EXECUTE ON FUNCTION patch_inspection_checklist(UUID, TEXT[], JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION patch_inspection_checklist(UUID, TEXT[], JSONB) TO authenticated, service_role;

COMMENT ON FUNCTION patch_inspection_checklist(UUID, TEXT[], JSONB) IS
'Merge one branch into inspections.checklist. Use instead of writing the whole
column: the three inspection tracks run in parallel and whole-column writes from
a page-load snapshot silently erase each other.';

NOTIFY pgrst, 'reload schema';
