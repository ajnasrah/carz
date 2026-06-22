-- Admin "delete" = hide a car from the marketplace (non-destructive; inventory
-- in Frazer is untouched). Admin-only via SECURITY DEFINER RPCs that check the
-- caller's profiles.role. The frontend reads marketplace_hidden to filter.
CREATE TABLE IF NOT EXISTS marketplace_hidden (
  stock_number TEXT PRIMARY KEY,
  hidden_by    UUID,
  hidden_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE marketplace_hidden ENABLE ROW LEVEL SECURITY;
-- Everyone can read (so the public marketplace can filter hidden cars out)...
DROP POLICY IF EXISTS "read marketplace_hidden" ON marketplace_hidden;
CREATE POLICY "read marketplace_hidden" ON marketplace_hidden
  FOR SELECT TO anon, authenticated USING (true);
-- ...but only the RPCs (definer) write. No direct INSERT/UPDATE/DELETE policy.

CREATE OR REPLACE FUNCTION hide_marketplace_car(p_stock TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (SELECT role FROM profiles WHERE id = auth.uid()) <> 'admin' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  INSERT INTO marketplace_hidden (stock_number, hidden_by)
  VALUES (p_stock, auth.uid())
  ON CONFLICT (stock_number) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION unhide_marketplace_car(p_stock TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (SELECT role FROM profiles WHERE id = auth.uid()) <> 'admin' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  DELETE FROM marketplace_hidden WHERE stock_number = p_stock;
END;
$$;

GRANT EXECUTE ON FUNCTION hide_marketplace_car(TEXT)   TO authenticated;
GRANT EXECUTE ON FUNCTION unhide_marketplace_car(TEXT) TO authenticated;
NOTIFY pgrst, 'reload schema';
