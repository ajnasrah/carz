-- Every text this system sends or receives, in one table, so the owner can read
-- the conversation instead of guessing.
--
-- WHAT WAS MISSING
-- Outbound had no record at all: sms_checklists.last_error kept only the most
-- recent failure per row, so a text that failed on Tuesday was erased by
-- Wednesday's success and nobody could ever see it happened. Inbound was worse
-- — /api/sms-reply forwarded the crew's replies to the owner's phone and kept
-- nothing, so the answers lived in one man's messages app and nowhere else.
--
-- Both directions land here now, which is what makes a thread possible: an
-- outbound checklist and the "yeah, done" that answers it are two rows with the
-- same phone number.

CREATE TABLE IF NOT EXISTS sms_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction   text NOT NULL CHECK (direction IN ('out', 'in')),
  phone       text NOT NULL,                  -- E.164, the crew member either way
  name        text,                           -- best effort at send/receive time
  body        text NOT NULL,
  -- 'sent' and 'failed' are outbound only; inbound is always 'received'.
  status      text NOT NULL CHECK (status IN ('sent', 'failed', 'received')),
  error       text,
  source      text,                           -- 'checklist' | 'nudge' | 'reply'
  twilio_sid  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The thread query: newest first, filtered by phone. Both indexes earn their
-- keep the moment there is more than a week of history.
CREATE INDEX IF NOT EXISTS sms_messages_created_idx ON sms_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS sms_messages_phone_idx   ON sms_messages (phone, created_at DESC);

ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;

-- Read-only for admins; nothing that reaches PostgREST may write. Every insert
-- comes from a cron or a webhook holding the service key, which bypasses RLS —
-- a browser that could write here could forge a reply from anyone on the crew.
--
-- The GRANT is to authenticated, which includes buyers; the policy is what
-- actually keeps them out, not the grant.
REVOKE ALL ON sms_messages FROM PUBLIC, anon;
GRANT SELECT ON sms_messages TO authenticated;

DROP POLICY IF EXISTS sms_messages_select ON sms_messages;
CREATE POLICY sms_messages_select ON sms_messages FOR SELECT USING (public.is_admin());

-- Name a number. Used when a reply arrives: Twilio gives a phone and nothing
-- else, and "Reply from (901) 555-0100" is a worse thread header than "Chris".
-- Checked in order of how specific the source is; profiles last because it holds
-- buyers too, and a buyer texting in should not be labelled as crew.
CREATE OR REPLACE FUNCTION sms_name_for(p_phone text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (SELECT right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 10) AS last10)
  SELECT COALESCE(
    (SELECT c.name FROM sms_checklists c, d
      WHERE right(regexp_replace(c.phone, '\D', '', 'g'), 10) = d.last10 LIMIT 1),
    (SELECT n.name FROM sms_nudges n, d
      WHERE right(regexp_replace(n.phone, '\D', '', 'g'), 10) = d.last10 LIMIT 1),
    (SELECT p.name FROM profiles p, d
      WHERE right(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), 10) = d.last10 LIMIT 1)
  );
$$;
REVOKE ALL ON FUNCTION sms_name_for(text) FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
