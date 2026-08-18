-- Remove the verification list from 20260818000003. The page has been confirmed
-- rendering end to end; leaving a fake buyer in prod is not the way to remember it.
DELETE FROM buyer_share_lists WHERE slug = 'smoketest0';
