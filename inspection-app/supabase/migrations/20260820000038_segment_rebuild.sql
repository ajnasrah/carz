-- Rebuild the segment classifier from the models we actually trade.
--
-- A quarter of everything filed as "car" was an SUV or a van. The list had been
-- grown by hand and had never been checked against the book, so it was missing
-- most of the crossover market:
--
--     GMC TERRAIN 61 · NISSAN KICKS 46 · CHEVROLET TRAX 32 · NISSAN ARMADA 30
--     SUBARU OUTBACK 26 · KIA SOUL 18 · INFINITI QX80 18 · KIA SPORTAGE 14
--     SUBARU FORESTER 14 · DODGE JOURNEY 13 · INFINITI QX60 10 · CROSSTREK 10
--     HONDA HR-V 9 · LINCOLN MKC 9 · ACURA MDX 9 · CADILLAC XT5/XT6 18
--     GENESIS GV70/GV80 9 · BMW X3/X4/X6/X7 · AUDI Q3/Q7/Q8 · VOLVO XC40/60/90
--     LAND ROVER RANGE ROVER / DEFENDER / DISCOVERY · PORSCHE CAYENNE ...
--
-- and vans: NISSAN NV200 8 · CHRYSLER VOYAGER 8 · GMC SAVANA 3 · TOWN & COUNTRY
-- · SEDONA · QUEST · ECONOLINE. Plus two pickups, the CHEVROLET AVALANCHE and
-- the DODGE DAKOTA.
--
-- Segment drives segment-lift, make-in-segment lift and the price tier, so a
-- misfiled car is offered to the wrong buyers at the wrong money — an Armada was
-- being priced and pitched like a sedan.
--
-- "TOYOTA GRAND HIGHLANDE" is real: Frazer truncates the model at 25 characters,
-- so the token is 'highlande', not 'highlander'.
--
-- This list and the two JavaScript copies (services/buyerMatch.js and the
-- extension's buyer-match-uploader.js) are generated from one definition now.
-- They drifted twice while maintained by hand — F250 classified as a car in one
-- and a truck in the other, and cargo vans as pickups in all three.
--
-- ORDER IS LOAD-BEARING. Vans are tested first because the truck list matches a
-- bare 1500/2500/3500 to catch "Silverado 1500", and those also occur in "RAM
-- PROMASTER 2500" and "CHEVROLET EXPRESS G3500". Trucks are tested before SUVs
-- because 'gladiator' contains the SUV token ' gla' (Mercedes GLA).
CREATE OR REPLACE FUNCTION sa_segment(make text, model text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH m AS (SELECT lower(coalesce(make,'') || ' ' || coalesce(model,'')) AS s)
  SELECT CASE
    WHEN (SELECT s FROM m) ~ '(transit|express|promaster|sienna|odyssey|carnival|pacifica|caravan|sprinter|metris|savana|econoline|town & country|voyager|sedona|quest|nv200|nv1500|nv2500|nv3500)' THEN 'van'
    WHEN (SELECT s FROM m) ~ '(silverado|sierra|f-?150|f-250|f250|f-350|f350|f-450|f450|ram 1500|ram 2500|tundra|tacoma|ranger|colorado|canyon|frontier|titan|ridgeline|gladiator|maverick|super duty|avalanche|dakota|santa cruz|1500|2500|3500)' THEN 'truck'
    WHEN (SELECT s FROM m) ~ '(tesla|model 3|mach-e|ev6|id\.4|lyriq|mullen|ioniq|bolt|leaf)' THEN 'ev'
    WHEN (SELECT s FROM m) ~ '(tahoe|suburban|yukon|expedition|explorer|escape|equinox|traverse|blazer|pilot|highlande|4runner|rav4|cr-v|crv|rogue|pathfinder|murano|telluride|palisade|santa fe|sorento|wrangler|grand cherokee|cherokee|compass|renegade|bronco|edge|nautilus|cx-9|cx-5|outlander|ascent|atlas|tiguan|durango|acadia|enclave|escalade|navigator|gx|rx|kona|tucson|seltos|encore|trailblazer|envision|corsair|aviator|terrain|kicks|trax|armada|outback|soul|sportage|forester|journey|crosstrek|hr-v|hrv|mkc|mkx|mdx|rdx|qx50|qx55|qx60|qx80|xt4|xt5|xt6|gv70|gv80|glc|gle|gls|glb|gla|g-class|c-hr|defender|sequoia|wagoneer|patriot|flex|range rover|juke|cx-3|cx-30|cx-50|cx-90|fj cruiser|xc40|xc60|xc90|ecosport|envista|eclipse cross|cayenne|ariya|passport|hornet|niro|taos|venza|discovery|xterra|touareg|e-pace|f-pace|hummer|grenadier|corolla cross| q3| q5| q7| q8| x3| x4| x5| x6| x7| nx)' THEN 'suv'
    ELSE 'car'
  END;
$$;

UPDATE public.sa_sold_sales       SET segment = sa_segment(make, model) WHERE segment IS DISTINCT FROM sa_segment(make, model);
UPDATE public.sa_active_cars      SET segment = sa_segment(make, model) WHERE segment IS DISTINCT FROM sa_segment(make, model);
UPDATE public.sa_listing_outcomes SET segment = sa_segment(make, model) WHERE segment IS DISTINCT FROM sa_segment(make, model);

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '--- segment mix after the rebuild ---';
  FOR r IN SELECT t.segment, count(*) AS n FROM public.buyer_training_rows(false, NULL, 0) t GROUP BY 1 ORDER BY 2 DESC
  LOOP RAISE NOTICE '  % : %', rpad(r.segment, 6), r.n; END LOOP;
  RAISE NOTICE '--- biggest models still filed as car ---';
  FOR r IN SELECT upper(t.make || ' ' || t.model) AS label, count(*) AS n
           FROM public.buyer_training_rows(false, NULL, 0) t
           WHERE t.segment = 'car' GROUP BY 1 ORDER BY 2 DESC LIMIT 15
  LOOP RAISE NOTICE '  % : %', lpad(r.n::text, 4), r.label; END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
