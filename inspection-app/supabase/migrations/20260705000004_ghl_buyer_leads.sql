-- GHL Buyer-Lead sync
-- A dedupe registry + outreach log for the buyers learned from sa_sold_sales.
-- Each unique buyer (deduped by normalized phone → email → name) becomes one row.
-- New, never-contacted buyers get POSTed to a GoHighLevel inbound webhook, which
-- creates the Contact + Opportunity. Seeded rows (existing GHL opportunities) are
-- marked contacted=true so they are never re-pushed.

-- ---------------------------------------------------------------------------
-- 1. BUYER REGISTRY / OUTREACH LOG
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sa_buyers (
    buyer_key       text PRIMARY KEY,      -- 'p:<10digit>' | 'e:<email>' | 'n:<name>'
    buyer_name      text,
    phone           text,                  -- priority contact channel
    email           text,
    city            text,
    state           text,
    zip             text,
    -- rollup from sold history (refreshed each sync)
    cars_bought     int     DEFAULT 0,
    avg_price       numeric,
    last_sale_date  date,
    last_vehicle    text,                  -- "2021 Ford F-150"
    top_segment     text,                  -- truck/suv/car/van/ev
    -- GHL sync / outreach state (preserved across profile refreshes)
    contacted       boolean DEFAULT false, -- true once seeded from GHL or pushed
    ghl_synced_at   timestamptz,           -- when the webhook fired successfully
    ghl_contact_id  text,                  -- id GHL echoes back (if any)
    ghl_source      text,                  -- 'seed' (from GHL export) | 'sync' (pushed by us)
    sync_error      text,                  -- last webhook failure, for retry visibility
    first_seen_at   timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sa_buyers_unsynced
    ON sa_buyers (ghl_synced_at) WHERE ghl_synced_at IS NULL AND contacted = false;
CREATE INDEX IF NOT EXISTS idx_sa_buyers_phone ON sa_buyers (phone);
CREATE INDEX IF NOT EXISTS idx_sa_buyers_email ON sa_buyers (email);

-- ---------------------------------------------------------------------------
-- RLS — mirror the other sa_* tables (anon + authenticated read/write).
-- The edge function uses the service role and bypasses RLS regardless.
-- ---------------------------------------------------------------------------
ALTER TABLE sa_buyers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "rw buyers" ON sa_buyers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. CRON SAFETY NET (optional but recommended)
-- Sweeps for un-synced buyers even if a browser closed mid-upload. Requires the
-- pg_cron + pg_net extensions and your project's function URL + service-role key.
-- Fill in <PROJECT_REF> and <SERVICE_ROLE_KEY>, then run this block once.
-- ---------------------------------------------------------------------------
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;
--
-- SELECT cron.schedule(
--   'ghl-lead-sync-hourly',
--   '17 * * * *',                       -- top-of-hour+17min, hourly
--   $$
--   SELECT net.http_post(
--     url    := 'https://<PROJECT_REF>.supabase.co/functions/v1/ghl-lead-sync',
--     headers:= jsonb_build_object(
--       'Content-Type',  'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
--     ),
--     body   := '{}'::jsonb
--   );
--   $$
-- );
