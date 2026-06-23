-- ============================================
-- Add "pro" as an alias for Pro Auto. The team abbreviates "pro auto" to just
-- "pro" ("drop pro", "086793 pro"), which normalized to "droppro"/"086793pro"
-- and did NOT contain the existing "proauto" keyword, so matchDestination()
-- returned null and the drop wasn't detected.
-- Longest keyword wins, so the full "pro auto" still resolves via "proauto".
-- ============================================

INSERT INTO location_keywords (keyword, location_code, label) VALUES
  ('pro', 'pro_auto', 'Pro Auto')
ON CONFLICT (keyword) DO NOTHING;

NOTIFY pgrst, 'reload schema';
