-- Temporary: one known-slug list so the public /m/<slug> page can be verified
-- end to end before a real one is sent to a buyer. Removed by the next migration.
INSERT INTO buyer_share_lists (slug, buyer_name, buyer_key, vins, note)
SELECT 'smoketest0', 'Smoke Test Buyer', 'smoketest',
       ARRAY(SELECT vin FROM sa_active_cars ORDER BY opening_price DESC NULLS LAST LIMIT 3),
       'Temporary verification list.'
ON CONFLICT (slug) DO NOTHING;
