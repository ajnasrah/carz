-- "personal" — a car of ours that isn't for sale and isn't going anywhere.
--
-- Every other destination in this table is somewhere a car is *waiting*: a
-- shop, an auction, a lot. Those cars are supposed to age, and the app is
-- supposed to nag about them. A personal car is none of that — it's not late,
-- not lost, not waiting on anybody — so the web app drops it out of Stuck 21d+,
-- Stale, Never Tracked, Needs Dispatch and Front Lot 10d+ entirely
-- (`isPersonalLoc` in Inventory.jsx, mirrored on the dashboard tiles).
--
-- It still counts in the stock total and still appears under Places, because we
-- do own the car. The point is to stop it appearing in the lists we chase.
--
-- Keywords are deliberately plain: the transport group only ever sends VIN +
-- location, never year/make/model, so a bare word can't collide with a vehicle
-- description. `personal` and `personalcar` cover how it actually gets typed,
-- and `mycar` covers the shorthand.
--
-- Escape hatch if a keyword ever misfires (live, no deploy):
--   DELETE FROM location_keywords WHERE keyword = 'mycar';

INSERT INTO location_keywords (keyword, location_code, label) VALUES
  ('personal',     'personal', 'Personal'),
  ('personalcar',  'personal', 'Personal'),
  ('personaluse',  'personal', 'Personal'),
  ('mycar',        'personal', 'Personal')
ON CONFLICT (keyword) DO NOTHING;
