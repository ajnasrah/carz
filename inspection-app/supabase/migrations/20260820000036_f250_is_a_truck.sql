-- "FORD F250" is a truck in SQL and a car in JavaScript.
--
-- sa_segment() matches f-?150|f-?250|f-?350, so it takes F250 and F-250 alike.
-- The JavaScript classifier matches substrings from a list that contains
-- 'f-150', 'f150', 'f-250' and 'f-350' — but not 'f250' or 'f350'. Frazer writes
-- these without the hyphen, so 21 heavy-duty pickups classify as trucks when the
-- database labels them and as CARS when the engine labels them.
--
-- That matters twice over: a training row carries the SQL answer while the active
-- car it is being compared against carries the JavaScript one, so an F-250 on the
-- lot was being scored as a sedan and offered to sedan buyers.
--
-- Found by rebuilding buyer_training_rows() locally and diffing it against
-- production row by row; these two models were the entire disagreement.
--
-- The lists are aligned in the same change (services/buyerMatch.js and the
-- extension's buyer-match-uploader.js), and F-450 is added everywhere while we
-- are here — nothing in the book has one yet, and the next one should not be a
-- car either.
CREATE OR REPLACE FUNCTION sa_segment(make text, model text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH m AS (SELECT lower(coalesce(make,'') || ' ' || coalesce(model,'')) AS s)
  SELECT CASE
    WHEN (SELECT s FROM m) ~ '(transit|express|promaster|sienna|odyssey|carnival|pacifica|caravan|sprinter)' THEN 'van'
    WHEN (SELECT s FROM m) ~ '(silverado|sierra|f-?[1-4]50|ram 1500|ram 2500|tundra|tacoma|ranger|colorado|canyon|frontier|titan|ridgeline|gladiator|maverick|super duty|1500|2500|3500)' THEN 'truck'
    WHEN (SELECT s FROM m) ~ '(tesla|model 3|mach-e|ev6|id\.4|lyriq|mullen|ioniq|bolt|leaf)' THEN 'ev'
    WHEN (SELECT s FROM m) ~ '(tahoe|suburban|yukon|expedition|explorer|escape|equinox|traverse|blazer|pilot|highlander|4runner|rav4|cr-?v|rogue|pathfinder|murano|telluride|palisade|santa fe|sorento|wrangler|grand cherokee|cherokee|compass|renegade|bronco|edge|nautilus|cx-9|cx-5|outlander|ascent|atlas|tiguan|durango|acadia|enclave|escalade|navigator|q5|x5|gx|rx|kona|tucson|seltos|encore|trailblazer|envision|corsair|aviator)' THEN 'suv'
    ELSE 'car'
  END;
$$;

UPDATE public.sa_sold_sales     SET segment = sa_segment(make, model) WHERE segment IS DISTINCT FROM sa_segment(make, model);
UPDATE public.sa_active_cars    SET segment = sa_segment(make, model) WHERE segment IS DISTINCT FROM sa_segment(make, model);
UPDATE public.sa_listing_outcomes SET segment = sa_segment(make, model) WHERE segment IS DISTINCT FROM sa_segment(make, model);

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT t.segment, count(*) AS n FROM public.buyer_training_rows(false, NULL, 0) t GROUP BY 1 ORDER BY 2 DESC
  LOOP RAISE NOTICE 'segment % : %', rpad(r.segment, 6), r.n; END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
