-- A second dealership's sold book, for the list builder only.
--
-- WHY NOT IN `sold`
-- `sold` is the profit book. sold_rows(), sold_clean, SoldReports, the Executive
-- Dashboard and Buying-vs-Selling all read it as "cars WE sold", and sold_rows()
-- has a fixed column list, so it cannot even be taught to filter a rooftop out.
-- Landing a partner's cars there would quietly fold their volume and margin into
-- our own reporting, everywhere, with no way to tell which was which.
--
-- It would also have broken the nightly load outright: frazer-ingest truncates
-- the WHOLE target table each run and reloads the full export, so the Frazer
-- sync would have deleted the partner's book every night, silently.
--
-- So the partner book lives here. The list builder unions it in; nothing else
-- sees it. `dealership` is a column rather than a table name so a third rooftop
-- costs an ingest config and nothing else.
--
-- Columns are NORMALISED, unlike `sold` — we control this ingest, so the DMS's
-- naming stops here instead of leaking into the scoring engine. `sold` stores
-- Frazer's text because Power Automate posts Frazer's CSV verbatim; this one is
-- fed by a puller that can map on the way in.

CREATE TABLE IF NOT EXISTS public.partner_sold (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership    TEXT NOT NULL,
  source_id     TEXT NOT NULL,           -- the DMS's own deal id, or vin:sale_date
  stock_number  TEXT,
  vin           TEXT,
  year          INT,
  make          TEXT,
  model         TEXT,
  trim_level    TEXT,                    -- not `trim`: that is a SQL keyword
  odometer      INT,
  sale_date     DATE,
  purchase_date DATE,
  sale_price    NUMERIC,
  total_cost    NUMERIC,
  added_costs   NUMERIC,
  net_profit    NUMERIC,
  days_on_lot   INT,
  type_of_sale  TEXT,
  buyer         TEXT,
  vendor        TEXT,
  raw           JSONB,                   -- the untouched source row
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.partner_sold IS
  'Sold history from partner rooftops. Feeds the list builder''s cohort scoring only — never our own P&L reporting.';

-- The ingest upserts rather than truncate-and-reload: a puller reading an API
-- can be interrupted halfway, and a truncate would leave the book empty until
-- the next successful run.
--
-- source_id is a PLAIN column, not an expression over (source_id, vin, date),
-- because ON CONFLICT can only name a plain-column constraint through
-- supabase-js's `onConflict`. The fallback (vin:sale_date, for a DMS that
-- exposes no deal id) is therefore built by the puller on the way in, not here.
-- A car really can sell twice, so the date is part of the key.
CREATE UNIQUE INDEX IF NOT EXISTS partner_sold_key
  ON public.partner_sold (dealership, source_id);

CREATE INDEX IF NOT EXISTS partner_sold_dealership ON public.partner_sold (dealership);
CREATE INDEX IF NOT EXISTS partner_sold_make_model ON public.partner_sold (make, model);
CREATE INDEX IF NOT EXISTS partner_sold_date       ON public.partner_sold (sale_date);

-- Same posture as `sold`: the money is not readable with the public key.
ALTER TABLE public.partner_sold ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_sold FROM anon, authenticated, PUBLIC;

-- ── Write path helper ──────────────────────────────────────────────────────
-- `replace: true` on the ingest clears one rooftop's book before reloading it,
-- for the case where the source has no way to tell us a deal was VOIDED — an
-- upsert alone can only ever add and update, so a deleted deal would live in our
-- book forever. Scoped to one dealership so a misconfigured feed cannot empty
-- another rooftop's history.
CREATE OR REPLACE FUNCTION public.partner_sold_truncate(p_dealership text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n bigint;
BEGIN
  IF p_dealership IS NULL OR btrim(p_dealership) = '' THEN
    RAISE EXCEPTION 'partner_sold_truncate: dealership is required';
  END IF;
  DELETE FROM public.partner_sold WHERE dealership = p_dealership;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.partner_sold_truncate(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_sold_truncate(text) TO service_role;

-- ── Read path ──────────────────────────────────────────────────────────────
-- Mirrors list_all_sold: SECURITY DEFINER so it can read a table the caller
-- cannot, with costs_visible() deciding whether the money comes back. The
-- extension authenticates with the anon key and proves itself with p_key, which
-- is why anon gets EXECUTE here at all.
CREATE OR REPLACE FUNCTION public.list_partner_sold(p_key text DEFAULT NULL)
RETURNS TABLE (
  dealership text, vin text, stock_number text,
  year int, make text, model text, odometer int,
  sale_date date, sale_price numeric, total_cost numeric,
  added_costs numeric, net_profit numeric, days_on_lot int,
  buyer text, vendor text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.dealership, p.vin, p.stock_number,
         p.year, p.make, p.model, p.odometer,
         p.sale_date,
         p.sale_price,
         CASE WHEN costs_visible(p_key) THEN p.total_cost  END,
         CASE WHEN costs_visible(p_key) THEN p.added_costs END,
         CASE WHEN costs_visible(p_key) THEN p.net_profit  END,
         p.days_on_lot,
         p.buyer, p.vendor
  FROM public.partner_sold p
  ORDER BY p.sale_date DESC NULLS LAST;
$$;
REVOKE ALL ON FUNCTION public.list_partner_sold(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_partner_sold(text) TO anon, authenticated;

-- Which rooftops actually have data, for the list builder's selector. Cheap and
-- safe to expose: names and counts, no money.
CREATE OR REPLACE FUNCTION public.partner_sold_rooftops()
RETURNS TABLE (dealership text, cars bigint, first_sale date, last_sale date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.dealership, count(*), min(p.sale_date), max(p.sale_date)
  FROM public.partner_sold p
  GROUP BY p.dealership
  ORDER BY count(*) DESC;
$$;
REVOKE ALL ON FUNCTION public.partner_sold_rooftops() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_sold_rooftops() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
