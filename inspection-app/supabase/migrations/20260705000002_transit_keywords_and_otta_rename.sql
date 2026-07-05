-- ============================================
-- Two corrections to the 2026-07-05 location batch (…000001):
--
-- 1) Otto -> Otta. The Denver body shop is "Otta Body Shop" (distinct from the
--    generic body_shop, and from the other Denver body shops). Rename the slug
--    otto_body -> otta_body everywhere, including any car already tagged.
--
-- 2) "Otw to memphis" routing. An outside carrier (not Super/Central Dispatch)
--    ships cars to Memphis and the driver posts "Otw to memphis" + a VIN list.
--    That phrase matched NO keyword, so matchDestination() returned null and the
--    cars kept their stale location (one even showed as "body shop"). Add "otw"
--    / "on the way" / "enroute" as generic -> in_transit. These are safe: VINs
--    contain no letter O, so "otw"/"enroute" can't hide inside a VIN, and any
--    real shop keyword (jorge, proauto, …) still wins by longest-match.
-- ============================================

-- 1) Otta rename ---------------------------------------------------------------
DELETE FROM location_keywords WHERE location_code = 'otto_body';
UPDATE vehicle_locations SET physical_location = 'otta_body'
  WHERE physical_location = 'otto_body';

INSERT INTO location_keywords (keyword, location_code, label) VALUES
  ('otta',        'otta_body', 'Otta Body Shop'),
  ('ottabody',    'otta_body', 'Otta Body Shop'),
  ('ottabodyshop','otta_body', 'Otta Body Shop')
ON CONFLICT (keyword) DO NOTHING;

-- 2) Outside-broker "on the way to Memphis" -> in_transit ----------------------
INSERT INTO location_keywords (keyword, location_code, label) VALUES
  ('otw',               'in_transit', 'In Transit'),
  ('otwtomemphis',      'in_transit', 'In Transit to Memphis'),
  ('ontheway',          'in_transit', 'In Transit'),
  ('onthewaytomemphis', 'in_transit', 'In Transit to Memphis'),
  ('enroute',           'in_transit', 'In Transit'),
  ('enroutetomemphis',  'in_transit', 'In Transit to Memphis')
ON CONFLICT (keyword) DO NOTHING;

NOTIFY pgrst, 'reload schema';
