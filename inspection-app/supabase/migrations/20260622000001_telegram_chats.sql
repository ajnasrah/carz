-- ============================================
-- TELEGRAM GROUP → STATION MAPPING
-- Telegram bots CAN read normal, human-made groups of any size (privacy mode
-- off / bot is admin), unlike WhatsApp. Each group maps to a station; the bot's
-- update carries chat.id so we know which group a message came from.
--
-- Reuses the existing wa_inbound_messages + wa_sessions + wa-photos pipeline:
--   message_id  -> "tg_<chatid>_<messageid>"  (idempotency)
--   phone_number_id column -> stores the Telegram chat_id
-- so the Mac puller and queue need no changes.
-- ============================================

CREATE TABLE IF NOT EXISTS tg_chats (
  chat_id       BIGINT PRIMARY KEY,        -- Telegram group id (supergroups are large negatives)
  station       TEXT NOT NULL CHECK (station IN ('seller', 'ready', 'body_shop', 'mechanic')),
  -- location stations (body_shop / mechanic) write this into vehicle_locations;
  -- NULL for intake stations (seller / ready)
  location_code TEXT,
  label         TEXT,
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tg_chats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read tg_chats" ON tg_chats;
CREATE POLICY "auth read tg_chats" ON tg_chats
  FOR SELECT TO authenticated USING (true);

-- Seed after you have the chat ids. Example:
--   INSERT INTO tg_chats (chat_id, station, location_code, label) VALUES
--     (-1001234567890, 'ready',     NULL,               'Ready to Sell'),
--     (-1001234567891, 'body_shop', 'body_shop',        'Body Shop'),
--     (-1001234567892, 'mechanic',  'mechanic_section', 'Mechanic'),
--     (-1001234567893, 'seller',    NULL,               'Seller Intake');

NOTIFY pgrst, 'reload schema';
