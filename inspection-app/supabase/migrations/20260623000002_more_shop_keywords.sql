-- ============================================
-- Add transport-destination keywords for shops the web app already knows about
-- but the Telegram parser couldn't route to (matchDestination() returned null):
--   Jorge's Shop, Muffler C&S, Jim Keras Nissan.
-- "keras" alone stays pointed at Chevy Service; Nissan needs "keras nissan"
-- (longest keyword wins, so "kerasnissan" beats "keras").
-- ============================================

INSERT INTO location_keywords (keyword, location_code, label) VALUES
  ('jorge',          'jorge',            'Jorge''s Shop'),
  ('muffler',        'muffler_cs',       'Muffler C&S'),
  ('mufflercs',      'muffler_cs',       'Muffler C&S'),
  ('kerasnissan',    'jim_keras_nissan', 'Jim Keras Nissan'),
  ('jimkerasnissan', 'jim_keras_nissan', 'Jim Keras Nissan')
ON CONFLICT (keyword) DO NOTHING;

NOTIFY pgrst, 'reload schema';
