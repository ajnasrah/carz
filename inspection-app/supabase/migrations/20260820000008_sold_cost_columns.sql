-- Take the money columns off `sold` too.
--
-- inventory's cost columns were revoked in 20260820000001, but `sold` was still
-- granted whole to `authenticated` — so a staff member without sold-reports
-- access could not see what a car cost, and could read every sold car's profit
-- straight off the API. The app didn't show it, which is not the same as it
-- being protected.
--
-- Same shape as inventory: revoke the table, grant back every column except the
-- money, and let sold_rows() / sold_clean hand cost to the people entitled to it.
-- sales_price stays granted — it is what we sold for, not what we had in it.
REVOKE SELECT ON public.sold FROM anon, authenticated;
GRANT SELECT (
  id, stock_number, vehicle_vin, last_6_vin,
  vehicle_year, vehicle_make, vehicle_model, vehicle_color, vehicle_source,
  vehicle_notes, mileage, engine, buyer, vendor,
  first_name, last_name, customer, state, type_of_sale,
  location_code, sales_price, days_on_lot, purchase_date, sale_date,
  last_pay_date, title_in, title_number, tag, gl_purchase_account,
  purchase_notes, synced_at
) ON public.sold TO authenticated;

NOTIFY pgrst, 'reload schema';
