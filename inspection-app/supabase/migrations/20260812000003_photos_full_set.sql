-- ready_to_sell_photos: every picture the marketplace has, not just Telegram's.
--
-- The extension's wizard and its photo download both go through this function,
-- and it only ever read wa_inbound_messages (station ready/seller). But a
-- listing's pictures also come from inspections.checklist->photos — the PWA
-- inspection shots and the 'sa_' shots scraped off SmartAuction — so any car
-- photographed through those paths looked like it had NO photos in the wizard
-- while showing a full gallery on the marketplace.
--
-- Now it returns the union, and applies the listing_photo_edits overlay
-- (20260812000002): photos an admin removed don't come back, and the order they
-- set leads. Curating a listing in the app therefore also decides what gets
-- uploaded to SmartAuction, which is the point of curating it.
--
-- Default order is unchanged when there's no overlay: Telegram photos in the
-- order they were sent, then anything extra off the checklist. Callers that
-- upload in filename order keep working.

CREATE OR REPLACE FUNCTION ready_to_sell_photos(p_vin6 text)
RETURNS TABLE (url text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH v AS (
    SELECT upper(p_vin6) AS vin6,
           (SELECT upper(inv.vehicle_vin)
              FROM inventory inv
             WHERE upper(inv.last_6_vin) = upper(p_vin6)
                OR upper(right(inv.vehicle_vin, 6)) = upper(p_vin6)
             LIMIT 1) AS full_vin
  ),
  -- Telegram, in the order sent: stored by content hash (random path), so the
  -- sequence has to come from the trailing number in message_id ("tg_<chat>_<N>").
  tg AS (
    SELECT
      'https://yprihgygmreibcuybwoy.supabase.co/storage/v1/object/public/wa-photos/' || w.media_path AS url,
      min(CASE WHEN w.message_id ~ '_(\d+)$'
               THEN regexp_replace(w.message_id, '^.*_', '')::bigint
               ELSE 0 END) AS ord
    FROM wa_inbound_messages w, v
    WHERE upper(w.vin6) = v.vin6
      AND w.station IN ('ready', 'seller')
      AND w.media_path IS NOT NULL
    GROUP BY w.media_path
  ),
  insp AS (
    SELECT i.checklist
    FROM inspections i, v
    WHERE i.completed_at IS NOT NULL
      AND (i.vin_last6 = v.vin6
           OR upper(right(COALESCE(i.vin, ''), 6)) = v.vin6
           OR (v.full_vin IS NOT NULL AND upper(i.vin) = v.full_vin))
    ORDER BY i.completed_at DESC
    LIMIT 1
  ),
  cl AS (
    SELECT e.val ->> 'url' AS url, row_number() OVER (ORDER BY e.key) AS ord
    FROM insp, jsonb_each(COALESCE(insp.checklist -> 'photos', '{}'::jsonb)) AS e(key, val)
    WHERE e.val ->> 'url' IS NOT NULL
  ),
  merged AS (
    SELECT url, 0 AS grp, ord FROM tg
    UNION ALL
    SELECT url, 1 AS grp, ord FROM cl
  ),
  uniq AS (
    SELECT DISTINCT ON (url) url, grp, ord FROM merged ORDER BY url, grp, ord
  ),
  edit AS (
    SELECT e.hidden, e.ordering FROM listing_photo_edits e, v WHERE e.vin = v.full_vin
  )
  SELECT u.url
  FROM uniq u
  WHERE NOT COALESCE(u.url = ANY (SELECT unnest(e.hidden) FROM edit e), false)
  ORDER BY
    COALESCE((SELECT array_position(e.ordering, u.url) FROM edit e), 2147483647),
    u.grp, u.ord;
$$;
GRANT EXECUTE ON FUNCTION ready_to_sell_photos(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
