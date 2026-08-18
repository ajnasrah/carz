-- Buyer outreach: one shareable page per buyer, and a key for the read API.
--
-- Buyer Match has always run one direction — for THIS car, who are the three
-- likeliest buyers. The useful direction for actually selling is the inverse:
-- for THIS buyer, every car we have that fits him, sent in one message instead
-- of one message per car. That needs somewhere to put the list, because a link
-- carrying ten VINs in a query string is not something you text anyone.

-- ---------------------------------------------------------------------------
-- The shared list. `slug` is what appears in the URL (carzinc.ai/m/<slug>).
-- vins are SmartAuction active VINs; the page resolves them at read time so a
-- list never goes stale against a car that has since sold.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS buyer_share_lists (
  slug            text PRIMARY KEY,
  buyer_name      text NOT NULL,
  buyer_key       text,                 -- phone→email→name, matches the GHL edge fn
  buyer_email     text,
  buyer_phone     text,
  vins            text[] NOT NULL,
  note            text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  open_count      int NOT NULL DEFAULT 0,
  first_opened_at timestamptz,
  last_opened_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_buyer_share_created ON buyer_share_lists(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_buyer_share_buyer   ON buyer_share_lists(buyer_key);

-- No policies: every read and write goes through the functions below. The table
-- itself stays unreachable with the anon key, so a buyer who guesses one slug
-- cannot enumerate every other buyer's list and see what we quoted them.
ALTER TABLE buyer_share_lists ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Create a list. Employees only — a buyer signed into the marketplace must not
-- be able to mint pages. The slug is generated here, never accepted from the
-- caller, so it can't be chosen to be guessable.
-- ---------------------------------------------------------------------------
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
    v_slug := substr(encode(gen_random_bytes(8), 'hex'), 1, 10);
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

-- ---------------------------------------------------------------------------
-- Read a list by slug — PUBLIC, because the whole point is that a buyer opens it
-- without an account. Returns one row per car, resolved live from the active
-- list, plus the marketplace listing id when the car has one so the page can
-- link to full photos and inspection detail.
--
-- Cars that have since left the active list simply stop coming back, which is
-- the behaviour you want: nobody gets shown a car we can no longer sell them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION buyer_share_list(p_slug text)
RETURNS TABLE (
  buyer_name text, note text, created_at timestamptz,
  vin text, year int, make text, model text, "trim" text,
  odometer int, color text, buy_now numeric, detail_url text,
  listing_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH l AS (
    SELECT * FROM buyer_share_lists WHERE slug = p_slug
  ),
  ml AS (
    SELECT m.id, upper(m.full_vin) AS full_vin FROM marketplace_listings() m
  )
  SELECT l.buyer_name, l.note, l.created_at,
         a.vin, a.year, a.make, a.model, a.trim,
         a.odometer, a.color, a.buy_now, a.detail_url,
         ml.id
  FROM l
  JOIN unnest(l.vins) WITH ORDINALITY AS u(vin, ord) ON true
  JOIN sa_active_cars a ON a.vin = u.vin
  LEFT JOIN ml ON ml.full_vin = a.vin
  ORDER BY a.buy_now DESC NULLS LAST, u.ord;
$$;
GRANT EXECUTE ON FUNCTION buyer_share_list(text) TO anon, authenticated;

-- Count an open. Separate from the read so the read can stay STABLE (and so a
-- crawler prefetching the page doesn't get to inflate the number silently —
-- the page calls this once, after it renders).
CREATE OR REPLACE FUNCTION buyer_share_list_opened(p_slug text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE buyer_share_lists
     SET open_count = open_count + 1,
         first_opened_at = COALESCE(first_opened_at, now()),
         last_opened_at = now()
   WHERE slug = p_slug;
$$;
GRANT EXECUTE ON FUNCTION buyer_share_list_opened(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- API keys for the read API. Only the SHA-256 of the key is stored, so this
-- migration (which lives in git) never carries the secret itself.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
  name        text PRIMARY KEY,
  key_sha256  text NOT NULL,
  created_at  timestamptz DEFAULT now(),
  last_used_at timestamptz
);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;   -- service role only; no policies

INSERT INTO api_keys (name, key_sha256)
VALUES ('buyer_recommendations', 'df94a413b075765f392c7ace783f5fa3f2252aca6d1e068ccc26adcb3bd8a35a')
ON CONFLICT (name) DO UPDATE SET key_sha256 = EXCLUDED.key_sha256;

NOTIFY pgrst, 'reload schema';
