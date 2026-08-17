-- Every car we've ever looked at on an auction run list, kept forever.
--
-- WHY THIS TABLE EXISTS WHEN target_run_lists ALREADY STORES THE CARS
-- It stores them for 30 days and then prune_target_run_lists() deletes them.
-- That was right for its job: a scored run list is a working document for a sale
-- day, and nobody re-works last month's sale. But the CR grade, the
-- announcements and the auction's own valuation are already being captured on
-- every car (97% / 94% / 92% of 2,800 scored cars carry them) — and then thrown
-- away a month later. Those are the only condition facts we ever see at BUY
-- time, and the sold book has no equivalent: `sold` records what a car cost to
-- recondition, never what shape it was in when we bid.
--
-- Recon is worth capturing precisely because of what the lot history shows: of
-- the 24 days a car is owned, ~19 are spent before it can even be sold, and
-- heavy-recon cars take 46 days to reach the front line against 11 for light
-- ones. Once it's out front everything sells in 2-4 days. So the shop, not
-- demand, is what a purchase decision is really betting on — and grade is the
-- only signal about it available while the car is still on the block.
--
-- Buying low-grade cars and reconditioning them up is the business, not a
-- mistake to flag. The question this table is built to answer is not "which
-- grades to avoid" but "which nameplate + grade + announcement combinations
-- recondition profitably, and which ones eat the shop".
--
-- One row per (vin, sale date, auction). A car that runs three weeks in a row
-- gets three rows on purpose: not selling is information about the car.

CREATE TABLE IF NOT EXISTS public.run_list_observations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  vin           TEXT NOT NULL,
  -- As the auction wrote it. The formats don't agree on a date shape and a list
  -- can straddle two days, so this is a label, not a date — same as
  -- target_run_lists.sale_date.
  --
  -- NOT NULL with an empty-string default so it can sit in the unique index
  -- below. A nullable column would make every undated row unique against every
  -- other one (NULL never equals NULL in an index), so re-uploading a list with
  -- no sale date would duplicate the whole thing.
  sale_date     TEXT NOT NULL DEFAULT '',
  source_id     TEXT NOT NULL,          -- adesa | manheim | edge_pipeline | carmax
  source_label  TEXT,
  seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- the car, as the auction described it
  year          INTEGER,
  make          TEXT,
  model         TEXT,
  trim          TEXT,
  odometer      INTEGER,

  -- CONDITION — the whole point of the table
  cr_grade      NUMERIC(3,1),           -- parsed to a number so it can be compared
  cr_grade_raw  TEXT,                   -- exactly what the feed said, in case parsing is wrong
  has_cr        BOOLEAN,
  announcements TEXT,
  title_status  TEXT,

  -- the market's own opinion at the time: Manheim MMR, ADESA CarValue
  auction_value NUMERIC(10,2),

  -- where and how it ran
  seller        TEXT,
  location      TEXT,
  lane          TEXT,
  lot           TEXT,
  run           TEXT,
  channel       TEXT,
  drivetrain    TEXT,
  engine        TEXT,
  transmission  TEXT,
  fuel          TEXT,
  color         TEXT,

  -- What the buy list said about it THAT DAY. Kept so the engine can later be
  -- graded on its own calls: of the cars it flagged and we bought, how did they
  -- actually do? Without this the verdict is gone the moment the list is pruned.
  verdict       TEXT,
  confidence    TEXT,
  exact_n       INTEGER,
  exact_profit  NUMERIC(10,2),
  exact_days    NUMERIC(6,1),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Re-uploading the same run list must not double the rows. A car genuinely
-- running at two different sales, or at two different auctions on the same day,
-- still gets its own row.
--
-- Plain columns, not an expression: PostgREST upserts name their conflict target
-- as a column list, and an index over COALESCE(...) cannot serve one — the
-- write would fail with "no unique or exclusion constraint matching". That's
-- what the NOT NULL DEFAULT '' on sale_date above is for.
CREATE UNIQUE INDEX IF NOT EXISTS run_list_observations_unique
  ON public.run_list_observations (vin, sale_date, source_id);

-- The join that makes this worth keeping: given a VIN we ended up buying, what
-- did it look like on the block?
CREATE INDEX IF NOT EXISTS run_list_observations_vin
  ON public.run_list_observations (vin);

CREATE INDEX IF NOT EXISTS run_list_observations_seen
  ON public.run_list_observations (seen_at DESC);

-- Deliberately NOT pruned. The whole value is longitudinal: a grade recorded
-- today only pays off when that car sells months from now. Roughly 800 cars a
-- day at ~40 narrow columns is a few MB a year.

ALTER TABLE public.run_list_observations ENABLE ROW LEVEL SECURITY;

-- Matches target_run_lists: the browser extension writes these with the public
-- anon key, so the policy has to admit it. This is a list of cars that ran at
-- public auction — no customer or margin data lives here.
DO $$ BEGIN
  CREATE POLICY "rw run_list_observations" ON public.run_list_observations
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON public.run_list_observations TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
