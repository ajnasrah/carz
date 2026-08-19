-- Merge the first real Frazer sync into the ledger.
--
-- sold_book only catches up when the nightly job runs, and the first genuine
-- sync landed at 15:30 today. Running it once here so the ledger is current
-- immediately rather than tomorrow morning — after this the cron keeps it so.
SELECT public.merge_sold_to_book();
