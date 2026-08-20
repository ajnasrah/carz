-- sold_clean must run as its owner, not as the caller.
--
-- I set security_invoker = true on it in 20260820000006, then revoked the cost
-- columns on `sold` in ...0008. Those two cannot both be true: an invoker view
-- reads the base table with the CALLER's rights, and the caller is exactly who
-- no longer has total_cost or profit_on_sale. Every read of sold_clean failed
-- with "permission denied for view sold_clean" — which took the Dashboard's
-- sold counts, Buying vs Selling, and the sold reports down with it.
--
-- The masking does not need invoker semantics, because the view does it itself:
-- costs_visible() decides per caller inside the CASE. Definer rights let it
-- reach the columns; the CASE decides who gets to see what came back. That is
-- the correct split, and the reason a masking view exists at all.
--
-- (This is the opposite call from 20260820000016 on the old view, where invoker
-- was right precisely BECAUSE there was no masking in the body — the view was
-- handing out rows the base table's RLS had already refused.)
CREATE OR REPLACE VIEW public.sold_clean
WITH (security_invoker = false) AS
  SELECT
    s.stock_number,
    NULLIF(regexp_replace(COALESCE(s.vehicle_year, ''), '[^0-9]', '', 'g'), '')::int   AS year,
    s.vehicle_make  AS make,
    s.vehicle_model AS model,
    NULLIF(regexp_replace(COALESCE(s.mileage, ''), '[^0-9]', '', 'g'), '')::int        AS mileage,
    public.frazer_date(s.sale_date)                                                    AS sale_date,
    NULLIF(regexp_replace(COALESCE(s.days_on_lot, ''), '[^0-9\-]', '', 'g'), '')::int  AS days_on_lot,
    CASE WHEN public.costs_visible() THEN public.frazer_num(s.original_cost) END       AS original_cost,
    CASE WHEN public.costs_visible() THEN public.frazer_num(s.total_cost)    END       AS total_cost,
    public.frazer_num(s.sales_price)                                                   AS sales_price,
    CASE WHEN public.costs_visible()
         THEN public.frazer_num(COALESCE(s.profit_on_sale, s.net_profit)) END          AS profit
  FROM public.sold s;

REVOKE ALL ON public.sold_clean FROM anon, PUBLIC;
GRANT SELECT ON public.sold_clean TO authenticated;

NOTIFY pgrst, 'reload schema';
