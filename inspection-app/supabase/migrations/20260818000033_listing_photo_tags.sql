-- What each listing photo shows, so the gallery can be put in one order.
--
-- 20260812000002 gave a listing an ordering overlay but no way to fill it in
-- except by hand, one car at a time. This is the cache behind filling it in
-- automatically: a photo is looked at once, ever, and its label is kept. Re-runs
-- — a new photo arriving from Telegram, or a change to the house order in
-- SLOT_ORDER — cost nothing for photos already seen, and the sort is repeatable
-- rather than re-derived from a model call each time.
--
-- Keyed by URL, not by car: photos are addressed by URL everywhere in this
-- pipeline (see listing_photo_edits), the storage path is a content hash, and
-- the same picture can end up on a listing through more than one source.
--
-- Nobody reads this from the browser. The marketplace reads the ORDER
-- (listing_photo_edits), not the reasoning behind it, so there is no read policy
-- and no grant: RLS refuses every role, and /api/photo-sort reaches it with the
-- service key, which bypasses RLS.

CREATE TABLE IF NOT EXISTS listing_photo_tags (
  url        text PRIMARY KEY,
  vin        text,
  label      text NOT NULL,
  quality    text NOT NULL DEFAULT 'good',
  model      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listing_photo_tags_vin_idx ON listing_photo_tags (vin);

ALTER TABLE listing_photo_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON listing_photo_tags FROM PUBLIC, anon, authenticated;

-- The automatic writer's way into listing_photo_edits.
--
-- set_listing_photo_edits (20260812000002) checks profiles.role for the calling
-- user, which a cron running on the service key does not have — so it needs its
-- own door rather than a widened one. Service role only; nothing a browser holds
-- can call it.
--
-- set_by is stamped 'ai' and CHECKED on the way in: if a person has curated this
-- car, their arrangement stands and the sorter leaves it alone. That check lives
-- here rather than in the caller so it holds however the function is reached —
-- a human's ordering is not something a retry or a second cron should be able to
-- undo.
CREATE OR REPLACE FUNCTION set_listing_photo_edits_auto(
  p_vin text, p_hidden text[], p_ordering text[]
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vin      text := upper(nullif(btrim(p_vin), ''));
  v_existing text;
BEGIN
  IF v_vin IS NULL THEN
    RAISE EXCEPTION 'A VIN is required to sort listing photos';
  END IF;

  SELECT set_by INTO v_existing FROM listing_photo_edits WHERE vin = v_vin;
  IF v_existing IS NOT NULL AND v_existing <> 'ai' THEN
    RETURN 'curated';
  END IF;

  INSERT INTO listing_photo_edits AS e (vin, hidden, ordering, set_by, updated_at)
  VALUES (v_vin, COALESCE(p_hidden, '{}'), COALESCE(p_ordering, '{}'), 'ai', now())
  ON CONFLICT (vin) DO UPDATE
    SET hidden = EXCLUDED.hidden, ordering = EXCLUDED.ordering,
        set_by = 'ai', updated_at = now();
  RETURN 'sorted';
END;
$$;

REVOKE ALL ON FUNCTION set_listing_photo_edits_auto(text, text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_listing_photo_edits_auto(text, text[], text[]) TO service_role;

NOTIFY pgrst, 'reload schema';
