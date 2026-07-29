-- ============================================
-- NEW SHOP: Santa Maria (Memphis) — tires / alignment / suspension.
--
-- Bug this fixes: a driver posted "Santamaria 374221" in the transport group.
-- extractAllVin6 read the VIN fine, but matchDestination() found no keyword
-- containing "santamaria" (and "santamaria" contains none of the existing
-- keywords either), so dest was null, there was no destination session for the
-- sender, and api/telegram.js silently logged "VINs but no destination known"
-- and dropped the message. Car 07-090-26 stayed on 'front' from its 07-23
-- intake. Same class of bug as the missing 'andy' keyword (20260623000001) and
-- the "otto body shop" misroute (20260707101325).
--
-- Keywords: the full name plus the two halves drivers actually type on their
-- own ("santa" / "maria"). Longest match wins, so "santamaria" still beats the
-- bare halves, and any other real shop keyword still beats a half.
--
-- CAVEAT — the bare 'santa' keyword can be hit by a Hyundai *Santa Fe*: if
-- someone types "santa fe" in the transport group it normalizes to "santafe",
-- which contains "santa" and would route the car here. If that shows up in
-- practice, delete the 'santa' row (the bot picks it up live):
--   DELETE FROM location_keywords WHERE keyword = 'santa';
--
-- Slug santa_maria is a Memphis-area shop, so it is deliberately NOT added to
-- SETTLED_TRANSPORT_LOCS in the web app — cars parked there must keep showing
-- up in Needs Dispatch / Stale so they get chased.
--
-- Bot picks up new keywords live (no redeploy). Web-app + extension labels ship
-- separately in the frontend.
-- ============================================

INSERT INTO location_keywords (keyword, location_code, label) VALUES
  ('santamaria', 'santa_maria', 'Santa Maria Tire & Alignment'),
  ('santa',      'santa_maria', 'Santa Maria Tire & Alignment'),
  ('maria',      'santa_maria', 'Santa Maria Tire & Alignment')
ON CONFLICT (keyword) DO NOTHING;

-- Data fix: the car the driver sent (2015 GMC Sierra, VIN ...374221). Stamp
-- now() so it wins the newest-event-time precedence over the stale 07-23
-- telegram write that put it on 'front'.
INSERT INTO vehicle_locations (stock_number, vin, physical_location, physical_source, location_updated_at) VALUES
  ('07-090-26', '3GTU2VEC9FG374221', 'santa_maria', 'telegram', NOW())
ON CONFLICT (stock_number) DO UPDATE SET
  physical_location   = EXCLUDED.physical_location,
  physical_source     = EXCLUDED.physical_source,
  location_updated_at = EXCLUDED.location_updated_at;

NOTIFY pgrst, 'reload schema';
