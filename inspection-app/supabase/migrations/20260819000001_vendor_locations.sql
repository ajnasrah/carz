-- Where we BUY from, by place.
--
-- `vendor` on inventory and wholesale_sold is a free-text auction name — "DAA
-- MEMPHIS", "ADESA MEM", "AAA-DENVER" — so there has never been a way to ask
-- which CITY or STATE our cars come from, only which string. Three different
-- spellings of Denver sat in three different buckets, and "which lanes pay us"
-- could not be answered at all.
--
-- This is the lookup. One row per vendor string as it actually appears in the
-- data, including the duplicate spellings, because the join is on the raw text.
--
-- `kind` matters as much as the place:
--   lane        a physical auction, has a city
--   online      OpenLane, ACV, Carvana feeds — no lane, no city
--   arbitration cars bought back through arbitration; not a place, and by far
--               the worst-performing channel we have
-- Vendors absent from this table are individual people — private street buys.

CREATE TABLE IF NOT EXISTS public.vendor_locations (
  vendor     TEXT PRIMARY KEY,
  city       TEXT,
  state      TEXT,
  kind       TEXT NOT NULL DEFAULT 'lane' CHECK (kind IN ('lane','online','arbitration','private')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.vendor_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_locations_read ON public.vendor_locations;
CREATE POLICY vendor_locations_read ON public.vendor_locations
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.vendor_locations TO anon, authenticated;

INSERT INTO public.vendor_locations (vendor, city, state, kind) VALUES
  ('AAA BIRMINGHAM', 'Birmingham', 'AL', 'lane'),
  ('AAA DENVER', 'Denver', 'CO', 'lane'),
  ('AAA HOUSTON', 'Houston', 'TX', 'lane'),
  ('AAA OKLAHOMA', 'Oklahoma City', 'OK', 'lane'),
  ('AAA- LONE STAR LUBBOCK', 'Lubbock', 'TX', 'lane'),
  ('AAA-DENVER', 'Denver', 'CO', 'lane'),
  ('ACV AUCTIONS', NULL, NULL, 'online'),
  ('ADESA ARB', NULL, NULL, 'arbitration'),
  ('ADESA ATLANTA', 'Atlanta', 'GA', 'lane'),
  ('ADESA AUSTIN', 'Austin', 'TX', 'lane'),
  ('ADESA BIRMINGHAM', 'Birmingham', 'AL', 'lane'),
  ('ADESA CHARLOTTE', 'Charlotte', 'NC', 'lane'),
  ('ADESA CINCINNATI/DAYTON', 'Franklin', 'OH', 'lane'),
  ('ADESA CLEVELAND', 'Northfield', 'OH', 'lane'),
  ('ADESA COLORADO SPRINGS', 'Colorado Springs', 'CO', 'lane'),
  ('ADESA CONCORD', 'Concord', 'NC', 'lane'),
  ('ADESA DALLAS', 'Dallas', 'TX', 'lane'),
  ('ADESA FLINT', 'Flint', 'MI', 'lane'),
  ('ADESA GOLDEN GATE', 'Tracy', 'CA', 'lane'),
  ('ADESA HOUSTON', 'Houston', 'TX', 'lane'),
  ('ADESA INDIANAPOLIS', 'Indianapolis', 'IN', 'lane'),
  ('ADESA KANSAS CITY', 'Kansas City', 'MO', 'lane'),
  ('ADESA KNOXVILLE', 'Knoxville', 'TN', 'lane'),
  ('ADESA LANSING', 'Lansing', 'MI', 'lane'),
  ('ADESA MEM', 'Memphis', 'TN', 'lane'),
  ('ADESA MINNEAPOLIS', 'Minneapolis', 'MN', 'lane'),
  ('ADESA NASHVILLE', 'Nashville', 'TN', 'lane'),
  ('ADESA NEW JERSEY', 'Manville', 'NJ', 'lane'),
  ('ADESA PHOENIX', 'Chandler', 'AZ', 'lane'),
  ('ADESA PITTSBURG', 'Pittsburgh', 'PA', 'lane'),
  ('ADESA RALEIGH', 'Raleigh', 'NC', 'lane'),
  ('ADESA RENO', 'Reno', 'NV', 'lane'),
  ('ADESA SAN ANTONIO', 'San Antonio', 'TX', 'lane'),
  ('ADESA ST.LOUIS', 'St. Louis', 'MO', 'lane'),
  ('ADESA SYRACUSE', 'Syracuse', 'NY', 'lane'),
  ('ADESA TULSA', 'Tulsa', 'OK', 'lane'),
  ('ADESA WASHINGTON DC', 'Dulles', 'VA', 'lane'),
  ('AMERICA''S AA OKLAHOMA', 'Oklahoma City', 'OK', 'lane'),
  ('AMERICA''S AUTO AUCTION - BATON ROUG', 'Baton Rouge', 'LA', 'lane'),
  ('AMERICAS AA ATLANTA', 'Atlanta', 'GA', 'lane'),
  ('AMERICAS AA BIRMINGHAM', 'Birmingham', 'AL', 'lane'),
  ('AMERICAS AA LONE STAR LUBBOCK', 'Lubbock', 'TX', 'lane'),
  ('AMERICAS AA NEW ORLEANS', 'New Orleans', 'LA', 'lane'),
  ('AMERICAS AA PENSACOLA', 'Pensacola', 'FL', 'lane'),
  ('AMERICAS AA SAN ANTONIO', 'San Antonio', 'TX', 'lane'),
  ('AMERICAS AA WEST MICHIGAN', 'Wayland', 'MI', 'lane'),
  ('AUTONATION AA ATLANTA', 'Atlanta', 'GA', 'lane'),
  ('CARMAX AUSTIN', 'Austin', 'TX', 'lane'),
  ('CARMAX BROOKLYN PARK', 'Brooklyn Park', 'MN', 'lane'),
  ('CARMAX CHINO', 'Chino', 'CA', 'lane'),
  ('CARMAX COLORADO SPRINGS', 'Colorado Springs', 'CO', 'lane'),
  ('CARMAX DES MOINES', 'Des Moines', 'IA', 'lane'),
  ('CARMAX FREMONT', 'Fremont', 'CA', 'lane'),
  ('CARMAX FRESNO', 'Fresno', 'CA', 'lane'),
  ('CARMAX LAS VEGAS', 'Las Vegas', 'NV', 'lane'),
  ('CARMAX OXNARD', 'Oxnard', 'CA', 'lane'),
  ('CARVANA CHESTERFIELD', 'Chesterfield', 'VA', 'lane'),
  ('CARVANA CONCORD', 'Concord', 'NC', 'lane'),
  ('CARVANA ELYRIA', 'Elyria', 'OH', 'lane'),
  ('CARVANA HAINES CITY', 'Haines City', 'FL', 'lane'),
  ('CARVANA HEATH', 'Heath', 'OH', 'lane'),
  ('CARVANA INDIANAPOLIS', 'Indianapolis', 'IN', 'lane'),
  ('CARVANA OKLAHOMA CITY', 'Oklahoma City', 'OK', 'lane'),
  ('CARVANA TRENTON', 'Trenton', 'NJ', 'lane'),
  ('CARVANA WINDER', 'Winder', 'GA', 'lane'),
  ('CITY AUTO', 'Memphis', 'TN', 'lane'),
  ('COPART', NULL, NULL, 'online'),
  ('DAA ARB', NULL, NULL, 'arbitration'),
  ('DAA HUNTSVILLE', 'Huntsville', 'AL', 'lane'),
  ('DAA JACKSON', 'Jackson', 'MS', 'lane'),
  ('DAA MEMPHIS', 'Memphis', 'TN', 'lane'),
  ('DAA OF THE ROCKIES', 'Commerce City', 'CO', 'lane'),
  ('DEALER CONNECT AUTO AUCTION', NULL, NULL, 'online'),
  ('JIM KERAS NISSAN', 'Memphis', 'TN', 'lane'),
  ('LOVELAND', 'Loveland', 'CO', 'lane'),
  ('MANHEIM ATLANTA', 'Atlanta', 'GA', 'lane'),
  ('MANHEIM CENTRAL FLORIDA', 'Orlando', 'FL', 'lane'),
  ('MANHEIM CHICAGO', 'Matteson', 'IL', 'lane'),
  ('MANHEIM DENVER', 'Denver', 'CO', 'lane'),
  ('MANHEIM DETROIT', 'Carleton', 'MI', 'lane'),
  ('MANHEIM EL PASO', 'El Paso', 'TX', 'lane'),
  ('MANHEIM FORT LAUDERDALE', 'Davie', 'FL', 'lane'),
  ('MANHEIM FREDERICKSBURG', 'Fredericksburg', 'VA', 'lane'),
  ('MANHEIM INDIANAPOLIS', 'Indianapolis', 'IN', 'lane'),
  ('MANHEIM JACKSONVILLE', 'Jacksonville', 'FL', 'lane'),
  ('MANHEIM KANSAS CITY', 'Kansas City', 'MO', 'lane'),
  ('MANHEIM LOUISVILLE', 'Louisville', 'KY', 'lane'),
  ('MANHEIM MILWAUKEE', 'Caledonia', 'WI', 'lane'),
  ('MANHEIM MINNEAPOLIS', 'Maple Grove', 'MN', 'lane'),
  ('MANHEIM MISSISSIPPI', 'Hattiesburg', 'MS', 'lane'),
  ('MANHEIM NASHVILLE', 'Nashville', 'TN', 'lane'),
  ('MANHEIM NEW JERSEY', 'Bordentown', 'NJ', 'lane'),
  ('MANHEIM NEW MEXICO', 'Albuquerque', 'NM', 'lane'),
  ('MANHEIM NEW YORK', 'Newburgh', 'NY', 'lane'),
  ('MANHEIM NORTH CAROLINA', 'Kernersville', 'NC', 'lane'),
  ('MANHEIM NY METRO', 'Newburgh', 'NY', 'lane'),
  ('MANHEIM OHIO', 'Grove City', 'OH', 'lane'),
  ('MANHEIM ORLANDO', 'Orlando', 'FL', 'lane'),
  ('MANHEIM PALM BEACH', 'West Palm Beach', 'FL', 'lane'),
  ('MANHEIM PENNSYLVANIA', 'Manheim', 'PA', 'lane'),
  ('MANHEIM PENSACOLA', 'Pensacola', 'FL', 'lane'),
  ('MANHEIM PHILADELPHIA', 'Hatfield', 'PA', 'lane'),
  ('MANHEIM SAN ANTONIO', 'San Antonio', 'TX', 'lane'),
  ('MANHEIM ST. LOUIS', 'St. Louis', 'MO', 'lane'),
  ('MANHEIM STATESVILLE', 'Statesville', 'NC', 'lane'),
  ('MANHEIM TAMPA', 'Tampa', 'FL', 'lane'),
  ('MANHEIM TEXAS HOBBY', 'Houston', 'TX', 'lane'),
  ('MYCENTRALAUCTION', NULL, NULL, 'online'),
  ('OPEN LANE', NULL, NULL, 'online'),
  ('ORLANDO LONGWOOD AA', 'Longwood', 'FL', 'lane'),
  ('RUSTY ECK FORD INC', 'Wichita', 'KS', 'lane'),
  ('SIXT', NULL, NULL, 'online'),
  ('SMART AUCTION', NULL, NULL, 'online'),
  ('SMART AUCTION ARB', NULL, NULL, 'arbitration'),
  ('UAX (OLIVE BRANCH)', 'Olive Branch', 'MS', 'lane'),
  ('UAX ARB', NULL, NULL, 'arbitration'),
  ('UAX MEMPHIS', 'Memphis', 'TN', 'lane')
ON CONFLICT (vendor) DO UPDATE
  SET city = EXCLUDED.city, state = EXCLUDED.state, kind = EXCLUDED.kind;

-- Buying performance by place. Joins the sold book to the lookup so a report can
-- ask for cities or states instead of auction-name spellings. Cars whose vendor
-- is not in the table come back as kind 'private'.
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
  FROM wholesale_sold w
  LEFT JOIN vendor_locations v ON v.vendor = upper(btrim(w.vendor))
  WHERE w.vendor IS NOT NULL AND btrim(w.vendor) <> ''
  GROUP BY 1, 2, 3, 4
  ORDER BY sum(w.net_profit) DESC NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION vendor_performance() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
