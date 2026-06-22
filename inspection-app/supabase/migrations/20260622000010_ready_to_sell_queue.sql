-- ============================================
-- SERVERLESS ready-to-sell queue for the SmartAuction extension.
-- Lets the extension read the queue + photo URLs straight from Supabase (no Mac
-- server / puller). All RPCs are SECURITY DEFINER so the anon key works without
-- exposing wa_inbound_messages directly.
-- ============================================

-- Status overlay (queued | listed | sold | hold | removed). Default queued.
CREATE TABLE IF NOT EXISTS sa_queue_status (
  vin6       TEXT PRIMARY KEY,
  status     TEXT NOT NULL DEFAULT 'queued',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE sa_queue_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read sa_queue_status" ON sa_queue_status;
CREATE POLICY "read sa_queue_status" ON sa_queue_status FOR SELECT TO anon, authenticated USING (true);

-- Queue: one row per ready/seller car with latest parsed data + photo count.
CREATE OR REPLACE FUNCTION ready_to_sell_queue()
RETURNS TABLE (vin6 text, miles text, condition text, notes text,
               photo_count integer, status text, message_date timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    w.vin6,
    (array_agg(w.parsed->>'miles' ORDER BY w.received_at DESC) FILTER (WHERE w.parsed ? 'miles'))[1],
    (array_agg(w.parsed->>'condition' ORDER BY w.received_at DESC) FILTER (WHERE w.parsed ? 'condition'))[1],
    (array_agg(w.parsed->>'notes' ORDER BY w.received_at DESC) FILTER (WHERE w.parsed ? 'notes'))[1],
    count(*) FILTER (WHERE w.media_path IS NOT NULL)::int,
    COALESCE(s.status, 'queued'),
    max(w.received_at)
  FROM wa_inbound_messages w
  LEFT JOIN sa_queue_status s ON s.vin6 = w.vin6
  WHERE w.station IN ('ready', 'seller') AND w.vin6 IS NOT NULL
  GROUP BY w.vin6, s.status
  ORDER BY max(w.received_at) DESC;
$$;
GRANT EXECUTE ON FUNCTION ready_to_sell_queue() TO anon, authenticated;

-- Public photo URLs for a car (wa-photos is public).
CREATE OR REPLACE FUNCTION ready_to_sell_photos(p_vin6 text)
RETURNS TABLE (url text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT DISTINCT
    'https://yprihgygmreibcuybwoy.supabase.co/storage/v1/object/public/wa-photos/' || w.media_path
  FROM wa_inbound_messages w
  WHERE upper(w.vin6) = upper(p_vin6) AND w.station IN ('ready', 'seller') AND w.media_path IS NOT NULL
  ORDER BY 1;
$$;
GRANT EXECUTE ON FUNCTION ready_to_sell_photos(text) TO anon, authenticated;

-- Set a car's queue status (mark listed/sold/hold/removed/queued).
CREATE OR REPLACE FUNCTION sa_queue_set_status(p_vin6 text, p_status text)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO sa_queue_status (vin6, status, updated_at)
  VALUES (upper(p_vin6), p_status, NOW())
  ON CONFLICT (vin6) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW();
$$;
GRANT EXECUTE ON FUNCTION sa_queue_set_status(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
