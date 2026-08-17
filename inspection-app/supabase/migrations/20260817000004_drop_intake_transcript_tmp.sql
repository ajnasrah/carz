-- Drop the temporary transcript reader from 20260817000003. It was a one-off
-- diagnostic pull; leaving a function that hands the whole intake conversation
-- to the anon key is not something to keep in prod.
DROP FUNCTION IF EXISTS ready_to_sell_transcript();
NOTIFY pgrst, 'reload schema';
