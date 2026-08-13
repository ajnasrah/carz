-- Nudge texts: every few days, tell the man responsible for a section which of
-- his cars have been sitting longest.
--
-- Who gets texted lives in a table, not in code, so a number changes or a person
-- is swapped without a deploy — the same reason location_keywords is a table.

CREATE TABLE IF NOT EXISTS sms_nudges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  phone        text NOT NULL,               -- E.164, e.g. +19012830548
  bucket       text NOT NULL CHECK (bucket IN ('mechanic', 'body_shop', 'stuck21')),
  cars         integer NOT NULL DEFAULT 5,
  every_days   integer NOT NULL DEFAULT 3,
  active       boolean NOT NULL DEFAULT true,
  last_sent_at timestamptz,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sms_nudges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sms_nudges FROM PUBLIC, anon, authenticated;
-- Server only: the cron function holds the service key, which bypasses RLS.
-- Nobody's phone number needs to be readable from the browser.

INSERT INTO sms_nudges (name, phone, bucket) VALUES
  ('Qasim',  '+19012830548', 'mechanic'),    -- all of the mechanic shops
  ('Jorge',  '+19013544264', 'body_shop'),   -- his own section
  ('Amera',  '+15403555463', 'stuck21'),
  ('Omar',   '+19018319661', 'stuck21')
ON CONFLICT DO NOTHING;

-- The oldest cars in a section. "Oldest" means longest sitting where it is —
-- the thing being chased is a car nobody has touched, not a car we've owned a
-- long time but moved yesterday.
--
-- stuck21 uses the app's own definition of tracked: the later of the last lot
-- scan and the last location update, with Frazer's days_on_lot as the fallback
-- for Transport (Z) cars that have no other signal, and capped by days_on_lot
-- because Frazer reuses stock numbers and a stale location row can outlive the
-- car it belonged to.
CREATE OR REPLACE FUNCTION nudge_cars(p_bucket text, p_limit integer DEFAULT 5)
RETURNS TABLE (
  stock_number text, vin text, vehicle text,
  days_owned integer, days_here integer, location text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT
      inv.stock_number,
      inv.vehicle_vin,
      btrim(concat_ws(' ', inv.vehicle_year, inv.vehicle_make, inv.vehicle_model)) AS vehicle,
      NULLIF(regexp_replace(COALESCE(inv.days_on_lot::text, ''), '[^0-9]', '', 'g'), '')::int AS dol,
      inv.location_code,
      vl.physical_location,
      vl.location_updated_at,
      GREATEST(ls.last_seen_at, vl.location_updated_at) AS tracked_at
    FROM inventory inv
    LEFT JOIN vehicle_locations vl ON vl.stock_number = inv.stock_number
    LEFT JOIN vehicle_lot_status ls ON ls.stock_number = inv.stock_number
  ),
  scored AS (
    SELECT b.*,
      CASE
        WHEN b.tracked_at IS NOT NULL
          THEN LEAST(floor(EXTRACT(epoch FROM (now() - b.tracked_at)) / 86400)::int,
                     COALESCE(b.dol, 2147483647))
        WHEN b.location_code = 'Z' THEN b.dol
      END AS days_untracked,
      floor(EXTRACT(epoch FROM (now() - b.location_updated_at)) / 86400)::int AS days_here
    FROM base b
  )
  SELECT s.stock_number, s.vehicle_vin, s.vehicle, s.dol,
         COALESCE(s.days_here, s.days_untracked), s.physical_location
  FROM scored s
  WHERE CASE
          WHEN p_bucket = 'stuck21' THEN s.days_untracked >= 21
          ELSE s.physical_location = ANY (shop_locations(p_bucket))
        END
  ORDER BY
    CASE WHEN p_bucket = 'stuck21' THEN s.days_untracked ELSE s.days_here END DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
$$;
REVOKE ALL ON FUNCTION nudge_cars(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nudge_cars(text, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
