-- Editing a listing's photos: which ones show, and in what order.
--
-- A listing's pictures come from three places that never meet: slots shot in the
-- PWA inspection, 'sa_' shots scraped off SmartAuction, and the crew's Telegram
-- ready-to-sell photos, which marketplace_listings() injects at READ time from
-- wa_inbound_messages. Nothing owns the combined set, so there was no object to
-- delete from or sort — and any edit written back into one source would be
-- overwritten by the next sync from that source.
--
-- So edits live in their own overlay, keyed by VIN and addressed by photo URL:
-- `hidden` drops photos, `ordering` puts the rest in a chosen sequence, and
-- ordering[0] is the cover. Photos not named in either array keep their natural
-- position behind the ordered ones, so a new photo arriving from Telegram shows
-- up on its own without an edit — it just doesn't jump the queue.

CREATE TABLE IF NOT EXISTS listing_photo_edits (
  vin        text PRIMARY KEY,
  hidden     text[] NOT NULL DEFAULT '{}',
  ordering   text[] NOT NULL DEFAULT '{}',
  set_by     text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE listing_photo_edits ENABLE ROW LEVEL SECURITY;

-- Readable by everyone: the marketplace is public, and how we arranged a car's
-- photos is exactly as public as the photos themselves. Writes are RPC-only —
-- no INSERT/UPDATE/DELETE policy exists, so RLS refuses them for every role.
DROP POLICY IF EXISTS listing_photo_edits_read ON listing_photo_edits;
CREATE POLICY listing_photo_edits_read ON listing_photo_edits FOR SELECT USING (true);
REVOKE ALL ON listing_photo_edits FROM PUBLIC;
GRANT SELECT ON listing_photo_edits TO anon, authenticated;

-- Admin-gated write. Same reasoning as set_marketplace_price: the check is in
-- the body, because GRANT ... TO authenticated would also hand it to buyers.
CREATE OR REPLACE FUNCTION set_listing_photo_edits(
  p_vin text, p_hidden text[], p_ordering text[]
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_admin boolean;
  v_email    text;
  v_vin      text := upper(nullif(btrim(p_vin), ''));
BEGIN
  IF v_vin IS NULL THEN
    RAISE EXCEPTION 'A VIN is required to edit listing photos';
  END IF;

  SELECT (p.role = 'admin' OR regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g') LIKE '%9018319661')
    INTO v_is_admin
    FROM profiles p WHERE p.id = auth.uid();
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Only admins can edit listing photos';
  END IF;

  v_email := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'email', '');

  -- An empty overlay is the same as none: clear the row so the car goes back to
  -- showing everything in its natural order.
  IF COALESCE(array_length(p_hidden, 1), 0) = 0
     AND COALESCE(array_length(p_ordering, 1), 0) = 0 THEN
    DELETE FROM listing_photo_edits e WHERE e.vin = v_vin;
    RETURN;
  END IF;

  INSERT INTO listing_photo_edits AS e (vin, hidden, ordering, set_by, updated_at)
  VALUES (v_vin, COALESCE(p_hidden, '{}'), COALESCE(p_ordering, '{}'),
          COALESCE(v_email, auth.uid()::text), now())
  ON CONFLICT (vin) DO UPDATE
    SET hidden = EXCLUDED.hidden, ordering = EXCLUDED.ordering,
        set_by = EXCLUDED.set_by, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION set_listing_photo_edits(text, text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_listing_photo_edits(text, text[], text[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
