-- Photo binding: stop a car's photos landing on the car before it.
--
-- A photo with no VIN of its own used to inherit whatever VIN the sender last
-- typed (the 10-minute session). That is right for "type the VIN, then send a
-- burst of photos" and WRONG the moment a worker shoots the next car before
-- naming it — and album photos, whose caption rides on one member and can be
-- delivered after its siblings, hit the wrong branch constantly.
--
-- The webhook now parks anything it can't bind from evidence on the photo
-- itself (its own caption, or a sibling in the same album). session_vin_at_
-- receipt records what the session WOULD have said, so a parked photo can
-- settle back to it a few seconds later once its caption has had time to
-- arrive — and, just as importantly, so a later VIN for a DIFFERENT car can
-- tell that this photo was already spoken for and leave it alone.
ALTER TABLE wa_inbound_messages
  ADD COLUMN IF NOT EXISTS session_vin_at_receipt TEXT;

-- The settle sweep runs inline on every incoming update (no cron, same as the
-- rest of this pipeline), so its scan has to stay cheap.
CREATE INDEX IF NOT EXISTS idx_wa_inbound_parked
  ON wa_inbound_messages (received_at)
  WHERE pending_file_id IS NOT NULL AND media_path IS NULL;

NOTIFY pgrst, 'reload schema';
