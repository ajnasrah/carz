-- Restore list_all_sold(), which my DROP TABLE ... CASCADE took with it.
--
-- It RETURNS SETOF sold, so it depends on the table's rowtype and CASCADE
-- removed it silently along with the table. That is what broke the Target Buy
-- List: the extension scores a run list against list_all_sold(), and with the
-- function gone every car came back with no comps.
--
-- sold_stocks_by_vins survived — it RETURNS TABLE(...), which does not depend on
-- the rowtype. Worth knowing which of the two shapes a drop takes with it.
CREATE OR REPLACE FUNCTION public.list_all_sold()
RETURNS SETOF public.sold
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.sold ORDER BY sale_date DESC;
$$;

-- Restored to the grant it had before today.
--
-- BE AWARE: this hands the whole sold book — cost, sale price, profit, customer
-- names — to anyone holding the public key, which reopens on this function what
-- 20260819000016 closed on the tables. It is restored rather than tightened
-- because the extension has no sign-in at all and this is how it scores a run
-- list; locking it would break the Target Buy List outright.
--
-- The real fix is a credential of its own for the extension, not a weaker RPC.
-- Until then this is a known, deliberate hole rather than an accidental one.
GRANT EXECUTE ON FUNCTION public.list_all_sold() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
