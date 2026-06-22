-- Bulletproof album handling. Telegram sends each photo in an album as a
-- separate webhook update sharing media_group_id; the caption (and thus the VIN)
-- can arrive in any order. We park un-VIN'd album photos with their file_id and
-- download them once a sibling reveals the VIN.
ALTER TABLE wa_inbound_messages ADD COLUMN IF NOT EXISTS media_group_id TEXT;
ALTER TABLE wa_inbound_messages ADD COLUMN IF NOT EXISTS pending_file_id TEXT;
CREATE INDEX IF NOT EXISTS idx_wa_inbound_mgid
  ON wa_inbound_messages(media_group_id) WHERE media_group_id IS NOT NULL;
NOTIFY pgrst, 'reload schema';
