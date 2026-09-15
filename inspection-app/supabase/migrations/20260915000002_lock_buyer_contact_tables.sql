-- Lock down the SmartAuction buyer tables.
--
-- sa_sold_sales, sa_buyers and sa_recommendations each had one policy,
-- `FOR ALL TO anon, authenticated USING (true)`, plus every table privilege for
-- both roles — TRUNCATE included, which RLS does not even apply to. The anon key
-- ships in the public marketplace bundle, so anyone could read 832 buyer phone
-- numbers and emails, rewrite them, or empty the tables with one request.
-- Verified from outside with the anon key on 2026-09-15.
--
-- Who actually needs them:
--   * staff in the app — Buyer Match's CSV upload (sa_sold_sales), the GHL seed
--     (sa_buyers), saving picks (sa_recommendations), Buyers analytics (reads)
--   * the Chrome extension, which upserts sold rows with the anon key on every
--     SMART_AUCTION upload → it now calls ingest_sa_sold_sales() with the same
--     shared key that already unlocks costs (api_keys 'extension_costs')
--   * ghl-lead-sync, db-backup, /api/* → service role, unaffected
--   * buyer_training_rows(), buyer_share_list(), sync_health() … → all SECURITY
--     DEFINER, unaffected

-- ---------------------------------------------------------------------------
-- Privileges: nothing for anon; ordinary DML for authenticated, filtered below.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.sa_sold_sales, public.sa_buyers, public.sa_recommendations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.sa_sold_sales, public.sa_buyers, public.sa_recommendations TO authenticated;

ALTER TABLE public.sa_sold_sales      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sa_buyers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sa_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rw sold"  ON public.sa_sold_sales;
DROP POLICY IF EXISTS "rw buyers" ON public.sa_buyers;
DROP POLICY IF EXISTS "rw reco"  ON public.sa_recommendations;

-- `authenticated` includes buyers signed into the marketplace, so the policy —
-- not the grant — is what keeps them out.
DROP POLICY IF EXISTS "staff only" ON public.sa_sold_sales;
CREATE POLICY "staff only" ON public.sa_sold_sales
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
DROP POLICY IF EXISTS "staff only" ON public.sa_buyers;
CREATE POLICY "staff only" ON public.sa_buyers
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
DROP POLICY IF EXISTS "staff only" ON public.sa_recommendations;
CREATE POLICY "staff only" ON public.sa_recommendations
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

-- ---------------------------------------------------------------------------
-- The extension's way in.
--
-- Same semantics as the PostgREST upsert it replaces
-- (`?on_conflict=vin`, `Prefer: resolution=merge-duplicates`): insert by VIN,
-- overwrite the columns the extension sends, leave price_tier and ingested_at
-- alone. Duplicates within one call keep the LAST row, which is the newest sale
-- because both uploaders sort oldest → newest before sending.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ingest_sa_sold_sales(p_key text, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE n integer;
BEGIN
  IF NOT (
    public.is_staff() AND auth.role() IS DISTINCT FROM 'anon'
    OR EXISTS (
      SELECT 1 FROM api_keys k
      WHERE k.name = 'extension_costs'
        AND p_key IS NOT NULL AND length(btrim(p_key)) > 0
        AND k.key_sha256 = encode(extensions.digest(convert_to(p_key, 'UTF8'), 'sha256'), 'hex')
    )
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array' USING ERRCODE = '22023';
  END IF;

  WITH incoming AS (
    SELECT r.*, ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS e(j, ord)
    CROSS JOIN LATERAL jsonb_populate_record(NULL::sa_sold_sales, e.j) AS r
    WHERE NULLIF(btrim(r.vin), '') IS NOT NULL
      AND NULLIF(btrim(r.buyer_name), '') IS NOT NULL
  ), latest AS (
    SELECT DISTINCT ON (vin) * FROM incoming ORDER BY vin, ord DESC
  )
  INSERT INTO sa_sold_sales AS s (
    vin, year, make, model, "trim", drivetrain, odometer, color, segment,
    sale_date, sale_price, buyer_name, buyer_email, buyer_phone,
    buyer_city, buyer_state, buyer_zip, seller, source
  )
  SELECT vin, year, make, model, "trim", drivetrain, odometer, color, segment,
         sale_date, sale_price, buyer_name, buyer_email, buyer_phone,
         buyer_city, buyer_state, buyer_zip, seller, COALESCE(source, 'smartauction')
  FROM latest
  ON CONFLICT (vin) DO UPDATE SET
    year = EXCLUDED.year, make = EXCLUDED.make, model = EXCLUDED.model,
    "trim" = EXCLUDED."trim", drivetrain = EXCLUDED.drivetrain,
    odometer = EXCLUDED.odometer, color = EXCLUDED.color, segment = EXCLUDED.segment,
    sale_date = EXCLUDED.sale_date, sale_price = EXCLUDED.sale_price,
    buyer_name = EXCLUDED.buyer_name, buyer_email = EXCLUDED.buyer_email,
    buyer_phone = EXCLUDED.buyer_phone, buyer_city = EXCLUDED.buyer_city,
    buyer_state = EXCLUDED.buyer_state, buyer_zip = EXCLUDED.buyer_zip,
    seller = EXCLUDED.seller, source = EXCLUDED.source;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.ingest_sa_sold_sales(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_sa_sold_sales(text, jsonb) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
