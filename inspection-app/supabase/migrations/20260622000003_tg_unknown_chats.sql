-- Discovery helper: when the bot hears from a group not yet in tg_chats, the
-- webhook records it here so we can find its chat_id and wire it — no webhook
-- juggling needed. Onboarding a new group = add bot, send one message, read this.
CREATE TABLE IF NOT EXISTS tg_unknown_chats (
  chat_id   BIGINT PRIMARY KEY,
  title     TEXT,
  last_text TEXT,
  last_seen TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE tg_unknown_chats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read tg_unknown_chats" ON tg_unknown_chats;
CREATE POLICY "auth read tg_unknown_chats" ON tg_unknown_chats
  FOR SELECT TO authenticated USING (true);
NOTIFY pgrst, 'reload schema';
