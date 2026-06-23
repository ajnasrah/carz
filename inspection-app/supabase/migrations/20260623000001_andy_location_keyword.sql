-- ============================================
-- Add "Andy's Auto" as a transport destination keyword.
-- Cars sent to Andy's Auto are tagged "andy" in the Carz Inc Transport group;
-- without this row matchDestination() returned null and the location didn't update.
-- ============================================

INSERT INTO location_keywords (keyword, location_code, label) VALUES
  ('andy',     'andys_auto', 'Andy''s Auto'),
  ('andys',    'andys_auto', 'Andy''s Auto'),
  ('andysauto','andys_auto', 'Andy''s Auto')
ON CONFLICT (keyword) DO NOTHING;

NOTIFY pgrst, 'reload schema';
