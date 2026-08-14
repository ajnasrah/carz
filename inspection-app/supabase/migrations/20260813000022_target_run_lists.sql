-- Target Buy List — make a scored run list outlive the tab it was built in.
--
-- Until now the list existed only in memory: a module variable in the extension
-- popup and a useState in ListBuilder. Close the popup, walk away from the
-- laptop, navigate off the page, and the upload was gone — at a sale, in the
-- lane, with the cars already crossing the block. This is where it lives now.
--
-- One row per uploaded list, not one per car. The list is read whole or not at
-- all — nobody queries "every 2019 Jetta that ever ran at ADESA" — so the scored
-- cars ride in a jsonb array and the columns beside it are only what the picker
-- needs to name a list without pulling it. A 400-car list serialises to roughly
-- 300KB, which TOAST handles and the anon REST API will happily hand back.
--
-- `opened` is the same idea one level down: which VINs have already been sent to
-- a tab. Reopening the list on another machine picks up where the first one
-- stopped instead of offering all forty targets again from the top.
--
-- Deliberately readable and writable by anon: the extension has no sign-in at
-- all, it carries the anon key and nothing else, so any policy resting on
-- auth.uid() would lock out the surface that builds most of these lists.

CREATE TABLE IF NOT EXISTS target_run_lists (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which auction's export this was: edge_pipeline | adesa | manheim. Decides
  -- how a car gets opened, so it travels with the list rather than being
  -- re-sniffed from the cars.
  source_id     TEXT NOT NULL,
  source_label  TEXT,
  file_name     TEXT,

  -- As the auction wrote it. The three formats don't agree on a date shape and
  -- a list can straddle two sale days, so this is a label, not a date.
  sale_date     TEXT,

  car_count     INTEGER DEFAULT 0,
  target_count  INTEGER DEFAULT 0,
  watch_count   INTEGER DEFAULT 0,
  book_size     INTEGER,

  cars          JSONB NOT NULL DEFAULT '[]'::jsonb,
  opened        JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- 'extension' or 'web'. Only for the picker, which says where a list came
  -- from so you can tell this morning's popup upload from the one on the phone.
  built_by      TEXT,

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- The only query either client makes: newest lists first.
CREATE INDEX IF NOT EXISTS idx_target_run_lists_created
  ON target_run_lists(created_at DESC);

ALTER TABLE target_run_lists ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "rw target_run_lists" ON target_run_lists
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Run lists are worth keeping for the week you might re-work them and no
-- longer, and each one is a few hundred KB. Called by whichever client saves a
-- list, so the table trims itself without a scheduler.
CREATE OR REPLACE FUNCTION prune_target_run_lists()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM target_run_lists WHERE created_at < NOW() - INTERVAL '30 days';
$$;

REVOKE ALL ON FUNCTION prune_target_run_lists() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prune_target_run_lists() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
