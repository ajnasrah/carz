-- Recreate the inventory/sold list RPCs and force a PostgREST schema reload.
-- The extension's syncSupabaseInventory / syncSupabaseSold hit these; a stale
-- schema cache (PGRST202) or a rowtype drift after a Frazer inventory reload
-- makes them error. Recreating + reloading refreshes both. If the `sold` or
-- `inventory` relation were missing, this migration itself would fail loudly,
-- which also pinpoints the cause.

CREATE OR REPLACE FUNCTION list_all_inventory()
RETURNS SETOF inventory
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM inventory;
$$;

CREATE OR REPLACE FUNCTION list_all_sold()
RETURNS SETOF sold
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM sold ORDER BY sale_date DESC;
$$;

GRANT EXECUTE ON FUNCTION list_all_inventory() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION list_all_sold() TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
