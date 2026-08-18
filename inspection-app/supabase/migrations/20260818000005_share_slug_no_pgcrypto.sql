-- Slug generation without pgcrypto.
--
-- create_buyer_share_list used gen_random_bytes(), which lives in pgcrypto —
-- not installed in this project's search_path, so every attempt to create a
-- buyer list failed with "function gen_random_bytes(integer) does not exist".
-- gen_random_uuid() is built into Postgres 13+, is backed by the same CSPRNG,
-- and needs no extension. Ten hex characters off it is ~10^12 slugs, which is
-- the point: the slug is the only thing guarding a list, so it has to be random
-- rather than sequential.
CREATE OR REPLACE FUNCTION create_buyer_share_list(
  p_buyer_name text, p_vins text[],
  p_buyer_key text DEFAULT NULL, p_buyer_email text DEFAULT NULL,
  p_buyer_phone text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_slug text;
  v_role text;
BEGIN
  IF coalesce(btrim(p_buyer_name), '') = '' THEN
    RAISE EXCEPTION 'A buyer name is required';
  END IF;
  IF p_vins IS NULL OR array_length(p_vins, 1) IS NULL THEN
    RAISE EXCEPTION 'Pick at least one car';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role = 'buyer' THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  LOOP
    v_slug := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM buyer_share_lists WHERE slug = v_slug);
  END LOOP;

  INSERT INTO buyer_share_lists (slug, buyer_name, buyer_key, buyer_email, buyer_phone, vins, note, created_by)
  VALUES (v_slug, btrim(p_buyer_name), p_buyer_key, p_buyer_email, p_buyer_phone,
          ARRAY(SELECT DISTINCT upper(btrim(v)) FROM unnest(p_vins) v WHERE btrim(v) <> ''),
          nullif(btrim(p_note), ''), auth.uid());
  RETURN v_slug;
END $$;
REVOKE ALL ON FUNCTION create_buyer_share_list(text, text[], text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_buyer_share_list(text, text[], text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
