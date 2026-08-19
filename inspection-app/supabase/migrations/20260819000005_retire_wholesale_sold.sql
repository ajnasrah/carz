-- Point every profit reader at sold_book, and retire wholesale_sold.
--
-- Verified before writing this: sold_book holds all 701 rows and the same
-- $400,580 of net profit, so nothing is lost. What is gained is that sold_book
-- keeps filling — the Frazer sold export lands in `sold` and the trigger merges
-- it — whereas wholesale_sold was hand-loaded once on 2026-07-29 and had been
-- quietly stale ever since, which is why every profit figure in the app stopped
-- three weeks ago without anyone being told.
--
-- RENAMED, NOT DROPPED. It is the only copy of the pre-automation history and
-- the sold feed has not delivered its first real load yet. Renaming takes it out
-- of the way, breaks nothing that still reads it (nothing does, after this
-- migration), and can be undone with one statement. Drop it once a Frazer sync
-- has actually landed.

CREATE OR REPLACE FUNCTION vendor_performance()
RETURNS TABLE (vendor text, city text, state text, kind text,
               cars bigint, profit_per_car numeric, total_profit numeric,
               avg_cost numeric, avg_days_on_lot numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT upper(btrim(w.vendor)),
         v.city, v.state, COALESCE(v.kind, 'private'),
         count(*),
         round(avg(w.net_profit), 0),
         round(sum(w.net_profit), 0),
         round(avg(w.total_cost), 0),
         round(avg(w.days_on_lot), 0)
  FROM sold_book w
  LEFT JOIN vendor_locations v ON v.vendor = upper(btrim(w.vendor))
  WHERE w.vendor IS NOT NULL AND btrim(w.vendor) <> ''
  GROUP BY 1, 2, 3, 4
  ORDER BY sum(w.net_profit) DESC NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION vendor_performance() TO anon, authenticated;

CREATE OR REPLACE FUNCTION seller_performance(p_min_sold int DEFAULT 1)
RETURNS TABLE (seller text, auction text, bought bigint, sold bigint, on_lot bigint,
               realised_profit numeric, profit_per_car numeric,
               avg_days numeric, avg_cr numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.seller, max(s.auction), count(*), count(w.vin),
         count(*) FILTER (WHERE w.vin IS NULL),
         round(sum(w.net_profit), 0), round(avg(w.net_profit), 0),
         round(avg(w.days_on_lot), 0), round(avg(s.cr_grade), 1)
  FROM vehicle_purchase_source s
  LEFT JOIN sold_book w ON upper(w.vin) = s.vin
  WHERE s.seller IS NOT NULL
  GROUP BY s.seller
  HAVING count(w.vin) >= p_min_sold
  ORDER BY avg(w.net_profit) DESC NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION seller_performance(int) TO anon, authenticated;

-- link_purchase_sources() read wholesale_sold for "cars we have sold".
CREATE OR REPLACE FUNCTION link_purchase_sources()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  WITH ours AS (
    SELECT upper(vehicle_vin) AS vin FROM inventory WHERE vehicle_vin IS NOT NULL
    UNION
    SELECT upper(vin) FROM sold_book WHERE vin IS NOT NULL
  ),
  best AS (
    SELECT DISTINCT ON (o.vin)
           upper(o.vin) AS vin, o.seller, o.auction, o.lane, o.run,
           o.cr_grade, o.announcements, o.sale_date, o.source_id, o.seen_at
    FROM run_list_observations o
    JOIN ours ON ours.vin = upper(o.vin)
    WHERE o.seller IS NOT NULL OR o.auction IS NOT NULL
    ORDER BY o.vin, o.seen_at DESC
  )
  INSERT INTO vehicle_purchase_source
    (vin, seller, auction, lane, run, cr_grade, announcements, sale_date, source_id, observed_at)
  SELECT vin, seller, auction, lane, run, cr_grade, announcements, sale_date, source_id, seen_at
  FROM best
  ON CONFLICT (vin) DO UPDATE SET
    seller = EXCLUDED.seller, auction = EXCLUDED.auction,
    lane = EXCLUDED.lane, run = EXCLUDED.run, cr_grade = EXCLUDED.cr_grade,
    announcements = EXCLUDED.announcements, sale_date = EXCLUDED.sale_date,
    source_id = EXCLUDED.source_id, observed_at = EXCLUDED.observed_at,
    linked_at = NOW();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION link_purchase_sources() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION link_purchase_sources() TO authenticated, service_role;

-- How fresh is the book? The whole reason this work happened is that nobody
-- could see it had gone stale. Anything reading profit should show this.
CREATE OR REPLACE FUNCTION sold_book_freshness()
RETURNS TABLE (rows bigint, latest_sale date, days_stale int, last_load timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*), max(sale_date),
         (CURRENT_DATE - max(sale_date))::int, max(updated_at)
  FROM sold_book;
$$;
GRANT EXECUTE ON FUNCTION sold_book_freshness() TO anon, authenticated;

ALTER TABLE IF EXISTS public.wholesale_sold RENAME TO wholesale_sold_retired_20260819;

NOTIFY pgrst, 'reload schema';
