-- Cost is not for everyone.
--
-- What we paid for a car, and what we have in it, is now visible only to people
-- with sold-reports access (and admins). Everyone else keeps the whole of
-- inventory — year, make, model, mileage, location, days on lot, stock number —
-- and simply cannot see the money. The ASKING price is untouched: that is what
-- we sell on, and the marketplace exists to show it.
--
-- Until this migration the public anon key could read total_cost and added_costs
-- for all 337 cars, both through list_all_inventory() and straight off the
-- table. That is the hole this closes.
--
-- HOW IT WORKS
-- Postgres grants are per-ROLE, and every signed-in user shares one role, so
-- column grants alone cannot say "these users but not those". So:
--   · the cost COLUMNS are revoked from anon and authenticated outright
--   · everything else on inventory stays granted, column by column
--   · cost comes back only through a SECURITY DEFINER function that checks who
--     is asking
-- A caller with no access gets the same rows with the money nulled, rather than
-- an error — a report that renders with blanks beats one that explodes.

-- ---------------------------------------------------------------------------
-- 1. Who may see cost
-- ---------------------------------------------------------------------------
-- The extension has no sign-in and carries the public key, so it identifies
-- itself with a shared secret instead. Only the SHA-256 is stored; the key
-- itself lives in the extension's config and in the owner's hands.
INSERT INTO public.api_keys (name, key_sha256)
VALUES ('extension_costs', 'e9cd36318de8d0c58eda9267ff9ef263d52526189b4ce1f8397ea71f03d1370e')
ON CONFLICT (name) DO UPDATE SET key_sha256 = EXCLUDED.key_sha256;

CREATE OR REPLACE FUNCTION public.costs_visible(p_key text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean;
BEGIN
  -- Trusted server contexts (service role, migrations) always see cost.
  IF current_user NOT IN ('anon', 'authenticated') THEN RETURN true; END IF;

  IF public.is_admin() THEN RETURN true; END IF;

  SELECT COALESCE(p.sold_reports_access, false) INTO ok
  FROM profiles p WHERE p.id = auth.uid();
  IF COALESCE(ok, false) THEN RETURN true; END IF;

  -- The extension's key. Compared against the stored digest, never in the clear.
  IF p_key IS NOT NULL AND length(btrim(p_key)) > 0 THEN
    RETURN EXISTS (
      SELECT 1 FROM api_keys k
      WHERE k.name = 'extension_costs'
        AND k.key_sha256 = encode(digest(convert_to(p_key, 'UTF8'), 'sha256'), 'hex')
    );
  END IF;

  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.costs_visible(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.costs_visible(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Take the cost columns off the inventory table
--
-- Column-by-column grants: everything except the money. A plain
-- `select=*` from a client now returns the row without cost rather than failing,
-- and an explicit `select=total_cost` is refused.
-- ---------------------------------------------------------------------------
REVOKE SELECT ON public.inventory FROM anon, authenticated;
GRANT SELECT (
  stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_vin,
  mileage, vehicle_color, vehicle_source, vehicle_notes, days_on_lot,
  buyer, location_code, engine, purchase_date, vendor, title_in,
  title_number, tag, gl_purchase_account, purchase_notes, last_6_vin, synced_at
) ON public.inventory TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Give cost back to the people entitled to it
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_all_inventory(p_key text DEFAULT NULL)
RETURNS SETOF public.inventory
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.inventory%ROWTYPE; show boolean;
BEGIN
  show := public.costs_visible(p_key);
  FOR r IN SELECT * FROM public.inventory LOOP
    IF NOT show THEN
      r.total_cost := NULL;
      r.added_costs := NULL;
    END IF;
    RETURN NEXT r;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.list_all_inventory(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_all_sold(p_key text DEFAULT NULL)
RETURNS SETOF public.sold
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.sold%ROWTYPE; show boolean;
BEGIN
  show := public.costs_visible(p_key);
  FOR r IN SELECT * FROM public.sold ORDER BY sale_date DESC LOOP
    IF NOT show THEN
      r.original_cost := NULL; r.total_cost := NULL; r.added_costs := NULL;
      r.profit_on_sale := NULL; r.net_profit := NULL; r.labor_costs := NULL;
      r.service_contract_profit := NULL; r.service_contract_cost := NULL;
      r.optional_sales_fee_1_profit := NULL; r.optional_sales_fee_2_profit := NULL;
      r.optional_sales_fee_3_profit := NULL; r.cost_of_financing := NULL;
      r.document_fee := NULL; r.reserve := NULL; r.total_of_payments_received := NULL;
      -- sales_price stays: it is the asking/sale figure, not what we had in it.
    END IF;
    RETURN NEXT r;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.list_all_sold(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
