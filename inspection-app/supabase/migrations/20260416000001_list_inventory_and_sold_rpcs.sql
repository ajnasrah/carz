-- Exposes the full inventory + sold tables to the anon key via SECURITY DEFINER
-- so the SmartAuction extension can auto-sync without a button press.
-- Anon SELECT on these tables is RLS-blocked; these wrappers are the bypass.

CREATE OR REPLACE FUNCTION list_all_inventory()
RETURNS SETOF inventory
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM inventory;
$$;

CREATE OR REPLACE FUNCTION list_all_sold()
RETURNS SETOF sold
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM sold ORDER BY sale_date DESC;
$$;

CREATE OR REPLACE FUNCTION sold_stocks_by_vins(vin_list text[])
RETURNS TABLE (stock_number text, vehicle_vin text, last_6_vin text, sale_date text, sales_price text)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT s.stock_number, s.vehicle_vin, s.last_6_vin, s.sale_date, s.sales_price
  FROM sold s
  WHERE upper(s.vehicle_vin) = ANY(SELECT upper(v) FROM unnest(vin_list) v)
     OR upper(s.last_6_vin) = ANY(SELECT upper(right(v, 6)) FROM unnest(vin_list) v);
$$;

GRANT EXECUTE ON FUNCTION list_all_inventory() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION list_all_sold() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION sold_stocks_by_vins(text[]) TO anon, authenticated;
