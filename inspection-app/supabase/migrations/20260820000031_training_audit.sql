-- A standing health check for the training set.
--
-- The engine is only as good as what it is fed, and the failure mode is silent:
-- a lane that stops resolving, a Frazer load that lands with no customer, a VIN
-- counted twice because SmartAuction and Frazer both reported it. None of that
-- raises an error — it just quietly makes the recommendations worse, which is
-- exactly how the thing spent months training on one channel out of fourteen.
--
-- Run this after any sold-data change. Every row it returns is either 'ok' or a
-- thing to look at.
CREATE OR REPLACE FUNCTION public.buyer_training_audit()
RETURNS TABLE (check_name text, status text, detail text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE n bigint; m bigint; t text;
BEGIN
  IF NOT is_staff() THEN RAISE EXCEPTION 'staff only'; END IF;

  -- 1. Volume.
  SELECT count(*) INTO n FROM buyer_training_rows();
  RETURN QUERY SELECT 'training rows'::text,
    CASE WHEN n > 5000 THEN 'ok' ELSE 'LOW' END, n::text || ' sales';

  SELECT count(DISTINCT buyer_key) INTO n FROM buyer_training_rows();
  RETURN QUERY SELECT 'distinct customers'::text,
    CASE WHEN n > 400 THEN 'ok' ELSE 'LOW' END, n::text;

  SELECT count(DISTINCT channel_key) INTO n FROM buyer_training_rows();
  RETURN QUERY SELECT 'channels represented'::text,
    CASE WHEN n >= 10 THEN 'ok' ELSE 'LOW' END, n::text;

  -- 2. Double counting. A VIN sold once must appear once. sold_book is keyed on
  --    (vin, sale_date), so a genuine resale is two rows and legitimate; the same
  --    VIN on the same DAY twice is not.
  SELECT count(*) INTO n FROM (
    SELECT vin, sale_date FROM buyer_training_rows()
    GROUP BY vin, sale_date HAVING count(*) > 1) z;
  RETURN QUERY SELECT 'duplicate (vin, sale_date)'::text,
    CASE WHEN n = 0 THEN 'ok' ELSE 'DUPLICATES' END, n::text || ' pairs';

  SELECT count(*) INTO n FROM (
    SELECT vin FROM buyer_training_rows() GROUP BY vin HAVING count(*) > 1) z;
  RETURN QUERY SELECT 'VINs sold more than once'::text, 'info',
    n::text || ' (expected: cars that came back and resold)';

  -- 3. Identity. A row with no buyer is a row the engine silently drops.
  SELECT count(*) INTO n FROM buyer_training_rows()
   WHERE buyer_key IS NULL OR btrim(buyer_key) IN ('', 'n:', 'c:', 'e:', 'p:');
  RETURN QUERY SELECT 'rows with no usable buyer key'::text,
    CASE WHEN n = 0 THEN 'ok' ELSE 'DROPPED' END, n::text;

  -- 4. Dates and money.
  SELECT count(*) INTO n FROM buyer_training_rows() WHERE sale_date > CURRENT_DATE;
  RETURN QUERY SELECT 'future-dated sales'::text,
    CASE WHEN n = 0 THEN 'ok' ELSE 'CHECK' END, n::text;

  SELECT count(*) INTO n FROM buyer_training_rows() WHERE sale_price IS NULL OR sale_price <= 0;
  RETURN QUERY SELECT 'sales with no price'::text,
    CASE WHEN n = 0 THEN 'ok' ELSE 'CHECK' END,
    n::text || ' (price fit falls back to a default for these)';

  SELECT count(*) INTO n FROM buyer_training_rows() WHERE sale_price > 200000;
  RETURN QUERY SELECT 'implausible prices (>$200k)'::text,
    CASE WHEN n = 0 THEN 'ok' ELSE 'CHECK' END, n::text;

  SELECT count(*) INTO n FROM buyer_training_rows() WHERE odometer IS NULL;
  SELECT count(*) INTO m FROM buyer_training_rows();
  RETURN QUERY SELECT 'sales with no odometer'::text,
    CASE WHEN n * 100 / GREATEST(m, 1) < 60 THEN 'ok' ELSE 'HIGH' END,
    n::text || ' of ' || m::text || ' (' || round(n * 100.0 / GREATEST(m, 1)) || '%) — mileage fit is skipped for these';

  -- 5. Freshness. A channel that has gone quiet is either a real business change
  --    or a broken feed, and the difference matters.
  SELECT string_agg(x.channel_label || ' (' || (CURRENT_DATE - x.last_sale) || 'd)', ', ' ORDER BY x.last_sale)
    INTO t FROM (
      SELECT channel_label, max(sale_date) AS last_sale
      FROM buyer_training_rows() GROUP BY 1
      HAVING max(sale_date) < CURRENT_DATE - 45) x;
  RETURN QUERY SELECT 'channels quiet over 45 days'::text,
    CASE WHEN t IS NULL THEN 'ok' ELSE 'STALE' END, COALESCE(t, 'none');

  -- 6. Resolution quality. Anything landing in 'direct' with real volume is a
  --    lane we have not taught the resolver about yet.
  SELECT string_agg(x.buyer_label || ' (' || x.n || ')', ', ' ORDER BY x.n DESC)
    INTO t FROM (
      SELECT buyer_label, count(*) AS n FROM sold_book
      WHERE channel_key = 'direct' GROUP BY 1 HAVING count(*) >= 25 ORDER BY 2 DESC LIMIT 8) x;
  RETURN QUERY SELECT 'big "direct" customers to review'::text, 'info',
    COALESCE(t, 'none') || ' — a lane here needs a sale_channel_aliases row';

  SELECT count(*) INTO n FROM sold_book WHERE channel_key IS NULL;
  RETURN QUERY SELECT 'sold_book rows with no channel'::text,
    CASE WHEN n = 0 THEN 'ok' ELSE 'UNRESOLVED' END, n::text;

  SELECT count(*) INTO n FROM sold_book WHERE customer IS NULL OR btrim(customer) = '';
  RETURN QUERY SELECT 'sold_book rows with no customer'::text,
    CASE WHEN n = 0 THEN 'ok' ELSE 'CHECK' END,
    n::text || ' (was every Frazer row before the trigger was fixed)';

  SELECT count(*) INTO n FROM sold_book WHERE is_arbitration;
  RETURN QUERY SELECT 'arbitrated sales held out'::text, 'info', n::text;

  -- 7. The overlap the union is supposed to remove.
  SELECT count(*) INTO n FROM sold_book b
   WHERE b.channel_key <> 'smartauction'
     AND EXISTS (SELECT 1 FROM sa_sold_sales s WHERE upper(s.vin) = upper(b.vin));
  RETURN QUERY SELECT 'non-SA rows also in sa_sold_sales'::text, 'info',
    n::text || ' excluded from training to avoid double counting';

  -- 8. Segment agreement. sa_sold_sales stores a segment at ingest; if it drifts
  --    from sa_segment() the engine trains on one and scores on the other.
  SELECT count(*) INTO n FROM sa_sold_sales
   WHERE segment IS DISTINCT FROM sa_segment(make, model);
  RETURN QUERY SELECT 'stored segments disagreeing with sa_segment()'::text,
    CASE WHEN n = 0 THEN 'ok' ELSE 'DRIFT' END, n::text;
END $$;
REVOKE ALL ON FUNCTION public.buyer_training_audit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_training_audit() TO authenticated, service_role;

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '================ TRAINING AUDIT ================';
  FOR r IN SELECT * FROM public.buyer_training_audit() LOOP
    RAISE NOTICE '% | % | %', rpad(r.check_name, 44), rpad(r.status, 11), r.detail;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
