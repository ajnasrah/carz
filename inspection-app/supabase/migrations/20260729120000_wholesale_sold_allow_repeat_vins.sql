-- wholesale_sold: allow the same VIN to appear more than once.
--
-- The table was keyed on vin alone, so a car we sold, bought back, and resold
-- could only ever store ONE of those sales — the upsert silently discarded the
-- other. That is exactly backwards: a buy-back loss is part of what a given
-- year/make/model/odometer actually costs us, and both outcomes have to count
-- toward that cohort.
--
-- Re-key on (vin, sale_date) so each distinct sale event is its own row while
-- re-uploading the same export stays idempotent.

ALTER TABLE wholesale_sold ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
UPDATE wholesale_sold SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE wholesale_sold ALTER COLUMN id SET NOT NULL;

ALTER TABLE wholesale_sold DROP CONSTRAINT IF EXISTS wholesale_sold_pkey;
ALTER TABLE wholesale_sold ADD PRIMARY KEY (id);

-- One row per sale event. A repeat sale of the same car has a different
-- sale_date, so it lands as its own row instead of overwriting the first.
CREATE UNIQUE INDEX IF NOT EXISTS wholesale_sold_vin_sale_date_key
  ON wholesale_sold (vin, sale_date);

CREATE INDEX IF NOT EXISTS idx_ws_vin ON wholesale_sold (vin);
