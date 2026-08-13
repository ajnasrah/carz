-- Everything the Transport group actually typed that the bot never understood.
--
-- Read of all 563 messages the bot has logged from "Carz inc Transport" since it
-- joined on 2026-06-22, plus the older WhatsApp-era strings still preserved in
-- vehicle_locations.notes->>'raw_location'. 122 messages matched no keyword at
-- all; 57 of those named a real place AND carried a VIN, so the car either got
-- no location or — worse — inherited the *previous* destination still sitting in
-- the sender's 10-minute session. A car dropped at J K Chevy showing up at Andy's
-- is not a missing update, it's a wrong one.
--
-- Two things are fixed here. The keywords below, and a `priority` column that
-- settles a fight the "longest keyword wins" rule was losing.

-- ── priority ────────────────────────────────────────────────────────────────
-- "Back summit" means the car came back FROM Summit and is on our lot now. But
-- `summit` (6) is longer than `back` (4), so longest-wins stamped the car at the
-- shop it had just left. Of 162 messages containing "back", only 59 resolved to
-- the lot — the other 103 were sent back to the shop they'd returned from.
--
-- Priority makes any return-to-lot word beat a shop named in the same message.
-- Nothing else uses it; every other keyword stays on longest-wins.
ALTER TABLE location_keywords ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 0;

UPDATE location_keywords SET priority = 10 WHERE keyword = 'back';

-- ── the shops we were dropping on the floor ─────────────────────────────────
-- Jim Keras is the big one: 17 messages, always typed as "J K" or "Jk", never
-- "Keras", so the one keyword we had for it never fired once in this group.
INSERT INTO location_keywords (keyword, location_code, label, priority) VALUES
  ('jkchevy',           'jim_keras_chevy_service', 'Jim Keras Chevy Svc', 0),
  ('jkchevrolet',       'jim_keras_chevy_service', 'Jim Keras Chevy Svc', 0),
  ('jkchevyservice',    'jim_keras_chevy_service', 'Jim Keras Chevy Svc', 0),
  ('jimkeraschevy',     'jim_keras_chevy_service', 'Jim Keras Chevy Svc', 0),
  ('jimkeraschevrolet', 'jim_keras_chevy_service', 'Jim Keras Chevy Svc', 0),
  ('jimkeras',          'jim_keras_chevy_service', 'Jim Keras',           0),
  ('jimkaris',          'jim_keras_chevy_service', 'Jim Keras',           0),
  -- "jk nissan" / "j k nissan", plus the way it actually gets misspelled.
  ('jknissan',          'jim_keras_nissan',        'Jim Keras Nissan',    0),
  ('jknisaan',          'jim_keras_nissan',        'Jim Keras Nissan',    0),
  ('jknisan',           'jim_keras_nissan',        'Jim Keras Nissan',    0),

  ('southern',          'southern',                'Southern',            0),
  ('mtmoriah',          'mt_moriah',               'Mt Moriah',           0),
  ('moriah',            'mt_moriah',               'Mt Moriah',           0),
  ('copart',            'copart',                  'Copart',              0),

  -- Gossett Kia (Memphis). Bare `kia` is deliberate — "Drop kia" is how it gets
  -- typed — and it can't steal Denver's Emich Kia, since `emichkia` is longer
  -- and wins. See the caveat at the bottom of this file.
  ('gossetkia',         'kia_gossett',             'Gossett Kia',         0),
  ('gossettkia',        'kia_gossett',             'Gossett Kia',         0),
  ('kiagossett',        'kia_gossett',             'Gossett Kia',         0),
  ('kiagosset',         'kia_gossett',             'Gossett Kia',         0),
  ('kia',               'kia_gossett',             'Gossett Kia',         0),

  -- "Cashete" 2026-08-04 17:53 and 18:03, then "Cha" at 18:14 — same sender,
  -- same run of cars, 11 minutes apart. Reading the short one as the long one.
  ('cashete',           'cashete',                 'Cashete',             0),
  ('cha',               'cashete',                 'Cashete',             0),

  ('bj',                'b_and_j',                 'B&J',                 0),
  ('bandj',             'b_and_j',                 'B&J',                 0),

  -- One-off pickups. "Out olive branch" alone covered three cars.
  ('olivebranch',       'olive_branch',            'Olive Branch',        0),
  ('wilfong',           'wilfong',                 'Wilfong',             0),
  ('toyotahernando',    'toyota_hernando',         'Toyota Hernando',     0),
  ('hernando',          'toyota_hernando',         'Toyota Hernando',     0),
  ('streamline',        'streamline',              'Streamline',          0),

  -- Lot states. `onlot` is priority 10 for the same reason `back` is: "On lot
  -- from muffler c&s" is a car that has arrived, not a car at the muffler shop.
  ('onlot',             'on_lot',                  'On lot',             10),
  ('soldlot',           'sold_lot',                'Sold lot',           10),
  ('detail',            'ready_detail',            'Detail',              0),
  ('detailline',        'ready_detail',            'Detail',              0),

  -- Spellings and shorthands of places we already track.
  ('citeauto',          'city_auto',               'City Auto',           0),
  ('sound',             '901_sound',               '901 Sound',           0),
  ('901sounds',         '901_sound',               '901 Sound',           0),
  ('mufflershop',       'muffler_cs',              'Muffler C&S',         0),
  ('arb',               'arb_section',             'Arbitration',         0),
  ('dynospeed',         'dynospeed',               'Dynospeed',           0)
ON CONFLICT (keyword) DO NOTHING;

-- ── why bare words are safe now ─────────────────────────────────────────────
-- These keywords are matched on whole-word boundaries (see `flatten` and
-- `occursOnWordBoundary` in api/telegram.js), not raw substring. Before that
-- change `otw` fired on "bot wont register" and `otto` on "Not to Ryan" — chat
-- chatter quietly moving cars. So `kia`, `cha`, `bj`, `arb` and `sound` only
-- match when typed as their own word: "sounds like" no longer hits `sound`.
--
-- The one keyword still worth watching is `kia`, which would match a message
-- that names the make instead of a destination ("Kia Sorento 123456"). The
-- Transport group sends VIN + place, not year/make/model, so this hasn't come up
-- in 563 messages — but if it ever does, drop it live with no deploy:
--   DELETE FROM location_keywords WHERE keyword = 'kia';
--
-- Deliberately NOT added: `pat` and `service`. Both appeared once, with no VIN,
-- and both are common enough English that a boundary match is not enough cover.

-- No backfill. The 103 "back <shop>" cars were stamped weeks ago and most have
-- moved since; rewriting them now would fight the newest-event-wins rule and
-- resurrect stale locations. This corrects the pipeline going forward only.
