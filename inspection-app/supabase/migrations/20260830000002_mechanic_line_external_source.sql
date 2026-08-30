-- Where a line came from, when it did not come from an inspection.
--
-- The mechanic group is full of real diagnoses that nothing has ever read. A
-- message this week said, in full:
--
--     No A/C
--     Suspension squeaking.
--     114843
--
-- The webhook took the VIN, opened a job card, and discarded both problems —
-- the same failure the inspection form had, in a different place: somebody
-- reported what was wrong with a car and it reached nobody.
--
-- Reading the text means writing lines from a webhook that Telegram retries, so
-- provenance needs to be unique or a redelivery doubles the car's job card.
-- source_inspection_id + source_key can't do it: their unique index requires
-- both to be set, and a line off a chat message has no inspection.

ALTER TABLE mechanic_lines
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

-- One line per (message, problem), forever. A Telegram retry, a re-run of the
-- sweep, or the same message arriving twice all land on the same row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mechanic_lines_source_ref
  ON mechanic_lines (source_ref) WHERE source_ref IS NOT NULL;

COMMENT ON COLUMN mechanic_lines.source_ref IS
'External provenance for a line that did not come from an inspection — e.g.
"tg:<message_id>:2" for the third problem in one Telegram message. Unique, so a
webhook redelivery cannot duplicate a car''s work.';

NOTIFY pgrst, 'reload schema';
