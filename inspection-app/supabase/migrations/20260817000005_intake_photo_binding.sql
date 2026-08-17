-- Stop losing photos that arrive after the sender's session has expired.
--
-- 6.1% of every picture ever sent to the Ready-to-Sell group (648 of 10,687)
-- never got attached to a car. 524 of those — 81% — failed for exactly one
-- reason: the worker posted the VIN, then sent more photos 10-60 minutes later,
-- and wa_sessions.expires_at is 10 minutes. Once the session was gone there was
-- nothing left to identify the photo with, so it parked forever.
--
-- The session was always the wrong place to look. It is a 10-minute cache of
-- something the message log already records permanently: which car this sender
-- last named. So photo binding now reads the log instead of the session, and
-- gets a much longer, much safer memory for free.
--
-- NEAREST IN TIME, NOT LAST SEEN
-- Looking further back reintroduces the failure the snapshot was built to stop:
-- a worker who shoots the NEXT car before naming it would have those photos
-- filed under the previous one. So the rule is not "the last VIN this sender
-- typed" but "the VIN this sender typed NEAREST IN TIME to the photo", counting
-- both directions — up to 2h before, up to 15 min after. Follow-up damage shots
-- 20 minutes after a caption land on the car that was captioned; an uncaptioned
-- burst named 30 seconds later lands on the car it was named. On the real
-- traffic that is 403 photos bound correctly against 37 the old "last seen"
-- rule would have mis-filed.

-- Where a photo's VIN came from, so a guess can be revisited and a fact never
-- is. 'caption' = the photo's own text, 'album' = a sibling in the same album,
-- 'guess' = nearest-in-time inference.
ALTER TABLE wa_inbound_messages ADD COLUMN IF NOT EXISTS vin_source TEXT;

-- Retry counter for parked photos. Without it the sweep re-reads the same
-- permanently-unidentifiable rows every time and never reaches newer ones.
ALTER TABLE wa_inbound_messages ADD COLUMN IF NOT EXISTS pending_attempts INT NOT NULL DEFAULT 0;

-- Set when the bot has already asked the group which car a photo belongs to,
-- so it asks once per album instead of once per picture.
ALTER TABLE wa_inbound_messages ADD COLUMN IF NOT EXISTS asked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_wa_inbound_sender_vin
  ON wa_inbound_messages (wa_from, station, received_at)
  WHERE vin6 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_inbound_guessed
  ON wa_inbound_messages (received_at)
  WHERE vin_source = 'guess';

-- The car this sender named nearest in time to p_at.
--
-- Candidates are only messages where the sender actually TYPED a VIN
-- (parsed->>'vin6'), never a photo that was itself bound by inference — one bad
-- guess must not become the evidence for the next one.
CREATE OR REPLACE FUNCTION intake_nearest_vin(
  p_from text, p_station text, p_at timestamptz,
  p_back_min int DEFAULT 120, p_fwd_min int DEFAULT 15)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT c.vin6
  FROM wa_inbound_messages c
  WHERE c.wa_from = p_from
    AND c.station = p_station
    AND c.vin6 IS NOT NULL
    AND c.parsed ->> 'vin6' IS NOT NULL
    AND c.received_at >= p_at - make_interval(mins => p_back_min)
    AND c.received_at <= p_at + make_interval(mins => p_fwd_min)
  ORDER BY abs(extract(epoch FROM (c.received_at - p_at)))
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION intake_nearest_vin(text, text, timestamptz, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_nearest_vin(text, text, timestamptz, int, int) TO service_role;

-- Parked photos worth another download attempt. Newest first: a picture from an
-- hour ago is still worth something, one from June that nothing can identify is
-- not, and ordering the other way let the dead ones starve the live ones.
CREATE OR REPLACE FUNCTION parked_photos_to_retry(p_before timestamptz, p_limit int DEFAULT 25)
RETURNS TABLE (message_id text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT w.message_id
  FROM wa_inbound_messages w
  WHERE w.pending_file_id IS NOT NULL
    AND w.media_path IS NULL
    AND w.pending_attempts < 8
    AND w.received_at <= p_before
    AND (
      w.vin6 IS NOT NULL
      OR w.session_vin_at_receipt IS NOT NULL
      OR (w.media_group_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM wa_inbound_messages s
            WHERE s.media_group_id = w.media_group_id AND s.vin6 IS NOT NULL))
      -- Nothing identifies this one. Return it exactly once, so the caller can
      -- ask the group whose car it is; asked_at then takes it out of the set.
      OR w.asked_at IS NULL
    )
  ORDER BY w.received_at DESC
  LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION parked_photos_to_retry(timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parked_photos_to_retry(timestamptz, int) TO service_role;

-- Photos bound by inference that a later message may have since contradicted.
CREATE OR REPLACE FUNCTION guessed_photos_to_recheck(p_since timestamptz, p_limit int DEFAULT 25)
RETURNS TABLE (message_id text, wa_from text, station text, received_at timestamptz, vin6 text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT w.message_id, w.wa_from, w.station, w.received_at, w.vin6
  FROM wa_inbound_messages w
  WHERE w.vin_source = 'guess'
    AND w.received_at >= p_since
  ORDER BY w.received_at DESC
  LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION guessed_photos_to_recheck(timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION guessed_photos_to_recheck(timestamptz, int) TO service_role;

-- Fresh intake puts a car back in the queue.
--
-- sa_queue_status is an overlay the extension writes and nothing ever cleared.
-- A car marked hold/removed stayed that way forever, so when the team re-shot it
-- the new photos landed in the database and the car still did not appear in the
-- extension — its ready-to-list view filters on status = 'queued'. 247722 was
-- stamped 'hold' by a SmartAuction upload on 2026-08-14 and was still invisible
-- after a complete re-shoot on 2026-08-17.
--
-- Only hold/removed are reopened, and only when the intake is NEWER than the
-- stamp. 'sold' and 'listed' are left alone — those say the car is handled, and
-- re-posting pictures is not an argument that it is not.
CREATE OR REPLACE FUNCTION sa_queue_reopen_on_intake(p_vin6 text, p_event timestamptz)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER AS $$
  WITH upd AS (
    UPDATE sa_queue_status
       SET status = 'queued', updated_at = NOW()
     WHERE vin6 = upper(p_vin6)
       AND status IN ('hold', 'removed')
       AND updated_at < p_event
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM upd);
$$;
REVOKE ALL ON FUNCTION sa_queue_reopen_on_intake(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sa_queue_reopen_on_intake(text, timestamptz) TO service_role;

-- Backfill: give every already-parked photo the nearest-in-time VIN it should
-- have had. This is what lets the sweep recover the 524 pictures that are
-- sitting in storage limbo right now, 247722's 30 damage shots among them.
UPDATE wa_inbound_messages w
   SET session_vin_at_receipt = intake_nearest_vin(w.wa_from, w.station, w.received_at)
 WHERE w.pending_file_id IS NOT NULL
   AND w.media_path IS NULL
   AND w.session_vin_at_receipt IS NULL
   AND w.vin6 IS NULL;

NOTIFY pgrst, 'reload schema';
