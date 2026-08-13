-- "CARVANA HAINES CITY" was landing in the private-party bucket — treated as if
-- someone had bought a car off a person named Carvana. It's a wholesale source
-- with a physical lot in Florida, so it belongs on James's list like any other
-- out-of-region pickup. Same for the other big names that show up as vendors.
CREATE OR REPLACE FUNCTION nudge_is_auction(p_vendor text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(COALESCE(p_vendor, '')) ~ (
    '(ADESA|MANHEIM|\mDAA\M|\mAAA\M|\mUAX\M|COPART|\mACV\M|OPEN[^A-Z]*LANE|OPENLANE'
    || '|AUCTION|LOVELAND|ROCKIES|CARVANA|CARMAX|VROOM|SHIFT|DRIVEWAY'
    || '|ENTERPRISE|HERTZ|AVIS|BUDGET|PENSKE|RYDER|EDGE PIPELINE|BACKLOT|IAA)'
  );
$$;
NOTIFY pgrst, 'reload schema';
