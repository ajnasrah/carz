-- ============================================
-- TRANSPORT STATION + DESTINATION KEYWORDS
-- The transport/dispatch group works differently from body_shop/mechanic:
-- the destination is stated IN the message ("086793 pro auto", "086793 back"),
-- not fixed by the group. So we parse the destination from text and set that as
-- the car's current location.
-- ============================================

-- Allow the new 'transport' station type.
ALTER TABLE tg_chats DROP CONSTRAINT IF EXISTS tg_chats_station_check;
ALTER TABLE tg_chats ADD CONSTRAINT tg_chats_station_check
  CHECK (station IN ('seller', 'ready', 'body_shop', 'mechanic', 'transport'));

-- Destination keyword → location_code. Keywords are normalized (lowercase,
-- letters+digits only) so "pro auto", "Pro-Auto", "proauto" all match. Longest
-- matching keyword wins. Add a shop here anytime — no redeploy needed.
CREATE TABLE IF NOT EXISTS location_keywords (
  keyword       TEXT PRIMARY KEY,     -- normalized
  location_code TEXT NOT NULL,
  label         TEXT
);

INSERT INTO location_keywords (keyword, location_code, label) VALUES
  ('proauto',   'pro_auto',                'Pro Auto'),
  ('summit',    'summit_tire',             'Summit Tire'),
  ('tristate',  'tri_state_glass',         'Tri-State Glass'),
  ('state',     'tri_state_glass',         'Tri-State Glass'),
  ('bodyshop',  'body_shop',               'Body Shop'),
  ('mechanic',  'mechanic_section',        'Mechanic'),
  ('upholstery','upholstery',              'Upholstery'),
  ('cityauto',  'city_auto',               'City Auto'),
  ('keras',     'jim_keras_chevy_service', 'Jim Keras'),
  ('901sound',  '901_sound',               '901 Sound'),
  ('901',       '901_sound',               '901 Sound'),
  ('back',      'front',                   'Back at lot'),
  ('front',     'front',                   'Front lot'),
  ('jackson',   'jackson',                 'Jackson'),
  ('uax',       'uax',                     'UAX'),
  ('daa',       'daa',                     'DAA'),
  ('adesa',     'adesa',                   'ADESA'),
  ('transit',   'in_transit',              'In transit')
ON CONFLICT (keyword) DO NOTHING;

ALTER TABLE location_keywords ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read location_keywords" ON location_keywords;
CREATE POLICY "auth read location_keywords" ON location_keywords
  FOR SELECT TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
