-- ============================================
-- 1) FIX: "otto body shop" misrouting to Jorge.
--    The Denver shop's slug is otta_body, but its keywords are only spelled
--    "otta*". Drivers type "otto body shop" → normalized "ottobodyshop", which
--    contains NO otta* keyword but DOES contain "bodyshop" → matched body_shop
--    (Jorge, Memphis). Add the "otto*" spellings as aliases → otta_body. Longest
--    match ("ottobodyshop", 12) now beats "bodyshop" (8), so it routes correctly.
--
-- 2) NEW SHOP: Rocky Mountain Dent Service (Denver) — a Denver PDR/dent shop,
--    separate from Andy's Auto (Memphis) and Marc Dent Doctor (Denver). Slug
--    rocky_mountain_dent. Keywords are Denver-specific (rocky / rmds / rmdent /
--    rockymtn / rockydent + full forms) — we deliberately do NOT reuse the
--    generic "dent"/"dentdoctor" keywords.
--
-- 3) DATA FIX: four cars the drivers sent today that landed on body_shop (Jorge)
--    because of the two gaps above — move them to the right location.
--
-- Bot picks up new keywords live (no redeploy). Web-app labels/colors ship
-- separately in the frontend.
-- ============================================

-- 1) otto* → otta_body -------------------------------------------------------
INSERT INTO location_keywords (keyword, location_code, label) VALUES
  ('otto',         'otta_body', 'Otta Body Shop'),
  ('ottobody',     'otta_body', 'Otta Body Shop'),
  ('ottobodyshop', 'otta_body', 'Otta Body Shop')
ON CONFLICT (keyword) DO NOTHING;

-- 2) Rocky Mountain Dent Service (Denver) ------------------------------------
INSERT INTO location_keywords (keyword, location_code, label) VALUES
  ('rocky',                    'rocky_mountain_dent', 'Rocky Mountain Dent Service (Denver)'),
  ('rmds',                     'rocky_mountain_dent', 'Rocky Mountain Dent Service (Denver)'),
  ('rmdent',                   'rocky_mountain_dent', 'Rocky Mountain Dent Service (Denver)'),
  ('rockymtn',                 'rocky_mountain_dent', 'Rocky Mountain Dent Service (Denver)'),
  ('rockydent',                'rocky_mountain_dent', 'Rocky Mountain Dent Service (Denver)'),
  ('rockymtndent',             'rocky_mountain_dent', 'Rocky Mountain Dent Service (Denver)'),
  ('rockymountain',            'rocky_mountain_dent', 'Rocky Mountain Dent Service (Denver)'),
  ('rockymountaindent',        'rocky_mountain_dent', 'Rocky Mountain Dent Service (Denver)'),
  ('rockymountaindentservice', 'rocky_mountain_dent', 'Rocky Mountain Dent Service (Denver)')
ON CONFLICT (keyword) DO NOTHING;

-- 3) Correct the four cars sent today (were misrouted to body_shop). Stamp now()
--    so this wins the newest-event-time precedence over the bad telegram write.
INSERT INTO vehicle_locations (stock_number, vin, physical_location, physical_source, location_updated_at) VALUES
  ('06-362-26', '1N4CZ1CV1RC550700', 'otta_body',           'telegram', NOW()),  -- Nissan Leaf (550700)
  ('06-324-26', '1C6SRFMT6NN355147', 'otta_body',           'telegram', NOW()),  -- Ram 1500
  ('06-334-26', 'JA4J4UA87NZ065719', 'otta_body',           'telegram', NOW()),  -- Mitsubishi Outlander
  ('06-366-26', 'KMHLM4DG1RU654894', 'rocky_mountain_dent', 'telegram', NOW())   -- Hyundai Elantra
ON CONFLICT (stock_number) DO UPDATE SET
  physical_location   = EXCLUDED.physical_location,
  physical_source     = EXCLUDED.physical_source,
  location_updated_at = EXCLUDED.location_updated_at;

NOTIFY pgrst, 'reload schema';
