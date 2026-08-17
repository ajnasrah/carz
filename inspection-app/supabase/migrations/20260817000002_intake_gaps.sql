-- Make the intake pipeline's failures visible instead of silent.
--
-- ready_to_sell_queue() ends with `AND w.vin6 IS NOT NULL`. Everything the
-- parser could not read a VIN out of therefore falls out of the world: it is not
-- in the queue, not in the extension, and not counted anywhere as a miss. The
-- team posts a car, the message lands, the row is stored — and the car simply
-- never appears. Nobody finds out until someone notices the car was never
-- listed, which is usually days later.
--
-- These two functions are the other half of the queue: what came in that we
-- could NOT turn into a car, and which photos never made it into storage. Same
-- SECURITY DEFINER + anon grant as ready_to_sell_queue(), for the same reason —
-- the extension has no sign-in, it carries the anon key and nothing else. They
-- expose no more than the queue already does (that function hands back the
-- message text as `notes`).

-- Messages from the intake groups that never resolved to a car.
CREATE OR REPLACE FUNCTION ready_to_sell_unmatched()
RETURNS TABLE (message_id text, received_at timestamptz, station text,
               wa_from text, msg_type text, body text, media_group_id text,
               parked boolean, session_vin_at_receipt text, error text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT w.message_id, w.received_at, w.station, w.wa_from, w.msg_type,
         w.body, w.media_group_id,
         w.pending_file_id IS NOT NULL,
         w.session_vin_at_receipt,
         w.error
  FROM wa_inbound_messages w
  WHERE w.station IN ('ready', 'seller')
    AND w.vin6 IS NULL
  ORDER BY w.received_at DESC;
$$;
GRANT EXECUTE ON FUNCTION ready_to_sell_unmatched() TO anon, authenticated;

-- Photos that know their car but never landed in storage — the upload failed
-- and the retry never succeeded. These are the "this car is missing a few
-- pictures" complaints, and today nothing surfaces them.
CREATE OR REPLACE FUNCTION ready_to_sell_stuck_photos()
RETURNS TABLE (message_id text, received_at timestamptz, station text,
               vin6 text, wa_from text, media_group_id text, error text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT w.message_id, w.received_at, w.station, w.vin6, w.wa_from,
         w.media_group_id, w.error
  FROM wa_inbound_messages w
  WHERE w.station IN ('ready', 'seller')
    AND w.pending_file_id IS NOT NULL
    AND w.media_path IS NULL
  ORDER BY w.received_at DESC;
$$;
GRANT EXECUTE ON FUNCTION ready_to_sell_stuck_photos() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
