-- Give sold_book a customer, and Buyer Match one place to train from.
--
-- sold_book was built to be the durable sold ledger, but its `customer` column
-- was mapped from `sold.customer` — a column the real Frazer export does not
-- have. The export puts the counterparty in first_name / last_name. So every
-- Frazer-fed ledger row has landed with customer NULL, and the only rows with a
-- customer at all are the 701 carried over from the old hand-loaded
-- wholesale_sold. This fixes the mapping, backfills what already landed, and
-- resolves each row to a channel using resolve_sale_channel().
--
-- Then buyer_training_rows() unions the two halves of the business into one
-- shape: SmartAuction with its real named buyers, and every other lane with the
-- lane itself as the customer.

-- ---------------------------------------------------------------------------
-- 1. Columns for the resolved identity.
-- ---------------------------------------------------------------------------
ALTER TABLE public.sold_book ADD COLUMN IF NOT EXISTS customer_state  text;
ALTER TABLE public.sold_book ADD COLUMN IF NOT EXISTS type_of_sale    text;
ALTER TABLE public.sold_book ADD COLUMN IF NOT EXISTS channel_key     text;
ALTER TABLE public.sold_book ADD COLUMN IF NOT EXISTS buyer_label     text;
ALTER TABLE public.sold_book ADD COLUMN IF NOT EXISTS buyer_detail    text;
ALTER TABLE public.sold_book ADD COLUMN IF NOT EXISTS is_arbitration  boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS sold_book_channel ON public.sold_book (channel_key);
CREATE INDEX IF NOT EXISTS sold_book_buyer   ON public.sold_book (buyer_label);

-- ---------------------------------------------------------------------------
-- 2. Landing -> ledger, with the customer actually mapped this time.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sold_to_book()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vin  text;
  v_date date;
  v_cust text;
  r      record;
