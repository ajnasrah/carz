-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Exposes the full inventory + sold tables to the anon key via SECURITY DEFINER
-- so the SmartAuction extension can auto-sync them without a button press.
--
-- These bypass RLS deliberately — the tables are read-only wholesale data and
-- the extension already holds the anon key, so there's no extra exposure.

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

-- RPC used by list-uploader to flag any VIN that has already been sold.
-- Mirrors the shape of inventory_stocks_by_vins.
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
