-- Gate cost on the sold side too, and give the app a way to ask for it.
--
-- 20260820000001 took cost off `inventory`, but `sold` was still readable in
-- full by any signed-in user — so a staff member without sold-reports access
-- could not see what a car cost, and could see exactly what every sold car
-- made. Half a gate is not a gate.
--
-- sold_clean masks in the view instead of by grant, because a view can decide
-- per row what to hand back and a GRANT cannot: it is one decision for the whole
-- `authenticated` role, and the whole point here is that some of those users may
-- see cost and some may not.

CREATE OR REPLACE VIEW public.sold_clean
WITH (security_invoker = true) AS
  SELECT
    s.stock_number,
    NULLIF(regexp_replace(COALESCE(s.vehicle_year, ''), '[^0-9]', '', 'g'), '')::int   AS year,
    s.vehicle_make  AS make,
    s.vehicle_model AS model,
    NULLIF(regexp_replace(COALESCE(s.mileage, ''), '[^0-9]', '', 'g'), '')::int        AS mileage,
    public.frazer_date(s.sale_date)                                                    AS sale_date,
    NULLIF(regexp_replace(COALESCE(s.days_on_lot, ''), '[^0-9\-]', '', 'g'), '')::int  AS days_on_lot,
    -- The money, only for those entitled to it. Everyone else gets the same row
    -- with blanks, so a report renders empty rather than erroring.
    CASE WHEN public.costs_visible() THEN public.frazer_num(s.original_cost) END       AS original_cost,
    CASE WHEN public.costs_visible() THEN public.frazer_num(s.total_cost)    END       AS total_cost,
    -- Sale price is what we sold it for, not what we had in it. Never masked.
    public.frazer_num(s.sales_price)                                                   AS sales_price,
    CASE WHEN public.costs_visible()
         THEN public.frazer_num(COALESCE(s.profit_on_sale, s.net_profit)) END          AS profit
  FROM public.sold s;
GRANT SELECT ON public.sold_clean TO authenticated;

-- The full sold row, masked the same way. This is what the reports read now
-- instead of selecting from `sold` directly, which cannot be gated per user.
CREATE OR REPLACE FUNCTION public.sold_rows(p_key text DEFAULT NULL)
RETURNS TABLE (
  stock_number text, vehicle_vin text, last_6_vin text,
  vehicle_year text, vehicle_make text, vehicle_model text,
  sale_date text, buyer text, vendor text, first_name text, last_name text,
  total_cost numeric, added_costs numeric, sales_price numeric,
  profit_on_sale numeric, days_on_lot int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT s.stock_number, s.vehicle_vin, s.last_6_vin,
         s.vehicle_year, s.vehicle_make, s.vehicle_model,
         s.sale_date, s.buyer, s.vendor, s.first_name, s.last_name,
         CASE WHEN costs_visible(p_key) THEN frazer_num(s.total_cost)  END,
         CASE WHEN costs_visible(p_key) THEN frazer_num(s.added_costs) END,
         frazer_num(s.sales_price),
         CASE WHEN costs_visible(p_key)
              THEN frazer_num(COALESCE(s.profit_on_sale, s.net_profit)) END,
         nullif(regexp_replace(COALESCE(s.days_on_lot, ''), '[^0-9\-]', '', 'g'), '')::int
  FROM public.sold s;
$$;
GRANT EXECUTE ON FUNCTION public.sold_rows(text) TO anon, authenticated;

-- Cost for a set of stock numbers, gated. Lets a page that mostly needs
-- inventory facts pull the money separately rather than losing the whole query.
CREATE OR REPLACE FUNCTION public.inventory_costs(p_key text DEFAULT NULL)
RETURNS TABLE (stock_number text, total_cost numeric, added_costs numeric, days_on_lot text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT i.stock_number,
         CASE WHEN costs_visible(p_key) THEN frazer_num(i.total_cost)  END,
         CASE WHEN costs_visible(p_key) THEN frazer_num(i.added_costs) END,
         i.days_on_lot
  FROM public.inventory i;
$$;
GRANT EXECUTE ON FUNCTION public.inventory_costs(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
