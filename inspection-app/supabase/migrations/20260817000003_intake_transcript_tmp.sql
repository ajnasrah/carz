-- TEMPORARY diagnostic (dropped by 20260817000004). Full intake transcript for
-- the ready/seller Telegram groups, used to reconstruct what happened around
-- every photo the pipeline failed to bind to a car.
CREATE OR REPLACE FUNCTION ready_to_sell_transcript()
RETURNS TABLE (message_id text, received_at timestamptz, station text, wa_from text,
               msg_type text, body text, vin6 text, parsed jsonb,
               media_path text, media_group_id text, parked boolean,
               session_vin_at_receipt text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT w.message_id, w.received_at, w.station, w.wa_from, w.msg_type, w.body,
         w.vin6, w.parsed, w.media_path, w.media_group_id,
         w.pending_file_id IS NOT NULL, w.session_vin_at_receipt
  FROM wa_inbound_messages w
  WHERE w.station IN ('ready', 'seller')
  ORDER BY w.received_at DESC;
$$;
GRANT EXECUTE ON FUNCTION ready_to_sell_transcript() TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
