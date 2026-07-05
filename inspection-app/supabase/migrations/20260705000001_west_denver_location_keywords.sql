-- ============================================
-- New transport destinations (Denver + West Coast expansion) for the
-- Carz Inc Transport/location Telegram group. matchDestination() in
-- api/telegram.js does a normalized (lowercase, alphanumerics-only) substring
-- match, LONGEST keyword wins — so city-qualified Manheim keywords beat a bare
-- "manheim" (we intentionally do NOT add bare "manheim" now that there are
-- several lots: Denver, SF Bay, Riverside, Little Rock), and "daarockies"
-- beats the existing "daa".
--
-- Live effect is immediate on INSERT (no redeploy). Web-app labels/colors and
-- the extension's DAA-Rockies run-list source ship separately.
-- ============================================

INSERT INTO location_keywords (keyword, location_code, label) VALUES
  -- Otto Body Shop (Denver)
  ('otto',                 'otto_body',         'Otto Body Shop'),
  ('ottobody',             'otto_body',         'Otto Body Shop'),
  ('ottobodyshop',         'otto_body',         'Otto Body Shop'),
  -- Manheim Denver
  ('manheimdenver',        'manheim_denver',    'Manheim Denver'),
  -- DAA Rockies (Dealers Auto Auction of the Rockies) — beats bare "daa"
  ('daarockies',           'daa_rockies',       'DAA Rockies'),
  ('rockies',              'daa_rockies',       'DAA Rockies'),
  -- Manheim San Francisco (export string is "Manheim San Francisco Bay")
  ('manheimsanfrancisco',    'manheim_sf',        'Manheim San Francisco'),
  ('manheimsanfranciscobay', 'manheim_sf',        'Manheim San Francisco'),
  ('manheimsf',              'manheim_sf',        'Manheim San Francisco'),
  -- Manheim Riverside
  ('manheimriverside',     'manheim_riverside', 'Manheim Riverside'),
  -- Manheim Little Rock
  ('manheimlittlerock',    'manheim_little_rock', 'Manheim Little Rock'),
  -- Loveland Auto Auction (Denver)
  ('loveland',             'loveland',          'Loveland Auto Auction'),
  ('lovelandautoauction',  'loveland',          'Loveland Auto Auction'),
  -- Marc — PDR (paintless dent repair), Denver
  ('marc',                 'marc_pdr',          'Marc (PDR)'),
  ('marcpdr',              'marc_pdr',          'Marc (PDR)'),
  -- Emich Kia
  ('emich',                'emich_kia',         'Emich Kia'),
  ('emichkia',             'emich_kia',         'Emich Kia'),
  -- "in transit to memphis" for a broker/shipper outside Super Dispatch.
  -- ("transit" already substring-matches this, but be explicit.)
  ('intransit',            'in_transit',        'In Transit'),
  ('intransittomemphis',   'in_transit',        'In Transit to Memphis')
ON CONFLICT (keyword) DO NOTHING;

NOTIFY pgrst, 'reload schema';
