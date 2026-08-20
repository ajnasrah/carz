-- A cargo van is not a pickup truck.
--
-- The segment classifier exists in three copies that have to agree — sa_segment()
-- here, segment() in src/services/buyerMatch.js, and segment() in the extension's
-- buyer-match-uploader.js — because rows are classified by whichever one happens
-- to touch them first. All three tested trucks before vans, and the truck list
-- contains the bare tokens '1500', '2500' and '3500' to catch "Silverado 1500".
-- Those tokens also appear in "RAM PROMASTER 2500" and "CHEVROLET EXPRESS G3500".
--
-- 88 real rows are affected — every Express and ProMaster we have ever sold, the
-- bulk of the van category, filed as pickups. A dealer who buys cargo vans looked
-- like a truck buyer, and the price band for "truck" was being computed partly
-- from van money.
--
-- Testing vans first fixes it: nothing in the van list can be a pickup, whereas
-- the truck list demonstrably can be a van.
CREATE OR REPLACE FUNCTION sa_segment(make text, model text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH m AS (SELECT lower(coalesce(make,'') || ' ' || coalesce(model,'')) AS s)
  SELECT CASE
    WHEN (SELECT s FROM m) ~ '(transit|express|promaster|sienna|odyssey|carnival|pacifica|caravan|sprinter)' THEN 'van'
    WHEN (SELECT s FROM m) ~ '(silverado|sierra|f-?150|f-?250|f-?350|ram 1500|ram 2500|tundra|tacoma|ranger|colorado|canyon|frontier|titan|ridgeline|gladiator|maverick|super duty|1500|2500|3500)' THEN 'truck'
    WHEN (SELECT s FROM m) ~ '(tesla|model 3|mach-e|ev6|id\.4|lyriq|mullen|ioniq|bolt|leaf)' THEN 'ev'
    WHEN (SELECT s FROM m) ~ '(tahoe|suburban|yukon|expedition|explorer|escape|equinox|traverse|blazer|pilot|highlander|4runner|rav4|cr-?v|rogue|pathfinder|murano|telluride|palisade|santa fe|sorento|wrangler|grand cherokee|cherokee|compass|renegade|bronco|edge|nautilus|cx-9|cx-5|outlander|ascent|atlas|tiguan|durango|acadia|enclave|escalade|navigator|q5|x5|gx|rx|kona|tucson|seltos|encore|trailblazer|envision|corsair|aviator)' THEN 'suv'
    ELSE 'car'
  END;
$$;

-- sold_book has no stored segment — buyer_training_rows() computes it live, so it
-- is already corrected by the definition above. sa_sold_sales stores one at
-- ingest, so those rows keep the old answer until rewritten.
UPDATE public.sa_sold_sales
SET segment = sa_segment(make, model)
WHERE segment IS DISTINCT FROM sa_segment(make, model);

-- sa_active_cars is a replaced-on-upload snapshot, but a wrong segment there is a
-- wrong recommendation until the next upload.
UPDATE public.sa_active_cars
SET segment = sa_segment(make, model)
WHERE segment IS DISTINCT FROM sa_segment(make, model);

UPDATE public.sa_listing_outcomes
SET segment = sa_segment(make, model)
WHERE segment IS DISTINCT FROM sa_segment(make, model);

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '--- segment mix after the fix (training set) ---';
  FOR r IN SELECT t.segment, count(*) AS n FROM public.buyer_training_rows() t GROUP BY 1 ORDER BY 2 DESC
  LOOP RAISE NOTICE '  % : %', rpad(r.segment, 6), r.n; END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
