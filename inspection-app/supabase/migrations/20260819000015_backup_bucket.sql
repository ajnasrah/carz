-- A private bucket for nightly table snapshots.
--
-- PITR is a paid add-on and is off. Until it is on, the only thing standing
-- between a bad statement and permanent loss is whether someone happens to have
-- a CSV — which today they did, and that was luck. A nightly logical snapshot of
-- the tables that cannot be reconstructed is the free half of the answer.
--
-- Private: these rows are the whole business. Nothing here is public-readable,
-- and no policy is created — only the service key touches it.
INSERT INTO storage.buckets (id, name, public)
VALUES ('db-backups', 'db-backups', false)
ON CONFLICT (id) DO UPDATE SET public = false;

NOTIFY pgrst, 'reload schema';
