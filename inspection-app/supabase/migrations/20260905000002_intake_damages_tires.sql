-- Tires ride along with the damages.
--
-- One read of the intake message answers both questions — the damage line and
-- the tire line are the same two sentences — so the cache that already keys on
-- that message's hash carries the tire grades too rather than paying for a
-- second call.
--
-- Grades, not tread depths: {"corners":{"lf":"good","rf":"good","lr":"bad","rr":"bad"}}.
-- What "good" is worth in 32nds is a commercial decision that lives in the
-- extension (content.js TIRE_TREAD) and changes without re-reading anything.
-- NULL means the message said nothing about tires, which is not the same as
-- saying they are fine — the filler leaves SmartAuction's certify box clear and
-- lets its own validation stop the post.
ALTER TABLE intake_damages ADD COLUMN IF NOT EXISTS tires JSONB;

NOTIFY pgrst, 'reload schema';
