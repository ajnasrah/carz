-- Carry the consignor onto the car, so "is this seller good" becomes answerable.
--
-- THE HOLE THIS FILLS
-- We see the seller exactly once — on the run list, before we bid. Neither
-- inventory nor wholesale_sold has a seller column: they carry `vendor`, which
-- is the auction ("MANHEIM KANSAS CITY"), not the consignor who put the car in
-- it ("Toyota Financial Services/repo"). So the moment we buy a car, the one
-- fact about who we bought it FROM is dropped, and every seller number we can
-- produce is really a statement about the KIND of car that seller brings —
-- exact_profit is comps on year/make/model/mileage, a property of the vehicle.
-- It cannot tell you a consignor reconditions well, describes cars honestly, or
-- prices to move. Only realised profit on their cars can, and that link did not
-- exist.
--
-- Not a column on `inventory`: that table is replaced by the Frazer sync and an
-- added column would be clobbered. This is keyed by VIN and stands beside it.
CREATE TABLE IF NOT EXISTS public.vehicle_purchase_source (
  vin          TEXT PRIMARY KEY,
  seller       TEXT,
  auction      TEXT,
  lane         TEXT,
  run          TEXT,
  cr_grade     NUMERIC(3,1),
  announcements TEXT,
  sale_date    TEXT,
  source_id    TEXT,
  observed_at  TIMESTAMPTZ,
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vehicle_purchase_source_seller
  ON public.vehicle_purchase_source (seller) WHERE seller IS NOT NULL;

ALTER TABLE public.vehicle_purchase_source ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vps_read ON public.vehicle_purchase_source;
CREATE POLICY vps_read ON public.vehicle_purchase_source
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.vehicle_purchase_source TO anon, authenticated;

-- Stamp every car we own, or have sold, with what the run list said about it.
-- Idempotent and cheap; safe to call after any list upload or inventory sync.
-- Newest observation wins — a car that ran twice was described twice, and the
-- run we actually bought on is the later one.
CREATE OR REPLACE FUNCTION link_purchase_sources()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  WITH ours AS (
    SELECT upper(vehicle_vin) AS vin FROM inventory WHERE vehicle_vin IS NOT NULL
    UNION
    SELECT upper(vin) FROM wholesale_sold WHERE vin IS NOT NULL
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

-- What a consignor's cars ACTUALLY did for us. `sold`/`realised_profit` are the
-- real answer; `on_lot` is money still out. A seller with no sold cars yet
-- returns NULLs rather than a flattering zero — the difference between "bad" and
-- "not known yet" is the whole point of this table.
CREATE OR REPLACE FUNCTION seller_performance(p_min_sold int DEFAULT 1)
RETURNS TABLE (
  seller text, auction text,
  bought bigint, sold bigint, on_lot bigint,
  realised_profit numeric, profit_per_car numeric,
  avg_days numeric, avg_cr numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.seller,
         max(s.auction),
         count(*),
         count(w.vin),
         count(*) FILTER (WHERE w.vin IS NULL),
         round(sum(w.net_profit), 0),
         round(avg(w.net_profit), 0),
         round(avg(w.days_on_lot), 0),
         round(avg(s.cr_grade), 1)
  FROM vehicle_purchase_source s
  LEFT JOIN wholesale_sold w ON upper(w.vin) = s.vin
  WHERE s.seller IS NOT NULL
  GROUP BY s.seller
  HAVING count(w.vin) >= p_min_sold
  ORDER BY avg(w.net_profit) DESC NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION seller_performance(int) TO anon, authenticated;

SELECT link_purchase_sources();

NOTIFY pgrst, 'reload schema';
