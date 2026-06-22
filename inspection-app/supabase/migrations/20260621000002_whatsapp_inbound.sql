-- ============================================
-- WHATSAPP CLOUD API INBOUND PIPELINE
-- Replaces the whatsapp-web.js group scraper with the official Cloud API.
-- One dedicated business number per station; the inbound phone_number_id
-- deterministically encodes the location (no group-name matching).
--
-- All writes here come from the Vercel webhook using the SERVICE ROLE key,
-- which bypasses RLS. We still enable RLS and only grant authenticated SELECT
-- so the dashboards can read, and nobody can write with the anon key.
-- ============================================

-- 1. STATION NUMBERS — maps a WhatsApp phone_number_id to a station.
--    Data-driven so adding a new number never needs a redeploy.
CREATE TABLE IF NOT EXISTS wa_station_numbers (
  phone_number_id TEXT PRIMARY KEY,           -- from webhook value.metadata.phone_number_id
  display_number  TEXT,                        -- human-readable, e.g. +1 901 555 0134
  station         TEXT NOT NULL CHECK (station IN ('seller', 'ready', 'body_shop', 'mechanic')),
  -- For location stations (body_shop / mechanic), the physical_location code to
  -- write into vehicle_locations. NULL for intake stations (seller / ready).
  location_code   TEXT,
  label           TEXT,                        -- e.g. "Carz Body Shop"
  active          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Seed your real numbers after registering them in Meta. Example:
--   INSERT INTO wa_station_numbers (phone_number_id, display_number, station, location_code, label) VALUES
--     ('111111111111111', '+1 901 555 0101', 'body_shop', 'body_shop',       'Carz Body Shop'),
--     ('222222222222222', '+1 901 555 0102', 'mechanic',  'mechanic_section', 'Carz Mechanic'),
--     ('333333333333333', '+1 901 555 0103', 'ready',     NULL,              'Carz Ready to Sell'),
--     ('444444444444444', '+1 901 555 0104', 'seller',    NULL,              'Carz Seller Intake');

-- 2. ALLOWED SENDERS — only these worker numbers are processed. Everyone else
--    (spam, wrong numbers) is logged and ignored.
CREATE TABLE IF NOT EXISTS wa_allowed_senders (
  wa_phone    TEXT PRIMARY KEY,                -- E.164 digits as WhatsApp sends them, no '+', e.g. 19015551234
  worker_name TEXT,
  station     TEXT,                            -- optional: which station they belong to
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. INBOUND MESSAGES — audit log + idempotency. message_id is the WhatsApp
--    wamid; PRIMARY KEY makes duplicate webhook deliveries a no-op.
CREATE TABLE IF NOT EXISTS wa_inbound_messages (
  message_id      TEXT PRIMARY KEY,            -- value.messages[].id (wamid.*)
  wa_from         TEXT,                        -- sender phone (digits)
  phone_number_id TEXT,                        -- which business number received it
  station         TEXT,
  msg_type        TEXT,                        -- text | image | ...
  body            TEXT,                        -- text or caption
  vin6            TEXT,                        -- parsed/resolved VIN last 6
  media_path      TEXT,                        -- storage path under wa-photos/
  parsed          JSONB,                       -- parsed vehicle entry (intake stations)
  processed       BOOLEAN DEFAULT false,       -- false = needs a retry sweep
  error           TEXT,                        -- last processing error, if any
  received_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_inbound_vin6 ON wa_inbound_messages(vin6);
CREATE INDEX IF NOT EXISTS idx_wa_inbound_unprocessed ON wa_inbound_messages(processed) WHERE processed = false;
CREATE INDEX IF NOT EXISTS idx_wa_inbound_received ON wa_inbound_messages(received_at DESC);

-- 4. SESSIONS — short-lived per-sender state so photos sent right after a VIN
--    get attached to it (webhook delivery is unordered & per-message).
CREATE TABLE IF NOT EXISTS wa_sessions (
  wa_from     TEXT PRIMARY KEY,
  last_vin6   TEXT,
  station     TEXT,
  expires_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 5. STORAGE BUCKET for inbound photos (private). The Mac puller pulls these
--    into seller_group_output/{vin6} for the SmartAuction extension.
INSERT INTO storage.buckets (id, name, public)
VALUES ('wa-photos', 'wa-photos', false)
ON CONFLICT (id) DO NOTHING;

-- 6. RLS — service role bypasses all of this; we only let authenticated READ.
ALTER TABLE wa_station_numbers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_allowed_senders  ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_inbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_sessions         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read wa_station_numbers" ON wa_station_numbers;
CREATE POLICY "auth read wa_station_numbers" ON wa_station_numbers
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth read wa_inbound_messages" ON wa_inbound_messages;
CREATE POLICY "auth read wa_inbound_messages" ON wa_inbound_messages
  FOR SELECT TO authenticated USING (true);

-- (No anon policies anywhere. No INSERT/UPDATE/DELETE policies — only the
--  service-role webhook writes, and it bypasses RLS.)

NOTIFY pgrst, 'reload schema';
