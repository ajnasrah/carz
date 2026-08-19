-- Match `sold` to the real Frazer export: all 40 headers, exactly.
--
-- Built from SOLD(in).csv — 6,453 rows, 40 columns. The reconstruction I made
-- from what the app selects was missing eleven of them (state, type_of_sale,
-- document_fee, the three service-contract columns, three optional sales fees,
-- cost_of_financing, reserve, labor_costs, total_of_payments_received,
-- last_pay_date). Any one of those fails the whole insert.
--
-- Note the export's LAST header is empty — the header row ends in a comma. That
-- normalises to a column named "", which no table can have, so this alone would
-- have failed every load that ever ran. frazer-ingest now drops unknown headers
-- rather than rejecting the batch, so it survives that; this migration makes the
-- other 39 land properly rather than being dropped too.
--
-- Everything stays TEXT. It is a landing pad for a CSV, and sold_clean does the
-- typing. A numeric column here would reject "$1,234.00" and take the load with it.

ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS stock_number TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS sale_date TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS type_of_sale TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS vehicle_year TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS vehicle_make TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS vehicle_model TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS vehicle_vin TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS mileage TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS vehicle_color TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS last_pay_date TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS days_on_lot TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS buyer TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS location_code TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS original_cost TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS total_cost TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS document_fee TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS service_contract TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS service_contract_profit TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS service_contract_cost TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS optional_sales_fee_1_profit TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS optional_sales_fee_2_profit TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS optional_sales_fee_3_profit TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS profit_on_sale TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS cost_of_financing TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS reserve TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS sales_price TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS purchase_date TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS vehicle_notes TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS vendor TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS title_in TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS title_number TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS added_costs TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS labor_costs TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS tag TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS total_of_payments_received TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS last_6_vin TEXT;

-- Present in my rebuild but not in the export; harmless, and keeps older callers
-- working. net_profit is the name wholesale_sold used for profit_on_sale.
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS net_profit TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS customer TEXT;
ALTER TABLE public.sold ADD COLUMN IF NOT EXISTS engine TEXT;

NOTIFY pgrst, 'reload schema';
