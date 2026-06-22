-- Photos must come back in the EXACT order they were sent. They're stored by
-- content hash (random path), so order must come from the Telegram message
-- sequence — the trailing number in message_id ("tg_<chat>_<N>", N increments
-- per message). Dedup identical photos by media_path, keep the earliest seq.
CREATE OR REPLACE FUNCTION ready_to_sell_photos(p_vin6 text)
RETURNS TABLE (url text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT url FROM (
    SELECT
      'https://yprihgygmreibcuybwoy.supabase.co/storage/v1/object/public/wa-photos/' || w.media_path AS url,
      min(CASE WHEN w.message_id ~ '_(\d+)$'
               THEN regexp_replace(w.message_id, '^.*_', '')::bigint
               ELSE 0 END) AS seq,
      min(w.received_at) AS rt
    FROM wa_inbound_messages w
    WHERE upper(w.vin6) = upper(p_vin6)
      AND w.station IN ('ready', 'seller')
      AND w.media_path IS NOT NULL
    GROUP BY w.media_path
  ) z
  ORDER BY seq, rt;
$$;
GRANT EXECUTE ON FUNCTION ready_to_sell_photos(text) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
