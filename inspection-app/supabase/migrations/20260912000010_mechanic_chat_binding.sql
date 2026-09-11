-- The mechanics never put the fault and the VIN in the same message.
--
-- WHAT WAS BROKEN
-- recordChatProblems() only ran on a message that carried a VIN. Of the 19
-- mechanic-group messages since the feature shipped, 6 carried a VIN and every
-- one of those six was a BARE VIN with no words on it; all 13 messages that
-- actually described a fault had none. So the extractor never once saw a
-- problem, 26 of 28 open jobs had zero lines, and not a single repair line has
-- ever come from the chat.
--
-- The group talks the way people talk:
--     14:11  "Needs torque converter"      <- the diagnosis
--     14:12  "L14640"                      <- the car, a minute later
--
-- So the fault has to find its car by TIME, which is exactly what photos
-- already do (intake_nearest_vin). Photos got that treatment; text never did.
--
-- Two differences from the photo version, both deliberate:
--   * Not keyed by sender. A photo belongs to whoever took it, but a diagnosis
--     is a conversation — one man posts the VIN, another says what is wrong
--     with it. Keying on wa_from would drop exactly the case this exists for.
--   * Symmetric window. The fault lands before the VIN as often as after.

-- The car this group was talking about at a given moment.
--
-- An anchor must be a TYPED vin: a text message whose body actually contains
-- the number. A vin6 that was itself inferred (a photo bound by nearest-in-time)
-- must never anchor another inference, or a guess quietly becomes evidence for
-- the next guess.
CREATE OR REPLACE FUNCTION mechanic_nearest_vin(
  p_at timestamptz, p_back_min int DEFAULT 120, p_fwd_min int DEFAULT 120)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.vin6
  FROM wa_inbound_messages c
  WHERE c.station = 'mechanic'
    AND c.msg_type = 'text'
    AND c.vin6 IS NOT NULL
    AND c.body ILIKE '%' || c.vin6 || '%'
    AND c.received_at >= p_at - make_interval(mins => p_back_min)
    AND c.received_at <= p_at + make_interval(mins => p_fwd_min)
  ORDER BY abs(extract(epoch FROM (c.received_at - p_at)))
  LIMIT 1;
$$;

-- Which chat messages have already been read for problems.
--
-- source_ref on mechanic_lines makes the WRITE idempotent, but it cannot make
-- the READ idempotent: a message that yields no problems leaves no line behind,
-- so without this the backfill would pay Haiku to re-read every "ok" and
-- "thanks" in the group on every run. Recording the read, not the result, is
-- what makes re-running free.
CREATE TABLE IF NOT EXISTS mechanic_chat_reads (
  message_id text PRIMARY KEY,
  vin6       text,          -- what it bound to, or NULL if nothing was near
  found      integer NOT NULL DEFAULT 0,
  read_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mechanic_chat_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mechanic_chat_reads FROM PUBLIC, anon, authenticated;
-- Server only: written by the webhook and the backfill, both on the service key.

-- The unread backlog, newest first. Text only, no VIN of its own, long enough
-- to plausibly say something — the same floor looksLikeReport() applies before
-- it will spend a model call.
CREATE OR REPLACE FUNCTION mechanic_chat_unread(p_limit int DEFAULT 40)
RETURNS TABLE (message_id text, body text, received_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.message_id, w.body, w.received_at
  FROM wa_inbound_messages w
  WHERE w.station = 'mechanic'
    AND w.msg_type = 'text'
    AND w.vin6 IS NULL
    AND length(coalesce(w.body, '')) > 8
    AND NOT EXISTS (SELECT 1 FROM mechanic_chat_reads r WHERE r.message_id = w.message_id)
  ORDER BY w.received_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION mechanic_nearest_vin(timestamptz, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mechanic_chat_unread(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mechanic_nearest_vin(timestamptz, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION mechanic_chat_unread(int) TO service_role;

-- The webhook reaches these through PostgREST as service_role. A missing EXECUTE
-- would make every call log and return null, and the binding would quietly do
-- nothing at all — which is the failure this migration exists to end. Fail here
-- instead of finding out from another month of empty repair orders.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'mechanic_nearest_vin(timestamptz,int,int)',
    'mechanic_chat_unread(int)'
  ] LOOP
    IF NOT has_function_privilege('service_role', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot EXECUTE %', fn;
    END IF;
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can EXECUTE % — should be service_role only', fn;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