BEGIN
  v_vin  := upper(NULLIF(btrim(COALESCE(NEW.vehicle_vin, '')), ''));
  v_date := frazer_date(NEW.sale_date);
  IF v_vin IS NULL OR v_date IS NULL THEN RETURN NEW; END IF;

  -- The export names the counterparty across first_name + last_name. `customer`
  -- exists only on rows imported from the old wholesale_sold table.
  v_cust := NULLIF(btrim(
    COALESCE(NULLIF(btrim(COALESCE(NEW.customer, '')), ''),
             btrim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')))
  ), '');

  SELECT * INTO r FROM resolve_sale_channel(v_cust);

  INSERT INTO sold_book (
    vin, stock_number, year, make, model, odometer, sale_date, sale_price,
    total_cost, added_costs, net_profit, days_on_lot, buyer, vendor, customer,
    title_in, customer_state, type_of_sale, channel_key, buyer_label,
    buyer_detail, is_arbitration)
  VALUES (
    v_vin, NULLIF(btrim(COALESCE(NEW.stock_number, '')), ''),
    frazer_num(NEW.vehicle_year)::int, NEW.vehicle_make, NEW.vehicle_model,
    frazer_num(NEW.mileage)::int, v_date, frazer_num(NEW.sales_price),
    frazer_num(NEW.total_cost), frazer_num(NEW.added_costs),
    frazer_num(COALESCE(NEW.profit_on_sale, NEW.net_profit)),
    frazer_num(NEW.days_on_lot)::int, NEW.buyer, NEW.vendor, v_cust, NEW.title_in,
    NULLIF(btrim(COALESCE(NEW.state, '')), ''), NULLIF(btrim(COALESCE(NEW.type_of_sale, '')), ''),
    r.channel_key, r.buyer_label, r.buyer_detail, COALESCE(r.is_arbitration, false))
  ON CONFLICT (vin, sale_date) DO UPDATE SET
    stock_number   = COALESCE(EXCLUDED.stock_number, sold_book.stock_number),
    sale_price     = COALESCE(EXCLUDED.sale_price, sold_book.sale_price),
    total_cost     = COALESCE(EXCLUDED.total_cost, sold_book.total_cost),
    added_costs    = COALESCE(EXCLUDED.added_costs, sold_book.added_costs),
    net_profit     = COALESCE(EXCLUDED.net_profit, sold_book.net_profit),
    days_on_lot    = COALESCE(EXCLUDED.days_on_lot, sold_book.days_on_lot),
    odometer       = COALESCE(EXCLUDED.odometer, sold_book.odometer),
    buyer          = COALESCE(EXCLUDED.buyer, sold_book.buyer),
    vendor         = COALESCE(EXCLUDED.vendor, sold_book.vendor),
    customer       = COALESCE(EXCLUDED.customer, sold_book.customer),
    title_in       = COALESCE(EXCLUDED.title_in, sold_book.title_in),
    customer_state = COALESCE(EXCLUDED.customer_state, sold_book.customer_state),
    type_of_sale   = COALESCE(EXCLUDED.type_of_sale, sold_book.type_of_sale),
    -- Channel is derived, so a re-resolve always wins rather than being COALESCEd
    -- into whatever a stale row happened to hold.
    channel_key    = EXCLUDED.channel_key,
    buyer_label    = EXCLUDED.buyer_label,
    buyer_detail   = EXCLUDED.buyer_detail,
    is_arbitration = EXCLUDED.is_arbitration,
    updated_at     = NOW();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Backfill. The trigger only fires on INSERT, and `sold` already holds a full
--    load, so replay it. DISTINCT ON because one VIN can appear twice on the same
--    date in the export and ON CONFLICT cannot touch a row twice per statement.
-- ---------------------------------------------------------------------------
WITH src AS (
  SELECT DISTINCT ON (upper(btrim(s.vehicle_vin)), frazer_date(s.sale_date))
         upper(btrim(s.vehicle_vin))                       AS vin,
         frazer_date(s.sale_date)                           AS sale_date,
         NULLIF(btrim(COALESCE(s.stock_number, '')), '')    AS stock_number,
         frazer_num(s.vehicle_year)::int                    AS year,
         s.vehicle_make                                     AS make,
         s.vehicle_model                                    AS model,
         frazer_num(s.mileage)::int                         AS odometer,
         frazer_num(s.sales_price)                          AS sale_price,
         frazer_num(s.total_cost)                           AS total_cost,
         frazer_num(s.added_costs)                          AS added_costs,
         frazer_num(COALESCE(s.profit_on_sale, s.net_profit)) AS net_profit,
         frazer_num(s.days_on_lot)::int                     AS days_on_lot,
         s.buyer, s.vendor, s.title_in,
         NULLIF(btrim(COALESCE(s.state, '')), '')           AS customer_state,
         NULLIF(btrim(COALESCE(s.type_of_sale, '')), '')    AS type_of_sale,
         NULLIF(btrim(COALESCE(NULLIF(btrim(COALESCE(s.customer, '')), ''),
                btrim(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')))), '') AS customer
  FROM public.sold s
  WHERE NULLIF(btrim(COALESCE(s.vehicle_vin, '')), '') IS NOT NULL
    AND frazer_date(s.sale_date) IS NOT NULL
  ORDER BY upper(btrim(s.vehicle_vin)), frazer_date(s.sale_date), s.synced_at DESC
),
resolved AS (
  SELECT src.*, r.channel_key, r.buyer_label, r.buyer_detail, r.is_arbitration
  FROM src, LATERAL public.resolve_sale_channel(src.customer) r
)
INSERT INTO public.sold_book (
  vin, stock_number, year, make, model, odometer, sale_date, sale_price,
  total_cost, added_costs, net_profit, days_on_lot, buyer, vendor, customer,
  title_in, customer_state, type_of_sale, channel_key, buyer_label,
  buyer_detail, is_arbitration, source)
SELECT vin, stock_number, year, make, model, odometer, sale_date, sale_price,
       total_cost, added_costs, net_profit, days_on_lot, buyer, vendor, customer,
       title_in, customer_state, type_of_sale, channel_key, buyer_label,
       buyer_detail, COALESCE(is_arbitration, false), 'frazer'
FROM resolved
ON CONFLICT (vin, sale_date) DO UPDATE SET
  customer       = COALESCE(EXCLUDED.customer, sold_book.customer),
  odometer       = COALESCE(EXCLUDED.odometer, sold_book.odometer),
  sale_price     = COALESCE(EXCLUDED.sale_price, sold_book.sale_price),
  net_profit     = COALESCE(EXCLUDED.net_profit, sold_book.net_profit),
  days_on_lot    = COALESCE(EXCLUDED.days_on_lot, sold_book.days_on_lot),
  customer_state = COALESCE(EXCLUDED.customer_state, sold_book.customer_state),
  type_of_sale   = COALESCE(EXCLUDED.type_of_sale, sold_book.type_of_sale),
  channel_key    = EXCLUDED.channel_key,
  buyer_label    = EXCLUDED.buyer_label,
  buyer_detail   = EXCLUDED.buyer_detail,
  is_arbitration = EXCLUDED.is_arbitration,
  updated_at     = NOW();

-- Rows that predate this (the wholesale_sold import) carry a customer but never
-- went through the resolver.
WITH unresolved AS (
  SELECT b.id, b.customer FROM public.sold_book b WHERE b.channel_key IS NULL
)
UPDATE public.sold_book b
SET channel_key = r.channel_key, buyer_label = r.buyer_label,
    buyer_detail = r.buyer_detail, is_arbitration = COALESCE(r.is_arbitration, false)
FROM unresolved u, LATERAL public.resolve_sale_channel(u.customer) r
WHERE b.id = u.id;

-- ---------------------------------------------------------------------------
-- 4. One training shape for the whole business.
--
--    SmartAuction rows come from sa_sold_sales, which is the only source with a
--    name, a phone and an email per buyer. Every other lane comes from sold_book
--    with the lane as the customer. A Frazer row for a car that SmartAuction
--    already reported is dropped rather than counted twice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buyer_training_rows(p_include_arbitration boolean DEFAULT false)
RETURNS TABLE (
  source          text,
  channel_key     text,
  channel_label   text,
  channel_kind    text,
  per_buyer_data  boolean,
  vin             text,
  year            int,
  make            text,
  model           text,
  odometer        int,
  segment         text,
  sale_date       date,
  sale_price      numeric,
  buyer_key       text,
  buyer_name      text,
  buyer_email     text,
  buyer_phone     text,
  buyer_city      text,
  buyer_state     text,
  buyer_detail    text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH sa AS (
    SELECT s.*, regexp_replace(COALESCE(s.buyer_phone, ''), '\D', '', 'g') AS d
    FROM sa_sold_sales s
    WHERE is_staff()
  )
  SELECT
    'smartauction'::text, 'smartauction'::text, 'SmartAuction'::text,
    'online_auction'::text, true,
    upper(sa.vin), sa.year, sa.make, sa.model, sa.odometer,
    COALESCE(sa.segment, sa_segment(sa.make, sa.model)),
    sa.sale_date, sa.sale_price,
    -- Mirrors buyerKey() in the app: phone, then email, then name.
    CASE
      WHEN length(sa.d) = 10 THEN 'p:' || sa.d
      WHEN length(sa.d) = 11 AND left(sa.d, 1) = '1' THEN 'p:' || right(sa.d, 10)
      WHEN sa.buyer_email LIKE '%@%' THEN 'e:' || lower(btrim(sa.buyer_email))
      ELSE 'n:' || lower(btrim(regexp_replace(COALESCE(sa.buyer_name, ''), '\s+', ' ', 'g')))
    END,
    sa.buyer_name, sa.buyer_email, sa.buyer_phone, sa.buyer_city, sa.buyer_state,
    NULL::text
  FROM sa
  WHERE sa.buyer_name IS NOT NULL AND btrim(sa.buyer_name) <> ''

  UNION ALL

  SELECT
    'frazer'::text, b.channel_key, c.label, c.kind, c.per_buyer_data,
    upper(b.vin), b.year, b.make, b.model, b.odometer,
    sa_segment(b.make, b.model),
    b.sale_date, b.sale_price,
    CASE WHEN c.per_buyer_data
         THEN 'n:' || lower(btrim(regexp_replace(b.buyer_label, '\s+', ' ', 'g')))
         ELSE 'c:' || b.channel_key END,
    b.buyer_label, NULL::text, NULL::text, NULL::text, b.customer_state,
    b.buyer_detail
  FROM sold_book b
  JOIN sale_channels c ON c.channel_key = b.channel_key
  WHERE is_staff()
    AND b.channel_key <> 'smartauction'
    AND b.buyer_label IS NOT NULL AND btrim(b.buyer_label) <> ''
    AND b.sale_date IS NOT NULL
    AND (p_include_arbitration OR NOT b.is_arbitration)
    -- Never double-count a car SmartAuction already reported with a real buyer.
    AND NOT EXISTS (SELECT 1 FROM sa_sold_sales s2 WHERE upper(s2.vin) = upper(b.vin));
$$;
REVOKE ALL ON FUNCTION public.buyer_training_rows(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_training_rows(boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. A health check, so "which channels are we learning from" is answerable
--    without running the engine.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buyer_training_stats()
RETURNS TABLE (channel_key text, channel_label text, per_buyer_data boolean,
               sales bigint, buyers bigint, first_sale date, last_sale date,
               avg_price numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.channel_key, t.channel_label, t.per_buyer_data,
         count(*), count(DISTINCT t.buyer_key),
         min(t.sale_date), max(t.sale_date), round(avg(t.sale_price), 0)
  FROM buyer_training_rows() t
  GROUP BY 1, 2, 3
  ORDER BY count(*) DESC;
$$;
REVOKE ALL ON FUNCTION public.buyer_training_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_training_stats() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Report what landed, so the push itself shows whether the mapping worked.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record; n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.sold_book;
  RAISE NOTICE 'sold_book rows: %', n;
  SELECT count(*) INTO n FROM public.sold_book WHERE customer IS NOT NULL;
  RAISE NOTICE 'sold_book rows with a customer: %', n;
  RAISE NOTICE '--- resolved channels ---';
  FOR r IN
    SELECT COALESCE(channel_key, '(null)') AS k, count(*) AS n,
           count(DISTINCT buyer_label) AS buyers,
           count(*) FILTER (WHERE is_arbitration) AS arb
    FROM public.sold_book GROUP BY 1 ORDER BY 2 DESC
  LOOP
    RAISE NOTICE '  % : % sales, % distinct customers, % arbitrated', rpad(r.k, 14), r.n, r.buyers, r.arb;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
