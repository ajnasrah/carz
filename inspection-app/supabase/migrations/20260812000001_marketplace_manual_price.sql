-- Admin-set marketplace price.
--
-- Until now the marketplace price was whatever SmartAuction said —
-- GREATEST(buy_now, opening_price) off sa_active_cars — which means a car that
-- isn't on SA has no price at all, and a car whose SA number is stale can't be
-- corrected. The scraper rewrites sa_active_cars wholesale, so an edit there
-- would be erased on the next run.
--
-- So overrides live in their own table keyed by VIN, and the two listing RPCs
-- COALESCE it over the SmartAuction number. VIN, not stock number: Frazer reuses
-- stock numbers, and an override that survives onto the next car with the same
-- stock would put a wrong price on a real listing. It also covers the sa-only
-- rows, which have no stock number at all.

CREATE TABLE IF NOT EXISTS marketplace_prices (
  vin        text PRIMARY KEY,
  price      numeric NOT NULL CHECK (price >= 0),
  set_by     text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE marketplace_prices ENABLE ROW LEVEL SECURITY;

-- No direct table access for anyone: reads come through the SECURITY DEFINER
-- listing RPCs, writes through set_marketplace_price below. With RLS on and no
-- policy, even a leaked authenticated token can't touch this table directly.
REVOKE ALL ON marketplace_prices FROM PUBLIC;
REVOKE ALL ON marketplace_prices FROM anon, authenticated;

-- ============================ SET / CLEAR ============================
-- p_price NULL clears the override and hands the car back to SmartAuction's
-- number. Admin-only, checked here rather than by grant: GRANT ... TO
-- authenticated would include approved BUYERS, who must never set our prices.
-- Returns the price now in effect for this VIN (NULL once cleared). Deliberately
-- a scalar, not a RETURNS TABLE: out-params named `vin`/`price` collide with the
-- table's own columns inside plpgsql (ON CONFLICT, WHERE) and error at runtime.
CREATE OR REPLACE FUNCTION set_marketplace_price(p_vin text, p_price numeric)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_admin boolean;
  v_email    text;
  v_vin      text := upper(nullif(btrim(p_vin), ''));
BEGIN
  IF v_vin IS NULL THEN
    RAISE EXCEPTION 'A VIN is required to price a car';
  END IF;
  IF p_price IS NOT NULL AND p_price < 0 THEN
    RAISE EXCEPTION 'Price cannot be negative';
  END IF;

  -- The primary admin passes on phone as well as role, matching isPrimaryAdmin()
  -- in the app — so a profile whose role somehow isn't set can't lock the owner
  -- out of his own pricing.
  SELECT (p.role = 'admin' OR regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g') LIKE '%9018319661')
    INTO v_is_admin
    FROM profiles p WHERE p.id = auth.uid();
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Only admins can set marketplace prices';
  END IF;

  v_email := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'email', '');

  IF p_price IS NULL THEN
    DELETE FROM marketplace_prices m WHERE m.vin = v_vin;
    RETURN NULL;
  END IF;

  INSERT INTO marketplace_prices AS m (vin, price, set_by, updated_at)
  VALUES (v_vin, p_price, COALESCE(v_email, auth.uid()::text), now())
  ON CONFLICT (vin) DO UPDATE
    SET price = EXCLUDED.price, set_by = EXCLUDED.set_by, updated_at = now();
  RETURN p_price;
END;
$$;
REVOKE ALL ON FUNCTION set_marketplace_price(text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_marketplace_price(text, numeric) TO authenticated;

-- ============================ LIST ============================
-- Body is 20260706000005 verbatim except: the marketplace_prices join, buy_now
-- now COALESCEs the override over GREATEST(buy_now, opening_price), and a new
-- price_source column tells the UI which one it's looking at.
DROP FUNCTION IF EXISTS marketplace_listings();
CREATE OR REPLACE FUNCTION marketplace_listings()
RETURNS TABLE (
  id uuid, stock_number text, vin text, vin_last6 text, full_vin text,
  year text, make text, model text, vehicle_color text, mileage text,
  checklist jsonb, completed_at timestamptz, buy_now text, sa_url text,
  price_source text
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH inv_listings AS (
    SELECT DISTINCT ON (inv.stock_number)
      md5(inv.stock_number)::uuid AS id, inv.stock_number,
      COALESCE(i.vin, inv.last_6_vin) AS vin, inv.last_6_vin AS vin_last6,
      inv.vehicle_vin AS full_vin, inv.vehicle_year AS year, inv.vehicle_make AS make,
      inv.vehicle_model AS model, inv.vehicle_color, inv.mileage::text AS mileage,
      jsonb_set(
        COALESCE(i.checklist, '{}'::jsonb), '{photos}',
        COALESCE(i.checklist -> 'photos', '{}'::jsonb) || COALESCE((
          SELECT jsonb_object_agg('rts' || rn, jsonb_build_object('url', purl))
          FROM (SELECT row_number() OVER (ORDER BY w.received_at) AS rn,
                       'https://yprihgygmreibcuybwoy.supabase.co/storage/v1/object/public/wa-photos/' || w.media_path AS purl
                FROM wa_inbound_messages w
                WHERE upper(w.vin6) = upper(inv.last_6_vin) AND w.station = 'ready' AND w.media_path IS NOT NULL) z
        ), '{}'::jsonb)
      ) AS checklist,
      COALESCE(i.completed_at, (SELECT max(w.received_at) FROM wa_inbound_messages w
        WHERE upper(w.vin6) = upper(inv.last_6_vin) AND w.station = 'ready')) AS completed_at,
      COALESCE(mp.price, GREATEST(sac.buy_now, sac.opening_price))::text AS buy_now,
      sac.detail_url AS sa_url,
      CASE
        WHEN mp.price IS NOT NULL THEN 'manual'
        WHEN GREATEST(sac.buy_now, sac.opening_price) IS NOT NULL THEN 'smartauction'
      END AS price_source
    FROM inventory inv
    LEFT JOIN inspections i ON (
      (i.vin_last6 = inv.last_6_vin OR i.vin = inv.last_6_vin OR i.vin = inv.vehicle_vin
       OR (i.stock_number IS NOT NULL AND i.stock_number = inv.stock_number)) AND i.completed_at IS NOT NULL)
    LEFT JOIN vehicle_locations vl ON vl.stock_number = inv.stock_number
    LEFT JOIN sa_active_cars sac ON upper(sac.vin) = upper(inv.vehicle_vin)
    LEFT JOIN marketplace_prices mp ON mp.vin = upper(inv.vehicle_vin)
    WHERE inv.stock_number IS NOT NULL
      AND (vl.sa_status IS DISTINCT FROM 'sold')                 -- (2) hide sold
      AND (
        i.completed_at IS NOT NULL
        OR sac.vin IS NOT NULL                                   -- active on SmartAuction
        OR EXISTS (SELECT 1 FROM wa_inbound_messages w
          WHERE upper(w.vin6) = upper(inv.last_6_vin) AND w.station = 'ready' AND w.media_path IS NOT NULL)
      )
    ORDER BY inv.stock_number, i.completed_at DESC NULLS LAST
  ),
  sa_only AS (                                                    -- (1) active on SA, not in inventory
    SELECT
      md5('sa:' || upper(sac.vin))::uuid AS id, NULL::text AS stock_number,
      right(sac.vin, 6) AS vin, right(sac.vin, 6) AS vin_last6, sac.vin AS full_vin,
      sac.year::text AS year, sac.make AS make, sac.model AS model,
      sac.color AS vehicle_color, sac.odometer::text AS mileage,
      '{}'::jsonb AS checklist, NULL::timestamptz AS completed_at,
      COALESCE(mp.price, GREATEST(sac.buy_now, sac.opening_price))::text AS buy_now,
      sac.detail_url AS sa_url,
      CASE
        WHEN mp.price IS NOT NULL THEN 'manual'
        WHEN GREATEST(sac.buy_now, sac.opening_price) IS NOT NULL THEN 'smartauction'
      END AS price_source
    FROM sa_active_cars sac
    LEFT JOIN marketplace_prices mp ON mp.vin = upper(sac.vin)
    WHERE NOT EXISTS (SELECT 1 FROM inventory inv WHERE upper(inv.vehicle_vin) = upper(sac.vin))
  )
  SELECT * FROM inv_listings
  UNION ALL
  SELECT * FROM sa_only
  ORDER BY completed_at DESC NULLS LAST, stock_number NULLS LAST;
END;
$$;
GRANT EXECUTE ON FUNCTION marketplace_listings() TO anon, authenticated;

-- ============================ DETAIL ============================
DROP FUNCTION IF EXISTS marketplace_listing_detail(uuid);
CREATE OR REPLACE FUNCTION marketplace_listing_detail(listing_id uuid)
RETURNS TABLE (
  id uuid, vin text, vin_last6 text, full_vin text, year text, make text, model text,
  mileage integer, checklist jsonb, completed_at timestamptz, vehicle_color text,
  stock_number text, total_cost text, days_on_lot text, sa_status text, buy_now text, sa_url text,
  price_source text
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  -- inventory-anchored car
  (SELECT DISTINCT ON (inv.stock_number)
    md5(inv.stock_number)::uuid, COALESCE(i.vin, inv.last_6_vin), inv.last_6_vin, inv.vehicle_vin,
    COALESCE(i.year::text, inv.vehicle_year), COALESCE(i.make, inv.vehicle_make), COALESCE(i.model, inv.vehicle_model),
    COALESCE(i.mileage, NULLIF(regexp_replace(inv.mileage::text, '[^0-9]', '', 'g'), '')::int),
    jsonb_set(
      COALESCE(i.checklist, '{}'::jsonb), '{photos}',
      COALESCE(i.checklist -> 'photos', '{}'::jsonb) || COALESCE((
        SELECT jsonb_object_agg('rts' || rn, jsonb_build_object('url', purl))
        FROM (SELECT row_number() OVER (ORDER BY w.received_at) AS rn,
                     'https://yprihgygmreibcuybwoy.supabase.co/storage/v1/object/public/wa-photos/' || w.media_path AS purl
              FROM wa_inbound_messages w
              WHERE upper(w.vin6) = upper(inv.last_6_vin) AND w.station = 'ready' AND w.media_path IS NOT NULL) z
      ), '{}'::jsonb)
    ),
    COALESCE(i.completed_at, (SELECT max(w.received_at) FROM wa_inbound_messages w
      WHERE upper(w.vin6) = upper(inv.last_6_vin) AND w.station = 'ready')),
    inv.vehicle_color, inv.stock_number, inv.total_cost, inv.days_on_lot, vl.sa_status,
    COALESCE(mp.price, GREATEST(sac.buy_now, sac.opening_price))::text, sac.detail_url,
    CASE
      WHEN mp.price IS NOT NULL THEN 'manual'
      WHEN GREATEST(sac.buy_now, sac.opening_price) IS NOT NULL THEN 'smartauction'
    END
  FROM inventory inv
  LEFT JOIN inspections i ON (
    (i.vin_last6 = inv.last_6_vin OR i.vin = inv.last_6_vin OR i.vin = inv.vehicle_vin
     OR (i.stock_number IS NOT NULL AND i.stock_number = inv.stock_number)) AND i.completed_at IS NOT NULL)
  LEFT JOIN vehicle_locations vl ON vl.stock_number = inv.stock_number
  LEFT JOIN sa_active_cars sac ON upper(sac.vin) = upper(inv.vehicle_vin)
  LEFT JOIN marketplace_prices mp ON mp.vin = upper(inv.vehicle_vin)
  WHERE md5(inv.stock_number)::uuid = listing_id
  ORDER BY inv.stock_number, i.completed_at DESC NULLS LAST)

  UNION ALL

  -- sa-only car (active on SmartAuction, not in inventory)
  (SELECT
    md5('sa:' || upper(sac.vin))::uuid, right(sac.vin, 6), right(sac.vin, 6), sac.vin,
    sac.year::text, sac.make, sac.model, sac.odometer::int,
    '{}'::jsonb, NULL::timestamptz, sac.color,
    NULL::text, NULL::text, NULL::text, NULL::text,
    COALESCE(mp.price, GREATEST(sac.buy_now, sac.opening_price))::text, sac.detail_url,
    CASE
      WHEN mp.price IS NOT NULL THEN 'manual'
      WHEN GREATEST(sac.buy_now, sac.opening_price) IS NOT NULL THEN 'smartauction'
    END
  FROM sa_active_cars sac
  LEFT JOIN marketplace_prices mp ON mp.vin = upper(sac.vin)
  WHERE md5('sa:' || upper(sac.vin))::uuid = listing_id
    AND NOT EXISTS (SELECT 1 FROM inventory inv WHERE upper(inv.vehicle_vin) = upper(sac.vin)));
$$;
GRANT EXECUTE ON FUNCTION marketplace_listing_detail(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
