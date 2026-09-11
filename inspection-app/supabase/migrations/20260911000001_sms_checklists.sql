-- Daily checklist texts: a fixed list of jobs sent to one person at one time of
-- day, on the weekdays that person works.
--
-- HOW THIS DIFFERS FROM sms_nudges, WHICH IS RIGHT NEXT DOOR
-- A nudge is derived: it asks the database which cars have sat longest and reads
-- the answer out. A checklist is dictated: the same sentences every day,
-- regardless of what the inventory looks like. They share the Twilio plumbing
-- and nothing else, so they get separate tables — folding a static list into
-- sms_nudges would mean a bucket that queries nothing, and a nudge_cars() that
-- has to return rows it invented.
--
-- Who gets what lives in a table, not in code, for the same reason sms_nudges
-- does: a number changes or a job moves to another man without a deploy.

CREATE TABLE IF NOT EXISTS sms_checklists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  phone        text NOT NULL,                    -- E.164, e.g. +19012830548
  title        text,                             -- optional label, for your eyes only
  items        text[] NOT NULL DEFAULT '{}',     -- ordered; numbered in the text when >1
  -- Local Memphis wall-clock time. Stored as a time, not an hour, because 4:30pm
  -- is a real answer and an hours-only column would have forced it to 4 or 5.
  send_at      time NOT NULL DEFAULT '07:30',
  -- ISO weekdays: 1=Mon … 7=Sun. Weekdays only is the default; a lot that works
  -- Saturdays adds 6 rather than getting a sixth day it has to ignore.
  days         integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  active       boolean NOT NULL DEFAULT true,
  -- The dedupe key, and the reason the cron can run every 15 minutes without
  -- texting anyone twice: a row is sent at most once per local date. A missed
  -- run costs 15 minutes, not the whole day.
  last_sent_on date,
  last_sent_at timestamptz,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sms_checklists_active_idx ON sms_checklists (active) WHERE active;

ALTER TABLE sms_checklists ENABLE ROW LEVEL SECURITY;

-- Crew phone numbers are not browser-readable by default. The cron holds the
-- service key and bypasses RLS; everyone reaching PostgREST with a public key
-- gets nothing unless is_admin() says otherwise.
--
-- The GRANT is to authenticated, which includes buyers — the four policies
-- below are what actually keeps them out, not the grant.
REVOKE ALL ON sms_checklists FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON sms_checklists TO authenticated;

DROP POLICY IF EXISTS sms_checklists_select ON sms_checklists;
CREATE POLICY sms_checklists_select ON sms_checklists FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS sms_checklists_insert ON sms_checklists;
CREATE POLICY sms_checklists_insert ON sms_checklists FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS sms_checklists_update ON sms_checklists;
CREATE POLICY sms_checklists_update ON sms_checklists FOR UPDATE
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS sms_checklists_delete ON sms_checklists;
CREATE POLICY sms_checklists_delete ON sms_checklists FOR DELETE USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- The first two, both Chris, who runs the body shop. One row per send time:
-- 9:10am he walks the new cars, 4:30pm he hands Jorge his keys.
--
-- His number is read out of profiles rather than typed here, so this migration
-- can't be the place a wrong digit gets frozen into the schema. If Chris has no
-- app account yet nothing is inserted and he gets added from the Checklists
-- screen instead — an empty table is a better outcome than a row that texts a
-- stranger every afternoon at 4:30.
--
-- profiles.phone is stored 11 digits with no '+' ('19018319661'); Twilio needs
-- E.164, so it is normalized on the way in.
-- ---------------------------------------------------------------------------
WITH chris AS (
  SELECT '+' || regexp_replace(p.phone, '\D', '', 'g') AS phone
  FROM profiles p
  WHERE p.name ILIKE 'chris%'
    AND length(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g')) = 11
  ORDER BY p.created_at
  LIMIT 1
)
INSERT INTO sms_checklists (name, phone, title, items, send_at, days)
SELECT 'Chris', chris.phone, v.title, v.items, v.send_at, '{1,2,3,4,5}'
FROM chris, (VALUES
  (
    'Body shop - morning walk',
    ARRAY[
      'Go through Intake and put your hands on every new car',
      'Confirm the parts list in the Carz Inc app for every new car',
      'Move the cars that need them into Need to Order Parts in the app',
      'Every single car Jorge has gets updated by you, personally'
    ],
    '09:10'::time
  ),
  (
    'Parts ordering',
    ARRAY[
      'Go through all of Need to Order Parts and order for the leftover cars and the new ones',
      'Update the notes on each car in the app: where you ordered the part and the ETA',
      'Then move it to Waiting for Parts'
    ],
    '11:00'::time
  ),
  (
    'Parts received',
    ARRAY[
      'Look through all the boxes that got delivered',
      'Update the cars whose parts came in',
      'Put the parts inside the car they belong to'
    ],
    '14:00'::time
  ),
  (
    'Chase late parts',
    ARRAY[
      'Go through the Waiting on Parts cars and find anything past its ETA',
      'If it has not shipped after 5 days, cancel it and order somewhere else'
    ],
    '15:30'::time
  ),
  (
    'Body shop - end of day',
    ARRAY['Pull 5 of the oldest keys that are waiting for Jorge and give them to him in hand'],
    '16:30'::time
  )
) AS v(title, items, send_at)
WHERE NOT EXISTS (
  SELECT 1 FROM sms_checklists c WHERE c.name ILIKE 'chris%' AND c.send_at = v.send_at
);

NOTIFY pgrst, 'reload schema';
